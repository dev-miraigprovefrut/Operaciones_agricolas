/**
 * Botón flotante abajo a la derecha para alternar el modo de color.
 * Cicla: automático (según el navegador) → claro fijo → oscuro fijo → automático.
 *
 * Copia sincronizada de ProgramaBase (ver TEMA.md en el repo
 * IT Team - Diseño Corporativo). Si el programa base cambia este archivo,
 * replicar el cambio aquí.
 *
 * Uso:
 *   const { modo, darkMode, siguienteModo } = useModoColor()
 *   <BotonModoColor modo={modo} darkMode={darkMode} onCambiar={siguienteModo} />
 */
import { useState } from 'react'

const ICONO = { auto: 'bx-desktop', claro: 'bx-sun', oscuro: 'bx-moon' }

const TITULO = {
  auto: 'Modo automático (según el navegador). Clic para fijar el modo claro',
  claro: 'Modo claro fijo. Clic para fijar el modo oscuro',
  oscuro: 'Modo oscuro fijo. Clic para volver al automático',
}

export default function BotonModoColor({ modo = 'auto', darkMode = false, onCambiar }) {
  const [hover, setHover] = useState(false)

  return (
    <button
      onClick={onCambiar}
      title={TITULO[modo]}
      aria-label={TITULO[modo]}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'fixed',
        bottom: '1.25rem',
        right: '1.25rem',
        // Por debajo de los overlays y drawers, para que ellos lo tapen
        zIndex: 9000,
        width: '46px',
        height: '46px',
        borderRadius: '50%',
        border: 'none',
        cursor: 'pointer',
        background: 'var(--color-primary)',
        color: 'var(--color-on-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '1.35rem',
        boxShadow: hover ? '0 6px 18px rgba(0,0,0,0.35)' : '0 3px 10px rgba(0,0,0,0.25)',
        transform: hover ? 'scale(1.08)' : 'scale(1)',
        transition: 'transform 0.15s, box-shadow 0.15s, background 0.2s',
      }}>
      <i className={`bx ${ICONO[modo]}`}></i>
      {/* En automático, un punto indica qué resolvió el navegador */}
      {modo === 'auto' && (
        <span style={{
          position: 'absolute', bottom: '6px', right: '6px',
          width: '9px', height: '9px', borderRadius: '50%',
          background: darkMode ? '#1a1a1a' : '#ffd54a',
          border: '1.5px solid var(--color-on-primary)',
        }} />
      )}
    </button>
  )
}
