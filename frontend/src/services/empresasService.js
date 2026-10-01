/**
 * Servicio para consumir las empresas (maestro Empresas, via el backend del
 * modulo). Copia sincronizada de ProgramaBase
 * (ver TEMA.md en el repo IT Team - Diseño Corporativo) -- este modulo es de
 * una sola empresa (Nintanga), pero consume el mismo contrato de API que los
 * modulos multi-empresa para no desincronizarse si el algoritmo cambia ahi.
 */

const API_BASE = import.meta.env?.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api/v1`
  : '/api/v1'

/** URL del logo (maestro Empresas: URL directa del tema). */
export const logoUrl = (empresa) => empresa?.logo_url || ''

/** Obtiene la lista de empresas. */
export async function listarEmpresas() {
  const res = await fetch(`${API_BASE}/empresas`)
  if (!res.ok) throw new Error('No se pudieron cargar las empresas')
  return res.json()
}

// Modulo de una sola empresa (Nintanga): se cachea en memoria para los
// lugares que no pueden usar el hook useEmpresas (ej. las plantillas de
// impresion, que arman el HTML fuera de React).
const NUMERO_EMPRESA = '222'
let _cacheNintanga = null

export async function obtenerEmpresaNintanga() {
  if (_cacheNintanga) return _cacheNintanga
  const empresas = await listarEmpresas()
  _cacheNintanga = empresas.find(e => e.numero === NUMERO_EMPRESA) || null
  return _cacheNintanga
}
