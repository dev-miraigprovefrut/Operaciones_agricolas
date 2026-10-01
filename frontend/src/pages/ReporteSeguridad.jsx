import { useState, useEffect } from 'react'
import Swal from 'sweetalert2'
import { parseFotos } from '../components/DrawerCosecha'
import ExcelJS from 'exceljs'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8007'

const NORMAS = [
  { key: 'seg_chaleco', label: 'Chaleco', short: 'Chaleco', icon: 'bx bx-vest' },
  { key: 'seg_cofia', label: 'Cofia', short: 'Cofia', icon: 'bx bx-hard-hat' },
  { key: 'seg_casco', label: 'Casco', short: 'Casco', icon: 'bx bx-shield-quarter' },
  { key: 'seg_calzado_adecuado', label: 'Calzado adecuado', short: 'Calzado A.', icon: 'bx bx-walk' },
  { key: 'seg_limpieza_bines', label: 'Limpieza de bines', short: 'Limpieza B.', icon: 'bx bx-droplet' },
  { key: 'seg_materiales_extranos', label: 'Sin materiales extraños', short: 'Sin Mat. Ext.', icon: 'bx bx-search-alt' },
  { key: 'seg_saran', label: 'Saran', short: 'Saran', icon: 'bx bx-layer' },
]

