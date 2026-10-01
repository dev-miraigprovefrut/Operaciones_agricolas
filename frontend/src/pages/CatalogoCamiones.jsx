import { useState, useEffect } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8007'

function CatalogoCamiones() {
  const [camiones, setCamiones] = useState([])
  const [loading, setLoading] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editando, setEditando] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [filtroEmpresa, setFiltroEmpresa] = useState('Todos')
  const [formData, setFormData] = useState({ nombre: '', cedula: '', placa: '', correo: '', empresa: 'PROVEFRUT', estado: 'Activo' })

  useEffect(() => { fetchData() }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      const res = await fetch(`${API_URL}/api/camiones`)
      if (res.ok) setCamiones(await res.json())
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const abrirNuevo = () => {
    setEditando(null)
    setFormData({ nombre: '', cedula: '', placa: '', correo: '', empresa: 'PROVEFRUT', estado: 'Activo' })
    setDrawerOpen(true)
  }

  const abrirEditar = (c) => {
    setEditando(c)
    setFormData({ nombre: c.nombre || '', cedula: c.cedula || '', placa: c.placa || '', correo: c.correo || '', empresa: c.empresa || 'PROVEFRUT', estado: c.estado || 'Activo' })
    setDrawerOpen(true)
  }

  const handleGuardar = async () => {
    if (!formData.nombre.trim() || !formData.cedula.trim()) return
    try {
      if (editando) {
        await fetch(`${API_URL}/api/camiones/${editando.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData)
        })
      } else {
        await fetch(`${API_URL}/api/camiones`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData)
        })
      }
      await fetchData()
      setDrawerOpen(false)
    } catch (err) { console.error(err) }
  }

  const filtrados = camiones.filter(c => {
    const matchBusqueda = !busqueda ||
      (c.nombre || '').toLowerCase().includes(busqueda.toLowerCase()) ||
      (c.placa || '').toLowerCase().includes(busqueda.toLowerCase()) ||
      (c.cedula || '').toLowerCase().includes(busqueda.toLowerCase())
    const matchEmpresa = filtroEmpresa === 'Todos' || c.empresa === filtroEmpresa
    return matchBusqueda && matchEmpresa
  })

  const empresas = ['Todos', ...new Set(camiones.map(c => c.empresa).filter(Boolean))]

  if (loading) return <div style={{textAlign:'center',padding:'3rem'}}><p>Cargando...</p></div>

  return (
    <>
      <div className="page-header" style={{display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center'}}>
        <div>
          <h1><i className='bx bxs-truck'></i> Transportistas</h1>
          <p className="page-subtitle">Camiones de cosecha</p>
        </div>
        <button className="btn btn-primary" onClick={abrirNuevo}>
          <i className='bx bx-plus'></i> Nuevo
        </button>
      </div>

      {/* Filtros */}
      <div style={{display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap'}}>
        <div style={{flex: 1, position: 'relative', minWidth: '200px'}}>
          <i className='bx bx-search' style={{position:'absolute', left:'10px', top:'50%', transform:'translateY(-50%)', color:'var(--color-text-secondary)'}}></i>
          <input type="text" className="form-control" value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar por nombre, placa o cedula..." style={{paddingLeft:'2rem'}} />
        </div>
        <div style={{display: 'flex', gap: '0.3rem'}}>
          {empresas.map(emp => (
            <button key={emp} onClick={() => setFiltroEmpresa(emp)}
              style={{
                padding: '0.4rem 0.8rem', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500,
                background: filtroEmpresa === emp ? 'var(--color-primary)' : 'var(--color-bg-tertiary)',
                color: filtroEmpresa === emp ? 'white' : 'var(--color-text-secondary)'
              }}>
              {emp}
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
              <th>Cedula</th>
              <th>Placa</th>
              <th>Correo</th>
              <th>Empresa</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map(c => (
              <tr key={c.id} className="clickeable" onClick={() => abrirEditar(c)}>
                <td><strong>{c.nombre}</strong></td>
                <td>{c.cedula || '-'}</td>
                <td>{c.placa || '-'}</td>
                <td style={{textTransform: 'lowercase', fontSize: '0.8rem'}}>{c.correo || '-'}</td>
                <td><span style={{
                  background: c.empresa === 'PROVEFRUT' ? '#1976d2' : c.empresa === 'PROCONGELADOS' ? '#e65100' : '#666',
                  color: 'white', padding: '2px 8px', borderRadius: '4px', fontSize: '0.7rem'
                }}>{c.empresa || '-'}</span></td>
                <td><span style={{background: c.estado === 'Activo' ? '#28a745' : '#dc3545', color: 'white', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem'}}>{c.estado}</span></td>
              </tr>
            ))}
            {filtrados.length === 0 && (
              <tr><td colSpan="6" style={{textAlign:'center',padding:'2rem',color:'var(--color-text-secondary)'}}>No hay transportistas</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Drawer */}
      <div className={`drawer-overlay ${drawerOpen ? 'active' : ''}`} onClick={() => setDrawerOpen(false)}></div>
      <div className={`drawer ${drawerOpen ? 'open' : ''}`}>
        <div className="drawer-header">
          <div className="drawer-header-top">
            <h2><i className='bx bxs-truck'></i> {editando ? 'Transportista' : 'Nuevo Transportista'}</h2>
            <button className="drawer-close" onClick={() => setDrawerOpen(false)}><i className='bx bx-x'></i></button>
          </div>
        </div>
        <div className="drawer-content">
          <div className="drawer-section">
            <div className="form-group">
              <label className="form-label">Nombre completo <span className="required">*</span></label>
              <input type="text" className="form-control" value={formData.nombre}
                onChange={e => setFormData({...formData, nombre: e.target.value.toUpperCase()})}
                placeholder="Nombre del transportista" />
            </div>
            <div className="form-group">
              <label className="form-label">Cedula <span className="required">*</span></label>
              <input type="text" className="form-control" value={formData.cedula}
                onChange={e => setFormData({...formData, cedula: e.target.value})}
                placeholder="000000000-0" />
            </div>
            <div className="form-group">
              <label className="form-label">Placa</label>
              <input type="text" className="form-control" value={formData.placa}
                onChange={e => setFormData({...formData, placa: e.target.value.toUpperCase()})}
                placeholder="AAA-0000" />
            </div>
            <div className="form-group">
              <label className="form-label">Correo</label>
              <input type="text" className="form-control" value={formData.correo}
                onChange={e => setFormData({...formData, correo: e.target.value.toLowerCase()})}
                placeholder="correo@ejemplo.com" style={{textTransform: 'lowercase'}} />
            </div>
            <div className="form-group">
              <label className="form-label">Empresa</label>
              <select className="form-control" value={formData.empresa} onChange={e => setFormData({...formData, empresa: e.target.value})}>
                <option value="PROVEFRUT">PROVEFRUT</option>
                <option value="PROCONGELADOS">PROCONGELADOS</option>
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

export default CatalogoCamiones
