/**
 * Chat de ayuda (Chatbot / Soporte Usuario).
 *
 * La URL NO sale de variables de entorno: es el LINK DE PRODUCCION del modulo
 * Soporte Usuario (clave 'administracion') en la tabla de modulos del HUB, igual
 * que el chat del HUB. Si se cambia ahi, cambia en todas las apps sin recompilar.
 * La sesion viaja en la cookie del HUB (mirai_access): nunca token en la URL.
 */
import { useEffect, useState } from 'react'

const HUB_API_URL = (import.meta.env.VITE_HUB_API_URL || 'https://hubbk.miraigprovefrut.com/api').replace(/\/$/, '')
const MODULO_AYUDA = 'administracion'

let pedido = null

/** Promesa con la URL del chat (origen del link de produccion + '/'), o null. */
export function urlAyuda() {
  if (!pedido) {
    pedido = fetch(`${HUB_API_URL}/modulos-config/`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : []))
      .then(lista => {
        const m = (Array.isArray(lista) ? lista : []).find(x => x.clave === MODULO_AYUDA)
        const link = (m?.link_produccion || '').trim()
        if (!link) return null
        return `${new URL(/^https?:\/\//i.test(link) ? link : `https://${link}`).origin}/`
      })
      .catch(() => { pedido = null; return null })
  }
  return pedido
}

/** Hook: URL del chat de ayuda (null mientras carga o si el HUB no responde). */
export function useUrlAyuda() {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let vivo = true
    urlAyuda().then(u => { if (vivo) setUrl(u) })
    return () => { vivo = false }
  }, [])
  return url
}