function ReporteSeguridad() {
  const [fichas, setFichas] = useState([])
  const [loading, setLoading] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [filtroCamion, setFiltroCamion] = useState('')
  const [filtroEmpresa, setFiltroEmpresa] = useState('')
  const [filtroNormas, setFiltroNormas] = useState(() => Object.fromEntries(NORMAS.map(n => [n.key, ''])))
  const [fechaDesde, setFechaDesde] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split('T')[0]
  })
  const [fechaHasta, setFechaHasta] = useState(() => new Date().toISOString().split('T')[0])
  const [filtroProyecto, setFiltroProyecto] = useState('')
  const [fichaDetalle, setFichaDetalle] = useState(null)
  const [fotosAmpliadas, setFotosAmpliadas] = useState(null)
  const [fotoAmpliadaIdx, setFotoAmpliadaIdx] = useState(0)
  const [editandoChecklist, setEditandoChecklist] = useState(false)
  const [checklistEdit, setChecklistEdit] = useState({})
  const [guardandoChecklist, setGuardandoChecklist] = useState(false)

  const abrirDetalle = (f) => {
    setFichaDetalle(f)
    setEditandoChecklist(false)
    setChecklistEdit({
      ...Object.fromEntries(NORMAS.map(n => [n.key, !!f[n.key]])),
      seg_observaciones: f.seg_observaciones || ''
    })
  }

  const guardarChecklist = async () => {
    if (!fichaDetalle) return
    setGuardandoChecklist(true)
    try {
      const res = await fetch(`${API_URL}/api/cosecha-transp/${fichaDetalle.id}/seguridad`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(checklistEdit)
      })
      if (res.ok) {
        setFichaDetalle(prev => ({ ...prev, ...checklistEdit }))
        setFichas(prev => prev.map(f => f.id === fichaDetalle.id ? { ...f, ...checklistEdit } : f))
        setEditandoChecklist(false)
      }
    } finally {
      setGuardandoChecklist(false)
    }
  }

  const eliminarFichaDetalle = async () => {
    if (!fichaDetalle) return
    const conf = await Swal.fire({
      title: '¿Eliminar esta ficha?',
      text: `La ficha ${fichaDetalle.placa} quedará como Eliminada y no aparecerá en los reportes.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#dc3545'
    })
    if (!conf.isConfirmed) return
    try {
      const res = await fetch(`${API_URL}/api/cosecha-transp/${fichaDetalle.id}/estado`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: 'Eliminado' })
      })
      if (res.ok) {
        Swal.fire('Eliminada', 'Ficha marcada como Eliminada', 'success')
        setFichaDetalle(null)
        fetchData()
      } else {
        Swal.fire('Error', 'No se pudo eliminar la ficha', 'error')
      }
    } catch {
      Swal.fire('Error', 'Error de conexión', 'error')
    }
  }

  const abrirFotoAmpliada = (fotos, idx = 0) => { setFotosAmpliadas(fotos); setFotoAmpliadaIdx(idx) }
  const cerrarFotoAmpliada = () => { setFotosAmpliadas(null); setFotoAmpliadaIdx(0) }

  useEffect(() => { fetchData() }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      const res = await fetch(`${API_URL}/api/cosecha-transp`, {})
      if (res.status === 401) return  // la sesion vencida la maneja services/sesion.js
      if (res.ok) setFichas(await res.json())
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

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

  const numeroFicha = (f) => (f.productos || [])[0]?.num_ficha || '-'

  const opcionesCamion = [...new Set(fichas.map(f => f.placa).filter(Boolean))].sort()
  const opcionesEmpresa = [...new Set(fichas.map(f => f.propietario).filter(Boolean))].sort()
  // Centro de costo del primer producto (misma logica que el filtro de Proyecto en Reportes de Cosecha)
  const resolverProyectoFiltro = (f) => ((f.productos || [])[0]?.centro_costos || '').trim()
  const opcionesProyecto = [...new Set(fichas.map(f => resolverProyectoFiltro(f)).filter(Boolean))].sort()

  const filtradas = fichas.filter(f => {
    if (f.estado === 'Falla' || f.estado === 'Eliminado') return false
    const matchBusqueda = !busqueda ||
      (f.placa || '').toLowerCase().includes(busqueda.toLowerCase()) ||
      (f.nombre_chofer || '').toLowerCase().includes(busqueda.toLowerCase())
    const matchCamion = !filtroCamion || f.placa === filtroCamion
    const matchEmpresa = !filtroEmpresa || (f.propietario || '') === filtroEmpresa
    const matchProyecto = !filtroProyecto || resolverProyectoFiltro(f) === filtroProyecto
    const matchNormas = NORMAS.every(n => {
      const val = filtroNormas[n.key]
      if (!val) return true
      return val === 'Cumple' ? !!f[n.key] : !f[n.key]
    })
    let matchFecha = true
    if (f.fecha_creacion) {
      const fichaDate = f.fecha_creacion.split('T')[0]
      if (fechaDesde) matchFecha = fichaDate >= fechaDesde
      if (fechaHasta && matchFecha) matchFecha = fichaDate <= fechaHasta
    }
    return matchBusqueda && matchCamion && matchEmpresa && matchProyecto && matchNormas && matchFecha
  })

  const hayFiltrosActivos = filtroCamion || filtroEmpresa || filtroProyecto || Object.values(filtroNormas).some(Boolean)
  const limpiarFiltros = () => { setFiltroCamion(''); setFiltroEmpresa(''); setFiltroProyecto(''); setFiltroNormas(Object.fromEntries(NORMAS.map(n => [n.key, '']))) }

  const cumpleTodo = (f) => NORMAS.every(n => f[n.key])

  const totalCumplen = filtradas.filter(cumpleTodo).length

  const handleDescargar = async () => {
    const COLS = ['Fecha', 'N° Ficha', 'Placa', 'Resp. Transporte', 'Propietario', ...NORMAS.map(n => n.short), 'Foto', 'Observaciones', 'Cumple']
    const MORADO = 'FF7B1FA2'
    const BLANCO = 'FFFFFFFF'

    const workbook = new ExcelJS.Workbook()
    const hoja = workbook.addWorksheet('Reporte de Camiones')

    COLS.forEach((c, idx) => {
      const celda = hoja.getRow(1).getCell(idx + 1)
      celda.value = c
      celda.font = { bold: true, color: { argb: BLANCO } }
      celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MORADO } }
    })

    filtradas.forEach((f, i) => {
      const fila = i + 2
      const fecha = f.fecha_creacion ? new Date(f.fecha_creacion).toLocaleDateString('es-EC', {day:'2-digit', month:'2-digit', year:'numeric'}) : '-'
      const valores = [
        fecha, numeroFicha(f), f.placa || '-', formatNombre(f.nombre_chofer), f.propietario || '-',
        ...NORMAS.map(n => f[n.key] ? 'Sí' : 'No')
      ]
      valores.forEach((v, idx) => { hoja.getRow(fila).getCell(idx + 1).value = v })

      const colFoto = valores.length + 1
      const fotos = parseFotos(f.seg_foto_url)
      const celdaFoto = hoja.getRow(fila).getCell(colFoto)
      if (fotos.length > 0) {
        celdaFoto.value = { text: fotos.length > 1 ? `Ver foto (+${fotos.length - 1} más)` : 'Ver foto', hyperlink: fotos[0] }
        celdaFoto.font = { color: { argb: 'FF1976D2' }, underline: true }
      } else {
        celdaFoto.value = '-'
      }

      hoja.getRow(fila).getCell(colFoto + 1).value = f.seg_observaciones || '-'
      hoja.getRow(fila).getCell(colFoto + 2).value = cumpleTodo(f) ? 'Sí' : 'No'
    })

    hoja.columns = COLS.map((c, idx) => {
      let max = c.length
      filtradas.forEach((f, i) => {
        const cell = hoja.getRow(i + 2).getCell(idx + 1)
        const len = String(cell.value?.text || cell.value || '').length
        if (len > max) max = len
      })
      return { width: Math.min(Math.max(max + 2, 10), 40) }
    })
    hoja.views = [{ state: 'frozen', ySplit: 1 }]

    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `reporte-camiones-${new Date().toISOString().split('T')[0]}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) return <div style={{textAlign:'center',padding:'3rem'}}><p>Cargando...</p></div>

  return (
    <>
      <div className="page-header" style={{display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center'}}>
        <div>
          <h1><i className='bx bx-shield-quarter'></i> Reporte de Camiones</h1>
          <p className="page-subtitle">{filtradas.length} fichas | {totalCumplen} cumplen todas las normas</p>
        </div>
        <button onClick={handleDescargar} style={{background: '#7b1fa2', color: 'white', border: 'none', borderRadius: '8px', padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap'}}>
          <i className='bx bx-download'></i> Descargar
        </button>
      </div>

      {/* Panel de búsqueda y filtros */}
      <div style={{background: 'var(--color-bg-white)', borderRadius: '12px', boxShadow: '0 1px 6px rgba(0,0,0,0.07)', marginBottom: '0.8rem', overflow: 'hidden'}}>
        <div style={{display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', padding: '0.75rem 1rem', borderBottom: '1px solid var(--color-border)'}}>
          <div style={{flex: 1, position: 'relative', minWidth: '200px'}}>
            <i className='bx bx-search' style={{position:'absolute', left:'10px', top:'50%', transform:'translateY(-50%)', color:'var(--color-text-secondary)', fontSize:'1rem'}}></i>
            <input type="text" className="form-control" value={busqueda} onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar placa, chofer..."
              style={{paddingLeft:'2.1rem', borderRadius:'8px', border:'1px solid var(--color-border)', background:'var(--color-bg-white)', color:'var(--color-text-primary)', fontSize:'0.82rem', height:'34px'}} />
          </div>
          <div style={{display:'flex', gap:'0.4rem', alignItems:'center'}}>
            <span style={{fontSize:'0.75rem', color:'var(--color-text-secondary)', whiteSpace:'nowrap'}}>Del</span>
            <input type="date" className="form-control" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)}
              style={{fontSize:'0.8rem', padding:'0.3rem 0.5rem', width:'138px', borderRadius:'8px', border:'1px solid var(--color-border)', background:'var(--color-bg-white)', color:'var(--color-text-primary)', height:'34px'}} />
            <span style={{fontSize:'0.75rem', color:'var(--color-text-secondary)'}}>al</span>
            <input type="date" className="form-control" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)}
              style={{fontSize:'0.8rem', padding:'0.3rem 0.5rem', width:'138px', borderRadius:'8px', border:'1px solid var(--color-border)', background:'var(--color-bg-white)', color:'var(--color-text-primary)', height:'34px'}} />
            {(fechaDesde || fechaHasta) && (
              <button onClick={() => { setFechaDesde(''); setFechaHasta('') }}
                style={{background:'var(--color-bg-light)', border:'none', borderRadius:'6px', color:'#dc3545', cursor:'pointer', padding:'0.3rem 0.5rem', fontSize:'0.85rem', lineHeight:1}}>
                <i className='bx bx-x'></i>
              </button>
            )}
          </div>
        </div>

        <div style={{display:'flex', alignItems:'center', gap:'0.5rem', padding:'0.6rem 1rem', flexWrap:'wrap'}}>
          <span style={{fontSize:'0.72rem', color:'var(--color-text-secondary)', fontWeight:600, letterSpacing:'0.03em', textTransform:'uppercase', whiteSpace:'nowrap', flexShrink:0}}>
            <i className='bx bx-filter-alt' style={{verticalAlign:'middle', marginRight:'3px'}}></i>Filtrar
          </span>

          <div style={{flex:1, display:'flex', alignItems:'center', minWidth:'160px',
            border: '1px solid ' + (filtroCamion ? '#7b1fa2' : 'var(--color-border)'),
            borderRadius:'8px', background: filtroCamion ? 'var(--color-bg-light)' : 'var(--color-bg-light)',
            padding:'0 0.6rem 0 0.7rem', height:'34px', cursor:'pointer', transition:'all 0.15s'}}>
            <i className='bx bx-car' style={{fontSize:'0.85rem', color: filtroCamion ? '#7b1fa2' : 'var(--color-text-secondary)', marginRight:'6px', flexShrink:0}}></i>
            <select value={filtroCamion} onChange={e => setFiltroCamion(e.target.value)}
              style={{flex:1, border:'none', background:'transparent', fontSize:'0.8rem', color: filtroCamion ? '#7b1fa2' : 'var(--color-text-primary)',
                fontWeight: filtroCamion ? 600 : 400, cursor:'pointer', outline:'none', padding:0, minWidth:0,
                appearance:'none', WebkitAppearance:'none'}}>
              <option value="">Camión</option>
              {opcionesCamion.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            <i className='bx bx-chevron-down' style={{fontSize:'0.8rem', color:'var(--color-text-secondary)', marginLeft:'4px', pointerEvents:'none', flexShrink:0}}></i>
          </div>

          <div style={{flex:1, display:'flex', alignItems:'center', minWidth:'160px',
            border: '1px solid ' + (filtroEmpresa ? '#7b1fa2' : 'var(--color-border)'),
            borderRadius:'8px', background: filtroEmpresa ? 'var(--color-bg-light)' : 'var(--color-bg-light)',
            padding:'0 0.6rem 0 0.7rem', height:'34px', cursor:'pointer', transition:'all 0.15s'}}>
            <i className='bx bx-building' style={{fontSize:'0.85rem', color: filtroEmpresa ? '#7b1fa2' : 'var(--color-text-secondary)', marginRight:'6px', flexShrink:0}}></i>
            <select value={filtroEmpresa} onChange={e => setFiltroEmpresa(e.target.value)}
              style={{flex:1, border:'none', background:'transparent', fontSize:'0.8rem', color: filtroEmpresa ? '#7b1fa2' : 'var(--color-text-primary)',
                fontWeight: filtroEmpresa ? 600 : 400, cursor:'pointer', outline:'none', padding:0, minWidth:0,
                appearance:'none', WebkitAppearance:'none'}}>
              <option value="">Empresa</option>
              {opcionesEmpresa.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            <i className='bx bx-chevron-down' style={{fontSize:'0.8rem', color:'var(--color-text-secondary)', marginLeft:'4px', pointerEvents:'none', flexShrink:0}}></i>
          </div>

          <div style={{flex:1, display:'flex', alignItems:'center', minWidth:'160px',
            border: '1px solid ' + (filtroProyecto ? '#7b1fa2' : 'var(--color-border)'),
            borderRadius:'8px', background: filtroProyecto ? 'var(--color-bg-light)' : 'var(--color-bg-light)',
            padding:'0 0.6rem 0 0.7rem', height:'34px', cursor:'pointer', transition:'all 0.15s'}}>
            <i className='bx bx-map-pin' style={{fontSize:'0.85rem', color: filtroProyecto ? '#7b1fa2' : 'var(--color-text-secondary)', marginRight:'6px', flexShrink:0}}></i>
            <select value={filtroProyecto} onChange={e => setFiltroProyecto(e.target.value)}
              style={{flex:1, border:'none', background:'transparent', fontSize:'0.8rem', color: filtroProyecto ? '#7b1fa2' : 'var(--color-text-primary)',
                fontWeight: filtroProyecto ? 600 : 400, cursor:'pointer', outline:'none', padding:0, minWidth:0,
                appearance:'none', WebkitAppearance:'none'}}>
              <option value="">Proyecto</option>
              {opcionesProyecto.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            <i className='bx bx-chevron-down' style={{fontSize:'0.8rem', color:'var(--color-text-secondary)', marginLeft:'4px', pointerEvents:'none', flexShrink:0}}></i>
          </div>

          {hayFiltrosActivos && (
            <button onClick={limpiarFiltros}
              style={{height:'30px', background:'var(--color-bg-light)', border:'1px solid var(--color-border)', color:'#dc3545', borderRadius:'20px',
                padding:'0 0.7rem', cursor:'pointer', fontSize:'0.75rem', display:'flex', alignItems:'center', gap:'3px'}}>
              <i className='bx bx-x'></i> Limpiar
            </button>
          )}
          <button onClick={fetchData} disabled={loading} style={{marginLeft:'auto', background:'var(--color-primary-soft)', border:'1px solid var(--color-border)', borderRadius:'8px', color:'var(--color-primary-texto)', cursor:'pointer', padding:'0.4rem 0.8rem', fontSize:'0.8rem', display:'flex', alignItems:'center', gap:'0.35rem', height:'34px', whiteSpace:'nowrap'}}>
            <i className={`bx bx-refresh ${loading ? 'bx-spin' : ''}`}></i> Actualizar
          </button>
        </div>

        {/* Fila 3: filtros por cada normativa de seguridad (toggle de 3 estados) */}
        <div style={{display:'flex', alignItems:'center', gap:'0.5rem', padding:'0 1rem 0.6rem', flexWrap:'wrap', borderTop:'1px solid var(--color-bg-light)', paddingTop:'0.6rem'}}>
          <span style={{fontSize:'0.72rem', color:'var(--color-text-secondary)', fontWeight:600, letterSpacing:'0.03em', textTransform:'uppercase', whiteSpace:'nowrap', flexShrink:0}}>
            <i className='bx bx-shield-quarter' style={{verticalAlign:'middle', marginRight:'3px'}}></i>Normativas
          </span>
          {NORMAS.map(n => {
            const value = filtroNormas[n.key]
            const siguiente = { '': 'Cumple', 'Cumple': 'No cumple', 'No cumple': '' }
            const colores = { '': { border: 'var(--color-bg-light)', bg: 'var(--color-bg-light)', fg: 'var(--color-text-secondary)' }, 'Cumple': { border: '#28a745', bg: '#28a745', fg: 'var(--color-bg-white)' }, 'No cumple': { border: '#dc3545', bg: '#dc3545', fg: 'var(--color-bg-white)' } }
            const c = colores[value] || colores['']
            return (
              <button key={n.key} type="button" onClick={() => setFiltroNormas(prev => ({...prev, [n.key]: siguiente[prev[n.key]]}))}
                style={{display:'flex', alignItems:'center', gap:'5px',
                  border: '1px solid ' + c.border, borderRadius:'20px', background: c.bg, color: c.fg,
                  padding:'0 0.7rem', height:'30px', cursor:'pointer', fontSize:'0.75rem', fontWeight: value ? 600 : 400,
                  transition:'all 0.15s'}}>
                <i className={n.icon} style={{fontSize:'0.8rem'}}></i>
                {n.label}
                <i className={`bx ${value === 'Cumple' ? 'bx-toggle-right' : value === 'No cumple' ? 'bx-block' : 'bx-toggle-left'}`} style={{fontSize:'1rem'}}></i>
              </button>
            )
          })}
        </div>
      </div>

      {/* Tabla */}
      <div className="tabla-container" style={{overflowX: 'auto'}}>
        <table className="tabla" style={{fontSize: '0.8rem'}}>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>N° Ficha</th>
              <th>Placa</th>
              <th>Resp. Transporte</th>
              <th>Propietario</th>
              {NORMAS.map(n => <th key={n.key} style={{textAlign:'center'}}>{n.short}</th>)}
              <th>Foto</th>
              <th>Observaciones</th>
            </tr>
          </thead>
          <tbody>
            {filtradas.map(f => (
              <tr key={f.id} className="clickeable" onClick={() => abrirDetalle(f)} style={{cursor:'pointer'}}>
                <td style={{whiteSpace:'nowrap'}}>{f.fecha_creacion ? new Date(f.fecha_creacion).toLocaleDateString('es-EC', {day:'2-digit', month:'2-digit', year:'numeric'}) : '-'}</td>
                <td style={{whiteSpace:'nowrap', fontSize:'0.75rem', color:'#7b1fa2', fontWeight:600}}>{numeroFicha(f)}</td>
                <td><strong>{f.placa || '-'}</strong></td>
                <td>{formatNombre(f.nombre_chofer)}</td>
                <td>{f.propietario || '-'}</td>
                {NORMAS.map(n => (
                  <td key={n.key} style={{textAlign:'center'}}>
                    <i className={`bx ${f[n.key] ? 'bx-check-circle' : 'bx-x-circle'}`} style={{color: f[n.key] ? '#28a745' : '#dc3545', fontSize:'1rem'}}></i>
                  </td>
                ))}
                <td style={{textAlign:'center'}}>
                  {(() => {
                    const fotos = parseFotos(f.seg_foto_url)
                    return fotos.length > 0 ? (
                      <div style={{position:'relative', display:'inline-block'}}>
                        <img src={fotos[0]} alt="Evidencia"
                          onClick={(e) => { e.stopPropagation(); abrirFotoAmpliada(fotos, 0) }}
                          style={{width:'40px', height:'40px', objectFit:'cover', borderRadius:'6px', border:'1px solid var(--color-border)', cursor:'pointer'}} />
                        {fotos.length > 1 && (
                          <span style={{position:'absolute', bottom:'-4px', right:'-4px', background:'#7b1fa2', color:'var(--color-bg-white)', borderRadius:'10px', fontSize:'0.6rem', padding:'0 4px', lineHeight:'14px'}}>+{fotos.length - 1}</span>
                        )}
                      </div>
                    ) : (
                      <div style={{width:'40px', height:'40px', borderRadius:'6px', border:'1px dashed var(--color-border)', background:'var(--color-bg-light)', margin:'0 auto'}}></div>
                    )
                  })()}
                </td>
                <td style={{maxWidth:'200px', fontSize:'0.75rem', color:'var(--color-text-secondary)'}}>{f.seg_observaciones || '-'}</td>
              </tr>
            ))}
            {filtradas.length === 0 && (
              <tr><td colSpan={5 + NORMAS.length + 2} style={{textAlign:'center',padding:'2rem',color:'var(--color-text-secondary)'}}>No hay registros de seguridad</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Drawer detalle */}
      {fichaDetalle && (
        <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99998}}>
          <div style={{position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)'}} onClick={() => setFichaDetalle(null)} />
          <div style={{position: 'absolute', top: 0, right: 0, bottom: 0, width: '95vw', maxWidth: '480px', background: 'var(--color-bg-white)', boxShadow: '-4px 0 20px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', overflow: 'hidden'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 1rem', borderBottom: '1px solid var(--color-bg-light)', background: 'var(--color-bg-light)', flexShrink: 0}}>
              <span style={{fontWeight: 600, color: 'var(--color-text-primary)', fontSize: '0.85rem'}}>
                {fichaDetalle.placa} - {formatNombre(fichaDetalle.nombre_chofer)}
              </span>
              <div style={{display:'flex', gap:'0.4rem'}}>
                {!editandoChecklist ? (
                  <button onClick={() => setEditandoChecklist(true)} style={{background: '#7b1fa2', color:'var(--color-bg-white)', border: 'none', borderRadius: '6px', padding: '0.4rem 0.8rem', cursor: 'pointer', fontSize: '0.75rem', display:'flex', alignItems:'center', gap:'0.3rem'}}>
                    <i className='bx bx-edit'></i> Editar
                  </button>
                ) : (
                  <button onClick={guardarChecklist} disabled={guardandoChecklist} style={{background: '#28a745', color:'var(--color-bg-white)', border: 'none', borderRadius: '6px', padding: '0.4rem 0.8rem', cursor: guardandoChecklist ? 'default' : 'pointer', fontSize: '0.75rem', opacity: guardandoChecklist ? 0.7 : 1, display:'flex', alignItems:'center', gap:'0.3rem'}}>
                    <i className='bx bx-save'></i> {guardandoChecklist ? 'Guardando...' : 'Guardar'}
                  </button>
                )}
                <button onClick={eliminarFichaDetalle} style={{background: '#dc3545', color:'var(--color-bg-white)', border: 'none', borderRadius: '6px', padding: '0.4rem 0.8rem', cursor: 'pointer', fontSize: '0.75rem', display:'flex', alignItems:'center', gap:'0.3rem'}}>
                  <i className='bx bx-trash'></i> Eliminar
                </button>
                <button onClick={() => setFichaDetalle(null)} style={{background: 'var(--color-bg-light)', border: 'none', borderRadius: '6px', padding: '0.4rem 0.7rem', cursor: 'pointer', fontSize: '1rem', color: 'var(--color-text-secondary)'}}>
                  <i className='bx bx-x'></i>
                </button>
              </div>
            </div>
            <div style={{flex: 1, overflow: 'auto', padding: '1rem'}}>
              <p style={{fontSize:'0.8rem', color:'var(--color-text-secondary)', margin:'0 0 0.8rem'}}>
                {fichaDetalle.fecha_creacion ? new Date(fichaDetalle.fecha_creacion).toLocaleDateString('es-EC', {day:'2-digit', month:'2-digit', year:'numeric'}) : '-'} | {fichaDetalle.propietario || '-'} | <strong style={{color:'#7b1fa2'}}>{numeroFicha(fichaDetalle)}</strong>
              </p>
              {NORMAS.map(n => (
                <div key={n.key} style={{display:'flex', alignItems:'center', gap:'0.5rem', padding:'0.5rem 0', borderBottom:'1px solid var(--color-bg-light)', cursor: editandoChecklist ? 'pointer' : 'default'}}
                  onClick={editandoChecklist ? () => setChecklistEdit(prev => ({...prev, [n.key]: !prev[n.key]})) : undefined}>
                  <i className={n.icon} style={{fontSize:'1.1rem', color:'#7b1fa2'}}></i>
                  <span style={{flex:1, fontSize:'0.85rem'}}>{n.label}</span>
                  <i className={`bx ${(editandoChecklist ? checklistEdit[n.key] : fichaDetalle[n.key]) ? 'bx-check-circle' : 'bx-x-circle'}`} style={{color: (editandoChecklist ? checklistEdit[n.key] : fichaDetalle[n.key]) ? '#28a745' : '#dc3545', fontSize:'1.2rem'}}></i>
                </div>
              ))}
              {editandoChecklist && (
                <div style={{marginTop:'1rem'}}>
                  <h4 style={{margin:'0 0 0.4rem', color:'var(--color-text-secondary)', fontSize:'0.85rem'}}>Observaciones</h4>
                  <textarea value={checklistEdit.seg_observaciones || ''} onChange={e => setChecklistEdit(prev => ({...prev, seg_observaciones: e.target.value}))}
                    rows={3} style={{width:'100%', border:'1px solid var(--color-border)', borderRadius:'6px', padding:'0.5rem', fontSize:'0.8rem', resize:'vertical'}} />
                </div>
              )}
              <div style={{marginTop:'1rem'}}>
                <h4 style={{margin:'0 0 0.4rem', color:'var(--color-text-secondary)', fontSize:'0.85rem'}}>Fotos de evidencia</h4>
                {(() => {
                  const fotos = parseFotos(fichaDetalle.seg_foto_url)
                  return fotos.length > 0 ? (
                    <div style={{display:'flex', flexWrap:'wrap', gap:'0.5rem'}}>
                      {fotos.map((url, i) => (
                        <img key={i} src={url} alt="Evidencia" onClick={() => abrirFotoAmpliada(fotos, i)}
                          style={{width:'90px', height:'90px', objectFit:'cover', borderRadius:'8px', border:'1px solid var(--color-bg-light)', cursor:'pointer'}} />
                      ))}
                    </div>
                  ) : (
                    <div style={{width:'100%', height:'120px', borderRadius:'8px', border:'1px dashed var(--color-border)', background:'var(--color-bg-light)', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--color-border)', fontSize:'0.8rem'}}>
                      Sin foto
                    </div>
                  )
                })()}
              </div>
              {!editandoChecklist && fichaDetalle.seg_observaciones && (
                <div style={{marginTop:'1rem'}}>
                  <h4 style={{margin:'0 0 0.4rem', color:'var(--color-text-secondary)', fontSize:'0.85rem'}}>Observaciones</h4>
                  <p style={{fontSize:'0.8rem', color:'var(--color-text-secondary)', background:'var(--color-bg-light)', padding:'0.6rem', borderRadius:'8px'}}>
                    {fichaDetalle.seg_observaciones}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Visor de foto ampliada */}
      {fotosAmpliadas && (
        <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.75)', zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem'}}
          onClick={cerrarFotoAmpliada}>
          {fotosAmpliadas.length > 1 && (
            <button onClick={(e) => { e.stopPropagation(); setFotoAmpliadaIdx(i => (i - 1 + fotosAmpliadas.length) % fotosAmpliadas.length) }}
              style={{position:'absolute', left:'1rem', background:'var(--color-bg-white)', border:'none', borderRadius:'50%', width:'36px', height:'36px', cursor:'pointer', fontSize:'1.2rem', color:'var(--color-text-primary)'}}>
              <i className='bx bx-chevron-left'></i>
            </button>
          )}
          <img src={fotosAmpliadas[fotoAmpliadaIdx]} alt="Evidencia" onClick={(e) => e.stopPropagation()} style={{maxWidth:'90vw', maxHeight:'90vh', borderRadius:'8px'}} />
          {fotosAmpliadas.length > 1 && (
            <button onClick={(e) => { e.stopPropagation(); setFotoAmpliadaIdx(i => (i + 1) % fotosAmpliadas.length) }}
              style={{position:'absolute', right:'4.5rem', background:'var(--color-bg-white)', border:'none', borderRadius:'50%', width:'36px', height:'36px', cursor:'pointer', fontSize:'1.2rem', color:'var(--color-text-primary)'}}>
              <i className='bx bx-chevron-right'></i>
            </button>
          )}
          <button onClick={cerrarFotoAmpliada} style={{position:'absolute', top:'1rem', right:'1rem', background:'var(--color-bg-white)', border:'none', borderRadius:'50%', width:'36px', height:'36px', cursor:'pointer', fontSize:'1.2rem', color:'var(--color-text-primary)'}}>
            <i className='bx bx-x'></i>
          </button>
        </div>
      )}
    </>
  )
}

export default ReporteSeguridad
