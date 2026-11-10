import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { API_URL, cargarSesion, cerrarSesion, limpiarDatosSesion, renovarSesion, esTractorista, esTelefonoCampo, cerrarPestana, HUB_LOGIN_URL, HUB_URL, haySesionGuardada, esDominioDron } from './services/sesion.js'
import { huboActividad, alVolverActividad } from './services/actividad.js'
import { esApp, tabletVinculada, iniciarModoTablet } from './services/tablet.js'

// Enlaces viejos del HUB traen #token=... en la URL: ya no se usa (la sesion
// va en la cookie del HUB), solo se limpia.
if (window.location.hash.includes('token=') || window.location.search.includes('token=')) {
  window.history.replaceState(null, '', '/')
}
if (window.location.pathname.startsWith('/sso-login')) {
  window.history.replaceState(null, '', '/')
}

// tractoristas.miraigprovefrut.com (Bitacora Tractor) y dron.miraigprovefrut.com
// (Bitacora Dron, pilotos): mismo ingreso con cedula + codigo
const esDominioTractoristas = window.location.hostname.startsWith('tractoristas') || esDominioDron()
const esRutaPublica = window.location.pathname.startsWith('/login-tractorista') || window.location.pathname.startsWith('/vincular-tablet')
  || window.location.pathname.startsWith('/kiosko')

