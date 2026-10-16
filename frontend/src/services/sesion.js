/**
 * Sesion por COOKIE (HttpOnly) del HUB, o la del tractorista.
 *
 * El token ya no viaja en la URL ni se guarda en localStorage: el navegador
 * manda la cookie solo. Aqui:
 *  - se parchea window.fetch para que TODA llamada al backend vaya con
 *    credentials:'include' (y sin el header Authorization viejo), con el
 *    header X-Ver-Como si un admin esta simulando a otro usuario, y con un
 *    reintento si la cookie vencio (se renueva con el HUB una vez);
 *  - cargarSesion() pide /api/auth/me y deja en localStorage SOLO los datos
 *    de pantalla que ya usaban las paginas (nombre, rol, permisos...).
 */
import { verComoActivo } from './verComo'
import { huboActividad } from './actividad'
import { borrarTelefonoDadoDeBaja, esTelefonoDeBaja } from './dispositivo.js'

export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8007').replace(/\/$/, '')
export const HUB_API_URL = (import.meta.env.VITE_HUB_API_URL || 'https://hubbk.miraigprovefrut.com/api').replace(/\/$/, '')
export const HUB_LOGIN_URL = import.meta.env.VITE_HUB_LOGIN_URL || 'https://miraigprovefrut.com/login'

const fetchOriginal = window.fetch.bind(window)
const esApi = (url) => typeof url === 'string' && url.startsWith(API_URL)
const RUTAS_SIN_REINTENTO = ['/api/tractoristas/', '/api/auth/me']

export const esTractorista = () => localStorage.getItem('usuario_tipo') === 'tractorista'
/** Sesion de telefono de campo del HUB (supervisores sin señal): no se corta por inactividad. */
export const esTelefonoCampo = () => localStorage.getItem('usuario_campo') === '1'

let renovando = null
/** Renueva la cookie de acceso con el refresh del HUB (una sola a la vez). */
export function renovarSesion() {
  if (esTractorista()) return Promise.resolve(false)
  if (!renovando) {
    renovando = fetchOriginal(`${HUB_API_URL}/refresh/`, { method: 'POST', credentials: 'include' })
      .then(r => r.ok)
      .catch(() => false)
      .finally(() => { setTimeout(() => { renovando = null }, 1000) })
  }
  return renovando
}

window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url
  if (!esApi(url)) return fetchOriginal(input, init)
  const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined))
  headers.delete('Authorization')            // la sesion va en la cookie
  const simulado = verComoActivo()
  if (simulado) headers.set('X-Ver-Como', simulado)
  const opciones = { ...init, headers, credentials: 'include' }
  let res = await fetchOriginal(input, opciones)
  // Sin actividad reciente no se renueva (la sesion vence a las 10 h sin
  // actividad); al volver el usuario se renueva en main.jsx.
  if (res.status === 401 && !esTractorista() && !esTelefonoCampo() && !huboActividad()) return res
  if (res.status === 401 && esTractorista()) {
    const detalle = await res.clone().json().then(d => d.detail).catch(() => '')
    if (esTelefonoDeBaja(detalle)) { await borrarTelefonoDadoDeBaja(); return res }
  }
  if (res.status === 401 && !RUTAS_SIN_REINTENTO.some(r => url.includes(r))) {
    if (await renovarSesion()) {
      res = await fetchOriginal(input, opciones)
    }
    if (res.status === 401) window.dispatchEvent(new Event('session-expired'))
  }
  return res
}

const CLAVES = ['usuario_nombre', 'usuario_username', 'usuario_correo', 'usuario_rol', 'usuario_departamento',
  'usuario_empresa', 'usuario_jefe', 'usuario_tipo', 'usuario_campo', 'user_permisos_operagricola']

export function limpiarDatosSesion() {
  CLAVES.forEach(k => localStorage.removeItem(k))
  localStorage.removeItem('token')   // de la version anterior
}

/**
 * Carga la sesion. Devuelve 'ok' | 'sin_sesion' | 'sin_acceso' | 'sin_conexion'.
 */
// Con señal debil el servidor puede no responder nunca: se corta a los 5 s
// (y se entra sin conexion con la sesion guardada, ver main.jsx).
const conLimite = (url, ms = 5000) => {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t))
}

