import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router'
import { useState, useEffect } from 'react'
import Swal from 'sweetalert2'
import Header from './components/Header'
import Nav from './components/Nav'
import Dashboard from './pages/Dashboard'
import ActividadesTractores from './pages/ActividadesTractores'
import RegistrarActTractores from './pages/RegistrarActTractores'
import FichaCosecha from './pages/FichaCosecha'
import ReporteActividades from './pages/ReporteActividades'
import ReportesCosecha from './pages/ReportesCosecha'
import ReporteSeguridad from './pages/ReporteSeguridad'
import CatalogoCamiones from './pages/CatalogoCamiones'
import CatalogoTractoristas from './pages/CatalogoTractoristas'
import CatalogoSupervisores from './pages/CatalogoSupervisores'
import CatalogoProyectos from './pages/CatalogoProyectos'
import Administracion from './pages/Administracion'
import LoginTractorista from './pages/LoginTractorista'
import OfflineIndicator from './components/OfflineIndicator'
import BotonModoColor from './components/BotonModoColor'
import { useEmpresas } from './services/useEmpresas'
import { logoUrl } from './services/empresasService'
import { useModoColor } from './services/useModoColor'
import { aplicarTema } from './utils/aplicarTema'
import { cerrarSesion } from './services/sesion'
import './App.css'

// Modulo de una sola empresa (Nintanga): siempre se busca esta misma fila de
// la tabla compartida `empresas`, sin selector -- ver TEMA.md.
const NUMERO_EMPRESA = '222'
// Asistente MirAI (chatbot): usa la misma cookie de sesion del HUB, no token en la URL.
const CHATBOT_URL = import.meta.env.VITE_CHATBOT_URL || 'https://chatbot.miraigprovefrut.com'

function DefaultRedirect() {
  const permisos = (() => { try { return JSON.parse(localStorage.getItem('user_permisos_operagricola') || '{}') } catch { return {} } })()
  const esAdmin = permisos.es_admin
  const pestanas = permisos.pestanas || []

  // Admin o usuario con múltiples permisos → dashboard
  if (esAdmin) return <Navigate to="/dashboard" replace />

  // Buscar la primera ruta a la que el usuario tiene acceso
  const rutasPorPermiso = {
    registrar_actividades: '/registrar/actividades',
    registrar_cosecha: '/registrar/cosecha',
    catalogos_actividades: '/catalogos/actividadtrac',
    catalogos_camiones: '/catalogos/camiones',
    catalogos_tractoristas: '/catalogos/tractoristas',
    catalogos_supervisores: '/catalogos/supervisores',
    reportes_actividades: '/reportes/actividades',
    reportes_cosecha: '/reportes/cosecha',
    reportes_seguridad: '/reportes/seguridad',
  }

  for (const [permiso, ruta] of Object.entries(rutasPorPermiso)) {
    if (pestanas.includes(permiso)) return <Navigate to={ruta} replace />
  }

  // Fallback
  return <Navigate to="/dashboard" replace />
}

function EntrenamientoPage() {
  const navigate = useNavigate()
  const [modoEntrenamiento, setModoEntrenamiento] = useState(localStorage.getItem('modo_entrenamiento') === 'true')

  useEffect(() => {
    if (modoEntrenamiento) {
      // Ya está activo, preguntar si quiere desactivar
      Swal.fire({
        title: 'Modo Entrenamiento',
        html: '<p>El modo entrenamiento está <strong>ACTIVO</strong>.</p><p>Los datos NO se guardan en la base de datos.</p>',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc3545',
        cancelButtonColor: '#7b1fa2',
        confirmButtonText: 'Desactivar',
        cancelButtonText: 'Mantener activo'
      }).then((result) => {
        if (result.isConfirmed) {
          localStorage.setItem('modo_entrenamiento', 'false')
          setModoEntrenamiento(false)
          Swal.fire({
            title: 'Modo Normal',
            text: 'Los datos se guardarán normalmente.',
            icon: 'success',
            confirmButtonColor: '#7b1fa2'
          })
        }
        navigate(-1)
      })
    } else {
      // Preguntar si quiere activar
      Swal.fire({
        title: '¿Activar Modo Entrenamiento?',
        html: '<p>En modo entrenamiento los datos <strong>NO se guardan</strong> en la base de datos.</p><p>Es solo para práctica y capacitación.</p>',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#e65100',
        cancelButtonColor: '#6c757d',
        confirmButtonText: 'Sí, activar',
        cancelButtonText: 'Cancelar'
      }).then((result) => {
        if (result.isConfirmed) {
          localStorage.setItem('modo_entrenamiento', 'true')
          setModoEntrenamiento(true)
          Swal.fire({
            title: 'Modo Entrenamiento Activo',
            text: 'Los datos NO se guardarán en la base de datos.',
            icon: 'warning',
            confirmButtonColor: '#e65100'
          })
        }
        navigate(-1)
      })
    }
  }, [])

  return null
}

