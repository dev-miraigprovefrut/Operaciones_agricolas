/**
 * MODO TABLET: la app corre como APK ("Tractor Nintanga", Capacitor) en una
 * tablet fija en el tractor (reemplaza a la Raspberry).
 *
 * - La PRIMERA vez se elige el tractor del catalogo en la misma tablet (como el
 *   tractor.txt de la Raspberry); se da de baja en Catalogos > Tractoristas. Su llave (la misma de dispositivo.js) viaja en la
 *   cabecera X-Equipo; el tractor queda fijo en la bitacora.
 * - Telemetria (como telemetria.py de la Raspberry): GPS de la tablet + horas
 *   de motor. La tablet va conectada al cargador del tractor: al conectarse el
 *   cargador empieza el conteo de horas y al desconectarlo se cierra. Cada
 *   reporte se guarda en una cola local y se envia al haber internet, con su
 *   hora real. Los registros de actividades usan tambien el GPS de la tablet.
 *
 * Los plugins nativos se usan por window.Capacitor.Plugins (no hace falta
 * importarlos en la web: fuera del APK todo esto no hace nada).
 */
import { llaveDispositivo, nombreDispositivo } from './dispositivo.js'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8007'
const CLAVE_TABLET = 'oa_tablet'
const CLAVE_COLA = 'oa_telemetria_cola'
const CLAVE_ULTIMO = 'oa_telemetria_ultimo'
const CLAVE_CONTANDO = 'oa_motor_contando'
const INTERVALO_MS = 60 * 1000
const REVISION_MS = 10 * 1000
const MAX_COLA = 20000                     // ~2 semanas de reportes por minuto

export const esApp = () => !!window.Capacitor?.isNativePlatform?.()
const plugin = nombre => window.Capacitor?.Plugins?.[nombre]

export function tabletVinculada() {
  try { return JSON.parse(localStorage.getItem(CLAVE_TABLET) || 'null') } catch { return null }
}
export const tractorFijo = () => (esApp() && tabletVinculada()?.tractor) || ''

/** Cabecera de la tablet para las llamadas al backend (solo en el APK vinculado). */
export const cabeceraEquipo = () => (esApp() && tabletVinculada() ? { 'X-Equipo': llaveDispositivo() } : {})

// Sesion de CADA tractorista que entro en la tablet (la del login con internet,
// 30 dias). Cada accion va con la de quien la hizo, aunque se envie despues
// desde la cola y otro tractorista haya entrado en medio.
const CLAVE_SESIONES = 'oa_tablet_sesiones'
const leerSesiones = () => { try { return JSON.parse(localStorage.getItem(CLAVE_SESIONES) || '{}') || {} } catch { return {} } }
export function guardarSesionTablet(username, token) {
  if (!username || !token) return
  const s = leerSesiones()
  s[username.toLowerCase()] = token
  localStorage.setItem(CLAVE_SESIONES, JSON.stringify(s))
}
export const sesionTablet = username => (esApp() && username ? leerSesiones()[username.toLowerCase()] : null) || null

/** Tractores del catalogo para elegir el de esta tablet (primera apertura). */
export async function tractoresCatalogo() {
  const res = await fetch(`${API_URL}/api/tractores`)
  if (!res.ok) throw new Error('No se pudo leer el catálogo de tractores')
  return (await res.json()).map(t => t.nombre || `${t.marca} ${t.modelo} - ${t.numeracion}`).filter(Boolean).sort()
}

export async function vincularTablet(tractor) {
  const res = await fetch(`${API_URL}/api/tablets/registrar`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tractor, llave: llaveDispositivo(), descripcion: nombreDispositivo() })
  })
  const d = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(d.detail || 'No se pudo vincular la tablet')
  localStorage.setItem(CLAVE_TABLET, JSON.stringify({ tractor: d.tractor, id: d.id }))
  return d.tractor
}

// ------------------------------------------------------------- telemetria
const leerCola = () => { try { return JSON.parse(localStorage.getItem(CLAVE_COLA) || '[]') } catch { return [] } }
const guardarCola = c => localStorage.setItem(CLAVE_COLA, JSON.stringify(c.slice(-MAX_COLA)))
const ahoraLocal = () => {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19)
}

// GPS de la TABLET: se sigue la posicion todo el tiempo y se guarda la ultima
// (la usan la telemetria y los registros de actividades).
let ultimaPos = null
async function seguirGps() {
  const geo = plugin('Geolocation')
  if (!geo) return
  try {
    await geo.watchPosition({ enableHighAccuracy: true, timeout: 30000, maximumAge: 10000 }, (p) => {
      if (p?.coords) ultimaPos = { lat: p.coords.latitude, lon: p.coords.longitude, t: Date.now() }
    })
  } catch { /* sin permiso: queda sin ubicacion */ }
}

