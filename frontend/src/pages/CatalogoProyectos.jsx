import { useState, useEffect } from 'react'
import Swal from 'sweetalert2'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8007'

function CatalogoProyectos() {
  const [proyectos, setProyectos] = useState([])
  const [loading, setLoading] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editando, setEditando] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('Todos')
  const [formData, setFormData] = useState({ nombre: '', direccion: '', tipo: 'Convencional', estado: 'Activo' })

  useEffect(() => { fetchData() }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      const res = await fetch(`${API_URL}/api/proyectos`)
      if (res.ok) setProyectos(await res.json())
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const abrirNuevo = () => {
    setEditando(null)
    setFormData({ nombre: '', direccion: '', tipo: 'Convencional', estado: 'Activo' })
    setDrawerOpen(true)
  }

  const abrirEditar = (p) => {
    setEditando(p)
    setFormData({ nombre: p.nombre || '', direccion: p.direccion || '', tipo: p.tipo || 'Convencional', estado: p.estado || 'Activo' })
    setDrawerOpen(true)
  }

  const handleGuardar = async () => {
    if (!formData.nombre.trim()) return
    try {
      if (editando) {
        const res = await fetch(`${API_URL}/api/proyectos/${editando.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData)
        })
        if (!res.ok) {
          const err = await res.json()
          Swal.fire('Error', err.detail || 'Error al actualizar', 'error')
          return
        }
      } else {
        const res = await fetch(`${API_URL}/api/proyectos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData)
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
      title: 'Eliminar proyecto',
      text: `Se eliminará el proyecto ${editando.nombre}`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#dc3545'
    })
    if (!result.isConfirmed) return
    try {
      await fetch(`${API_URL}/api/proyectos/${editando.id}`, { method: 'DELETE' })
      await fetchData()
      setDrawerOpen(false)
    } catch (err) { console.error(err) }
  }

  const filtrados = proyectos.filter(p => {
    const matchBusqueda = !busqueda || p.nombre.toLowerCase().includes(busqueda.toLowerCase())
    const matchTipo = filtroTipo === 'Todos' || p.tipo === filtroTipo
    return matchBusqueda && matchTipo
  })

  if (loading) return <div style={{textAlign:'center',padding:'3rem'}}><p>Cargando...</p></div>

  return (
    <>
      <div className="page-header" style={{display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center'}}>
        <div>
          <h1><i className='bx bx-map'></i> Proyectos</h1>
          <p className="page-subtitle">Haciendas y fincas</p>
        </div>
        <button className="btn btn-primary" onClick={abrirNuevo}>
          <i className='bx bx-plus'></i> Nuevo
        </button>
      </div>

      {/* Filtros */}
      <div style={{display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap'}}>
        <div style={{flex: 1, position: 'relative', minWidth: '200px'}}>
          <i className='bx bx-search' style={{position:'absolute', left:'10px', top:'50%', transform:'translateY(-50%)', color:'var(--color-text-secondary)'}}></i>
          <input type="text" className="form-control" value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar proyecto..." style={{paddingLeft:'2rem'}} />
        </div>
        <div style={{display: 'flex', gap: '0.3rem'}}>
          {['Todos', 'Orgánico', 'Convencional'].map(t => (
            <button key={t} onClick={() => setFiltroTipo(t)}
              style={{
                padding: '0.4rem 0.8rem', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500,
                background: filtroTipo === t ? 'var(--color-primary)' : 'var(--color-bg-tertiary)',
                color: filtroTipo === t ? 'white' : 'var(--color-text-secondary)'
              }}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Tabla */}
      <div className="tabla-container">
        <table className="tabla">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Dirección</th>
              <th>Tipo</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map(p => (
              <tr key={p.id} className="clickeable" onClick={() => abrirEditar(p)}>
                <td><strong>{p.nombre}</strong></td>
                <td style={{fontSize: '0.8rem'}}>{p.direccion || '-'}</td>
                <td><span style={{
                  background: p.tipo === 'Orgánico' ? '#2e7d32' : '#1565c0',
                  color: 'white', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem'
                }}>{p.tipo || '-'}</span></td>
                <td><span style={{background: p.estado === 'Activo' ? '#28a745' : '#dc3545', color: 'white', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem'}}>{p.estado}</span></td>
              </tr>
            ))}
            {filtrados.length === 0 && (
              <tr><td colSpan="4" style={{textAlign:'center',padding:'2rem',color:'var(--color-text-secondary)'}}>No hay proyectos</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Drawer */}
      <div className={`drawer-overlay ${drawerOpen ? 'active' : ''}`} onClick={() => setDrawerOpen(false)}></div>
      <div className={`drawer ${drawerOpen ? 'open' : ''}`}>
        <div className="drawer-header">
          <div className="drawer-header-top">
            <h2><i className='bx bx-map'></i> {editando ? 'Editar Proyecto' : 'Nuevo Proyecto'}</h2>
            <button className="drawer-close" onClick={() => setDrawerOpen(false)}><i className='bx bx-x'></i></button>
          </div>
        </div>
        <div className="drawer-content">
          <div className="drawer-section">
            <div className="form-group">
              <label className="form-label">Nombre <span className="required">*</span></label>
              <input type="text" className="form-control" value={formData.nombre}
                onChange={e => setFormData({...formData, nombre: e.target.value.toUpperCase()})}
                placeholder="Nombre del proyecto" />
            </div>
            <div className="form-group">
              <label className="form-label">Dirección</label>
              <input type="text" className="form-control" value={formData.direccion}
                onChange={e => setFormData({...formData, direccion: e.target.value})}
                placeholder="Dirección del proyecto" />
            </div>
            <div className="form-group">
              <label className="form-label">Tipo</label>
              <select className="form-control" value={formData.tipo} onChange={e => setFormData({...formData, tipo: e.target.value})}>
                <option value="Orgánico">Orgánico</option>
                <option value="Convencional">Convencional</option>
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
            disabled={!formData.nombre.trim()}>
            <i className='bx bx-save'></i> Guardar
          </button>
        </div>
      </div>
    </>
  )
}

export default CatalogoProyectos