function VersionPage() {
  const navigate = useNavigate()
  useEffect(() => {
    Swal.fire({
      title: 'Versión',
      html: `
        <div style="text-align:center;">
          <p style="font-size:2rem; font-weight:700; color:#7b1fa2; margin-bottom:0.5rem;">v0.0.1</p>
          <p style="color:#666; font-size:0.85rem;">Módulo Agrícola - Operaciones</p>
          <p style="color:#999; font-size:0.75rem; margin-top:0.5rem;">© 2026 Nintanga</p>
        </div>
      `,
      confirmButtonColor: '#7b1fa2',
      confirmButtonText: 'Cerrar'
    }).then(() => {
      navigate(-1)
    })
  }, [])
  return null
}

function AyudaPage() {
  const navigate = useNavigate()
  const [showChat, setShowChat] = useState(true)

  const cerrarChat = () => {
    setShowChat(false)
    navigate(-1)
  }

  if (!showChat) return null

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.5)',
      zIndex: 9999,
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center'
    }}>
      <div style={{
        width: '420px',
        height: '600px',
        maxWidth: '95vw',
        maxHeight: '90vh',
        borderRadius: '12px',
        overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        display: 'flex',
        flexDirection: 'column',
        background: '#fff'
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.8rem 1rem',
          background: '#7b1fa2',
          color: 'white'
        }}>
          <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
            <i className='bx bx-help-circle' style={{fontSize: '1.2rem'}}></i>
            <strong>Asistente Virtual MirAI</strong>
          </div>
          <button
            onClick={cerrarChat}
            style={{background: 'transparent', border: 'none', color: 'white', fontSize: '1.3rem', cursor: 'pointer'}}
          >
            <i className='bx bx-x'></i>
          </button>
        </div>
        {/* Iframe del chat */}
        <iframe
          src={CHATBOT_URL}
          style={{flex: 1, border: 'none', width: '100%'}}
          title="Asistente Virtual"
        />
      </div>
    </div>
  )
}

