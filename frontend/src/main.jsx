import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { API_URL, cargarSesion, renovarSesion, esTractorista, cerrarPestana, HUB_LOGIN_URL, HUB_URL } from './services/sesion.js'
import { huboActividad, alVolverActividad } from './services/actividad.js'

// Enlaces viejos del HUB traen #token=... en la URL: ya no se usa (la sesion
// va en la cookie del HUB), solo se limpia.
if (window.location.hash.includes('token=') || window.location.search.includes('token=')) {
  window.history.replaceState(null, '', '/')
}
if (window.location.pathname.startsWith('/sso-login')) {
  window.history.replaceState(null, '', '/')
}

const esDominioTractoristas = window.location.hostname.startsWith('tractoristas')
const esRutaPublica = window.location.pathname.startsWith('/login-tractorista')

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
    if (esTractorista()) return
    const r = await fetch(`${API_URL}/api/auth/me`)
    if (r.status === 401 && !(await renovarSesion())) sesionExpirada()
  })
}

async function iniciar() {
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
  pantalla({ icono: 'bx-wifi-off', color: '#ff8a80', titulo: 'Sin conexión',
    texto: 'No se pudo contactar al servidor. Revise su conexión e intente de nuevo.',
    botones: [{ texto: 'Reintentar', accion: () => window.location.reload() }] })
}

iniciar()