function pantalla({ icono, color, titulo, texto, botones = [] }) {
  document.title = titulo
  const root = document.getElementById('root')
  if (!root) return
  root.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#1a1a1a;color:white;font-family:sans-serif;flex-direction:column;gap:1rem;text-align:center;padding:1rem;">
      <i class="bx ${icono}" style="font-size:3rem;color:${color};"></i>
      <h2 style="margin:0;">${titulo}</h2>
      <p style="margin:0;color:#bbb;max-width:420px;">${texto}</p>
      <div style="display:flex;gap:.75rem;flex-wrap:wrap;justify-content:center;">
        ${botones.map((b, i) => `<button data-i="${i}" style="padding:.6rem 1.2rem;border-radius:8px;border:none;cursor:pointer;font-weight:600;background:${i === 0 ? '#7b1fa2' : '#444'};color:white;">${b.texto}</button>`).join('')}
      </div>
    </div>`
  root.querySelectorAll('button').forEach(btn => { btn.onclick = botones[+btn.dataset.i].accion })
}

// Sesion vencida o no valida: se cierra la pestaña del modulo (el HUB la abrio);
// si el navegador no lo permite, al login del HUB. Los tractoristas vuelven a
// su login de cedula + PIN.
function sesionExpirada() {
  // Tablet del tractor: la pantalla tipo kiosko maneja su propio ingreso
  if (esApp()) { if (!window.location.pathname.startsWith('/kiosko')) window.location.href = '/kiosko'; return }
  if (esTractorista() || esDominioTractoristas) { window.location.href = '/login-tractorista'; return }
  pantalla({ icono: 'bx-lock-alt', color: '#ff8a80', titulo: 'Sesión expirada',
    texto: 'Su sesión ha finalizado. Cerrando...', botones: [] })
  cerrarPestana(HUB_LOGIN_URL)
}

function renderizar() {
  createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
  window.addEventListener('session-expired', sesionExpirada)
  // Sesion por INACTIVIDAD (10 h): la cookie del HUB se renueva solo si el
  // usuario hizo algo (cada 20 min mientras trabaja, y al volver tras estar
  // inactivo). Si al volver ya vencio, se cierra la pestaña.
  setInterval(() => { if (huboActividad(20 * 60 * 1000)) renovarSesion() }, 20 * 60 * 1000)
  alVolverActividad(async () => {
    if (esTractorista() || !navigator.onLine) return
    try {
      const r = await fetch(`${API_URL}/api/auth/me`)
      if (r.status === 401 && !(await renovarSesion())) sesionExpirada()
    } catch { /* sin conexion: se sigue trabajando con lo guardado */ }
  })
  // La APLICACION se cierra tras 4 h sin actividad en ella (aparte de la
  // sesion de MirAI de 10 h): usuario del HUB -> se cierra la pestaña (el HUB
  // sigue); tractorista -> se cierra su sesion y vuelve al login de PIN.
  const revisarInactividad = () => {
    if (window.location.pathname.startsWith('/login-tractorista')) return
    // Telefono de campo: entre un camion y otro pasan horas; la sesion de jornada
    // (16 h) la controla el HUB.
    if (esTelefonoCampo()) return
    // Tractorista: telefono registrado (se da de baja en Catalogos > Tractoristas)
    if (esTractorista() || esDominioTractoristas) return
    if (!huboActividad(CIERRE_POR_INACTIVIDAD_MS)) cerrarPorInactividad()
  }
  setInterval(revisarInactividad, 60 * 1000)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') revisarInactividad() })
}

const CIERRE_POR_INACTIVIDAD_MS = 4 * 60 * 60 * 1000
let cerrandoPorInactividad = false
async function cerrarPorInactividad() {
  if (cerrandoPorInactividad) return
  if ((esTractorista() || esDominioTractoristas) && !navigator.onLine) return   // sin internet no se podria volver a entrar
  cerrandoPorInactividad = true
  if (esTractorista() || esDominioTractoristas) {
    await cerrarSesion()   // borra la cookie del tractorista (conserva usuario/cedula guardados)
    window.location.href = '/login-tractorista'
    return
  }
  limpiarDatosSesion()
  pantalla({ icono: 'bx-time-five', color: '#ffb74d', titulo: 'Sesión cerrada por inactividad',
    texto: 'Pasaron 4 horas sin actividad en Operaciones Agrícolas. Cerrando...', botones: [] })
  cerrarPestana(HUB_URL)
}

async function iniciar() {
  // APK de la tablet del tractor: primero vincularla; despues telemetria siempre
  if (esApp() && !tabletVinculada() && !window.location.pathname.startsWith('/vincular-tablet')) {
    window.location.href = '/vincular-tablet'; return
  }
  // Tablet vinculada: siempre la interfaz del kiosko (como la Raspberry)
  if (esApp() && tabletVinculada() && !esRutaPublica) { window.location.href = '/kiosko'; return }
  if (esApp() && tabletVinculada() && window.location.pathname.startsWith('/login-tractorista')) { window.location.href = '/kiosko'; return }
  iniciarModoTablet()
  if (esRutaPublica) { renderizar(); return }
  const estado = await cargarSesion()
  if (estado === 'ok') { renderizar(); return }
  if (estado === 'sin_sesion') {
    if (esDominioTractoristas) { window.location.href = '/login-tractorista'; return }
    sesionExpirada()
    return
  }
  if (estado === 'sin_acceso') {
    pantalla({ icono: 'bx-block', color: '#ffb74d', titulo: 'Sin acceso',
      texto: 'Su usuario no tiene acceso al módulo Operaciones Agrícolas. Solicítelo al administrador del módulo.',
      botones: [] })
    // se deja leer el mensaje y se cierra la pestaña (o vuelve al HUB)
    setTimeout(() => cerrarPestana(HUB_URL), 3500)
    return
  }
  // SIN INTERNET: si el celular ya tiene la sesion guardada se entra igual y
  // se trabaja con lo guardado (la cola envia todo al volver la señal).
  if (haySesionGuardada()) { renderizar(); return }
  if (esDominioTractoristas) { window.location.href = '/login-tractorista'; return }
  pantalla({ icono: 'bx-wifi-off', color: '#ff8a80', titulo: 'Sin conexión',
    texto: 'No se pudo contactar al servidor. Revise su conexión e intente de nuevo.',
    botones: [{ texto: 'Reintentar', accion: () => window.location.reload() }] })
}

iniciar()
