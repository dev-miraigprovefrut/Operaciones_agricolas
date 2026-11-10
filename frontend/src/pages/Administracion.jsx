import { useState, useEffect, useRef } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8007'

// Estructura jerárquica tipo menú (igual que el Nav)
const MENU_PERMISOS = [
  {
    key: 'registrar',
    label: 'Registrar',
    icon: 'bx bxs-edit',
    hijos: [
      { key: 'registrar_actividades', label: 'Bitácora Tractor', icon: 'bx bx-task' },
      { key: 'bitacora_dron', label: 'Bitácora Dron', icon: 'bx bx-paper-plane' },
      { key: 'registrar_cosecha', label: 'Cosecha', icon: 'bx bx-leaf' },
    ]
  },
  {
    key: 'catalogos',
    label: 'Catálogos',
    icon: 'bx bxs-folder-open',
    hijos: [
      { key: 'catalogos_actividades', label: 'Actividades', icon: 'bx bx-task' },
      { key: 'catalogos_camiones', label: 'Camiones', icon: 'bx bxs-car' },
      { key: 'catalogos_tractoristas', label: 'Operadores', icon: 'bx bx-hard-hat' },
      { key: 'catalogos_supervisores', label: 'Supervisores', icon: 'bx bx-user-check' },
    ]
  },
  {
    key: 'reportes',
    label: 'Reportes',
    icon: 'bx bxs-bar-chart-alt-2',
    hijos: [
      { key: 'reportes_actividades', label: 'Actividades', icon: 'bx bx-calendar' },
      { key: 'reportes_cosecha', label: 'Cosecha', icon: 'bx bx-leaf' },
      { key: 'reportes_seguridad', label: 'R. Seguridad', icon: 'bx bx-shield-quarter' },
      { key: 'reportes_fichas_aplicacion', label: 'Fichas de aplicación', icon: 'bx bx-spray-can' },
      { key: 'revisar_actividades', label: 'Revisar horas', icon: 'bx bx-check-square' },
    ]
  },
]

