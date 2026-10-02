/**
 * Aplica los colores de la empresa (Nintanga) como variables CSS globales.
 *
 * Uso:
 *   aplicarTema(empresa)          // modo claro
 *   aplicarTema(empresa, true)    // modo oscuro
 *
 * Copia sincronizada de ProgramaBase (ver TEMA.md en el repo
 * IT Team - Diseño Corporativo): este módulo no es multi-empresa, pero
 * igual lee los colores de la tabla `empresas` (vía GET /api/empresa-tema)
 * en vez de tenerlos escritos a mano, para no desincronizarse si cambian
 * ahí. Si el algoritmo de ProgramaBase cambia, replicar el cambio aquí.
 *
 * Después se usan var(--color-primary), var(--color-accent), etc. en todo el
 * módulo. Importa también `mirai-oscuro.css`, que resuelve los casos donde el
 * color de marca se usa como color de texto.
 *
 * REGLAS QUE NO SE DEBEN CAMBIAR (cada una salió de un bug real en producción):
 *
 * 1. Los valores de la tabla pueden ser hex de 3 o 6 dígitos, rgb() o rgba(),
 *    porque el selector de colores permite ajustar la opacidad.
 * 2. La opacidad se aplana SOBRE NEGRO. Los `color_bg_dark` están guardados con
 *    alfa baja (0.05 a 0.2): aplanar sobre blanco daría un gris claro y el modo
 *    oscuro saldría claro.
 * 3. En oscuro las superficies se DERIVAN del fondo aclarándolo, no se copian:
 *    si superficie == fondo, las tarjetas y tablas desaparecen.
 * 4. `color_texto_dark` está NULL en la mayoría de las empresas. El fallback es
 *    #e8e8e8, NUNCA `color_texto`, que es un color oscuro pensado para fondo
 *    claro (daría texto negro sobre fondo negro).
 * 5. En oscuro el texto va en claro, jamás en el color de marca. El primario de
 *    Nintanga (#712d7d) es ilegible sobre fondo oscuro.
 */

// Texto por defecto en modo oscuro, cuando la empresa no lo tiene configurado
const TEXTO_OSCURO_DEFAULT = '#e8e8e8'

// Colores de marca: iguales en claro y oscuro
const COMUNES = {
  color_primario: '--color-primary',
  color_on_primary: '--color-on-primary',
  color_accent: '--color-accent',
  color_on_accent: '--color-on-accent',
  color_accent_2: '--color-accent-2',
  color_primary_hover: '--color-primary-hover',
  color_accent_hover: '--color-accent-hover',
  color_icono_marco: '--color-icon-frame',
  color_icono_ai: '--color-icon-ai',
}

// Cuánto se aclara el fondo oscuro para derivar cada capa
const CAPAS_OSCURO = {
  '--color-bg-theme-light': 0,   // fondo general
  '--color-bg-light': 12,        // inputs, filas alternas
  '--color-bg-white': 22,        // tarjetas, tablas, drawers
  '--color-border': 40,          // bordes
}

// --- Utilidades de color ---

/** Acepta hex de 3 o 6 dígitos, rgb() y rgba(). Devuelve null si no reconoce. */
export function parseColor(color) {
  const c = String(color || '').trim()
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c)
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, ch => ch + ch) : hex[1]
    const n = parseInt(h, 16)
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff, a: 1 }
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/i.exec(c)
  if (rgb) {
    return { r: +rgb[1], g: +rgb[2], b: +rgb[3], a: rgb[4] === undefined ? 1 : parseFloat(rgb[4]) }
  }
  return null
}

/** Aplana la opacidad. Por defecto sobre negro: ver regla 2. */
export function aplanar(col, fondo = { r: 0, g: 0, b: 0 }) {
  return {
    r: Math.round(col.r * col.a + fondo.r * (1 - col.a)),
    g: Math.round(col.g * col.a + fondo.g * (1 - col.a)),
    b: Math.round(col.b * col.a + fondo.b * (1 - col.a)),
  }
}

export const luminancia = ({ r, g, b }) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255

const aCss = ({ r, g, b }) => `rgb(${r}, ${g}, ${b})`

/** Aclara un color sumando `cant` a cada canal. Devuelve null si no se puede parsear. */
export function aclarar(color, cant) {
  const c = parseColor(color)
  if (!c) return null
  const p = aplanar(c)
  return aCss({
    r: Math.min(255, p.r + cant),
    g: Math.min(255, p.g + cant),
    b: Math.min(255, p.b + cant),
  })
}

/** ¿Sirve como texto sobre fondo oscuro? Evita textos oscuros ilegibles (regla 4). */
export function claroParaOscuro(color) {
  const c = parseColor(color)
  return !!c && luminancia(aplanar(c, { r: 255, g: 255, b: 255 })) >= 0.5
}

// --- Tema ---

/**
 * Devuelve las variables CSS del tema como objeto { '--color-x': valor }.
 */
export function variablesTema(empresa, dark = false) {
  if (!empresa) return {}
  const vars = {}

  for (const [campo, cssVar] of Object.entries(COMUNES)) {
    if (empresa[campo]) vars[cssVar] = empresa[campo]
  }

  const suave = dark
    ? (empresa.color_primary_soft_dark || empresa.color_primary_soft)
    : empresa.color_primary_soft
  const activo = dark
    ? (empresa.color_active_bg_dark || empresa.color_active_bg)
    : empresa.color_active_bg

  if (suave) vars['--color-primary-soft'] = suave
  if (activo) vars['--color-active-bg'] = activo

  if (!dark) {
    if (empresa.color_texto) vars['--color-text-primary'] = empresa.color_texto
    if (empresa.color_bg_theme_light) vars['--color-bg-theme-light'] = empresa.color_bg_theme_light
    return vars
  }

  // Texto: el de la empresa solo si es claro; si no, el default (regla 4)
  vars['--color-text-primary'] = claroParaOscuro(empresa.color_texto_dark)
    ? empresa.color_texto_dark
    : TEXTO_OSCURO_DEFAULT

  // Fondo, superficies y bordes derivados del fondo oscuro (reglas 2 y 3)
  if (aclarar(empresa.color_bg_dark, 0)) {
    for (const [cssVar, cant] of Object.entries(CAPAS_OSCURO)) {
      vars[cssVar] = aclarar(empresa.color_bg_dark, cant)
    }
  }

  return vars
}

/**
 * Escribe el tema en el <html> y marca el modo con la clase `dark`.
 *
 * Va en el <html> a propósito: las reglas `.dark body`, `.dark .card`, etc. leen
 * las variables desde ahí, y un estilo en línea le gana a cualquier clase de
 * tema que traiga el CSS.
 */
// Variables escritas en el <html> por la ultima llamada
let aplicadas = new Set()

export function aplicarTema(empresa, dark = false) {
  const root = document.documentElement
  root.classList.toggle('dark', dark)

  const vars = variablesTema(empresa, dark)
  const nuevas = new Set()
  for (const [cssVar, valor] of Object.entries(vars)) {
    if (valor) { root.style.setProperty(cssVar, valor); nuevas.add(cssVar) }
  }
  // Al cambiar de oscuro a claro se quitan las que solo pone el oscuro
  // (superficies, bordes...); si no, quedaban los colores oscuros en modo
  // claro hasta recargar la pagina.
  for (const cssVar of aplicadas) {
    if (!nuevas.has(cssVar)) root.style.removeProperty(cssVar)
  }
  aplicadas = nuevas
}
