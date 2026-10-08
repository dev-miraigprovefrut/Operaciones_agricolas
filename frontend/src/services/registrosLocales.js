/**
 * Registros de la bitacora (tractor / dron) que funcionan SIN INTERNET.
 *
 * Cada accion (crear, iniciar, pausar, reanudar, finalizar, editar, eliminar)
 * se guarda primero aqui, en el celular, con la HORA REAL en que se hizo, y se
 * encola para el servidor. Asi la actividad aparece al instante en la lista y
 * se puede pausar / finalizar aunque todavia no haya llegado al servidor.
 *
 * Cada registro nuevo lleva un `cliente_id` generado en el celular: el servidor
 * lo usa para no duplicar reintentos y para ubicarlo (PUT/DELETE
 * /registros/cliente/{cliente_id}) antes de que el celular conozca su id.
 *
 * Al leer del servidor se mezclan: mientras una accion local siga en la cola,
 * manda la version local; cuando ya no hay nada pendiente, la del servidor.
 */
import { cacheData, getCachedData, getPendingItems } from './syncQueue'

const CLAVE = 'registros_locales'

export const nuevoClienteId = () =>
  (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`)

/** Hora local (Ecuador) sin zona, como la guarda el servidor: 2026-10-08T14:05:33 */
export const ahoraLocal = () => {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19)
}

export const claveRegistro = (r) => r.cliente_id ? `c:${r.cliente_id}` : `i:${r.id}`

export async function leerLocales() {
  try { return (await getCachedData(CLAVE)) || [] } catch { return [] }
}

export async function guardarLocal(reg) {
  const locales = await leerLocales()
  const k = claveRegistro(reg)
  const otros = locales.filter(l => claveRegistro(l) !== k)
  await cacheData(CLAVE, [{ ...reg, _local: true, _actualizado: Date.now() }, ...otros])
}

/** URL del registro en el servidor: por cliente_id si lo tiene, si no por id. */
export const urlRegistro = (apiUrl, r) => r.cliente_id
  ? `${apiUrl}/api/registros/cliente/${encodeURIComponent(r.cliente_id)}`
  : `${apiUrl}/api/registros/${r.id}`

/** Evento del historial que corresponde a pasar al estado `nuevo`. */
export const accionDe = (anterior, nuevo) =>
  nuevo === 'Pausado' ? 'pausado'
    : nuevo === 'Finalizado' ? 'finalizado'
    : nuevo === 'Ejecutándose' ? (anterior === 'Pendiente' || !anterior ? 'inicio' : 'reanudado')
    : null

/**
 * Mezcla lo del servidor con lo local. Devuelve la lista para mostrar (sin
 * eliminados) y limpia lo local que ya quedo sincronizado.
 */
export async function mezclar(servidor) {
  const locales = await leerLocales()
  if (!locales.length) return servidor
  let pendientes = []
  try { pendientes = await getPendingItems() } catch { pendientes = [] }
  const textoPend = pendientes.map(p => `${p.url} ${JSON.stringify(p.body || {})}`)
  const tienePendiente = (l) => textoPend.some(t =>
    (l.cliente_id && t.includes(l.cliente_id)) || (!l.cliente_id && l.id && t.includes(`/api/registros/${l.id}`)))
  const porClave = new Map(servidor.map(r => [claveRegistro(r), r]))
  // por id tambien: un registro viejo editado sin internet se guardo con clave i:<id>
  const porId = new Map(servidor.filter(r => r.id).map(r => [r.id, r]))

  const vigentes = locales.filter(l => {
    const enServidor = porClave.get(claveRegistro(l)) || (l.id && porId.get(l.id))
    if (tienePendiente(l)) return true
    // sin nada pendiente: si ya esta en el servidor manda el servidor; si no
    // esta y no hay nada en cola (envio fallido definitivamente) se conserva 7 dias
    if (enServidor) return false
    return Date.now() - (l._actualizado || 0) < 7 * 24 * 3600 * 1000
  })
  if (vigentes.length !== locales.length) {
    try { await cacheData(CLAVE, vigentes) } catch { /* nada */ }
  }
  const tapados = new Set()
  const encima = vigentes.map(l => {
    const s = porClave.get(claveRegistro(l)) || (l.id && porId.get(l.id))
    if (s) tapados.add(claveRegistro(s))
    return s ? { ...s, ...l, id: s.id } : l
  })
  return [...encima, ...servidor.filter(r => !tapados.has(claveRegistro(r)))]
    .filter(r => r.estado !== 'Eliminado')
}
