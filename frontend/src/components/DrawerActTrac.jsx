import { useState, useEffect } from 'react'

function DrawerActTrac({ open, onClose, mode, actividad, onSave, onDelete }) {
  const [formData, setFormData] = useState({
    nombre: '',
    tipo: 'Actividades Culturales'
  })

  const [subactividades, setSubactividades] = useState([])
  const [nuevaSubactividad, setNuevaSubactividad] = useState('')
  const [editandoId, setEditandoId] = useState(null)
  const [editandoNombre, setEditandoNombre] = useState('')

  useEffect(() => {
    if (mode === 'editar-actividad' && actividad) {
      setFormData({
        nombre: actividad.nombre,
        tipo: actividad.tipo
      })
      setSubactividades(actividad.subactividades || [])
    } else if (mode === 'crear-actividad') {
      setFormData({ nombre: '', tipo: 'Actividades Culturales' })
      setSubactividades([])
    }
    setNuevaSubactividad('')
    setEditandoId(null)
  }, [mode, actividad, open])

  // Cerrar con ESC
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && open) {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const agregarSubactividad = () => {
    if (nuevaSubactividad.trim()) {
      const nueva = {
        id: Date.now(),
        codigo: `SUB-${String(Date.now()).slice(-3)}`,
        nombre: nuevaSubactividad.trim().toUpperCase()
      }
      setSubactividades([...subactividades, nueva])
      setNuevaSubactividad('')
    }
  }

  const eliminarSubactividad = (id) => {
    setSubactividades(subactividades.filter(sub => sub.id !== id))
  }

  const iniciarEdicion = (sub) => {
    setEditandoId(sub.id)
    setEditandoNombre(sub.nombre)
  }

  const guardarEdicion = (id) => {
    if (editandoNombre.trim()) {
      setSubactividades(subactividades.map(sub => 
        sub.id === id ? { ...sub, nombre: editandoNombre.trim().toUpperCase() } : sub
      ))
    }
    setEditandoId(null)
    setEditandoNombre('')
  }

  const cancelarEdicion = () => {
    setEditandoId(null)
    setEditandoNombre('')
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (mode === 'editar-actividad') {
      onSave({ ...actividad, ...formData, subactividades })
    } else {
      onSave({ ...formData, subactividades })
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      agregarSubactividad()
    }
  }

  const handleKeyPressEdicion = (e, id) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      guardarEdicion(id)
    } else if (e.key === 'Escape') {
      cancelarEdicion()
    }
  }

  return (
    <>
      {/* Drawer Overlay */}
      <div 
        className={`drawer-overlay ${open ? 'active' : ''}`}
        onClick={onClose}
      ></div>

      {/* Drawer */}
      <div className={`drawer ${open ? 'open' : ''}`}>
        <div className="drawer-header">
          <div className="drawer-header-top">
            <h2>
              <i className={`bx ${mode === 'crear-actividad' ? 'bx-plus-circle' : 'bx-edit'}`}></i> 
              {mode === 'crear-actividad' ? ' Nueva Actividad' : ' Editar Actividad'}
            </h2>
            <button className="drawer-close" onClick={onClose}>
              <i className='bx bx-x'></i>
            </button>
          </div>
        </div>

        <div className="drawer-content">
          <form onSubmit={handleSubmit}>
            <div className="drawer-section">
              <h3><i className='bx bx-info-circle'></i> Información de la Actividad</h3>
              
              <div className="form-group">
                <label className="form-label">Nombre <span className="required">*</span></label>
                <input 
                  type="text" 
                  className="form-control" 
                  name="nombre"
                  value={formData.nombre}
                  onChange={handleInputChange}
                  placeholder="Nombre de la actividad"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Tipo <span className="required">*</span></label>
                <select 
                  className="form-control"
                  name="tipo"
                  value={formData.tipo}
                  onChange={handleInputChange}
                  required
                >
                  <option value="Actividades Culturales">Actividades Culturales</option>
                  <option value="Apoyos Generales">Apoyos Generales</option>
                </select>
              </div>

              {/* Subactividades */}
              <div className="form-group">
                <label className="form-label">Subactividades</label>
                
                {/* Lista de subactividades */}
                <div style={{
                  background: 'var(--color-bg-light)', 
                  padding: '1rem', 
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                  marginBottom: '0.75rem'
                }}>
                  {subactividades.length > 0 ? (
                    <div style={{display: 'flex', flexDirection: 'column', gap: '0.5rem'}}>
                      {subactividades.map(sub => (
                        <div 
                          key={sub.id} 
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem'
                          }}
                        >
                          <input
                            type="text"
                            value={sub.nombre}
                            onChange={(e) => {
                              setSubactividades(subactividades.map(s => 
                                s.id === sub.id ? { ...s, nombre: e.target.value.toUpperCase() } : s
                              ))
                            }}
                            className="form-control"
                            style={{flex: 1}}
                          />
                          <button
                            type="button"
                            onClick={() => eliminarSubactividad(sub.id)}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: '#666',
                              cursor: 'pointer',
                              padding: '0.5rem',
                              fontSize: '1.1rem'
                            }}
                            title="Eliminar"
                          >
                            <i className='bx bx-trash'></i>
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span style={{color: 'var(--color-text-secondary)', fontStyle: 'italic'}}>
                      Sin subactividades
                    </span>
                  )}
                </div>

                {/* Agregar nueva subactividad */}
                <div style={{display: 'flex', gap: '0.5rem'}}>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Nueva subactividad..."
                    value={nuevaSubactividad}
                    onChange={(e) => setNuevaSubactividad(e.target.value)}
                    onKeyDown={handleKeyPress}
                    style={{flex: 1}}
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={agregarSubactividad}
                    disabled={!nuevaSubactividad.trim()}
                  >
                    <i className='bx bx-plus'></i> Agregar
                  </button>
                </div>
              </div>
            </div>
          </form>
        </div>

        <div className="drawer-footer">
          {mode === 'editar-actividad' && (
            <button 
              className="btn btn-danger btn-responsive" 
              onClick={() => {
                if (confirm('¿Está seguro de eliminar esta actividad y todas sus subactividades?')) {
                  onDelete(actividad.id)
                }
              }}
              style={{marginRight: 'auto'}}
            >
              <i className='bx bx-trash'></i>
              <span className="btn-text">Eliminar</span>
            </button>
          )}
          <button className="btn btn-secondary btn-responsive" onClick={onClose}>
            <i className='bx bx-x'></i>
            <span className="btn-text">Cancelar</span>
          </button>
          <button className="btn btn-primary btn-responsive" onClick={handleSubmit}>
            <i className='bx bx-save'></i>
            <span className="btn-text">Guardar</span>
          </button>
        </div>

        <style>{`
          @media (max-width: 768px) {
            .btn-responsive .btn-text {
              display: none;
            }
            .btn-responsive {
              padding: 0.75rem !important;
            }
          }
        `}</style>
      </div>
    </>
  )
}

export default DrawerActTrac
