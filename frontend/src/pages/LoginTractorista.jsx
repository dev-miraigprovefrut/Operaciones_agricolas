import { useState, useEffect, useRef } from 'react'
import { useEmpresas } from '../services/useEmpresas'
import { logoUrl } from '../services/empresasService'
import { llaveDispositivo, nombreDispositivo, guardarIngresoOffline, hayIngresoOffline, ingresarOffline, nombreGuardado } from '../services/dispositivo'

// fetch lanza TypeError cuando no hay red (o AbortError si la señal no da datos)
const esSinRed = err => err instanceof TypeError || err?.name === 'AbortError'
const conPlazo = (url, opciones, ms = 6000) => {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  return fetch(url, { ...opciones, signal: ctrl.signal }).finally(() => clearTimeout(t))
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8007'
const NUMERO_EMPRESA = '222'

function LoginTractorista() {
  const { empresas } = useEmpresas()
  const empresa = empresas.find(e => e.numero === NUMERO_EMPRESA) || null
  const [paso, setPaso] = useState(1)
  const [username, setUsername] = useState('')
  const [cedula, setCedula] = useState('')
  const [nombreCompleto, setNombreCompleto] = useState('')
  const [tienePIN, setTienePIN] = useState(false)
  const [pinExpirado, setPinExpirado] = useState(false)
  // Olvido su codigo: entra con el codigo TEMPORAL del catalogo y crea uno nuevo
  const [modoRecuperar, setModoRecuperar] = useState(false)
  const [codigoTemporal, setCodigoTemporal] = useState('')
  const [sinRed, setSinRed] = useState(false)

  const [pin, setPin] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [showCedula, setShowCedula] = useState(false)
  const autoVerificado = useRef(false)

  // Auto-verificar si ya tiene datos guardados (webapp/PWA)
  useEffect(() => {
    if (autoVerificado.current) return
    const savedUsername = localStorage.getItem('tractorista_username')
    const savedCedula = localStorage.getItem('tractorista_cedula')
    if (savedUsername && savedCedula) {
      autoVerificado.current = true
      setUsername(savedUsername)
      setCedula(savedCedula)
      // Verificar automáticamente
      setLoading(true)
      conPlazo(`${API_URL}/api/tractoristas/verificar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: savedUsername, cedula: savedCedula })
      })
        .then(res => res.json().then(data => ({ ok: res.ok, data })))
        .then(({ ok, data }) => {
          if (!ok) {
            // Datos guardados ya no son válidos, limpiar
            localStorage.removeItem('tractorista_username')
            localStorage.removeItem('tractorista_cedula')
            return
          }
          setNombreCompleto(data.nombre || '')
          setTienePIN(data.tiene_pin)
          setModoRecuperar(!!data.requiere_temporal)
          setPaso(2)
        })
        .catch(() => {
          // SIN INTERNET: no se borra nada; si este telefono ya entro antes, se
          // ingresa con el codigo contra la huella guardada
          if (hayIngresoOffline(savedUsername)) {
            setSinRed(true)
            setNombreCompleto(nombreGuardado())
            setTienePIN(true)
            setPaso(2)
          } else {
            setError('Sin conexión. La primera vez debe ingresar con internet.')
          }
        })
        .finally(() => setLoading(false))
    }
  }, [])

  const limpiarPIN = () => {
    setPin('')
    setPinConfirm('')
    setError('')
    setExito('')
  }

  const volverPaso1 = () => {
    setPaso(1)
    limpiarPIN()
    setModoRecuperar(false)
    setTienePIN(false)
    setPinExpirado(false)
    // Limpiar datos guardados para permitir cambiar de usuario
    localStorage.removeItem('tractorista_username')
    localStorage.removeItem('tractorista_cedula')
  }

  const handleVerificar = async () => {
    if (!username.trim()) return setError('Ingrese su usuario')
    if (!cedula.trim()) return setError('Ingrese su cédula')
    if (cedula.trim().length !== 10) return setError('La cédula debe tener 10 dígitos')

    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_URL}/api/tractoristas/verificar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), cedula: cedula.trim() })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Error de verificación')

      setNombreCompleto(data.nombre || '')
      setTienePIN(data.tiene_pin)
      setModoRecuperar(!!data.requiere_temporal)
      setPaso(2)
    } catch (err) {
      if (esSinRed(err) && hayIngresoOffline(username.trim())) {
        setSinRed(true)
        setNombreCompleto(nombreGuardado())
        setTienePIN(true)
        setPaso(2)
        return
      }
      setError(esSinRed(err) ? 'Sin conexión. La primera vez debe ingresar con internet.' : err.message)
    } finally {
      setLoading(false)
    }
  }

  const necesitaGenerarPIN = !tienePIN || modoRecuperar
  const pinActual = necesitaGenerarPIN && pin.length === 4 ? pinConfirm : pin
  const pinLabel = necesitaGenerarPIN
    ? (pin.length === 4 ? 'Confirme su código' : 'Cree un código de 4 dígitos')
    : 'Ingrese su código'

  const agregarDigito = (digito) => {
    if (necesitaGenerarPIN) {
      if (pin.length < 4) setPin(prev => prev + digito)
      else if (pinConfirm.length < 4) setPinConfirm(prev => prev + digito)
    } else {
      if (pin.length < 4) setPin(prev => prev + digito)
    }
    setError('')
  }

  const borrarDigito = () => {
    if (necesitaGenerarPIN && pinConfirm.length > 0) {
      setPinConfirm(prev => prev.slice(0, -1))
    } else if (pin.length > 0) {
      setPin(prev => prev.slice(0, -1))
    }
    setError('')
  }

  const handleGenerarCodigo = async () => {
    if (pin.length !== 4) return setError('El código debe ser de 4 dígitos')
    if (pin !== pinConfirm) return setError('Los códigos no coinciden')
    if (modoRecuperar && codigoTemporal.length !== 6) return setError('Ingrese el código temporal de 6 dígitos que le dio su supervisor')

    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_URL}/api/tractoristas/registro`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), cedula: cedula.trim(), pin,
          codigo_temporal: modoRecuperar ? codigoTemporal : null })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Error al generar código')

      setExito(modoRecuperar ? 'Código actualizado correctamente' : 'Código registrado correctamente')
      setTienePIN(true)
      setPinExpirado(false)
      setModoRecuperar(false)
      setCodigoTemporal('')
      limpiarPIN()

      setTimeout(() => {
        setExito('')
      }, 2000)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleLogin = async () => {
    if (pin.length !== 4) return setError('Ingrese su código de 4 dígitos')

    setLoading(true)
    setError('')
    const entrarSinRed = async () => {
      await ingresarOffline(username.trim(), pin)
      window.location.href = '/registrar/actividades'
    }
    try {
      if (sinRed || navigator.onLine === false) { await entrarSinRed(); return }
      let res
      try {
        res = await conPlazo(`${API_URL}/api/tractoristas/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: username.trim(), pin,
            dispositivo: llaveDispositivo(), dispositivo_nombre: nombreDispositivo() })
        })
      } catch (err) {
        if (esSinRed(err) && hayIngresoOffline(username.trim())) { await entrarSinRed(); return }
        throw esSinRed(err) ? new Error('Sin conexión. La primera vez debe ingresar con internet.') : err
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Error al ingresar')
      await guardarIngresoOffline(username.trim(), pin, data.nombre)

      // La sesion queda en una cookie HttpOnly del backend (no en localStorage)
      localStorage.setItem('usuario_nombre', data.nombre || '')
      localStorage.setItem('usuario_username', data.username || '')
      localStorage.setItem('usuario_tipo', 'tractorista')
      // Guardar datos para auto-login en siguiente visita
      localStorage.setItem('tractorista_username', username.trim())
      localStorage.setItem('tractorista_cedula', cedula.trim())

      window.location.href = '/registrar/actividades'
    } catch (err) {
      setError(err.message)
      setPin('')
    } finally {
      setLoading(false)
    }
  }

  // Estilos
  const styles = {
    page: {
      minHeight: '100vh',
      background: 'linear-gradient(160deg, #0d0d1a 0%, #1a1035 40%, #2d1b4e 70%, #1a1035 100%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1rem',
      fontFamily: 'var(--font-principal, "Inter", sans-serif)'
    },
    card: {
      width: '100%',
      maxWidth: '380px',
      borderRadius: '20px',
      overflow: 'hidden',
      boxShadow: '0 25px 80px rgba(113, 45, 125, 0.25), 0 8px 32px rgba(0,0,0,0.4)',
      border: '1px solid rgba(255,255,255,0.06)'
    },
    headerSection: {
      background: 'linear-gradient(135deg, #712d7d 0%, #9c27b0 50%, #ea64a5 100%)',
      padding: '2rem 1.5rem 1.5rem',
      textAlign: 'center',
      position: 'relative',
      overflow: 'hidden'
    },
    headerOverlay: {
      position: 'absolute',
      top: 0, left: 0, right: 0, bottom: 0,
      background: 'radial-gradient(circle at 30% 20%, rgba(255,255,255,0.1) 0%, transparent 60%)',
      pointerEvents: 'none'
    },
    body: {
      background: '#15152a',
      padding: '1.75rem 1.5rem 1.5rem'
    },
    inputGroup: {
      marginBottom: '1rem'
    },
    label: {
      fontSize: '0.8rem',
      color: 'rgba(255,255,255,0.5)',
      marginBottom: '0.4rem',
      display: 'block',
      fontWeight: 500,
      letterSpacing: '0.03em',
      textTransform: 'uppercase'
    },
    inputWrap: {
      position: 'relative'
    },
    input: {
      width: '100%',
      padding: '0.85rem 0.85rem 0.85rem 2.75rem',
      borderRadius: '12px',
      border: '1.5px solid rgba(255,255,255,0.08)',
      background: 'rgba(255,255,255,0.04)',
      color: '#fff',
      fontSize: '0.95rem',
      outline: 'none',
      boxSizing: 'border-box',
      transition: 'all 0.25s ease',
      backdropFilter: 'blur(4px)'
    },
    inputIcon: {
      position: 'absolute', left: '0.9rem', top: '50%',
      transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.3)', fontSize: '1.15rem'
    },
    btnPrimary: (disabled) => ({
      width: '100%',
      padding: '0.95rem',
      border: 'none',
      borderRadius: '12px',
      background: disabled
        ? 'rgba(255,255,255,0.1)'
        : 'linear-gradient(135deg, #712d7d 0%, #9c27b0 50%, #ea64a5 100%)',
      color: 'white',
      fontSize: '0.95rem',
      fontWeight: 600,
      cursor: disabled ? 'not-allowed' : 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '0.5rem',
      transition: 'all 0.25s ease',
      boxShadow: disabled ? 'none' : '0 4px 20px rgba(113, 45, 125, 0.4)',
      letterSpacing: '0.02em'
    }),
    errorBox: {
      background: 'rgba(244,67,54,0.08)',
      border: '1px solid rgba(244,67,54,0.2)',
      color: '#ff8a80',
      padding: '0.65rem 0.85rem',
      borderRadius: '10px',
      fontSize: '0.8rem',
      marginBottom: '1rem',
      textAlign: 'center',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '0.35rem'
    },
    successBox: {
      background: 'rgba(76,175,80,0.08)',
      border: '1px solid rgba(76,175,80,0.2)',
      color: '#81c784',
      padding: '0.65rem 0.85rem',
      borderRadius: '10px',
      fontSize: '0.8rem',
      marginBottom: '1rem',
      textAlign: 'center',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '0.35rem'
    },
    warningBox: {
      background: 'rgba(255,152,0,0.08)',
      border: '1px solid rgba(255,152,0,0.2)',
      color: '#ffb74d',
      padding: '0.65rem 0.85rem',
      borderRadius: '10px',
      fontSize: '0.8rem',
      marginBottom: '1rem',
      textAlign: 'center',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '0.35rem'
    },
    userCard: {
      background: 'rgba(255,255,255,0.04)',
      borderRadius: '14px',
      padding: '0.85rem',
      marginBottom: '1.25rem',
      display: 'flex',
      alignItems: 'center',
      gap: '0.85rem',
      border: '1px solid rgba(255,255,255,0.06)'
    },
    avatar: {
      width: '44px', height: '44px', borderRadius: '12px',
      background: 'linear-gradient(135deg, #712d7d, #ea64a5)',
      display: 'flex', alignItems: 'center',
      justifyContent: 'center', color: 'white', fontWeight: 700,
      fontSize: '1.15rem', flexShrink: 0
    },
    pinDot: (active) => ({
      width: '44px', height: '44px', borderRadius: '12px',
      border: `2px solid ${active ? '#9c27b0' : 'rgba(255,255,255,0.08)'}`,
      background: active ? 'rgba(156,39,176,0.15)' : 'rgba(255,255,255,0.02)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '1.6rem', fontWeight: 700, color: '#c66ba9',
      transition: 'all 0.2s ease',
      boxShadow: active ? '0 0 16px rgba(156,39,176,0.2)' : 'none'
    }),
    numpadBtn: {
      padding: '0.85rem',
      fontSize: '1.35rem',
      fontWeight: 600,
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: '12px',
      background: 'rgba(255,255,255,0.03)',
      color: '#fff',
      cursor: 'pointer',
      transition: 'all 0.15s ease',
      userSelect: 'none'
    },
    footer: {
      padding: '0.85rem',
      textAlign: 'center',
      borderTop: '1px solid rgba(255,255,255,0.04)',
      fontSize: '0.7rem',
      color: 'rgba(255,255,255,0.25)',
      background: '#15152a',
      letterSpacing: '0.05em'
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        {/* Header con gradiente */}
        <div style={styles.headerSection}>
          <div style={styles.headerOverlay}></div>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <img src={logoUrl(empresa) || '/LogoNintanga.png'} alt="Nintanga"
              style={{ height: '120px', marginBottom: '1.5rem', filter: 'brightness(1.1)', display: 'block', margin: '0 auto 1.5rem' }}
              onError={e => { e.target.style.display = 'none' }}
            />
            <h2 style={{
              margin: 0, fontSize: '1.25rem', fontWeight: 700,
              color: 'white', letterSpacing: '0.02em'
            }}>
              Operaciones Agrícolas
            </h2>
            <div style={{
              width: '40px', height: '2px', margin: '0.6rem auto',
              background: 'rgba(255,255,255,0.4)', borderRadius: '1px'
            }}></div>
            <p style={{
              margin: 0, color: 'rgba(255,255,255,0.85)',
              fontSize: '0.85rem', fontWeight: 400
            }}>
              Acceso Tractoristas
            </p>
          </div>
        </div>

        <div style={styles.body}>

          {/* ========== PASO 1: Usuario + Cédula ========== */}
          {paso === 1 && (
            <>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Usuario</label>
                <div style={styles.inputWrap}>
                  <i className='bx bx-user' style={styles.inputIcon}></i>
                  <input
                    type="text"
                    placeholder=""
                    value={username}
                    onChange={e => { setUsername(e.target.value.toLowerCase()); setError('') }}
                    onKeyDown={e => e.key === 'Enter' && document.getElementById('input-cedula')?.focus()}
                    style={styles.input}
                    onFocus={e => {
                      e.target.style.borderColor = 'rgba(156,39,176,0.5)'
                      e.target.style.background = 'rgba(156,39,176,0.06)'
                    }}
                    onBlur={e => {
                      e.target.style.borderColor = 'rgba(255,255,255,0.08)'
                      e.target.style.background = 'rgba(255,255,255,0.04)'
                    }}
                  />
                </div>
              </div>

              <div style={{ ...styles.inputGroup, marginBottom: '1.25rem' }}>
                <label style={styles.label}>Código</label>
                <div style={styles.inputWrap}>
                  <i className='bx bx-lock-alt' style={styles.inputIcon}></i>
                  <input
                    id="input-cedula"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder=""
                    value={cedula}
                    onChange={e => { setCedula(e.target.value.replace(/\D/g, '').slice(0, 10)); setError('') }}
                    onKeyDown={e => e.key === 'Enter' && handleVerificar()}
                    maxLength={10}
                    style={styles.input}
                    onFocus={e => {
                      e.target.style.borderColor = 'rgba(156,39,176,0.5)'
                      e.target.style.background = 'rgba(156,39,176,0.06)'
                    }}
                    onBlur={e => {
                      e.target.style.borderColor = 'rgba(255,255,255,0.08)'
                      e.target.style.background = 'rgba(255,255,255,0.04)'
                    }}
                  />
                </div>
              </div>

              {error && (
                <div style={styles.errorBox}>
                  <i className='bx bx-error-circle'></i>{error}
                </div>
              )}

              <button onClick={handleVerificar} disabled={loading}
                style={styles.btnPrimary(loading)}
              >
                {loading
                  ? <><i className='bx bx-loader-alt bx-spin'></i> Verificando...</>
                  : <><i className='bx bx-right-arrow-alt' style={{ fontSize: '1.2rem' }}></i> Continuar</>
                }
              </button>
            </>
          )}

          {/* ========== PASO 2: Código ========== */}
          {paso === 2 && (
            <>
              {/* Info del usuario */}
              <div style={styles.userCard}>
                <div style={styles.avatar}>
                  {(nombreCompleto || username).charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: '#fff', fontWeight: 600, fontSize: '0.95rem' }}>{nombreCompleto}</div>
                  <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.75rem' }}>{username}</div>
                </div>
                <button onClick={volverPaso1} style={{
                  background: 'rgba(255,255,255,0.06)', border: 'none',
                  color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: '1.1rem',
                  borderRadius: '8px', padding: '0.35rem 0.5rem', transition: 'all 0.2s'
                }}>
                  <i className='bx bx-x'></i>
                </button>
              </div>

              {sinRed && (
                <div style={styles.warningBox}>
                  <i className='bx bx-wifi-off'></i>
                  Sin conexión: ingrese con su código. Lo registrado se enviará al volver la señal.
                </div>
              )}

              {/* Olvido su codigo: codigo TEMPORAL del supervisor (Catalogos > Tractoristas) */}
              {modoRecuperar && !sinRed && (
                <>
                  <div style={styles.warningBox}>
                    <i className='bx bx-key'></i>
                    Ingrese el código temporal que le dio su supervisor y cree su código nuevo.
                  </div>
                  <div style={styles.inputGroup}>
                    <label style={styles.label}>Código temporal (6 dígitos)</label>
                    <div style={styles.inputWrap}>
                      <i className='bx bx-key' style={styles.inputIcon}></i>
                      <input id="codigo-temporal" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
                        value={codigoTemporal} style={styles.input} autoComplete="one-time-code"
                        onChange={e => { setCodigoTemporal(e.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }} />
                    </div>
                  </div>
                </>
              )}

              {/* Botón recuperar */}
              {tienePIN && !modoRecuperar && !sinRed && (
                <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                  <button onClick={() => { setModoRecuperar(true); limpiarPIN() }}
                    style={{
                      background: 'transparent', border: 'none',
                      color: '#c66ba9', cursor: 'pointer', fontSize: '0.8rem',
                      opacity: 0.8, transition: 'opacity 0.2s'
                    }}
                    onMouseEnter={e => e.target.style.opacity = '1'}
                    onMouseLeave={e => e.target.style.opacity = '0.8'}
                  >
                    <i className='bx bx-refresh' style={{ marginRight: '0.25rem', verticalAlign: 'middle' }}></i>
                    Olvidé mi código (pida un código temporal a su supervisor)
                  </button>
                </div>
              )}

              {/* Label dinámico */}
              <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                <label style={{
                  fontSize: '0.8rem', color: 'rgba(255,255,255,0.45)',
                  display: 'block', marginBottom: '0.75rem',
                  fontWeight: 500, letterSpacing: '0.03em', textTransform: 'uppercase'
                }}>
                  {pinLabel}
                </label>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '0.65rem', cursor: 'pointer' }} onClick={() => document.getElementById('pin-hidden-input')?.focus()}>
                  {[0, 1, 2, 3].map(i => (
                    <div key={i} style={styles.pinDot(pinActual.length > i)}>
                      {pinActual.length > i ? '\u2022' : ''}
                    </div>
                  ))}
                </div>
              </div>

              {/* Input oculto para teclado del celular */}
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoFocus
                value={pinActual}
                onChange={e => {
                  const val = e.target.value.replace(/\D/g, '')
                  if (necesitaGenerarPIN) {
                    if (pin.length < 4) {
                      setPin(val.slice(0, 4))
                    } else {
                      setPinConfirm(val.slice(0, 4))
                    }
                  } else {
                    setPin(val.slice(0, 4))
                  }
                  setError('')
                }}
                maxLength={4}
                style={{
                  position: 'absolute',
                  opacity: 0,
                  width: '1px',
                  height: '1px',
                  pointerEvents: 'none'
                }}
                id="pin-hidden-input"
              />

              {/* Mensajes */}
              {error && (
                <div style={styles.errorBox}>
                  <i className='bx bx-error-circle'></i>{error}
                </div>
              )}
              {exito && (
                <div style={styles.successBox}>
                  <i className='bx bx-check-circle'></i>{exito}
                </div>
              )}

              {/* Botón acción */}
              <button
                onClick={necesitaGenerarPIN ? handleGenerarCodigo : handleLogin}
                disabled={loading}
                style={styles.btnPrimary(loading)}
              >
                {loading
                  ? <><i className='bx bx-loader-alt bx-spin'></i> Procesando...</>
                  : necesitaGenerarPIN
                    ? <><i className='bx bx-key' style={{ fontSize: '1.1rem' }}></i> Generar código</>
                    : <><i className='bx bx-log-in' style={{ fontSize: '1.1rem' }}></i> Ingresar</>
                }
              </button>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          NINTANGA — OPERACIONES AGRÍCOLAS
        </div>
      </div>
    </div>
  )
}

export default LoginTractorista
