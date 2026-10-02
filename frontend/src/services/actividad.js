/**
 * Actividad del usuario (clic, tecla, mouse, toque, scroll).
 *
 * La sesion de MirAI vence tras 10 h SIN ACTIVIDAD: el refresh dura 10 h y solo
 * se renueva cuando el usuario hace algo. Por eso las renovaciones automaticas
 * (temporizador, 401 del polling de notificaciones) solo ocurren si hubo
 * actividad reciente; con la pestana abierta pero sin tocarla, la sesion se
 * deja vencer.
 */
const VENTANA_MS = 5 * 60 * 1000          // "reciente" = ultimos 5 minutos
let ultima = Date.now()
const alVolver = new Set()

const marcar = () => {
  const antes = ultima
  ultima = Date.now()
  // Volvio despues de estar inactivo: avisar (p.ej. renovar la sesion ya).
  if (ultima - antes > VENTANA_MS) alVolver.forEach(fn => { try { fn() } catch { /* nada */ } })
}

;['click', 'keydown', 'mousemove', 'touchstart', 'scroll', 'wheel'].forEach(ev =>
  window.addEventListener(ev, marcar, { passive: true, capture: true }))

/** ¿Hubo actividad en los ultimos `ms` milisegundos? */
export const huboActividad = (ms = VENTANA_MS) => Date.now() - ultima < ms

/** Registra una funcion que se llama cuando el usuario vuelve tras estar inactivo. */
export const alVolverActividad = (fn) => { alVolver.add(fn); return () => alVolver.delete(fn) }
