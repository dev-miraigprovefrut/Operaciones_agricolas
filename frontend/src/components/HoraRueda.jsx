import { useEffect, useRef } from 'react'

/**
 * Hora (HH:MM) editable en la tabla: se puede escribir o mover con la RUEDA
 * del mouse sobre el campo (1 minuto por paso; con Shift, 10 minutos).
 * Solo cambia la hora: la fecha la conserva quien lo usa.
 */
const aMin = (hhmm) => { const [h, m] = (hhmm || '00:00').split(':').map(Number); return h * 60 + m }
const aHora = (min) => {
  const t = ((min % 1440) + 1440) % 1440
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

function HoraRueda({ value, onChange, modificado = false, title }) {
  const ref = useRef(null)
  const valorRef = useRef(value)
  const cambioRef = useRef(onChange)
  valorRef.current = value
  cambioRef.current = onChange

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    // passive:false para poder evitar que la pagina se desplace mientras se gira la rueda
    const alGirar = (e) => {
      e.preventDefault()
      const paso = e.shiftKey ? 10 : 1
      cambioRef.current(aHora(aMin(valorRef.current) + (e.deltaY < 0 ? paso : -paso)))
    }
    el.addEventListener('wheel', alGirar, { passive: false })
    return () => el.removeEventListener('wheel', alGirar)
  }, [])

  return (
    <input
      ref={ref}
      type="time"
      value={value}
      onChange={e => e.target.value && onChange(e.target.value)}
      title={title || 'Gire la rueda del mouse para ajustar (Shift: de 10 en 10 minutos)'}
      style={{
        fontSize: '0.75rem', padding: '1px 4px', borderRadius: '4px', cursor: 'ns-resize',
        border: `1px solid ${modificado ? '#ff9800' : 'var(--color-border)'}`,
        background: modificado ? 'rgba(255,152,0,0.12)' : 'transparent',
        color: 'var(--color-text-primary)', width: '6.2rem'
      }}
    />
  )
}

export default HoraRueda
