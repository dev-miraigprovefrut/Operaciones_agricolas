/**
 * Modo de color del módulo: automático (según el navegador), claro fijo u oscuro fijo.
 *
 * Copia sincronizada de ProgramaBase (ver TEMA.md en el repo
 * IT Team - Diseño Corporativo). Si el programa base cambia este archivo,
 * replicar el cambio aquí.
 *
 * Uso:
 *   const { modo, setModo, darkMode, siguienteModo } = useModoColor()
 *   aplicarTema(empresa, darkMode)
 *
 * Comportamiento esperado en todos los módulos MirAI:
 * - Por defecto sigue el tema del navegador y reacciona en vivo si el usuario lo
 *   cambia mientras la app está abierta.
 * - Un botón permite fijar claro u oscuro (ver BotonModoColor.jsx).
 * - La elección se recuerda en localStorage.
 */
import { useState, useEffect, useCallback } from 'react'

const CONSULTA_OSCURO = '(prefers-color-scheme: dark)'
const CLAVE = 'modoColor'

export const MODOS = ['auto', 'claro', 'oscuro']

// Ciclo del botón
const SIGUIENTE = { auto: 'claro', claro: 'oscuro', oscuro: 'auto' }

const modoGuardado = () => {
  const modo = localStorage.getItem(CLAVE)
  if (MODOS.includes(modo)) return modo
  // Compatibilidad con módulos que guardaban un booleano
  return localStorage.getItem('darkMode') === 'true' ? 'oscuro' : 'auto'
}

export function useModoColor() {
  const [modo, setModo] = useState(modoGuardado)
  const [sistemaOscuro, setSistemaOscuro] = useState(
    () => window.matchMedia?.(CONSULTA_OSCURO).matches || false
  )

  // Seguir al navegador mientras el modo sea automático
  useEffect(() => {
    const mq = window.matchMedia?.(CONSULTA_OSCURO)
    if (!mq) return
    const alCambiar = (e) => setSistemaOscuro(e.matches)
    mq.addEventListener('change', alCambiar)
    return () => mq.removeEventListener('change', alCambiar)
  }, [])

  const darkMode = modo === 'auto' ? sistemaOscuro : modo === 'oscuro'

  useEffect(() => {
    localStorage.setItem(CLAVE, modo)
    localStorage.setItem('darkMode', darkMode)
  }, [modo, darkMode])

  const siguienteModo = useCallback(() => {
    setModo(actual => SIGUIENTE[actual] || 'auto')
  }, [])

  return { modo, setModo, darkMode, siguienteModo }
}
