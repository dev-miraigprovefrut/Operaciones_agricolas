/**
 * Hook React para cargar las empresas compartidas.
 * Copia sincronizada de ProgramaBase (ver TEMA.md en el repo
 * IT Team - Diseño Corporativo).
 *
 * Uso:
 *   const { empresas, cargando, error, recargar } = useEmpresas()
 */
import { useState, useEffect, useCallback } from 'react'
import { listarEmpresas } from './empresasService'

export function useEmpresas() {
  const [empresas, setEmpresas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  const recargar = useCallback(async () => {
    try {
      setCargando(true)
      setError(null)
      const data = await listarEmpresas()
      setEmpresas(data)
    } catch (e) {
      setError(e)
      setEmpresas([])
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    recargar()
  }, [recargar])

  return { empresas, cargando, error, recargar }
}
