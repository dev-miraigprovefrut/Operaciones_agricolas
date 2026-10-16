import { useState, useEffect } from 'react'
import Swal from 'sweetalert2'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8007'

function CatalogoTractoristas() {
  const [tractoristas, setTractoristas] = useState([])
  const [loading, setLoading] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editando, setEditando] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [formData, setFormData] = useState({ codigo: '', nombre: '', apellido: '', cargo: 'Tractorista', estado: 'Activo', username: '' })

  useEffect(() => { fetchData() }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      const res = await fetch(`${API_URL}/api/tractoristas`)
      if (res.ok) {
        const data = await res.json()
        // Filtrar solo tractoristas en el frontend también
        setTractoristas(data.filter(t => (t.cargo || '').toUpperCase().trim() === 'TRACTORISTA'))
      }
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const abrirNuevo = () => {
    setEditando(null)
    setFormData({ codigo: '', nombre: '', apellido: '', cargo: 'Tractorista', estado: 'Activo', username: '' })
    setDrawerOpen(true)
  }

  // Separar: los 2 primeros son apellidos, los 2 últimos son nombres
  // Si hay 3 palabras: 1 apellido + 2 nombres
  // Si hay 2: 1 apellido + 1 nombre
  // Si hay 1: solo nombre
  const separarNombreApellido = (completo) => {
    const partes = (completo || '').trim().split(/\s+/)
    if (partes.length >= 4) {
      return { apellido: partes.slice(0, 2).join(' '), nombre: partes.slice(2).join(' ') }
    } else if (partes.length === 3) {
      return { apellido: partes[0], nombre: partes.slice(1).join(' ') }
    } else if (partes.length === 2) {
      return { apellido: partes[0], nombre: partes[1] }
    }
    return { apellido: '', nombre: partes[0] || '' }
  }

  const generarUsername = (nombre, apellido) => {
    const n = (nombre || '').trim().split(/\s+/)[0].toLowerCase()
    const a = (apellido || '').trim().split(/\s+/)[0].toLowerCase()
    if (n && a) return `${n}.${a}`
    return n || a || ''
  }

  const abrirEditar = (t) => {
    setEditando(t)
    const { nombre, apellido } = separarNombreApellido(t.nombre)
    const usr = t.username ? t.username.toLowerCase() : generarUsername(nombre, apellido)
    setFormData({ codigo: t.codigo || '', nombre, apellido, cargo: t.cargo || '', estado: t.estado || 'Activo', username: usr })
    setDrawerOpen(true)
  }

  const handleGuardar = async () => {
    if (!formData.nombre.trim()) return
    try {
      const url = editando ? `${API_URL}/api/tractoristas/${editando.id}` : `${API_URL}/api/tractoristas`
      const method = editando ? 'PUT' : 'POST'
      const nombreCompleto = `${formData.apellido.trim()} ${formData.nombre.trim()}`.trim()
      const payload = { codigo: formData.codigo, nombre: nombreCompleto, cargo: formData.cargo, estado: formData.estado, username: formData.username.toLowerCase() }
      await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      await fetchData()
      setDrawerOpen(false)
    } catch (err) { console.error(err) }
  }

  const handleEliminar = async (id) => {
    const result = await Swal.fire({
      title: '¿Eliminar tractorista?',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc3545',
      cancelButtonColor: '#6c757d',
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar'
    })
    if (!result.isConfirmed) return
    try {
      await fetch(`${API_URL}/api/tractoristas/${id}`, { method: 'DELETE' })
      await fetchData()
    } catch (err) { console.error(err) }
  }

  const fechaCorta = f => f ? new Date(f.replace(' ', 'T')).toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-'

  // Telefono perdido o cambio de celular: deja de funcionar al instante
  const handleBajaTelefono = async (t) => {
    const r = await Swal.fire({
      title: 'Dar de baja el teléfono',
      html: `<b>${t.dispositivo.descripcion}</b> de ${t.nombre}<br><br>Dejará de funcionar de inmediato y se borrarán sus datos en ese teléfono al tener señal. Lo que no se haya enviado desde ese teléfono se pierde. El tractorista podrá registrar otro teléfono al ingresar.`,
      icon: 'warning', showCancelButton: true, confirmButtonColor: '#dc3545', cancelButtonColor: '#6c757d',
      confirmButtonText: 'Dar de baja', cancelButtonText: 'Cancelar'
    })
    if (!r.isConfirmed) return
    const res = await fetch(`${API_URL}/api/tractoristas/${t.id}/dispositivo/baja`, { method: 'POST' })
    if (!res.ok) return Swal.fire('No se pudo dar de baja', (await res.json().catch(() => ({}))).detail || '', 'error')
    await fetchData()
    Swal.fire({ title: 'Teléfono dado de baja', icon: 'success', timer: 1800, showConfirmButton: false })
  }

  // Olvido su codigo: codigo temporal de 6 digitos (se muestra una sola vez)
  const handleCodigoTemporal = async (t) => {
    const r = await Swal.fire({
      title: 'Código temporal',
      html: `Para que <b>${t.nombre}</b> cree un código nuevo porque olvidó el suyo.<br><br>Su código actual dejará de funcionar.`,
      icon: 'question', showCancelButton: true, confirmButtonColor: '#7b1fa2', cancelButtonColor: '#6c757d',
      confirmButtonText: 'Generar', cancelButtonText: 'Cancelar'
    })
    if (!r.isConfirmed) return
    const res = await fetch(`${API_URL}/api/tractoristas/${t.id}/codigo-temporal`, { method: 'POST' })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) return Swal.fire('No se pudo generar', d.detail || '', 'error')
    await fetchData()
    Swal.fire({
      title: d.codigo.replace(/(\d{3})(\d{3})/, '$1 $2'),
      html: `Entréguelo en persona a <b>${t.nombre}</b>.<br>Vence el ${new Date(d.vence.replace(' ', 'T')).toLocaleString('es-EC')}.<br><small>No se volverá a mostrar.</small>`,
      icon: 'info', confirmButtonColor: '#7b1fa2', confirmButtonText: 'Listo'
    })
  }

  const filtrados = tractoristas.filter(t =>
    !busqueda || (t.nombre || '').toLowerCase().includes(busqueda.toLowerCase()) || (t.codigo || '').toLowerCase().includes(busqueda.toLowerCase())
  )

  if (loading) return <div style={{textAlign:'center',padding:'3rem'}}><p>Cargando...</p></div>

  return (
    <>
      <div className="page-header" style={{display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center'}}>
        <div>
          <h1><i className='bx bx-user'></i> Tractoristas</h1>
          <p className="page-subtitle">Catálogo de operadores</p>
        </div>
        <button className="btn btn-primary" onClick={abrirNuevo}>
          <i className='bx bx-plus'></i> Nuevo
        </button>
      </div>

      {/* Buscador */}
      <div style={{marginBottom: '1rem', position: 'relative'}}>
        <i className='bx bx-search' style={{position:'absolute', left:'10px', top:'50%', transform:'translateY(-50%)', color:'var(--color-text-secondary)'}}></i>
        <input type="text" className="form-control" value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar por nombre o código..." style={{paddingLeft:'2rem'}} />
      </div>

      {/* Tabla */}
      <div className="tabla-container">
        <table className="tabla">
          <thead>
            <tr>
              <th>Código</th>
              <th>Nombre</th>
              <th>Usuario</th>
              <th>Cargo</th>
              <th>Estado</th>
              <th>Teléfono</th>
              <th style={{width: '1%'}}></th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map(t => (
              <tr key={t.id} className="clickeable" onClick={() => abrirEditar(t)}>
                <td>{t.codigo || '-'}</td>
                <td><strong>{t.nombre}</strong></td>
                <td style={{textTransform: 'lowercase'}}>{t.username || '-'}</td>
                <td>{t.cargo || '-'}</td>
                <td><span style={{background: t.estado === 'Activo' ? '#28a745' : '#dc3545', color: 'white', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem'}}>{t.estado}</span></td>
                <td onClick={e => e.stopPropagation()} style={{cursor: 'default'}}>
                  {t.dispositivo ? (
                    <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap'}}>
                      <div>
                        <div style={{fontSize: '0.8rem'}}><i className='bx bx-mobile-alt'></i> {t.dispositivo.descripcion}</div>
                        <div style={{fontSize: '0.7rem', color: 'var(--color-text-secondary)'}}>
                          Desde {fechaCorta(t.dispositivo.fecha_alta)} · último uso {fechaCorta(t.dispositivo.ultimo_uso)}
                        </div>
                      </div>
                      <button className="btn btn-sm" onClick={() => handleBajaTelefono(t)}
                        style={{background: '#dc3545', color: 'white', padding: '2px 8px', fontSize: '0.72rem'}}>
                        <i className='bx bx-block'></i> Dar de baja
                      </button>
                    </div>
                  ) : <span style={{fontSize: '0.75rem', color: 'var(--color-text-secondary)'}}>Sin teléfono registrado</span>}
                  {t.codigo_temporal_vence && (
                    <div style={{fontSize: '0.7rem', color: '#e67e22', marginTop: '2px'}}>
                      <i className='bx bx-key'></i> Código temporal pendiente (vence {fechaCorta(t.codigo_temporal_vence)})
                    </div>
                  )}
                </td>
                <td onClick={e => e.stopPropagation()} style={{cursor: 'default', whiteSpace: 'nowrap'}}>
                  <button className="btn btn-sm" title="Olvidó su código: generar código temporal" onClick={() => handleCodigoTemporal(t)}
                    style={{background: 'var(--color-bg-light)', color: 'var(--color-text)', padding: '2px 8px', fontSize: '0.72rem'}}>
                    <i className='bx bx-key'></i> Código temporal
                  </button>
                </td>
              </tr>
            ))}
            {filtrados.length === 0 && (
              <tr><td colSpan="7" style={{textAlign:'center',padding:'2rem',color:'var(--color-text-secondary)'}}>No hay tractoristas</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Drawer */}
      <div className={`drawer-overlay ${drawerOpen ? 'active' : ''}`} onClick={() => setDrawerOpen(false)}></div>
      <div className={`drawer ${drawerOpen ? 'open' : ''}`}>
        <div className="drawer-header">
          <div className="drawer-header-top">
            <h2><i className='bx bx-user'></i> {editando ? 'Editar' : 'Nuevo'} Tractorista</h2>
            <button className="drawer-close" onClick={() => setDrawerOpen(false)}><i className='bx bx-x'></i></button>
          </div>
        </div>
        <div className="drawer-content">
          <div className="drawer-section">
            <div className="form-group">
              <label className="form-label">Código</label>
              <input type="text" className="form-control" value={formData.codigo} onChange={e => setFormData({...formData, codigo: e.target.value.toLowerCase()})} placeholder="Código del tractorista" />
            </div>
            <div className="form-group">
              <label className="form-label">Nombres <span className="required">*</span></label>
              <input type="text" className="form-control" value={formData.nombre} onChange={e => { const v = e.target.value.toUpperCase(); setFormData(f => ({...f, nombre: v, username: generarUsername(v, f.apellido)})) }} placeholder="Nombre" />
            </div>
            <div className="form-group">
              <label className="form-label">Apellidos <span className="required">*</span></label>
              <input type="text" className="form-control" value={formData.apellido} onChange={e => { const v = e.target.value.toUpperCase(); setFormData(f => ({...f, apellido: v, username: generarUsername(f.nombre, v)})) }} placeholder="Apellido" />
            </div>
            <div className="form-group">
              <label className="form-label">Usuario</label>
              <input type="text" className="form-control" value={formData.username} onChange={e => setFormData({...formData, username: e.target.value.toLowerCase()})} placeholder="Usuario del tractorista" style={{textTransform: 'lowercase'}} />
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
            <button onClick={() => { setDrawerOpen(false); handleEliminar(editando.id) }} style={{background:'transparent', border:'1px solid #dc3545', color:'#dc3545', borderRadius:'6px', padding:'0.4rem 0.8rem', cursor:'pointer', fontSize:'0.8rem', display:'flex', alignItems:'center', gap:'0.3rem'}}>
              <i className='bx bx-trash'></i> Eliminar
            </button>
          )}
          <div style={{flex:1}}></div>
          <button className="btn btn-primary" onClick={handleGuardar} disabled={!formData.nombre.trim() || !formData.apellido.trim()}>
            <i className='bx bx-save'></i> Guardar
          </button>
        </div>
      </div>
    </>
  )
}

export default CatalogoTractoristas
