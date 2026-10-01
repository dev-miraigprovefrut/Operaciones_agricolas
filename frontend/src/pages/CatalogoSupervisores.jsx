import { useState, useEffect } from 'react'
import Swal from 'sweetalert2'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8007'

function CatalogoSupervisores() {
  const [supervisores, setSupervisores] = useState([])
  const [proyectos, setProyectos] = useState([])
  const [loading, setLoading] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editando, setEditando] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [filtroProyecto, setFiltroProyecto] = useState('Todos')
  const [formData, setFormData] = useState({ cedula: '', nombre: '', id_proyecto: '', estado: 'Activo' })

  useEffect(() => { fetchData() }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      const [resSup, resProy] = await Promise.all([
        fetch(`${API_URL}/api/supervisores`),
        fetch(`${API_URL}/api/proyectos`)
      ])
      if (resSup.ok) setSupervisores(await resSup.json())
      if (resProy.ok) setProyectos(await resProy.json())
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const abrirNuevo = () => {
    setEditando(null)
    setFormData({ cedula: '', nombre: '', id_proyecto: '', estado: 'Activo' })
    setDrawerOpen(true)
  }

  const abrirEditar = (s) => {
    setEditando(s)
    setFormData({ cedula: s.cedula || '', nombre: s.nombre || '', id_proyecto: s.id_proyecto || '', estado: s.estado || 'Activo' })
    setDrawerOpen(true)
  }

  const handleGuardar = async () => {
    if (!formData.nombre.trim() || !formData.cedula.trim()) return
    const payload = { ...formData, id_proyecto: formData.id_proyecto || null }
    try {
      if (editando) {
        const res = await fetch(`${API_URL}/api/supervisores/${editando.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
        if (!res.ok) {
          const err = await res.json()
          Swal.fire('Error', err.detail || 'Error al actualizar', 'error')
          return
        }
      } else {
        const res = await fetch(`${API_URL}/api/supervisores`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
        if (!res.ok) {
          const err = await res.json()
          Swal.fire('Error', err.detail || 'Error al crear', 'error')
          return
        }
      }
      await fetchData()
      setDrawerOpen(false)
    } catch (err) { console.error(err) }
  }

  const handleEliminar = async () => {
    if (!editando) return
    const result = await Swal.fire({
      title: 'Eliminar supervisor',
      text: `Se eliminará a ${editando.nombre}`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#dc3545'
    })
    if (!result.isConfirmed) return
    try {
      await fetch(`${API_URL}/api/supervisores/${editando.id}`, { method: 'DELETE' })
      await fetchData()
      setDrawerOpen(false)
    } catch (err) { console.error(err) }
  }

  const filtrados = supervisores.filter(s => {
    const texto = `${s.nombre} ${s.cedula}`.toLowerCase()
    const matchBusqueda = !busqueda || texto.includes(busqueda.toLowerCase())
    const matchProyecto = filtroProyecto === 'Todos' || s.proyecto === filtroProyecto
    return matchBusqueda && matchProyecto
  })

  const proyectosUnicos = ['Todos', ...new Set(supervisores.map(s => s.proyecto).filter(Boolean))]
  const proyectosActivos = proyectos.filter(p => p.estado === 'Activo')

  if (loading) return <div style={{textAlign:'center',padding:'3rem'}}><p>Cargando...</p></div>

  return (
    <>
      <div className="page-header" style={{display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center'}}>
        <div>
          <h1><i className='bx bx-user-check'></i> Supervisores</h1>
          <p className="page-subtitle">Supervisores de campo</p>
        </div>
        <button className="btn btn-primary" onClick={abrirNuevo}>
          <i className='bx bx-plus'></i> Nuevo
        </button>
      </div>

      {/* Filtros */}
      <div style={{display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap'}}>
        <div style={{flex: 1, position: 'relative', minWidth: '200px'}}>
          <i className='bx bx-search' style={{position:'absolute', left:'10px', top:'50%', transform:'translateY(-50%)', color:'var(--color-text-secondary)'}}></i>
          <input type="text" className="form-control" value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar por nombre o cédula..." style={{paddingLeft:'2rem'}} />
        </div>
        <select className="form-control" value={filtroProyecto} onChange={e => setFiltroProyecto(e.target.value)} style={{width: 'auto', minWidth: '160px'}}>
          {proyectosUnicos.map(p => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>

      {/* Tabla */}
      <div className="tabla-container">
        <table className="tabla">
          <thead>
            <tr>
              <th>C.I.</th>
              <th>Nombre</th>
              <th>Proyecto</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map(s => (
              <tr key={s.id} className="clickeable" onClick={() => abrirEditar(s)}>
                <td>{s.cedula}</td>
                <td><strong>{s.nombre}</strong></td>
                <td>{s.proyecto || '-'}</td>
                <td><span style={{background: s.estado === 'Activo' ? '#28a745' : '#dc3545', color: 'white', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem'}}>{s.estado}</span></td>
              </tr>
            ))}
            {filtrados.length === 0 && (
              <tr><td colSpan="4" style={{textAlign:'center',padding:'2rem',color:'var(--color-text-secondary)'}}>No hay supervisores</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Drawer */}
      <div className={`drawer-overlay ${drawerOpen ? 'active' : ''}`} onClick={() => setDrawerOpen(false)}></div>
      <div className={`drawer ${drawerOpen ? 'open' : ''}`}>
        <div className="drawer-header">
          <div className="drawer-header-top">
            <h2><i className='bx bx-user-check'></i> {editando ? 'Editar Supervisor' : 'Nuevo Supervisor'}</h2>
            <button className="drawer-close" onClick={() => setDrawerOpen(false)}><i className='bx bx-x'></i></button>
          </div>
        </div>
        <div className="drawer-content">
          <div className="drawer-section">
            <div className="form-group">
              <label className="form-label">C.I. <span className="required">*</span></label>
              <input type="text" className="form-control" value={formData.cedula}
                onChange={e => setFormData({...formData, cedula: e.target.value})}
                placeholder="0000000000" />
            </div>
            <div className="form-group">
              <label className="form-label">Nombre completo <span className="required">*</span></label>
              <input type="text" className="form-control" value={formData.nombre}
                onChange={e => setFormData({...formData, nombre: e.target.value.toUpperCase()})}
                placeholder="Nombres y apellidos" />
            </div>
            <div className="form-group">
              <label className="form-label">Proyecto</label>
              <select className="form-control" value={formData.id_proyecto} onChange={e => setFormData({...formData, id_proyecto: e.target.value ? parseInt(e.target.value) : ''})}>
                <option value="">Sin proyecto</option>
                {proyectosActivos.map(p => (
                  <option key={p.id} value={p.id}>{p.nombre}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Estado</label>
              <select className="form-control" value={formData.estado} onChange={e => setFormData({...formData, estado: e.target.value})}>
                <option value="Activo">Activo</option>
                <option value="Inactivo">Inactivo</option>
              </select>
            </div>
          </div>
        </div>
        <div className="drawer-footer">
          {editando && (
            <button onClick={handleEliminar} style={{background:'transparent', border:'1px solid #dc3545', color:'#dc3545', borderRadius:'6px', padding:'0.4rem 0.8rem', cursor:'pointer', fontSize:'0.8rem', display:'flex', alignItems:'center', gap:'0.3rem'}}>
              <i className='bx bx-trash'></i> Eliminar
            </button>
          )}
          <div style={{flex:1}}></div>
          <button className="btn btn-primary" onClick={handleGuardar}
            disabled={!formData.nombre.trim() || !formData.cedula.trim()}>
            <i className='bx bx-save'></i> Guardar
          </button>
        </div>
      </div>
    </>
  )
}

export default CatalogoSupervisores