function App() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [modoEntrenamiento, setModoEntrenamiento] = useState(localStorage.getItem('modo_entrenamiento') === 'true')
  const esTractorista = localStorage.getItem('usuario_tipo') === 'tractorista'
  const esDominioTractoristas = window.location.hostname.startsWith('tractoristas')

  // Tema visual (colores + modo claro/oscuro) desde la tabla compartida
  // `empresas` -- ver TEMA.md. Este modulo no es multi-empresa, pero igual
  // se lee de ahi (no escrito a mano) para no desincronizarse si cambia.
  const { empresas } = useEmpresas()
  const { modo, darkMode, siguienteModo } = useModoColor()
  const empresa = empresas.find(e => e.numero === NUMERO_EMPRESA) || null
  useEffect(() => {
    if (empresa) aplicarTema(empresa, darkMode)
  }, [empresa, darkMode])

  // En el dominio de tractoristas solo entran tractoristas (sesion propia):
  // si no hay una, al login de cedula + PIN.
  if (esDominioTractoristas && !esTractorista && !window.location.pathname.startsWith('/login-tractorista')) {
    window.location.href = '/login-tractorista'
    return null
  }

  const cerrarSesionTractorista = async () => {
    const conf = await Swal.fire({
      title: '¿Desea cerrar sesión?',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, salir',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#7b1fa2'
    })
    if (!conf.isConfirmed) return
    // Borra la cookie de sesion del tractorista; se conservan usuario/cedula
    // guardados para el auto-llenado del siguiente ingreso.
    await cerrarSesion()
    // window.close() solo funciona si la pestaña fue abierta por script; en
    // una pestaña normal (link/bookmark) no hace nada, por eso siempre se
    // redirige al login como respaldo.
    window.close()
    window.location.href = '/login-tractorista'
  }

  // Escuchar cambios en localStorage para modo entrenamiento
  useEffect(() => {
    const checkModo = () => setModoEntrenamiento(localStorage.getItem('modo_entrenamiento') === 'true')
    window.addEventListener('storage', checkModo)
    const interval = setInterval(checkModo, 500)
    return () => { window.removeEventListener('storage', checkModo); clearInterval(interval) }
  }, [])

  return (
    <BrowserRouter>
      <Routes>
        {/* Login tractorista - página independiente sin header/nav */}
        <Route path="/login-tractorista" element={<LoginTractorista />} />

        {/* Tractorista: solo acceso a registrar actividades */}
        {esTractorista ? (
          <Route path="/*" element={
            <div className="app-shell">
              {/* Header simplificado para tractorista */}
              <header className="app-header">
                <div className="app-header-container">
                  <div className="header-logo">
                    <img src={logoUrl(empresa) || '/LogoNintanga.png'} alt="Nintanga" className="header-logo-img logo-empresa" />
                    <span className="header-logo-text">
                      <span className="title-full">Operaciones Agrícolas</span>
                      <span className="title-mobile">Operaciones</span>
                    </span>
                  </div>
                  <div className="header-right">
                    <div className="header-user">
                      <span className="header-user-name">{localStorage.getItem('usuario_nombre') || 'Tractorista'}</span>
                      <span className="header-user-email">{localStorage.getItem('usuario_username') || ''}</span>
                    </div>
                    <button className="header-btn-logout" onClick={cerrarSesionTractorista}>
                      <i className='bx bx-log-out'></i>
                      <span>Salir</span>
                    </button>
                  </div>
                  <button className="header-btn-logout-mobile" onClick={cerrarSesionTractorista}>
                    <i className='bx bx-log-out'></i>
                  </button>
                </div>
              </header>
              <main className="app-main">
                <Routes>
                  <Route path="/registrar/actividades" element={<RegistrarActTractores />} />
                  <Route path="*" element={<Navigate to="/registrar/actividades" replace />} />
                </Routes>
              </main>
              <OfflineIndicator />
            </div>
          } />
        ) : (
          /* App principal con layout completo */
          <Route path="/*" element={
            <div className={`app-shell ${modoEntrenamiento ? 'modo-entrenamiento' : ''}`}>
              {modoEntrenamiento && (
                <div className="banner-entrenamiento">
                  <i className='bx bx-error-circle'></i> MODO ENTRENAMIENTO ACTIVO — Los datos NO se guardan en la base de datos
                </div>
              )}
              <Header onMenuClick={() => setMenuOpen(true)} />
              <Nav isOpen={menuOpen} onClose={() => setMenuOpen(false)} />
              <main className="app-main">
                <Routes>
                  <Route path="/" element={<DefaultRedirect />} />
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/catalogos/actividadtrac" element={<ActividadesTractores />} />
            <Route path="/catalogos/tractoristas" element={<CatalogoTractoristas />} />
                  <Route path="/catalogos/camiones" element={<CatalogoCamiones />} />
                  <Route path="/catalogos/tractoristas" element={<CatalogoTractoristas />} />
                  <Route path="/catalogos/supervisores" element={<CatalogoSupervisores />} />
                  <Route path="/catalogos/proyectos" element={<CatalogoProyectos />} />
                  {/* Registrar */}
                  <Route path="/registrar/actividades" element={<RegistrarActTractores />} />
                  <Route path="/registrar/cosecha" element={<FichaCosecha />} />
                  {/* Ingreso */}
                  <Route path="/ingreso/actividades" element={<div>Ingreso Actividades - En construcción</div>} />
                  {/* Reportes */}
                  <Route path="/reportes" element={<div>Reportes - En construcción</div>} />
                  <Route path="/reportes/actividades" element={<ReporteActividades />} />
                  <Route path="/reportes/cosecha" element={<ReportesCosecha />} />
                  <Route path="/reportes/seguridad" element={<ReporteSeguridad />} />
                  {/* Configuraciones */}
                  <Route path="/configuraciones/administracion" element={<Administracion />} />
                  <Route path="/configuraciones/entrenamiento" element={<EntrenamientoPage />} />
                  <Route path="/configuraciones/version" element={<VersionPage />} />
                  <Route path="/configuraciones/ayuda" element={<AyudaPage />} />
                </Routes>
              </main>
              <OfflineIndicator />
            </div>
          } />
        )}
      </Routes>
      <BotonModoColor modo={modo} darkMode={darkMode} onCambiar={siguienteModo} />
    </BrowserRouter>
  )
}

export default App
