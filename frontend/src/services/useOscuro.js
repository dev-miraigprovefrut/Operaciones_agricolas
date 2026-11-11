import { useEffect, useState } from 'react'

/**
 * Pantallas de campo (ingreso tractorista, vincular tablet) con estilos en linea:
 * siguen el boton de la luna, que pone/quita la clase 'dark' en <html>.
 */
export function useOscuro() {
  const raiz = document.documentElement
  const [oscuro, setOscuro] = useState(() => raiz.classList.contains('dark'))
  useEffect(() => {
    const obs = new MutationObserver(() => setOscuro(raiz.classList.contains('dark')))
    obs.observe(raiz, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [raiz])
  return oscuro
}

/** Colores de las pantallas de campo segun el modo. */
export const paletaCampo = oscuro => oscuro
  ? { fondo: 'linear-gradient(160deg, #0d0d1a 0%, #1a1035 40%, #2d1b4e 70%, #1a1035 100%)', tarjeta: '#15152a',
      texto: '#fff', etiqueta: 'rgba(255,255,255,0.55)', suave: 'rgba(255,255,255,0.3)',
      borde: 'rgba(255,255,255,0.1)', campo: 'rgba(255,255,255,0.04)' }
  : { fondo: 'linear-gradient(160deg, #f7f2f9 0%, #efe3f4 50%, #f9eef5 100%)', tarjeta: '#ffffff',
      texto: '#1f1a24', etiqueta: '#6b5a72', suave: 'rgba(31,26,36,0.45)',
      borde: 'rgba(31,26,36,0.15)', campo: '#faf7fb' }
