/**
 * Telefono registrado del tractorista.
 *
 * - Llave del telefono: 32 bytes al azar que solo viven en este telefono; el
 *   servidor guarda su SHA-256 y ata la sesion a ella (un telefono activo por
 *   tractorista; se da de baja en Catalogos > Tractoristas).
 * - Ingreso SIN internet: al entrar con internet se guarda una huella (PBKDF2)
 *   del codigo de 4 digitos; sin internet se compara contra ella. Nunca se
 *   guarda el codigo. 3 intentos fallidos bloquean 15 minutos.
 */
const CLAVE_LLAVE = 'oa_dispositivo'
const CLAVE_HUELLA = 'tractorista_pin_offline'
const CLAVE_NOMBRE = 'tractorista_nombre'
const CLAVE_FALLOS = 'tractorista_fallos_offline'
const MAX_FALLOS = 3
const BLOQUEO_MS = 15 * 60 * 1000

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')

export function llaveDispositivo() {
  let llave = localStorage.getItem(CLAVE_LLAVE)
  if (!llave || llave.length < 64) {
    llave = hex(crypto.getRandomValues(new Uint8Array(32)))
    localStorage.setItem(CLAVE_LLAVE, llave)
  }
  return llave
}

/** "Android 14 · Chrome" para reconocer el telefono en el catalogo. */
export function nombreDispositivo() {
  const ua = navigator.userAgent || ''
  const so = (ua.match(/Android [\d.]+/) || ua.match(/iPhone OS [\d_]+/) || ua.match(/Windows NT [\d.]+/) || ['Teléfono'])[0]
    .replace(/_/g, '.').replace('iPhone OS', 'iPhone iOS')
  const modelo = (ua.match(/Android [\d.]+; ([^;)]+)/) || [])[1]
  const nav = /EdgA?\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador'
  return [so, modelo && modelo !== 'K' ? modelo.trim() : null, nav].filter(Boolean).join(' · ')
}

async function huella(username, pin) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const sal = new TextEncoder().encode(`oa|${username.toLowerCase()}|${llaveDispositivo()}`)
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: 150000 }, material, 256))
}

/** Tras entrar CON internet: deja listo el ingreso sin internet. */
export async function guardarIngresoOffline(username, pin, nombre) {
  try {
    localStorage.setItem(CLAVE_HUELLA, `${username.toLowerCase()}:${await huella(username, pin)}`)
    localStorage.setItem(CLAVE_NOMBRE, nombre || '')
    localStorage.removeItem(CLAVE_FALLOS)
  } catch { /* sin crypto.subtle (http): no hay ingreso sin internet */ }
}

export const hayIngresoOffline = username =>
  (localStorage.getItem(CLAVE_HUELLA) || '').startsWith(`${(username || '').toLowerCase()}:`)

export const nombreGuardado = () => localStorage.getItem(CLAVE_NOMBRE) || ''

/** Ingreso SIN internet. Devuelve true o lanza Error con el motivo. */
export async function ingresarOffline(username, pin) {
  const guardada = localStorage.getItem(CLAVE_HUELLA) || ''
  if (!hayIngresoOffline(username)) throw new Error('Sin conexión. La primera vez debe ingresar con internet.')
  const fallos = JSON.parse(localStorage.getItem(CLAVE_FALLOS) || '{"n":0,"hasta":0}')
  if (fallos.hasta > Date.now()) {
    throw new Error(`Demasiados intentos. Intente de nuevo en ${Math.ceil((fallos.hasta - Date.now()) / 60000)} min.`)
  }
  if (guardada.split(':')[1] !== await huella(username, pin)) {
    const n = fallos.n + 1
    localStorage.setItem(CLAVE_FALLOS, JSON.stringify(n >= MAX_FALLOS ? { n: 0, hasta: Date.now() + BLOQUEO_MS } : { n, hasta: 0 }))
    throw new Error('Código incorrecto')
  }
  localStorage.removeItem(CLAVE_FALLOS)
  localStorage.setItem('usuario_nombre', nombreGuardado())
  localStorage.setItem('usuario_username', username)
  localStorage.setItem('usuario_tipo', 'tractorista')
  return true
}

/**
 * El telefono fue DADO DE BAJA (perdido o cambio de celular): se borra todo lo
 * del tractorista en este telefono, incluida la cola sin enviar (no se sabe
 * quien la tiene) y la llave. Vuelve al ingreso.
 */
export async function borrarTelefonoDadoDeBaja() {
  Object.keys(localStorage).filter(k => k.startsWith('tractorista_') || k.startsWith('usuario_') || k === CLAVE_LLAVE
    || k === 'user_permisos_operagricola').forEach(k => localStorage.removeItem(k))
  try {
    if (indexedDB.databases) {
      for (const d of await indexedDB.databases()) if (d.name) indexedDB.deleteDatabase(d.name)
    } else {
      indexedDB.deleteDatabase('opagricola_offline')
    }
  } catch { /* nada que borrar */ }
  window.location.href = '/login-tractorista?baja=1'
}

export const esTelefonoDeBaja = detalle => /dado de baja/i.test(detalle || '')
