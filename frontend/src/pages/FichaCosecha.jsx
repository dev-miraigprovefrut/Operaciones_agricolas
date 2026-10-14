import { useState, useEffect } from 'react'
import DrawerCosecha from '../components/DrawerCosecha'
import { fetchWithOffline, fetchConTimeout, cacheData } from '../services/syncQueue'
import { mezclarFichas, claveFicha } from '../services/cosechaLocal'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8007'

function FichaCosecha() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [fichas, setFichas] = useState([])
  const [fichaSeleccionada, setFichaSeleccionada] = useState(null)
  const [grupoHover, setGrupoHover] = useState(null)
  const [filaHoverId, setFilaHoverId] = useState(null)
  const [actualizando, setActualizando] = useState(false)

  // Fichas del servidor (con copia para SIN INTERNET) + las que estan solo en el celular
  const fetchFichas = async () => {
    setActualizando(true)
    try {
      const { data } = await fetchWithOffline(`${API_URL}/api/cosecha-transp`, 'cosecha_fichas')
      setFichas(await mezclarFichas(Array.isArray(data) ? data : []))
    } catch (err) {
      console.error('Error cargando fichas:', err)
    } finally {
      setActualizando(false)
    }
  }

  useEffect(() => {
    fetchFichas()
    // al volver la señal la cola sincroniza: refrescar la lista despues
    const alVolver = () => setTimeout(fetchFichas, 6000)
    window.addEventListener('online', alVolver)
    // Copia de los lotes para buscarlos sin internet (1 vez por hora, con señal)
    const t = setTimeout(async () => {
      if (!navigator.onLine || Date.now() - Number(localStorage.getItem('oa_precarga_lotes') || 0) < 60 * 60 * 1000) return
      try {
        const r = await fetchConTimeout(`${API_URL}/api/lotes-infx`, 30000)
        if (r.ok) { await cacheData('lotes_all', await r.json()); localStorage.setItem('oa_precarga_lotes', String(Date.now())) }
      } catch { /* sin señal */ }
    }, 3000)
    return () => { window.removeEventListener('online', alVolver); clearTimeout(t) }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const abrirNueva = () => {
    setFichaSeleccionada(null)
    setDrawerOpen(true)
  }

  const seleccionarFicha = (ficha) => {
    setFichaSeleccionada(ficha)
    setDrawerOpen(true)
  }

  const cerrarDrawer = () => {
    setDrawerOpen(false)
    setFichaSeleccionada(null)
  }

  // El backend (/api/cosecha-transp) ya filtra por usuario -- un supervisor
  // solo recibe sus propias fichas o las de su supervision (por creado_por
  // O id_supervisor). Filtrar aqui otra vez solo por creado_por descartaba
  // las fichas que el supervisor supervisa pero no creo el mismo, mostrando
  // "no hay fichas registradas" aunque si tuviera pendientes.
  const misFichas = fichas.filter(f => f.estado === 'Activo' || f.estado === 'Enviado')

  return (
    <>
      {/* Header */}
      <div className="page-header" style={{display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center'}}>
        <div>
          <h1><i className='bx bx-leaf'></i> Fichas de Cosecha</h1>
          <p className="page-subtitle">Notas de entrega de producto</p>
        </div>
        <button className="btn btn-primary" onClick={abrirNueva}>
          <i className='bx bx-plus'></i> Nueva Ficha
        </button>
      </div>

      <div style={{display: 'flex', justifyContent: 'flex-end', margin: '0.75rem 0'}}>
        <button className="btn btn-secondary" onClick={fetchFichas} disabled={actualizando}>
          <i className={`bx bx-refresh ${actualizando ? 'bx-spin' : ''}`}></i> Actualizar
        </button>
      </div>

      {/* Tabla de fichas */}
      <div className="tabla-container">
        <table className="tabla">
          <thead>
            <tr>
              <th>Placa</th>
              <th className="col-ocultar-movil">Resp. Transporte</th>
              <th className="col-ocultar-movil">Dueño</th>
              <th className="col-ocultar-movil">Supervisor</th>
              <th>Lote</th>
              <th>Producto</th>
              <th>Variedad</th>
              <th>Bines</th>
            </tr>
          </thead>
          <tbody>
            <style>{`
              @keyframes titilar-sin-enviar { 0%, 100% { background-color: rgba(220, 53, 69, 0.12) } 50% { background-color: rgba(220, 53, 69, 0.42) } }
              .celda-sin-enviar { animation: titilar-sin-enviar 1.4s ease-in-out infinite; }
              @media (prefers-reduced-motion: reduce) { .celda-sin-enviar { animation: none; background-color: rgba(220, 53, 69, 0.3) !important; } }
            `}</style>
            {(() => {
              const formatNombre = (raw) => {
                if (!raw) return '-'
                const partes = raw.trim().split(/\s+/)
                if (partes.length >= 3) {
                  const nombre1 = partes[partes.length >= 4 ? 2 : 1]
                  const apellido1 = partes[0]
                  return `${nombre1.charAt(0).toUpperCase()}${nombre1.slice(1).toLowerCase()} ${apellido1.charAt(0).toUpperCase()}${apellido1.slice(1).toLowerCase()}`
                }
                return raw.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
              }
              // Varias fichas separadas del mismo camion (mismo dia) se
              // agrupan bajo una sola fila de Placa/Transporte/Dueño/
              // Supervisor -- antes se repetian esos datos en cada fila
              // aunque fuera el mismo camion, dificultando ver de un vistazo
              // cuantos viajes/lotes lleva un mismo camion hoy.
              const grupos = []
              const indicePorClave = {}
              misFichas.forEach(ficha => {
                const dia = ficha.fecha_creacion ? new Date(ficha.fecha_creacion).toDateString() : ''
                const clave = `${ficha.placa || ''}|${dia}`
                if (!(clave in indicePorClave)) {
                  indicePorClave[clave] = grupos.length
                  grupos.push({ clave, fichas: [] })
                }
                grupos[indicePorClave[clave]].fichas.push(ficha)
              })
              return grupos.map((grupo, gIdx) => {
                // Fondo alterno POR GRUPO (no por fila) y celda combinada
                // centrada verticalmente -- antes el texto de Placa/
                // Transporte/Dueño/Supervisor quedaba pegado arriba, dando
                // la impresion de que solo la primera fila del grupo le
                // pertenecia y las demas eran de otra ficha suelta.
                const fondoGrupo = grupo.fichas.length > 1 && gIdx % 2 === 1 ? 'var(--color-bg-light)' : undefined
                const comunResaltado = grupoHover === grupo.clave
                return grupo.fichas.map((ficha, idx) => {
                  const filaResaltada = filaHoverId === claveFicha(ficha)
                  // Lleno y sin enviar: titila en rojo hasta que el supervisor lo envie
                  const sinEnviar = ficha.estado === 'Activo' && (ficha.productos || []).length > 0
                  const claseCelda = sinEnviar && !filaResaltada ? 'celda-sin-enviar' : undefined
                  return (
                  <tr key={claveFicha(ficha)} className="clickeable" onClick={() => seleccionarFicha(ficha)}
                    onMouseEnter={() => { setGrupoHover(grupo.clave); setFilaHoverId(claveFicha(ficha)) }}
                    onMouseLeave={() => { setGrupoHover(null); setFilaHoverId(null) }}
                    style={idx > 0 ? {borderTop: 'none'} : undefined}>
                    {idx === 0 && <>
                      <td rowSpan={grupo.fichas.length} style={{verticalAlign: 'middle', background: comunResaltado ? 'var(--color-bg-light)' : fondoGrupo}}><strong>{ficha.placa || '-'}</strong></td>
                      <td className="col-ocultar-movil" rowSpan={grupo.fichas.length} style={{verticalAlign: 'middle', background: comunResaltado ? 'var(--color-bg-light)' : fondoGrupo}}>{formatNombre(ficha.nombre_chofer)}</td>
                      <td className="col-ocultar-movil" rowSpan={grupo.fichas.length} style={{verticalAlign: 'middle', background: comunResaltado ? 'var(--color-bg-light)' : fondoGrupo}}>{ficha.propietario || '-'}</td>
                      <td className="col-ocultar-movil" rowSpan={grupo.fichas.length} style={{verticalAlign: 'middle', background: comunResaltado ? 'var(--color-bg-light)' : fondoGrupo}}>
                        {ficha.supervisor_nombre || (ficha.productos || [])[0]?.responsable || '-'}
                        {(ficha.productos || [])[0]?.centro_costos && (
                          <div style={{fontSize: '0.7rem', color: 'var(--color-text-secondary)'}}>{ficha.productos[0].centro_costos}</div>
                        )}
                      </td>
                    </>}
                    <td className={claseCelda} style={{background: filaResaltada ? 'var(--color-bg-light)' : fondoGrupo}}>{ficha.productos?.map(p => p.lote).filter(Boolean).join(', ') || '-'}
                      {sinEnviar && <div style={{fontSize: '0.68rem', color: '#dc3545', fontWeight: 700}}><i className='bx bx-error-circle'></i> Sin enviar</div>}
                      {ficha._local && <div style={{fontSize: '0.68rem', color: '#e67e22', fontWeight: 600}} title="Guardada en el celular, se envía al haber señal"><i className='bx bx-time-five'></i> Por sincronizar</div>}
                    </td>
                    <td className={claseCelda} style={{background: filaResaltada ? 'var(--color-bg-light)' : fondoGrupo}}>{ficha.productos?.map(p => p.producto).filter(Boolean).join(', ') || '-'}</td>
                    <td className={claseCelda} style={{background: filaResaltada ? 'var(--color-bg-light)' : fondoGrupo}}>{ficha.productos?.map(p => p.variedad).filter(Boolean).join(', ') || '-'}</td>
                    <td className={claseCelda} style={{background: filaResaltada ? 'var(--color-bg-light)' : fondoGrupo}}>{ficha.productos?.reduce((sum, p) => sum + (p.cantidad || 0), 0) || '-'}</td>
                  </tr>
                  )
                })
              })
            })()}
            {misFichas.length === 0 && (
              <tr>
                <td colSpan="8" style={{textAlign: 'center', padding: '2rem', color: 'var(--color-text-secondary)'}}>
                  No hay fichas registradas
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Drawer */}
      <DrawerCosecha 
        open={drawerOpen} 
        onClose={cerrarDrawer} 
        ficha={fichaSeleccionada}
        onSaved={fetchFichas}
      />
    </>
  )
}

export default FichaCosecha
