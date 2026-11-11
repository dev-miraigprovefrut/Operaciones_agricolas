import { useEffect, useState } from 'react'
import { tractoresCatalogo, vincularTablet } from '../services/tablet'
import { useOscuro, paletaCampo } from '../services/useOscuro'
import { TecladoFormulario } from './KioskoTablet'
import './KioskoTablet.css'

/**
 * Primera vez que se abre el APK en la tablet: se elige el tractor del catalogo
 * donde va montada (como el tractor.txt de la Raspberry). Despues la tablet
 * queda atada a ese tractor y va directo al ingreso de tractoristas. Para
 * cambiarla de tractor: Catalogos > Tractoristas > Tablets > Dar de baja.
 */
function VincularTablet() {
  const [tractores, setTractores] = useState([])
  const [busqueda, setBusqueda] = useState('')
  const [elegido, setElegido] = useState('')
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(true)
  const [listo, setListo] = useState('')
  const [aviso, setAviso] = useState('')
  // Paso 2: horas que marca el horometro del equipo (desde ahi suma la tablet)
  const [horas, setHoras] = useState('')
  const [enHoras, setEnHoras] = useState(false)
  const c = paletaCampo(useOscuro())

  const cargar = async () => {
    setCargando(true); setError('')
    try { setTractores(await tractoresCatalogo()) } catch (e) {
      setError(navigator.onLine === false ? 'Sin conexión: la primera vez necesita internet para leer el catálogo.' : e.message)
    } finally { setCargando(false) }
  }
  useEffect(() => { cargar() }, [])

  const confirmar = async () => {
    if (!elegido) return setError('Elija el equipo')
    if (!enHoras) { setEnHoras(true); return setError('') }
    const h = Number(horas)
    if (!horas || Number.isNaN(h) || h < 0) return setError('Escriba las horas que marca el horómetro del equipo')
    setCargando(true); setError('')
    try {
      const d = await vincularTablet(elegido, h)
      setListo(d.tractor); setAviso(d.horometro_error || '')
      setTimeout(() => { window.location.href = '/kiosko' }, d.horometro_error ? 6000 : 2500)
    } catch (e) { setError(e.message || 'No se pudo registrar la tablet') } finally { setCargando(false) }
  }

  const [marcado, setMarcado] = useState(0)
  const filtrados = tractores.filter(t => !busqueda || t.toLowerCase().replace(/-/g, ' ').includes(busqueda.toLowerCase().replace(/-/g, ' ')))
  const s = {
    page: { minHeight: '100vh', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '0.75rem 1rem 320px',
      background: c.fondo, fontFamily: 'var(--font-principal, "Inter", sans-serif)' },
    card: { width: '100%', maxWidth: '480px', background: c.tarjeta, borderRadius: '20px', padding: '1rem 1.25rem',
      border: `1px solid ${c.borde}`, color: c.texto, display: 'grid', gap: '0.6rem' },
    input: { width: '100%', boxSizing: 'border-box', padding: '0.85rem', borderRadius: '12px', fontSize: '1rem',
      border: `1.5px solid ${c.borde}`, background: c.campo, color: c.texto },
    lista: { maxHeight: '30vh', overflowY: 'auto', display: 'grid', gap: '0.4rem' },
    item: sel => ({ padding: '0.8rem 0.9rem', borderRadius: '10px', cursor: 'pointer', fontSize: '1rem', textAlign: 'left',
      border: `1.5px solid ${sel ? '#9c27b0' : c.borde}`, background: sel ? 'rgba(156,39,176,0.2)' : c.campo, color: c.texto }),
    btn: { padding: '0.95rem', border: 'none', borderRadius: '12px', color: '#fff', fontWeight: 600, fontSize: '1rem',
      background: 'linear-gradient(135deg, #712d7d 0%, #9c27b0 50%, #ea64a5 100%)', cursor: 'pointer' },
    error: { color: '#ff8a80', fontSize: '0.85rem' },
    ayuda: { color: c.etiqueta, fontSize: '0.85rem', lineHeight: 1.5, margin: 0 }
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <h2 style={{ margin: 0, textAlign: 'center' }}>Seleccione el equipo</h2>
        {listo ? (
          <div style={{ textAlign: 'center' }}>
            <i className='bx bx-check-circle' style={{ fontSize: '3rem', color: '#81c784' }}></i>
            <p style={{ fontSize: '1.1rem' }}>Tablet registrada en <strong>{listo}</strong></p>
            {aviso && <p style={s.error}>{aviso}</p>}
            <p style={s.ayuda}>Abriendo el ingreso de tractoristas...</p>
          </div>
        ) : (
          enHoras ? (
          <>
            <p style={{ margin: 0, textAlign: 'center', fontSize: '1.1rem' }}><strong>{elegido}</strong></p>
            <label style={s.ayuda}>Horas que marca el horómetro</label>
            <div id="horas-equipo" style={{ ...s.input, fontSize: '1.6rem', textAlign: 'center', minHeight: '3.2rem', borderColor: '#9c27b0' }}>{horas || ' '}</div>
            {error && <div style={s.error}><i className='bx bx-error-circle'></i> {error}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.5rem' }}>
              <button style={{ ...s.btn, background: c.campo, color: c.texto, border: `1.5px solid ${c.borde}` }} onClick={() => { setEnHoras(false); setError('') }}>Volver</button>
              <button style={s.btn} onClick={confirmar} disabled={cargando}>{cargando ? 'Guardando...' : 'Guardar'}</button>
            </div>
            <div className="k-vars">
              <TecladoFormulario
                onLetra={l => { if (/[0-9.]/.test(l)) setHoras(h => (l === '.' && h.includes('.') ? h : (h + l).slice(0, 9))); setError('') }}
                onBorrar={() => setHoras(h => h.slice(0, -1))}
                onArriba={() => {}} onAbajo={() => {}} onAnterior={() => { setEnHoras(false); setError('') }} onSiguiente={() => {}}
                onOk={confirmar} />
            </div>
          </>
          ) : (
          <>
            <input id="buscar-tractor" style={s.input} placeholder="Buscar..." inputMode="none" value={busqueda} onChange={e => { setBusqueda(e.target.value); setMarcado(0) }} />
            <div style={s.lista}>
              {cargando && !tractores.length && <p style={s.ayuda}>Cargando catálogo...</p>}
              {filtrados.map((t, i) => (
                <button key={t} ref={el => { if (i === marcado && el) el.scrollIntoView({ block: 'nearest' }) }} style={s.item(t === elegido || (!elegido && i === marcado && busqueda))} onClick={() => { setElegido(t); setError('') }}>
                  <i className='bx bx-cog'></i> {t}
                </button>
              ))}
            </div>
            {error && <div style={s.error}><i className='bx bx-error-circle'></i> {error}
              {!tractores.length && <button onClick={cargar} style={{ marginLeft: '0.5rem', background: 'none', border: 'none', color: '#c66ba9', cursor: 'pointer' }}>Reintentar</button>}</div>}
            <button style={s.btn} onClick={confirmar} disabled={cargando || !elegido}>
              {elegido ? `Siguiente: horas de ${elegido}` : 'Elija un equipo'}
            </button>
            {/* teclado en pantalla (la tablet es solo tactil) */}
            <div className="k-vars">
              <TecladoFormulario
                onLetra={l => { setBusqueda(b => b + l); setMarcado(0); setElegido('') }}
                onBorrar={() => { setBusqueda(b => b.slice(0, -1)); setMarcado(0); setElegido('') }}
                onArriba={() => setMarcado(m => Math.max(0, m - 1))}
                onAbajo={() => setMarcado(m => Math.min(filtrados.length - 1, m + 1))}
                onAnterior={() => {}} onSiguiente={() => {}}
                onOk={() => { if (elegido) confirmar(); else if (filtrados[marcado]) setElegido(filtrados[marcado]) }} />
            </div>
          </>
          )
        )}
      </div>
    </div>
  )
}

export default VincularTablet