function Administracion() {
  const [usuarios, setUsuarios] = useState([])
  const [permisosDisponibles, setPermisosDisponibles] = useState([])
  const [seleccionado, setSeleccionado] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [busquedaAgregar, setBusquedaAgregar] = useState('')
  const [resultadosBusqueda, setResultadosBusqueda] = useState([])
  const [loading, setLoading] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [mostrarAgregar, setMostrarAgregar] = useState(false)
  const [filtroAsignacion, setFiltroAsignacion] = useState('sin_asignar')
  const [permisosEditados, setPermisosEditados] = useState([])
  const [menusAbiertos, setMenusAbiertos] = useState(MENU_PERMISOS.map(g => g.key))
  const timerRef = useRef(null)

  // La sesion va en la cookie del HUB (services/sesion.js)
  const headers = { 'Content-Type': 'application/json' }

  const fetchUsuarios = async () => {
    try {
      setLoading(true)
      const res = await fetch(`${API_URL}/api/admin/usuarios`, { headers })
      if (!res.ok) throw new Error('Error al cargar usuarios')
      const data = await res.json()
      setUsuarios(data.usuarios || [])
      setPermisosDisponibles(data.permisos_disponibles || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchUsuarios() }, [])

  const buscarUsuarios = async (q) => {
    if (q.length < 2) { setResultadosBusqueda([]); return }
    try {
      const res = await fetch(`${API_URL}/api/admin/usuarios/buscar?q=${encodeURIComponent(q)}`, { headers })
      if (res.ok) {
        const data = await res.json()
        const existentes = new Set(usuarios.map(u => u.usuario))
        setResultadosBusqueda(data.filter(u => !existentes.has(u.usuario)))
      }
    } catch (err) {
      console.error(err)
    }
  }

  const handleBusquedaAgregar = (val) => {
    setBusquedaAgregar(val)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => buscarUsuarios(val), 300)
  }

  // El acceso al modulo se crea en el HUB al guardar su primera pestaña:
  // se abre directamente el panel de permisos del usuario elegido.
  const agregarUsuario = (u) => {
    setBusquedaAgregar('')
    setResultadosBusqueda([])
    setMostrarAgregar(false)
    abrirDrawer({ ...u, sub_permisos: [], es_admin: false })
  }


  const abrirDrawer = (usuario) => {
    setSeleccionado(usuario)
    setPermisosEditados([...(usuario.sub_permisos || [])])
    setMenusAbiertos(MENU_PERMISOS.map(g => g.key))
    setDrawerOpen(true)
  }

  const cerrarDrawer = () => {
    setDrawerOpen(false)
    setTimeout(() => { setSeleccionado(null) }, 300)
  }

  const togglePermiso = (permiso) => {
    setPermisosEditados(prev => {
      const idx = prev.indexOf(permiso)
      if (idx >= 0) return prev.filter(p => p !== permiso)
      return [...prev, permiso]
    })
  }

  // Toggle todos los hijos de un grupo
  const toggleGrupo = (grupo) => {
    const keys = grupo.hijos.map(h => h.key)
    const todosActivos = keys.every(k => permisosEditados.includes(k))
    setPermisosEditados(prev => {
      if (todosActivos) {
        return prev.filter(p => !keys.includes(p))
      } else {
        return [...new Set([...prev, ...keys])]
      }
    })
  }

  const guardarPermisos = async () => {
    if (!seleccionado) return
    setGuardando(true)
    try {
      const res = await fetch(`${API_URL}/api/admin/usuarios/${encodeURIComponent(seleccionado.usuario)}/permisos`, {
        method: 'PUT', headers,
        body: JSON.stringify({ sub_permisos: permisosEditados, empresa: 'Nintanga' })
      })
      if (res.ok) {
        await fetchUsuarios()
        cerrarDrawer()
      } else {
        const err = await res.json().catch(() => ({}))
        alert(err.detail || 'Error al guardar permisos')
      }
    } catch (err) {
      console.error('Error guardando permisos:', err)
      alert('Error de conexión al guardar permisos')
    } finally {
      setGuardando(false)
    }
  }

  const usuariosFiltrados = usuarios.filter(u => {
    const coincideBusqueda = !busqueda || u.nombre_completo?.toLowerCase().includes(busqueda.toLowerCase()) ||
      u.usuario?.toLowerCase().includes(busqueda.toLowerCase())
    if (!coincideBusqueda) return false
    if (filtroAsignacion === 'todos') return true
    const tienePermisos = u.es_admin || (u.sub_permisos && u.sub_permisos.length > 0)
    if (filtroAsignacion === 'asignados') return tienePermisos
    if (filtroAsignacion === 'sin_asignar') return !tienePermisos
    return true
  })


  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1><i className='bx bx-user-check'></i> Administración</h1>
          <p className="page-subtitle">Gestionar usuarios y permisos del módulo · <strong>{usuarios.length}</strong> usuario{usuarios.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => setMostrarAgregar(!mostrarAgregar)}>
            <i className={`bx ${mostrarAgregar ? 'bx-x' : 'bx-user-plus'}`}></i>
            <span>{mostrarAgregar ? 'Cancelar' : 'Agregar usuario'}</span>
          </button>
        </div>
      </div>

      {/* Agregar usuario */}
      {mostrarAgregar && (
        <div style={{ marginBottom: '1rem', position: 'relative' }}>
          <div className="search-input-wrapper" style={{ maxWidth: '400px' }}>
            <i className='bx bx-search'></i>
            <input
              type="text"
              className="form-control"
              placeholder="Buscar usuario por nombre o username..."
              value={busquedaAgregar}
              onChange={e => handleBusquedaAgregar(e.target.value)}
              autoFocus
            />
          </div>
          {resultadosBusqueda.length > 0 && (
            <div style={{
              position: 'absolute', zIndex: 20, background: 'var(--color-bg-white)', border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)', maxHeight: '220px', overflowY: 'auto', width: '400px',
              boxShadow: 'var(--shadow-lg)', marginTop: '0.25rem'
            }}>
              {resultadosBusqueda.map(u => (
                <div key={u.usuario} onClick={() => agregarUsuario(u)} style={{
                  padding: '0.6rem 1rem', cursor: 'pointer', borderBottom: '1px solid var(--color-border)',
                  display: 'flex', alignItems: 'center', gap: '0.75rem', transition: 'background 0.15s'
                }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-light)'}
                   onMouseLeave={e => e.currentTarget.style.background = 'var(--color-bg-white)'}>
                  <div style={{
                    width: '32px', height: '32px', borderRadius: '50%', background: 'var(--color-primary)',
                    color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 600, fontSize: '0.8rem', flexShrink: 0
                  }}>
                    {(u.nombre_completo || u.usuario).charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 500, fontSize: '0.85rem', color: 'var(--color-text-primary)' }}>{u.nombre_completo}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{u.usuario} · {u.departamento}</div>
                  </div>
                  <i className='bx bx-plus-circle' style={{ marginLeft: 'auto', color: 'var(--color-primary)', fontSize: '1.2rem' }}></i>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Filtro */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <div className="search-input-wrapper" style={{ flex: 1, minWidth: '180px' }}>
            <i className='bx bx-search'></i>
            <input
              type="text"
              className="form-control"
              placeholder="Filtrar usuarios..."
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
            />
          </div>
          <button
            type="button"
            onClick={fetchUsuarios}
            style={{ padding: '0.5rem 0.7rem', border: 'none', background: 'var(--color-primary)', color: 'white', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', fontWeight: 500 }}
          >
            <i className='bx bx-refresh'></i>
          </button>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
          {(() => {
            const countSinAsignar = usuarios.filter(u => !u.es_admin && (!u.sub_permisos || u.sub_permisos.length === 0)).length
            const countAsignados = usuarios.filter(u => u.es_admin || (u.sub_permisos && u.sub_permisos.length > 0)).length
            const countTodos = usuarios.length
            return [
              { key: 'sin_asignar', label: 'Sin asignar', count: countSinAsignar, color: '#ff9800' },
              { key: 'asignados', label: 'Asignados', count: countAsignados, color: '#4caf50' },
              { key: 'todos', label: 'Todos', count: countTodos, color: '#7b1fa2' },
            ].map(f => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFiltroAsignacion(f.key)}
                style={{
                  padding: '0.4rem 0.75rem',
                  border: filtroAsignacion === f.key ? `2px solid ${f.color}` : '2px solid var(--color-border)',
                  borderRadius: '20px',
                  fontSize: '0.78rem',
                  fontWeight: filtroAsignacion === f.key ? 600 : 400,
                  background: filtroAsignacion === f.key ? `${f.color}12` : 'var(--color-bg-white)',
                  color: filtroAsignacion === f.key ? f.color : 'var(--color-text-secondary)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  transition: 'all 0.15s',
                  whiteSpace: 'nowrap'
                }}
              >
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: f.color, flexShrink: 0 }}></span>
                {f.label} ({f.count})
              </button>
            ))
          })()}
        </div>
      </div>

      {/* Tabla */}
      {loading ? (
        <div className="tabla-loading">
          <i className='bx bx-loader-alt bx-spin'></i>
          <span>Cargando usuarios...</span>
        </div>
      ) : usuariosFiltrados.length === 0 ? (
        <div className="tabla-empty">
          <i className='bx bx-user-x'></i>
          <span>No hay usuarios asignados al módulo</span>
        </div>
      ) : (
        <div className="tabla-container">
          <table className="tabla">
            <thead>
              <tr>
                <th style={{ width: '50px' }}></th>
                <th>Nombre</th>
                <th>Departamento</th>
                <th>Rol</th>
                <th className="tabla-centro">Tipo</th>
                <th className="tabla-centro">Pestañas</th>
              </tr>
            </thead>
            <tbody>
              {usuariosFiltrados.map(u => (
                <tr key={u.usuario} className="clickeable" onClick={() => abrirDrawer(u)}>
                  <td>
                    <div style={{
                      width: '34px', height: '34px', borderRadius: '50%', background: u.es_admin ? 'var(--color-primary)' : 'var(--color-accent)',
                      color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 600, fontSize: '0.85rem'
                    }}>
                      {(u.nombre_completo || u.usuario).charAt(0).toUpperCase()}
                    </div>
                  </td>
                  <td>
                    <div>
                      <strong style={{ color: 'var(--color-text-primary)' }}>{u.nombre_completo || u.usuario}</strong>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'lowercase' }}>{u.usuario}</div>
                    </div>
                  </td>
                  <td>{u.departamento || '—'}</td>
                  <td>{u.rol || '—'}</td>
                  <td className="tabla-centro">
                    {u.es_admin ? (
                      <span className="badge badge-aprobado" style={{ fontSize: '0.7rem' }}>Admin</span>
                    ) : (
                      <span className="badge badge-pendiente" style={{ fontSize: '0.7rem' }}>Usuario</span>
                    )}
                  </td>
                  <td className="tabla-centro" style={{ textTransform: 'none' }}>
                    {u.es_admin ? (
                      <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Todas</span>
                    ) : (
                      <span style={{ fontSize: '0.8rem' }}>{(u.sub_permisos || []).length} de {permisosDisponibles.length}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Overlay del drawer */}
      <div className={`drawer-overlay ${drawerOpen ? 'active' : ''}`} onClick={cerrarDrawer}></div>

      {/* Drawer de permisos - estilo menú lateral */}
      <div className={`drawer ${drawerOpen ? 'open' : ''}`}>
        {seleccionado && (
          <>
            <div className="drawer-header">
              <div className="drawer-header-top">
                <h2><i className='bx bx-shield-quarter'></i> Permisos</h2>
                <button className="drawer-close" onClick={cerrarDrawer}>
                  <i className='bx bx-x'></i>
                </button>
              </div>
              <div className="drawer-summary">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div style={{
                    width: '40px', height: '40px', borderRadius: '50%',
                    background: seleccionado.es_admin ? 'var(--color-primary)' : 'var(--color-accent)',
                    color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: '1rem', flexShrink: 0
                  }}>
                    {(seleccionado.nombre_completo || seleccionado.usuario).charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', fontSize: '0.95rem' }}>{seleccionado.nombre_completo}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>{seleccionado.usuario} · {seleccionado.departamento || ''}</div>
                  </div>
                </div>
                {seleccionado.es_admin && <span className="badge badge-aprobado">Admin</span>}
              </div>
            </div>

            <div className="drawer-content">
              {seleccionado.es_admin && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.65rem 0.85rem',
                  background: '#e8f5e9', borderRadius: 'var(--radius-md)', marginBottom: '1rem',
                  fontSize: '0.82rem', color: '#2e7d32'
                }}>
                  <i className='bx bx-info-circle'></i>
                  Administrador — acceso completo a todas las pestañas.
                </div>
              )}

              {/* Menú estilo Nav con submenús */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {MENU_PERMISOS.map(grupo => {
                  const hijosKeys = grupo.hijos.map(h => h.key)
                  const activos = hijosKeys.filter(k => seleccionado.es_admin || permisosEditados.includes(k)).length
                  const todosActivos = activos === hijosKeys.length
                  const algunoActivo = activos > 0
                  const abierto = menusAbiertos.includes(grupo.key)

                  return (
                    <div key={grupo.key}>
                      {/* Item principal - como nav-button */}
                      <div
                        onClick={() => setMenusAbiertos(prev => abierto ? prev.filter(k => k !== grupo.key) : [...prev, grupo.key])}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '0.7rem',
                          padding: '0.7rem 0.85rem', cursor: 'pointer',
                          borderRadius: 'var(--radius-md)',
                          background: abierto ? 'var(--color-bg-light)' : 'transparent',
                          transition: 'background 0.15s',
                          userSelect: 'none'
                        }}
                        onMouseEnter={e => { if (!abierto) e.currentTarget.style.background = 'var(--color-bg-light)' }}
                        onMouseLeave={e => { if (!abierto) e.currentTarget.style.background = 'transparent' }}
                      >
                        {/* Checkbox del grupo */}
                        {!seleccionado.es_admin && (
                          <div
                            onClick={e => { e.stopPropagation(); toggleGrupo(grupo) }}
                            style={{
                              width: '20px', height: '20px', borderRadius: '3px',
                              border: `2px solid ${todosActivos ? 'var(--color-primary)' : algunoActivo ? 'var(--color-primary)' : 'var(--color-border)'}`,
                              background: todosActivos ? 'var(--color-primary)' : 'var(--color-bg-white)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              flexShrink: 0, cursor: 'pointer', transition: 'all 0.15s'
                            }}
                          >
                            {todosActivos && <i className='bx bx-check' style={{ color: 'white', fontSize: '0.85rem' }}></i>}
                            {algunoActivo && !todosActivos && <div style={{ width: '10px', height: '2px', background: 'var(--color-primary)', borderRadius: '1px' }}></div>}
                          </div>
                        )}
                        <i className={grupo.icon} style={{ fontSize: '1.15rem', color: 'var(--color-primary)' }}></i>
                        <span style={{ flex: 1, fontWeight: 500, fontSize: '0.9rem', color: 'var(--color-text-primary)' }}>{grupo.label}</span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginRight: '0.3rem' }}>
                          {activos}/{hijosKeys.length}
                        </span>
                        <i className={`bx bx-chevron-down`} style={{
                          fontSize: '1.1rem', color: 'var(--color-text-muted)',
                          transition: 'transform 0.2s',
                          transform: abierto ? 'rotate(180deg)' : 'rotate(0deg)'
                        }}></i>
                      </div>

                      {/* Submenú expandible */}
                      <div style={{
                        maxHeight: abierto ? `${grupo.hijos.length * 44}px` : '0',
                        overflow: 'hidden',
                        transition: 'max-height 0.25s ease',
                        marginLeft: seleccionado.es_admin ? '1.2rem' : '2rem',
                        borderLeft: abierto ? '2px solid var(--color-border)' : '2px solid transparent'
                      }}>
                        {grupo.hijos.map(hijo => {
                          const checked = seleccionado.es_admin || permisosEditados.includes(hijo.key)
                          return (
                            <label
                              key={hijo.key}
                              style={{
                                display: 'flex', alignItems: 'center', gap: '0.6rem',
                                padding: '0.5rem 0.75rem',
                                cursor: seleccionado.es_admin ? 'default' : 'pointer',
                                borderRadius: 'var(--radius-sm)',
                                transition: 'background 0.15s',
                                opacity: seleccionado.es_admin ? 0.65 : 1
                              }}
                              onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,0,0,0.02)'}
                              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => togglePermiso(hijo.key)}
                                disabled={seleccionado.es_admin}
                                style={{ display: 'none' }}
                              />
                              <div style={{
                                width: '18px', height: '18px', borderRadius: '3px',
                                border: `2px solid ${checked ? 'var(--color-primary)' : 'var(--color-border)'}`,
                                background: checked ? 'var(--color-primary)' : 'var(--color-bg-white)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                flexShrink: 0, transition: 'all 0.15s'
                              }}>
                                {checked && <i className='bx bx-check' style={{ color: 'white', fontSize: '0.8rem' }}></i>}
                              </div>
                              <i className={hijo.icon} style={{ fontSize: '1rem', color: 'var(--color-text-secondary)' }}></i>
                              <span style={{ fontSize: '0.85rem', color: 'var(--color-text-primary)' }}>{hijo.label}</span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {!seleccionado.es_admin && (
              <div className="drawer-footer">
                <button className="btn btn-secondary" onClick={cerrarDrawer}>Cancelar</button>
                <button className="btn btn-primary" onClick={guardarPermisos} disabled={guardando}>
                  <i className={`bx ${guardando ? 'bx-loader-alt bx-spin' : 'bx-save'}`}></i>
                  <span>{guardando ? 'Guardando...' : 'Guardar'}</span>
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default Administracion
