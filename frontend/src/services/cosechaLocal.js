/**
 * Fichas de cosecha que funcionan SIN INTERNET (mismo esquema que
 * registrosLocales.js de la bitacora).
 *
 * La ficha (camion + seguridad), sus productos y el "Enviar camion" se guardan
 * primero en el celular y se encolan para el servidor. Cada ficha nueva lleva
 * `cliente_id` (generado aqui): el servidor no duplica reintentos y la ubica
 * aunque el celular todavia no conozca su id. El numero COS-... lo pone el
 * servidor al sincronizar (mientras tanto la ficha sale "por asignar").
 */
import { cacheData, getCachedData, getPendingItems } from './syncQueue'

const CLAVE = 'cosecha_locales'

export const claveFicha = (f) => f.cliente_id ? `c:${f.cliente_id}` : `i:${f.id}`

export async function leerFichasLocales() {
  try { return (await getCachedData(CLAVE)) || [] } catch { return [] }
}

export async function guardarFichaLocal(ficha) {
  const locales = await leerFichasLocales()
  const k = claveFicha(ficha)
  await cacheData(CLAVE, [{ ...ficha, _local: true, _actualizado: Date.now() }, ...locales.filter(l => claveFicha(l) !== k)])
}

/** Texto que identifica las acciones en cola de una ficha (por cliente_id o por id). */
const referencias = (f) => [f.cliente_id, f.id && `/cosecha-transp/${f.id}/`, f.id && `"id_transporte":${f.id}`, f.id && `/cosecha-transp/${f.id}"`]
  .filter(Boolean)

export async function fichaTienePendientes(f) {
  let pend = []
  try { pend = await getPendingItems() } catch { pend = [] }
  const refs = referencias(f)
  return pend.some(p => { const t = `${p.url}" ${JSON.stringify(p.body || {})}`; return refs.some(r => t.includes(r)) })
}

/** Lo del servidor + lo local que aun no se sincroniza (manda lo local mientras tenga cola). */
export async function mezclarFichas(servidor) {
  const locales = await leerFichasLocales()
  if (!locales.length) return servidor
  let pend = []
  try { pend = await getPendingItems() } catch { pend = [] }
  const textos = pend.map(p => `${p.url}" ${JSON.stringify(p.body || {})}`)
  const conCola = (f) => { const refs = referencias(f); return textos.some(t => refs.some(r => t.includes(r))) }
  const porCliente = new Map(servidor.filter(f => f.cliente_id).map(f => [f.cliente_id, f]))
  const porId = new Map(servidor.map(f => [f.id, f]))
  const enServidor = (l) => (l.cliente_id && porCliente.get(l.cliente_id)) || (l.id && porId.get(l.id))

  const vigentes = locales.filter(l => conCola(l) || (!enServidor(l) && Date.now() - (l._actualizado || 0) < 7 * 24 * 3600 * 1000))
  if (vigentes.length !== locales.length) {
    try { await cacheData(CLAVE, vigentes) } catch { /* nada */ }
  }
  const tapadas = new Set()
  const encima = vigentes.map(l => {
    const s = enServidor(l)
    if (s) tapadas.add(s.id)
    return s ? { ...s, ...l, id: s.id, numeracion: s.numeracion || l.numeracion } : l
  })
  return [...encima, ...servidor.filter(f => !tapadas.has(f.id))].filter(f => f.estado !== 'Eliminado')
}

/** Foto a JPEG comprimido (data URL) para guardarla en la cola sin internet. */
export function comprimirFoto(file, max = 1280, calidad = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const escala = Math.min(1, max / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * escala); c.height = Math.round(img.height * escala)
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/jpeg', calidad))
    }
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e) }
    img.src = url
  })
}