/** ¿Hay datos de una sesion anterior en el celular? (para entrar sin internet) */
export const haySesionGuardada = () => !!(localStorage.getItem('usuario_tipo') && localStorage.getItem('usuario_nombre'))

export async function cargarSesion() {
  let res
  // El celular ya sabe que no tiene red: no esperar el plazo
  if (navigator.onLine === false) return 'sin_conexion'
  try {
    res = await conLimite(`${API_URL}/api/auth/me`)
    if (res.status === 401 && await renovarSesion()) res = await conLimite(`${API_URL}/api/auth/me`)
  } catch {
    return 'sin_conexion'
  }
  if (res.status === 401) {
    const detalle = await res.clone().json().then(d => d.detail).catch(() => '')
    if (esTelefonoDeBaja(detalle)) { await borrarTelefonoDadoDeBaja(); return 'sin_sesion' }
    limpiarDatosSesion(); return 'sin_sesion'
  }
  if (res.status === 403) { limpiarDatosSesion(); return 'sin_acceso' }
  if (!res.ok) return 'sin_conexion'
  const d = await res.json()
  // "Ver como" (services/verComo.js) ya dejo en localStorage la identidad y
  // los permisos simulados: no se pisan con los reales.
  if (!verComoActivo()) {
    localStorage.setItem('usuario_nombre', d.nombre || '')
    localStorage.setItem('usuario_username', d.username || '')
    localStorage.setItem('usuario_correo', d.correo || '')
    localStorage.setItem('usuario_rol', d.rol || '')
    localStorage.setItem('usuario_departamento', d.departamento || '')
    localStorage.setItem('usuario_empresa', d.empresa || '')
    localStorage.setItem('usuario_jefe', d.jefe || '')
    localStorage.setItem('user_permisos_operagricola', JSON.stringify({ es_admin: !!d.es_admin, pestanas: d.pestanas || [] }))
  }
  localStorage.setItem('usuario_tipo', d.tipo === 'tractorista' ? 'tractorista' : 'hub')
  if (d.campo) localStorage.setItem('usuario_campo', '1')
  else localStorage.removeItem('usuario_campo')
  localStorage.removeItem('token')
  return 'ok'
}

/** URL del HUB (de donde se abre el modulo). */
export const HUB_URL = new URL(HUB_LOGIN_URL).origin

/**
 * Cierra la pestaña del modulo (el HUB la abrio con window.open). Si el
 * navegador no lo permite (la pestaña no la abrio un script), va a `destino`.
 */
export function cerrarPestana(destino = HUB_URL) {
  window.close()
  // Si el navegador no deja cerrarla: el tractorista (kiosko) vuelve a su login;
  // un usuario del HUB ve el aviso en la misma pestana (no se abre el HUB).
  setTimeout(() => {
    if (window.closed) return
    if (destino && destino !== HUB_URL) window.location.href = destino
    else mostrarSesionCerrada()
  }, 300)
}

/** Cierra la sesion: la del tractorista en este modulo, o la del HUB (todo el ecosistema). */
export async function cerrarSesion() {
  try {
    if (esTractorista()) {
      await fetch(`${API_URL}/api/tractoristas/logout`, { method: 'POST' })
    } else {
      await fetchOriginal(`${HUB_API_URL}/logout/`, { method: 'POST', credentials: 'include' })
    }
  } catch { /* sin red: igual se limpia */ }
  limpiarDatosSesion()
}

/**
 * Pantalla final cuando el navegador no permite cerrar la pestana (solo deja
 * cerrar pestanas abiertas por script y sin navegacion interna). No se abre el
 * HUB: el usuario cierra la pestana a mano.
 */
export function mostrarSesionCerrada() {
  document.title = 'Sesión finalizada'
  document.body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#1a1a1a;color:#fff;
                font-family:sans-serif;flex-direction:column;gap:1rem;text-align:center;padding:1rem;">
      <div style="font-size:3rem;">&#128274;</div>
      <h2 style="margin:0;">Sesión finalizada</h2>
      <p style="margin:0;color:#bbb;max-width:420px;">Ya puede cerrar esta pestaña.</p>
    </div>`
}
