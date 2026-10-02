import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import Swal from 'sweetalert2'
import { EstadoErpBadge, estadoAplicacionTexto } from '../components/FichaAplicacion'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8007'

const semanaIso = (d = new Date()) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7))
  return { anio: t.getUTCFullYear(), semana: Math.ceil(((t - new Date(Date.UTC(t.getUTCFullYear(), 0, 1))) / 86400000 + 1) / 7) }
}
const num = (v, dec = 2) => (v === null || v === undefined || v === '') ? '' : Number(v).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: dec })

const ENVIO = {
  ENVIADO: { t: 'Enviada al ERP', c: '#1b5e20' },
  PENDIENTE: { t: 'Envío pendiente', c: '#8a5300' },
  ERROR: { t: 'Error al enviar', c: '#b71c1c' },
}

/** HTML de la ficha como la imprimia el sistema viejo (con los datos de la aplicacion). */
function htmlFicha(f) {
  const fecha = f.fecha_aplicacion ? new Date(f.fecha_aplicacion + 'T12:00:00').toLocaleDateString('es-EC') : ''
  return `<div class="ficha">
    <div class="fila"><b>Nro. Orden: ${f.ocult}</b><span>Lote: <b>${f.lote || ''}</b></span><span>Has.: <b>${num(f.hectareas)}</b></span><span>Producto: <b>${f.cultivo || ''}</b></span></div>
    <div class="fila"><span>Edad: <b>SEMANA ${f.edad_sem ?? ''}</b></span><h3>${f.actividad || ''}</h3><span>Sem. Aplicación: <b>${f.semana} - ${f.anio}</b></span></div>
    <div class="fila"><span>Temperatura: <b>${num(f.temperatura)}</b></span><span>Vel. viento: <b>${num(f.velocidad_viento)}</b></span><span># Bombas: <b>${num(f.num_bombas)}</b></span><span>Fecha Aplic.: <b>${fecha}</b></span><span>Hora Ini.: <b>${f.hora_inicio || ''}</b></span><span>Hora Fin.: <b>${f.hora_fin || ''}</b></span></div>
    <div class="fila"><span>Método Aplic.: <b>${f.metodo || ''}</b></span><span>Aplicador Responsable: <b>${f.aplicador || ''}</b></span><span>Equipo: <b>${f.tractor || ''}${f.bomba ? ' · ' + f.bomba : ''}</b></span><span>Estado ERP: <b>${f.estado_erp_nombre || ''}</b></span></div>
    <table><thead><tr><th>Producto</th><th>Descripción</th><th class="n">Dosis/Ha</th><th>Uni</th><th class="n">Cantidad</th><th>Es</th><th>Clasificación</th><th>Período de Carencia</th><th class="n">Cantidad Aplicada</th></tr></thead>
    <tbody>${f.productos.map(p => `<tr><td>${p.cod_prod || ''}</td><td>${p.descripcion || ''}</td><td class="n">${num(p.dosis_ha)}</td><td>${p.unidad || ''}</td><td class="n">${num(p.cantidad)}</td><td>${p.estado_erp || ''}</td><td>${p.clasificacion || ''}</td><td>${p.carencia || ''}</td><td class="n">${num(p.cantidad_aplicada)}</td></tr>`).join('')}</tbody></table>
  </div>`
}

function imprimir(fichas, titulo) {
  const w = document.createElement('iframe')
  w.style.position = 'fixed'; w.style.width = '0'; w.style.height = '0'; w.style.border = '0'
  document.body.appendChild(w)
  w.srcdoc = `<html><head><title>${titulo}</title><style>
    body{font-family:Arial,sans-serif;font-size:10px;padding:1rem;} h1{text-align:center;font-size:14px;color:#7b1fa2;margin:0 0 0.8rem;}
    .ficha{border-top:2px dashed #999;padding-top:0.6rem;margin-bottom:1.2rem;page-break-inside:avoid;}
    .fila{display:flex;flex-wrap:wrap;gap:0.4rem 1.6rem;align-items:baseline;margin-bottom:0.35rem;} h3{margin:0;font-size:13px;flex:1;text-align:center;}
    table{width:100%;border-collapse:collapse;margin-top:0.3rem;} th{background:#eee;border-bottom:1px solid #999;text-align:left;padding:2px 4px;} td{border-bottom:1px dotted #ccc;padding:2px 4px;} .n{text-align:right;}
  </style></head><body><h1>${titulo}</h1>${fichas.map(htmlFicha).join('')}</body></html>`
  w.onload = () => { w.contentWindow.print(); setTimeout(() => w.remove(), 1000) }
}

