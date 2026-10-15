import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router'

function Nav({ isOpen, onClose }) {
  const [openSubmenu, setOpenSubmenu] = useState(null)
  const location = useLocation()

  // Sincronizar con prop isOpen
  useEffect(() => {
    if (!isOpen) {
      setOpenSubmenu(null)
    }
  }, [isOpen])

  // Cerrar con ESC
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const toggleSubmenu = (menu) => {
    setOpenSubmenu(openSubmenu === menu ? null : menu)
  }

  const closeMenus = () => {
    onClose()
    setOpenSubmenu(null)
  }

  const isActive = (path) => location.pathname === path
  const isActiveGroup = (paths) => paths.some(p => location.pathname.startsWith(p))

  // Obtener permisos del usuario
  const permisos = (() => { try { return JSON.parse(localStorage.getItem('user_permisos_operagricola') || '{}') } catch { return {} } })()
  const esAdmin = permisos.es_admin
  const pestanas = permisos.pestanas || []
  const tienePermiso = (key) => esAdmin || pestanas.includes(key)

  return (
    <nav className="app-nav">
      <div className="nav-container">
        <div
          className={`mobile-overlay ${isOpen ? 'active' : ''}`}
          onClick={onClose}
        ></div>

        <ul className={`nav-items ${isOpen ? 'mobile-open' : ''}`}>
          <li className="sidebar-header">
            <button className="sidebar-close-btn" onClick={onClose}>
              <i className='bx bx-x'></i>
            </button>
            <div className="sidebar-header-content">
              <h2 className="sidebar-header-title">Operaciones Agrícolas</h2>
            </div>
          </li>

          <li className="sidebar-user-section">
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{localStorage.getItem('usuario_nombre') || 'Usuario'}</div>
              <div className="sidebar-user-email">{localStorage.getItem('usuario_correo') || ''}</div>
              <div className="sidebar-user-role">{localStorage.getItem('usuario_rol') || ''}</div>
            </div>
            <button className="sidebar-btn-salir" title="Cerrar sesión">
              <i className='bx bx-log-out'></i>
            </button>
          </li>

          {/* Dashboard - solo si es admin o tiene más de un grupo de permisos */}
          {(esAdmin || (tienePermiso('registrar_actividades') || tienePermiso('registrar_cosecha')) && (tienePermiso('reportes_actividades') || tienePermiso('reportes_cosecha') || tienePermiso('reportes_seguridad'))) && (
            <li className="nav-item">
              <Link
                to="/dashboard"
                className={`nav-button nav-button-home ${isActive('/dashboard') ? 'active' : ''}`}
                onClick={closeMenus}
              >
                <i className='bx bxs-dashboard'></i>
                <span>Dashboard</span>
              </Link>
            </li>
          )}

          {/* Registrar - solo si tiene algún permiso de registrar */}
          {(tienePermiso('registrar_actividades') || tienePermiso('bitacora_dron') || tienePermiso('registrar_cosecha')) && (
            <li className="nav-item">
              <button className="nav-button" onClick={() => toggleSubmenu('registrar')}>
                <i className='bx bxs-edit'></i>
                <span>Registrar</span>
                <i className={`bx bx-chevron-down arrow ${openSubmenu === 'registrar' ? 'rotated' : ''}`}></i>
              </button>
              {openSubmenu === 'registrar' && (
                <div className="nav-submenu">
                  <ul className="nav-submenu-items">
                    {tienePermiso('registrar_actividades') && <li><Link to="/registrar/actividades" className="nav-submenu-link" onClick={closeMenus}><i className='bx bx-task'></i> Bitácora Tractor</Link></li>}
                    {tienePermiso('bitacora_dron') && <li><Link to="/registrar/dron" className="nav-submenu-link" onClick={closeMenus}><i className='bx bx-paper-plane'></i> Bitácora Dron</Link></li>}
                    {tienePermiso('registrar_cosecha') && <li><Link to="/registrar/cosecha" className="nav-submenu-link" onClick={closeMenus}><i className='bx bx-leaf'></i> Cosecha</Link></li>}
                  </ul>
                </div>
              )}
            </li>
          )}

          {/* Catálogos - solo si tiene algún permiso de catálogos */}
          {(tienePermiso('catalogos_actividades') || tienePermiso('catalogos_camiones') || tienePermiso('catalogos_tractoristas') || tienePermiso('catalogos_supervisores')) && (
            <li className="nav-item">
              <button className="nav-button" onClick={() => toggleSubmenu('catalogos')}>
                <i className='bx bxs-folder-open'></i>
                <span>Catálogos</span>
                <i className={`bx bx-chevron-down arrow ${openSubmenu === 'catalogos' ? 'rotated' : ''}`}></i>
              </button>
              {openSubmenu === 'catalogos' && (
                <div className="nav-submenu">
                  <ul className="nav-submenu-items">
                    {tienePermiso('catalogos_actividades') && <li><Link to="/catalogos/actividadtrac" className="nav-submenu-link" onClick={closeMenus}><i className='bx bx-task'></i> Actividades</Link></li>}
                    {tienePermiso('catalogos_camiones') && <li><Link to="/catalogos/camiones" className="nav-submenu-link" onClick={closeMenus}><i className='bx bxs-car'></i> Camiones</Link></li>}
                    {tienePermiso('catalogos_tractoristas') && <li><Link to="/catalogos/tractoristas" className="nav-submenu-link" onClick={closeMenus}><i className='bx bx-hard-hat'></i> Tractoristas</Link></li>}
                    {tienePermiso('catalogos_supervisores') && <li><Link to="/catalogos/supervisores" className="nav-submenu-link" onClick={closeMenus}><i className='bx bx-user-check'></i> Supervisores</Link></li>}
                    {tienePermiso('catalogos_supervisores') && <li><Link to="/catalogos/proyectos" className="nav-submenu-link" onClick={closeMenus}><i className='bx bx-map'></i> Proyectos</Link></li>}
                  </ul>
                </div>
              )}
            </li>
          )}

          {/* Reportes - solo si tiene algún permiso de reportes */}
          {(tienePermiso('reportes_actividades') || tienePermiso('reportes_cosecha') || tienePermiso('reportes_seguridad')) && (
            <li className="nav-item">
              <button className="nav-button" onClick={() => toggleSubmenu('reportes')}>
                <i className='bx bxs-bar-chart-alt-2'></i>
                <span>Reportes</span>
                <i className={`bx bx-chevron-down arrow ${openSubmenu === 'reportes' ? 'rotated' : ''}`}></i>
              </button>
              {openSubmenu === 'reportes' && (
                <div className="nav-submenu">
                  <ul className="nav-submenu-items">
                    {tienePermiso('reportes_actividades') && <li><Link to="/reportes/actividades" className="nav-submenu-link" onClick={closeMenus}><i className='bx bx-calendar'></i> Actividades</Link></li>}
                    {(tienePermiso('reportes_actividades') || tienePermiso('revisar_actividades')) && <li><Link to="/reportes/fichas-aplicacion" className="nav-submenu-link" onClick={closeMenus}><i className='bx bx-spray-can'></i> Fichas de aplicación</Link></li>}
                    {tienePermiso('reportes_cosecha') && <li><Link to="/reportes/cosecha" className="nav-submenu-link" onClick={closeMenus}><i className='bx bx-leaf'></i> Cosecha</Link></li>}
                    {tienePermiso('reportes_seguridad') && <li><Link to="/reportes/seguridad" className="nav-submenu-link" onClick={closeMenus}><i className='bx bx-shield-quarter'></i> R. Camiones</Link></li>}
                  </ul>
                </div>
              )}
            </li>
          )}

          {/* Configuraciones - visible para todos, Administración solo admin */}
          <li className="nav-item">
              <button className="nav-button" onClick={() => toggleSubmenu('configuraciones')}>
                <i className='bx bxs-cog'></i>
                <span>Configuraciones</span>
                <i className={`bx bx-chevron-down arrow ${openSubmenu === 'configuraciones' ? 'rotated' : ''}`}></i>
              </button>
              {openSubmenu === 'configuraciones' && (
                <div className="nav-submenu">
                  <ul className="nav-submenu-items">
                    {esAdmin && (
                      <li><Link to="/configuraciones/administracion" className="nav-submenu-link" onClick={closeMenus}><i className='bx bx-user-check'></i> Administración</Link></li>
                    )}
                    <li><Link to="/configuraciones/entrenamiento" className="nav-submenu-link" onClick={closeMenus}><i className='bx bx-book-reader'></i> Entrenamiento</Link></li>
                    <li><Link to="/configuraciones/version" className="nav-submenu-link" onClick={closeMenus}><i className='bx bx-info-circle'></i> Versión</Link></li>
                  </ul>
                </div>
              )}
            </li>

            {/* Asistente MirAI (chat de ayuda): a la derecha de la barra, ya no en Configuraciones */}
            <li className="nav-item nav-item-ayuda">
              <Link to="/configuraciones/ayuda" className="nav-button" onClick={closeMenus} title="Asistente MirAI (ayuda)">
                <i className='bx bx-bot'></i>
                <span>Ayuda</span>
              </Link>
            </li>
        </ul>
      </div>
    </nav>
  )
}

export default Nav