async function posicion() {
  if (ultimaPos && Date.now() - ultimaPos.t < 2 * INTERVALO_MS) return ultimaPos
  const geo = plugin('Geolocation')
  if (!geo) return null
  try {
    const p = await geo.getCurrentPosition({ enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 })
    ultimaPos = { lat: p.coords.latitude, lon: p.coords.longitude, t: Date.now() }
    return ultimaPos
  } catch { return ultimaPos }
}

/** Ubicacion de la tablet "lat,lon" para los registros (null si no es el APK o no hay GPS). */
export async function ubicacionTablet() {
  if (!esApp() || !tabletVinculada()) return null
  const p = await posicion()
  return p ? `${p.lat.toFixed(6)},${p.lon.toFixed(6)}` : null
}

async function motorEncendido() {
  try {
    const b = await plugin('Device')?.getBatteryInfo()
    return !!b?.isCharging
  } catch { return false }
}

/** Guarda en la cola las horas desde la ultima muestra (como maximo 2 intervalos:
 * si la app estuvo cerrada no se inventan horas). */
async function registrarHoras(ahora) {
  const ultimo = Number(localStorage.getItem(CLAVE_ULTIMO) || ahora)
  localStorage.setItem(CLAVE_ULTIMO, String(ahora))
  const horas = Math.min(Math.max(ahora - ultimo, 0), 2 * INTERVALO_MS) / 3600000
  if (horas <= 0) return
  const pos = await posicion()
  const cola = leerCola()
  cola.push({ horas_delta: Number(horas.toFixed(5)), lat: pos?.lat ?? null, lon: pos?.lon ?? null,
    fecha: ahoraLocal(), operador: localStorage.getItem('usuario_nombre') || null })
  guardarCola(cola)
}

/**
 * Horas de motor: al CONECTAR el cargador empieza el conteo (desde ese
 * momento, no antes); mientras siga cargando se registra cada minuto; al
 * DESCONECTARLO se registra el tramo final. Se revisa cada 10 s y al instante
 * con el evento de carga del navegador.
 */
let revisando = false
async function revisarCarga() {
  if (revisando) return
  revisando = true
  try {
    const ahora = Date.now()
    const cargando = await motorEncendido()
    const contando = localStorage.getItem(CLAVE_CONTANDO) === '1'
    if (cargando && !contando) {                       // se conecto: arranca el conteo
      localStorage.setItem(CLAVE_CONTANDO, '1')
      localStorage.setItem(CLAVE_ULTIMO, String(ahora))
    } else if (cargando && ahora - Number(localStorage.getItem(CLAVE_ULTIMO) || ahora) >= INTERVALO_MS) {
      await registrarHoras(ahora)
    } else if (!cargando && contando) {                // se desconecto: cierra el tramo
      await registrarHoras(ahora)
      localStorage.removeItem(CLAVE_CONTANDO)
    }
  } finally { revisando = false }
}

let enviando = false
async function enviarCola() {
  if (enviando || !navigator.onLine) return
  enviando = true
  try {
    let cola = leerCola()
    while (cola.length) {
      const r = cola[0]
      let res
      try {
        res = await fetch(`${API_URL}/api/telemetria`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...cabeceraEquipo() },
          body: JSON.stringify(r)
        })
      } catch { break }                                 // sin red: se reintenta despues
      if (res.status === 401) {                         // tablet dada de baja
        localStorage.removeItem(CLAVE_TABLET)
        break
      }
      if (!res.ok && res.status < 500) console.warn('telemetria descartada', res.status)
      if (!res.ok && res.status >= 500) break           // Mantenimiento caido: reintentar
      cola = leerCola().slice(1)
      guardarCola(cola)
    }
  } finally { enviando = false }
}

let iniciada = false
/** En el APK vinculado: pantalla siempre encendida, permiso de GPS y telemetria cada minuto. */
export async function iniciarModoTablet() {
  if (iniciada || !esApp() || !tabletVinculada()) return
  iniciada = true
  try { await plugin('KeepAwake')?.keepAwake() } catch { /* sin plugin */ }
  try { await plugin('Geolocation')?.requestPermissions() } catch { /* el usuario puede negarlo */ }
  seguirGps()
  // Al abrir la app no se cuentan horas de cuando estuvo cerrada
  localStorage.removeItem(CLAVE_CONTANDO)
  revisarCarga()
  setInterval(revisarCarga, REVISION_MS)
  try {                                                // aviso inmediato al conectar/desconectar
    const bateria = await navigator.getBattery?.()
    bateria?.addEventListener('chargingchange', revisarCarga)
  } catch { /* el WebView no lo soporta: queda la revision cada 10 s */ }
  setInterval(enviarCola, INTERVALO_MS)
  window.addEventListener('online', enviarCola)
  enviarCola()
}

/** Para la pantalla de estado: reportes pendientes de enviar. */
export const telemetriaPendiente = () => leerCola().length