export default function FichasAplicacion() {
  const actual = semanaIso()
  const [anio, setAnio] = useState(actual.anio)
  const [semana, setSemana] = useState(actual.semana)
  const [fichas, setFichas] = useState([])
  const [cargando, setCargando] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [filtro, setFiltro] = useState('')       // '' | PENDIENTE | EN_CURSO | APLICADA | ERROR
  const [abierta, setAbierta] = useState(null)
  const [sincronizando, setSincronizando] = useState(false)
  const pedido = useRef(0)

  const cargar = async () => {
    const n = ++pedido.current
    setCargando(true)
    try {
      const r = await fetch(`${API_URL}/api/fichas-aplicacion?anio=${anio}&semana=${semana}`)
      const d = r.ok ? await r.json() : []
      if (n === pedido.current) setFichas(Array.isArray(d) ? d : [])
    } catch { if (n === pedido.current) setFichas([]) } finally { if (n === pedido.current) setCargando(false) }
  }
  useEffect(() => { cargar() }, [anio, semana])  // eslint-disable-line react-hooks/exhaustive-deps

  const sincronizar = async () => {
    setSincronizando(true)
    try {
      const r = await fetch(`${API_URL}/api/fichas-aplicacion/sincronizar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ anio, semana }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.detail || 'No se pudo sincronizar')
      Swal.fire({ icon: 'success', title: 'Fichas actualizadas', text: `${d.creadas} nuevas, ${d.actualizadas} actualizadas`, timer: 1600, showConfirmButton: false })
      cargar()
    } catch (e) { Swal.fire({ icon: 'error', title: 'Error', text: e.message }) } finally { setSincronizando(false) }
  }

  const accion = async (f, tipo) => {
    const textos = { reenviar: ['¿Reenviar esta aplicación al ERP?', 'Enviada al ERP'], liberar: ['¿Liberar esta ficha?', 'Ficha liberada'] }
    const conf = await Swal.fire({ title: textos[tipo][0], html: tipo === 'liberar' ? 'Se borra el inicio (temperatura, viento, equipo) para que otro equipo pueda aplicarla.' : '', icon: 'question', showCancelButton: true, confirmButtonText: 'Sí', cancelButtonText: 'Cancelar', confirmButtonColor: '#7b1fa2' })
    if (!conf.isConfirmed) return
    const r = await fetch(`${API_URL}/api/fichas-aplicacion/${f.id}/${tipo}`, { method: 'POST' })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { Swal.fire({ icon: 'error', title: 'Error', text: d.detail || 'No se pudo' }); return }
    setFichas(prev => prev.map(x => x.id === d.id ? d : x))
    Swal.fire({ icon: 'success', title: textos[tipo][1], timer: 1200, showConfirmButton: false })
  }

  const visibles = useMemo(() => fichas.filter(f => {
    if (filtro === 'ERROR' ? f.envio_erp !== 'ERROR' : filtro && f.estado_aplicacion !== filtro) return false
    if (!busqueda) return true
    const b = busqueda.toLowerCase()
    return [f.ocult, f.lote, f.hacienda, f.cultivo, f.tractor, f.aplicador].some(v => String(v || '').toLowerCase().includes(b))
  }), [fichas, filtro, busqueda])

  const cuenta = (est) => fichas.filter(f => est === 'ERROR' ? f.envio_erp === 'ERROR' : f.estado_aplicacion === est).length

  return (
    <div>
      <div className="page-header">
        <div>
          <h1><i className='bx bx-spray-can'></i> Fichas de aplicación</h1>
          <p className="page-subtitle">Fichas fitosanitarias del ERP (herbicida y fitosanitaria) y su aplicación en campo</p>
        </div>
        <div className="page-actions" style={{display: 'flex', gap: '0.5rem', flexWrap: 'wrap'}}>
          <button className="btn btn-secondary" onClick={sincronizar} disabled={sincronizando}>
            <i className={`bx ${sincronizando ? 'bx-loader-alt bx-spin' : 'bx-refresh'}`}></i> Sincronizar con el ERP
          </button>
          <button className="btn btn-primary" onClick={() => imprimir(visibles, `Aplicaciones fitosanitarias · semana ${semana}-${anio}`)} disabled={!visibles.length}>
            <i className='bx bx-printer'></i> Imprimir
          </button>
        </div>
      </div>

      <div style={{display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', margin: '0.5rem 0 0.8rem'}}>
        <button className="btn btn-secondary" style={{padding: '0.3rem 0.6rem'}} onClick={() => { if (semana > 1) setSemana(semana - 1); else { setAnio(anio - 1); setSemana(52) } }}><i className='bx bx-chevron-left'></i></button>
        <span style={{fontWeight: 600}}>Semana</span>
        <input type="number" className="form-control" value={semana} min="1" max="53" onChange={e => setSemana(Number(e.target.value) || 1)} style={{width: '75px'}} />
        <input type="number" className="form-control" value={anio} onChange={e => setAnio(Number(e.target.value) || actual.anio)} style={{width: '90px'}} />
        <button className="btn btn-secondary" style={{padding: '0.3rem 0.6rem'}} onClick={() => { if (semana < 53) setSemana(semana + 1); else { setAnio(anio + 1); setSemana(1) } }}><i className='bx bx-chevron-right'></i></button>
        <input className="form-control" placeholder="Buscar orden, lote, hacienda, equipo…" value={busqueda} onChange={e => setBusqueda(e.target.value)} style={{flex: 1, minWidth: '200px'}} />
      </div>

      <div style={{display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.8rem'}}>
        {[['', `Todas (${fichas.length})`], ['PENDIENTE', `Por aplicar (${cuenta('PENDIENTE')})`], ['EN_CURSO', `En aplicación (${cuenta('EN_CURSO')})`], ['APLICADA', `Aplicadas (${cuenta('APLICADA')})`], ['ERROR', `Error al enviar (${cuenta('ERROR')})`]].map(([k, t]) => (
          <button key={k} onClick={() => setFiltro(k)} style={{border: 'none', borderRadius: '6px', padding: '0.35rem 0.8rem', cursor: 'pointer', fontSize: '0.8rem',
            background: filtro === k ? 'var(--color-primary)' : 'var(--color-bg-light)', color: filtro === k ? 'var(--color-on-primary)' : 'var(--color-text-secondary)'}}>{t}</button>
        ))}
      </div>

      {cargando ? <p style={{textAlign: 'center', padding: '2rem', color: 'var(--color-text-secondary)'}}><i className='bx bx-loader-alt bx-spin'></i> Cargando…</p>
        : !visibles.length ? <p style={{textAlign: 'center', padding: '2rem', color: 'var(--color-text-secondary)'}}>No hay fichas para esta semana. Use «Sincronizar con el ERP» si aún no se han copiado.</p>
        : (
        <div className="tabla-container">
          <table className="tabla" style={{fontSize: '0.8rem'}}>
            <thead><tr><th>Orden</th><th>Lote</th><th>Hacienda</th><th>Cultivo</th><th>Actividad</th><th>Estado ERP</th><th>Aplicación</th><th>Envío</th><th></th></tr></thead>
            <tbody>
              {visibles.map(f => (
                <Fragment key={f.id}>
                  <tr className="clickeable" onClick={() => setAbierta(abierta === f.id ? null : f.id)}>
                    <td><strong>{f.ocult}</strong></td>
                    <td>{f.lote}</td>
                    <td>{f.hacienda}</td>
                    <td>{f.cultivo} · {Number(f.hectareas || 0).toLocaleString('es-EC')} ha</td>
                    <td>{f.cod_acamp === 83 ? 'Herbicida' : 'Fitosanitaria'} ({f.productos.length})</td>
                    <td><EstadoErpBadge estado={f.estado_erp} /></td>
                    <td style={{textTransform: 'none'}}>{estadoAplicacionTexto(f)}</td>
                    <td style={{color: ENVIO[f.envio_erp]?.c, fontWeight: 600, textTransform: 'none'}} title={f.envio_error || ''}>{ENVIO[f.envio_erp]?.t || '-'}</td>
                    <td style={{whiteSpace: 'nowrap'}} onClick={e => e.stopPropagation()}>
                      <button title="Imprimir ficha" onClick={() => imprimir([f], `Ficha de aplicación · orden ${f.ocult}`)} style={{background: 'transparent', border: 'none', color: '#7b1fa2', cursor: 'pointer', fontSize: '1.1rem'}}><i className='bx bx-printer'></i></button>
                      {f.estado_aplicacion === 'APLICADA' && f.envio_erp !== 'ENVIADO' && (
                        <button title="Reenviar al ERP" onClick={() => accion(f, 'reenviar')} style={{background: 'transparent', border: 'none', color: '#1565c0', cursor: 'pointer', fontSize: '1.1rem'}}><i className='bx bx-upload'></i></button>
                      )}
                      {f.estado_aplicacion === 'EN_CURSO' && (
                        <button title="Liberar ficha (inicio por error)" onClick={() => accion(f, 'liberar')} style={{background: 'transparent', border: 'none', color: '#dc3545', cursor: 'pointer', fontSize: '1.1rem'}}><i className='bx bx-reset'></i></button>
                      )}
                    </td>
                  </tr>
                  {abierta === f.id && (
                    <tr><td colSpan={9} style={{background: 'var(--color-bg-light)', textTransform: 'none'}}>
                      <div style={{display: 'flex', flexWrap: 'wrap', gap: '0.3rem 1.2rem', marginBottom: '0.4rem'}}>
                        <span>Semana {f.semana}-{f.anio} · Edad {f.edad_sem}</span>
                        {f.estado_aplicacion !== 'PENDIENTE' && <>
                          <span>Temperatura: <b>{f.temperatura ?? '-'}</b></span><span>Viento: <b>{f.velocidad_viento ?? '-'}</b></span>
                          <span># Bombas: <b>{f.num_bombas ?? '-'}</b></span><span>Método: <b>{f.metodo}</b></span>
                          <span>Equipo: <b>{f.tractor}{f.bomba ? ' · ' + f.bomba : ''}</b></span><span>Aplicador: <b>{f.aplicador}</b></span>
                        </>}
                        {f.envio_error && <span style={{color: '#b71c1c'}}>Error: {f.envio_error}</span>}
                      </div>
                      <table style={{width: '100%', fontSize: '0.75rem', borderCollapse: 'collapse'}}>
                        <thead><tr style={{textAlign: 'left'}}><th>Producto</th><th>Descripción</th><th>Clasificación</th><th style={{textAlign: 'right'}}>Dosis/Ha</th><th style={{textAlign: 'right'}}>Cantidad</th><th style={{textAlign: 'right'}}>Despachada</th><th style={{textAlign: 'right'}}>Aplicada</th><th>Carencia</th><th>Estado</th></tr></thead>
                        <tbody>{f.productos.map(p => (
                          <tr key={p.cod_docul}><td>{p.cod_prod}</td><td>{p.descripcion}</td><td>{p.clasificacion}</td>
                            <td style={{textAlign: 'right'}}>{num(p.dosis_ha)} {p.unidad}</td><td style={{textAlign: 'right'}}>{num(p.cantidad)}</td>
                            <td style={{textAlign: 'right'}}>{num(p.cantidad_salida)}</td><td style={{textAlign: 'right'}}>{num(p.cantidad_aplicada)}</td>
                            <td>{p.carencia}</td><td><EstadoErpBadge estado={p.estado_erp} /></td></tr>
                        ))}</tbody>
                      </table>
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
