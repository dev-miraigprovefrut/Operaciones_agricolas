import { useEffect, useState } from 'react'
import { tractoresCatalogo, vincularTablet } from '../services/tablet'

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

  const cargar = async () => {
    setCargando(true); setError('')
    try { setTractores(await tractoresCatalogo()) } catch (e) {
      setError(navigator.onLine === false ? 'Sin conexión: la primera vez necesita internet para leer el catálogo.' : e.message)
    } finally { setCargando(false) }
  }
  useEffect(() => { cargar() }, [])

  const confirmar = async () => {
    if (!elegido) return setError('Elija el tractor')
    setCargando(true); setError('')
    try {
      setListo(await vincularTablet(elegido))
      setTimeout(() => { window.location.href = '/kiosko' }, 2500)
    } catch (e) { setError(e.message || 'No se pudo registrar la tablet') } finally { setCargando(false) }
  }

  const filtrados = tractores.filter(t => !busqueda || t.toLowerCase().replace(/-/g, ' ').includes(busqueda.toLowerCase().replace(/-/g, ' ')))
  const s = {
    page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
      background: 'linear-gradient(160deg, #0d0d1a 0%, #1a1035 40%, #2d1b4e 70%, #1a1035 100%)', fontFamily: 'var(--font-principal, "Inter", sans-serif)' },
    card: { width: '100%', maxWidth: '480px', background: '#15152a', borderRadius: '20px', padding: '1.75rem 1.5rem',
      border: '1px solid rgba(255,255,255,0.06)', color: '#fff', display: 'grid', gap: '0.9rem' },
    input: { width: '100%', boxSizing: 'border-box', padding: '0.85rem', borderRadius: '12px', fontSize: '1rem',
      border: '1.5px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: '#fff' },
    lista: { maxHeight: '45vh', overflowY: 'auto', display: 'grid', gap: '0.4rem' },
    item: sel => ({ padding: '0.8rem 0.9rem', borderRadius: '10px', cursor: 'pointer', fontSize: '1rem', textAlign: 'left',
      border: `1.5px solid ${sel ? '#9c27b0' : 'rgba(255,255,255,0.08)'}`, background: sel ? 'rgba(156,39,176,0.2)' : 'rgba(255,255,255,0.03)', color: '#fff' }),
    btn: { padding: '0.95rem', border: 'none', borderRadius: '12px', color: '#fff', fontWeight: 600, fontSize: '1rem',
      background: 'linear-gradient(135deg, #712d7d 0%, #9c27b0 50%, #ea64a5 100%)', cursor: 'pointer' },
    error: { color: '#ff8a80', fontSize: '0.85rem' },
    ayuda: { color: 'rgba(255,255,255,0.55)', fontSize: '0.85rem', lineHeight: 1.5, margin: 0 }
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <img src="/LogoNintanga.png" alt="Nintanga" style={{ height: '80px', margin: '0 auto' }} onError={e => { e.target.style.display = 'none' }} />
        <h2 style={{ margin: 0, textAlign: 'center' }}>¿En qué tractor va esta tablet?</h2>
        {listo ? (
          <div style={{ textAlign: 'center' }}>
            <i className='bx bx-check-circle' style={{ fontSize: '3rem', color: '#81c784' }}></i>
            <p style={{ fontSize: '1.1rem' }}>Tablet registrada en <strong>{listo}</strong></p>
            <p style={s.ayuda}>Abriendo el ingreso de tractoristas...</p>
          </div>
        ) : (
          <>
            <p style={s.ayuda}>Se elige una sola vez. Para cambiarla de tractor, se da de baja en Catálogos › Operadores › Tablets.</p>
            <input id="buscar-tractor" style={s.input} placeholder="Buscar tractor..." value={busqueda} onChange={e => setBusqueda(e.target.value)} />
            <div style={s.lista}>
              {cargando && !tractores.length && <p style={s.ayuda}>Cargando catálogo...</p>}
              {filtrados.map(t => (
                <button key={t} style={s.item(t === elegido)} onClick={() => { setElegido(t); setError('') }}>
                  <i className='bx bx-cog'></i> {t}
                </button>
              ))}
            </div>
            {error && <div style={s.error}><i className='bx bx-error-circle'></i> {error}
              {!tractores.length && <button onClick={cargar} style={{ marginLeft: '0.5rem', background: 'none', border: 'none', color: '#c66ba9', cursor: 'pointer' }}>Reintentar</button>}</div>}
            <button style={s.btn} onClick={confirmar} disabled={cargando || !elegido}>
              {elegido ? `Usar en ${elegido}` : 'Elija un tractor'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default VincularTablet
