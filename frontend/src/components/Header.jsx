import { useState, useEffect, useRef } from 'react'
import Swal from 'sweetalert2'
import useOnlineStatus from '../services/useOnlineStatus'
import { activarVerComo, salirVerComo, verComoActivo, verComoNombre } from '../services/verComo'
import { useEmpresas } from '../services/useEmpresas'
import { logoUrl } from '../services/empresasService'
import { cerrarPestana, HUB_URL, limpiarDatosSesion } from '../services/sesion'

const NUMERO_EMPRESA = '222'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8007'

function Header({ onMenuClick }) {
  const [dateTime, setDateTime] = useState(new Date())
  const [esMovil, setEsMovil] = useState(() => window.innerWidth <= 768)
  const { isOnline } = useOnlineStatus()
  const { empresas } = useEmpresas()
  const empresa = empresas.find(e => e.numero === NUMERO_EMPRESA) || null
  const simulando = verComoActivo()
  // Si esta simulando, "admin real" se lee del backup (el usuario simulado
  // puede no ser admin) -- si no esta simulando, se lee de los permisos
  // actuales tal cual (esos SI son los reales).
  const esAdminReal = (() => {
    try {
      const raw = simulando
        ? localStorage.getItem('ver_como_real_user_permisos_operagricola')
        : localStorage.getItem('user_permisos_operagricola')
      return !!JSON.parse(raw || '{}').es_admin
    } catch { return false }
  })()

  const [verComoAbierto, setVerComoAbierto] = useState(false)
  const [usuariosVerComo, setUsuariosVerComo] = useState([])
  const [busquedaVerComo, setBusquedaVerComo] = useState('')
  const verComoRef = useRef(null)

  const abrirVerComo = async () => {
    setVerComoAbierto(true)
    setBusquedaVerComo('')
    if (usuariosVerComo.length > 0) return
    try {
      const res = await fetch(`${API_URL}/api/admin/usuarios`, {})
      if (res.ok) {
        const data = await res.json()
        setUsuariosVerComo(Array.isArray(data?.usuarios) ? data.usuarios : [])
      }
    } catch (e) { console.error('Error cargando usuarios:', e) }
  }

  // Cerrar el dropdown al hacer click afuera
  useEffect(() => {
    if (!verComoAbierto) return
    const handleClick = (e) => {
      if (verComoRef.current && !verComoRef.current.contains(e.target)) setVerComoAbierto(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [verComoAbierto])

  const busq = busquedaVerComo.trim().toLowerCase()
  const usuariosFiltrados = busq
    ? usuariosVerComo.filter(u =>
        (u.nombre_completo || '').toLowerCase().includes(busq) ||
        (u.usuario || '').toLowerCase().includes(busq) ||
        (u.rol || '').toLowerCase().includes(busq))
    : usuariosVerComo

  const seleccionarVerComo = (u) => {
    setVerComoAbierto(false)
    activarVerComo(u)
  }

  // Deteccion de mobile por JS (no depende de que cargue el CSS de media queries)
  useEffect(() => {
    const checkAncho = () => setEsMovil(window.innerWidth <= 768)
    window.addEventListener('resize', checkAncho)
    return () => window.removeEventListener('resize', checkAncho)
  }, [])
  const nombreUsuario = localStorage.getItem('usuario_nombre') || 'Usuario'
  const username = localStorage.getItem('usuario_username') || ''
  const rolCompleto = localStorage.getItem('usuario_rol') || ''
  const rolCorto = (() => {
    // Si tiene guión, mantener ambas partes del guión
    if (rolCompleto.includes('-')) {
      const partes = rolCompleto.split(/\s*-\s*/)
      return partes[0].split(/\s+/)[0] + ' - ' + partes[1].split(/\s+/)[0]
    }
    const palabras = rolCompleto.split(/\s+/)
    if (palabras.length <= 2) return rolCompleto
    const preposiciones = ['de', 'en', 'del', 'la', 'el', 'las', 'los', 'y']
    let corte = 2
    while (corte < palabras.length && preposiciones.includes(palabras[corte - 1].toLowerCase())) {
      corte++
    }
    return palabras.slice(0, corte).join(' ')
  })()

  useEffect(() => {
    const timer = setInterval(() => setDateTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const formatDate = (date) => {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }
    return date.toLocaleDateString('es-ES', options)
  }

  const formatTime = (date) => {
    return date.toLocaleTimeString('es-ES')
  }

  const cerrarSesion = async () => {
    const conf = await Swal.fire({
      title: '¿Desea cerrar sesión?',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, salir',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#7b1fa2'
    })
    if (!conf.isConfirmed) return
    // Salir del MODULO: se cierra la pestaña y el HUB sigue con su sesion
    // (cerrar sesion de todo MirAI se hace desde el HUB). Si el navegador no
    // deja cerrarla, se vuelve al HUB.
    limpiarDatosSesion()
    cerrarPestana(HUB_URL)
  }

  return (
    <header className="app-header">
      <div className="app-header-container">
        <div className="header-logo">
          {esMovil && (
            <button onClick={onMenuClick} aria-label="Abrir menu" style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.5)',
              color: 'white', fontSize: '1.5rem', lineHeight: 1, cursor: 'pointer',
              padding: 0, width: '2.5rem', height: '2.5rem', minWidth: '2.5rem',
              marginRight: '0.75rem', borderRadius: '8px', flexShrink: 0
            }}>
              <i className='bx bx-menu'></i>
            </button>
          )}
          <img src={logoUrl(empresa) || '/LogoNintanga.png'} alt="Nintanga" className="header-logo-img logo-empresa" style={esMovil ? {display: 'none'} : undefined} />
          <span className="header-logo-text">
            {esMovil ? 'Operaciones' : 'Operaciones Agrícolas'}
          </span>
        </div>
        {!esMovil && (
          <div className="header-right">
            <div style={{display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.2rem'}}>
              <span className="header-online-status" style={{
                display: 'flex', alignItems: 'center', gap: '0.3rem',
                fontSize: '0.7rem', fontWeight: 600,
                color: isOnline ? '#a5d6a7' : '#ff8a80'
              }}>
                <i className={isOnline ? 'bx bx-wifi' : 'bx bx-wifi-off'} style={{fontSize: '0.85rem'}}></i>
                {isOnline ? 'Online' : 'Offline'}
              </span>
              {esAdminReal && (
                <div ref={verComoRef} style={{position: 'relative'}}>
                  {simulando ? (
                    <button
                      onClick={() => (verComoAbierto ? setVerComoAbierto(false) : abrirVerComo())}
                      title="Click para cambiar de usuario simulado"
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.25rem',
                        background: 'rgba(255,152,0,0.25)', border: '1px solid #ff9800',
                        color: '#ffcc80', fontSize: '0.65rem', fontWeight: 600,
                        padding: '0.15rem 0.5rem', borderRadius: '10px', cursor: 'pointer'
                      }}>
                      <i className='bx bx-low-vision'></i>
                      {verComoNombre()}
                      <i className='bx bx-x' title="Salir de la vista simulada"
                        onClick={e => { e.stopPropagation(); salirVerComo() }}
                        style={{marginLeft: '0.15rem', fontSize: '0.9rem'}}></i>
                    </button>
                  ) : (
                    <button onClick={() => (verComoAbierto ? setVerComoAbierto(false) : abrirVerComo())} style={{
                      display: 'flex', alignItems: 'center', gap: '0.25rem',
                      background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.3)',
                      color: 'rgba(255,255,255,0.8)', fontSize: '0.65rem', fontWeight: 600,
                      padding: '0.15rem 0.5rem', borderRadius: '10px', cursor: 'pointer'
                    }}>
                      <i className='bx bx-low-vision'></i> Ver como
                    </button>
                  )}
                  {verComoAbierto && (
                    <div style={{
                      position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 2000,
                      width: '300px', background: '#fff', borderRadius: '10px',
                      boxShadow: '0 8px 28px rgba(0,0,0,0.35)', overflow: 'hidden'
                    }}>
                      <div style={{padding: '0.6rem'}}>
                        <input
                          autoFocus
                          type="text"
                          value={busquedaVerComo}
                          onChange={e => setBusquedaVerComo(e.target.value)}
                          placeholder="Buscar por nombre, usuario o cargo..."
                          style={{
                            width: '100%', padding: '0.45rem 0.6rem', borderRadius: '6px',
                            border: '1px solid #ddd', fontSize: '0.8rem', color: '#333',
                            outline: 'none', boxSizing: 'border-box'
                          }}
                        />
                      </div>
                      <div style={{maxHeight: '260px', overflowY: 'auto', borderTop: '1px solid #eee'}}>
                        {usuariosFiltrados.length === 0 && (
                          <div style={{padding: '0.8rem', fontSize: '0.78rem', color: '#999', textAlign: 'center'}}>
                            {usuariosVerComo.length === 0 ? 'Cargando...' : 'Sin resultados'}
                          </div>
                        )}
                        {usuariosFiltrados.map(u => (
                          <div key={u.usuario} onClick={() => seleccionarVerComo(u)} style={{
                            padding: '0.55rem 0.8rem', cursor: 'pointer', borderBottom: '1px solid #f2f2f2'
                          }}
                            onMouseEnter={e => e.currentTarget.style.background = '#f5eefa'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                            <div style={{fontSize: '0.82rem', fontWeight: 600, color: '#333'}}>{u.nombre_completo || u.usuario}</div>
                            <div style={{fontSize: '0.7rem', color: '#888'}}>{u.usuario}{u.rol ? ` · ${u.rol}` : ''}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="header-datetime">
              <span className="date">{formatDate(dateTime)}</span>
              <span className="time">{formatTime(dateTime)}</span>
            </div>
            <div className="header-user">
              <span className="header-user-name">{nombreUsuario}</span>
              <span className="header-user-email">{username}</span>
              <span className="header-user-role">{rolCorto}</span>
            </div>
            <button className="header-btn-logout" onClick={cerrarSesion}>
              <i className='bx bx-log-out'></i>
              <span>Salir</span>
            </button>
          </div>
        )}
        {esMovil && (
          <button onClick={cerrarSesion} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.5)',
            color: 'white', fontSize: '1.3rem', cursor: 'pointer',
            padding: 0, width: '2.5rem', height: '2.5rem', borderRadius: '8px', flexShrink: 0
          }}>
            <i className='bx bx-log-out'></i>
          </button>
        )}
      </div>
    </header>
  )
}

export default Header
