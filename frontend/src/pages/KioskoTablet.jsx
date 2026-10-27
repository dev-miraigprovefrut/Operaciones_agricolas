import { useCallback, useEffect, useRef, useState } from 'react'
import './KioskoTablet.css'
import { addToQueue, processQueue, getPendingCount, getPendingItems, fetchWithOffline, fetchConTimeout, cacheData, getCachedData } from '../services/syncQueue'
import { nuevoClienteId, ahoraLocal, guardarLocal, mezclar, urlRegistro, accionDe, claveRegistro } from '../services/registrosLocales'
import { llaveDispositivo, nombreDispositivo, guardarIngresoOffline, hayIngresoOffline, ingresarOffline, nombreGuardado } from '../services/dispositivo'
import { tractorFijo, ubicacionTablet, guardarSesionTablet } from '../services/tablet'
import useOnlineStatus from '../services/useOnlineStatus'

/**
 * TABLET DEL TRACTOR (APK "Tractor Nintanga"): la misma interfaz del kiosko
 * de la Raspberry (pi-zero-2w/kiosk_app.py):
 *   cedula (teclado numerico) -> codigo de 4 digitos -> checklist previo al
 *   uso -> actividades de hoy (tabla a la izquierda, formulario a la derecha)
 *   -> Finalizar jornada (vuelve al codigo del mismo tractorista).
 * Funciona SIN INTERNET: todo se guarda en la tablet con su hora real y se
 * envia al volver la señal (misma cola y mismos endpoints que la bitacora web),
 * cada accion con la sesion del tractorista que la hizo.
 */
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8007'
const CLAVE_CEDULAS = 'oa_kiosko_cedulas'    // cedula -> usuario, para entrar sin internet
const CLAVE_CHECK = 'oa_kiosko_check'        // checklist hecho en esta tablet (aunque aun no llegue al servidor)

// Mismos puntos y mismo orden que el kiosko de la Raspberry (campos de la tabla check)
const CHECKLIST = [
  ['insp_motor', 'Motor'],
  ['insp_aceite_motor', 'Nivel de aceite del motor'],
  ['insp_refrigerante', 'Nivel de refrigerante'],
  ['insp_aceite_hidraulico', 'Nivel de aceite hidráulico'],
  ['insp_fugas_hidraulico', 'Sistema hidráulico sin fugas'],
  ['insp_transmisiones', 'Transmisión'],
  ['insp_neumaticos', 'Neumáticos'],
  ['insp_fisuras', 'Componentes estructurales'],
  ['limp_radiador', 'Limpieza del radiador'],
  ['limp_cabina', 'Limpieza de cabina'],
  ['lub_articulaciones', 'Lubricación de articulaciones'],
  ['insp_bomba_hidraulica', 'Bomba hidráulica'],
  ['insp_indicadores_tablero', 'Sin alertas o indicadores encendidos en el tablero'],
  ['insp_frenos', 'Sistema de frenos'],
  ['insp_fallo_electrico', 'Sistema eléctrico'],
  ['limp_motor_filtros', 'Limpieza de motor y filtros'],
  ['limp_frenos', 'Limpieza de frenos'],
  ['lub_pines_bocines', 'Lubricación de pines y bocines'],
]
const APOYOS = 'APOYOS GENERALES'
const COLOR_ESTADO = { 'Ejecutándose': 'var(--verde)', Pausado: 'var(--naranja)', Pendiente: '#555' }

const leer = (k, def) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? def } catch { return def } }
const sinAcentos = t => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const esSinRed = err => err instanceof TypeError || err?.name === 'AbortError'
const conPlazo = (url, opciones, ms = 6000) => {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  return fetch(url, { ...opciones, signal: ctrl.signal }).finally(() => clearTimeout(t))
}
const postJson = (url, body) => conPlazo(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

/** Las que EMPIEZAN con lo buscado primero (buscar "2." trae "2.1" antes que "32.2"). */
const filtrar = (opciones, texto, de = o => o) => {
  const q = sinAcentos(texto.trim())
  return opciones.filter(o => sinAcentos(de(o)).includes(q))
    .sort((a, b) => (sinAcentos(de(a)).startsWith(q) ? 0 : 1) - (sinAcentos(de(b)).startsWith(q) ? 0 : 1))
}

/** Tiempo trabajado: suma de los tramos inicio/reanudado -> pausado/finalizado. */
function tiempoDe(r) {
  if (!['Ejecutándose', 'Pausado'].includes(r.estado)) return '-'
  let total = 0; let desde = null
  for (const ev of r.fecha_historial || []) {
    const f = new Date(ev.fecha).getTime()
    if (Number.isNaN(f)) continue
    if (ev.accion === 'inicio' || ev.accion === 'reanudado') desde = f
    else if ((ev.accion === 'pausado' || ev.accion === 'finalizado') && desde != null) { total += f - desde; desde = null }
  }
  if (r.estado === 'Ejecutándose' && desde != null) total += Date.now() - desde
  const s = Math.max(0, Math.floor(total / 1000))
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, '0')).join(':')
}
const hora = f => (f ? String(f).slice(11, 16) : '')

// Tractoristas que ya entraron en esta tablet: se eligen por nombre y entran solo con su codigo
const CLAVE_CONOCIDOS = 'oa_kiosko_conocidos'
const conocidos = () => leer(CLAVE_CONOCIDOS, [])
function recordar(u) {
  const otros = conocidos().filter(c => c.username !== u.username)
  localStorage.setItem(CLAVE_CONOCIDOS, JSON.stringify([{ cedula: u.cedula, username: u.username, nombre: u.nombre }, ...otros].slice(0, 30)))
}
function olvidar(username) {
  localStorage.setItem(CLAVE_CONOCIDOS, JSON.stringify(conocidos().filter(c => c.username !== username)))
}

async function verificarCedula(cedula, username = null) {
  try {
    const res = await postJson(`${API_URL}/api/tractoristas/verificar`, { cedula })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(d.detail || 'Cédula no registrada')
    if (username && d.username.toLowerCase() !== username.trim().toLowerCase()) {
      throw new Error('El usuario y la cédula no coinciden')
    }
    localStorage.setItem(CLAVE_CEDULAS, JSON.stringify({ ...leer(CLAVE_CEDULAS, {}), [cedula]: d.username }))
    return { cedula, username: d.username, nombre: d.nombre, tienePin: !!d.tiene_pin, temporal: !!d.requiere_temporal, sinRed: false }
  } catch (err) {
    const guardado = leer(CLAVE_CEDULAS, {})[cedula]
    if (esSinRed(err) && guardado && hayIngresoOffline(guardado) && (!username || guardado === username.trim().toLowerCase())) {
      return { cedula, username: guardado, nombre: nombreGuardado(guardado), tienePin: true, temporal: false, sinRed: true }
    }
    throw esSinRed(err) ? new Error('Sin conexión. La primera vez debe ingresar con internet.') : err
  }
}

// ======================================================================
function Teclado({ onDigito, onBorrar, onOk, ocupado }) {
  return (
    <div className="k-teclado">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n, i) => (
        <button key={n} className="k-tecla" style={{ gridRow: Math.floor(i / 3) + 1, gridColumn: (i % 3) + 1 }} onClick={() => onDigito(n)}>{n}</button>
      ))}
      <button className="k-tecla ok" style={{ gridRow: 1, gridColumn: 4 }} onClick={onOk} disabled={ocupado}>
        {ocupado ? <i className="bx bx-loader-alt bx-spin"></i> : 'OK'}
      </button>
      <button className="k-tecla borrar" style={{ gridRow: 2, gridColumn: 4 }} onClick={onBorrar} aria-label="Borrar">⌫</button>
      <button className="k-tecla" style={{ gridRow: 3, gridColumn: 4 }} onClick={() => onDigito('0')}>0</button>
    </div>
  )
}

/** Inicio: los tractoristas que ya entraron en esta tablet (tocan su nombre y ponen su codigo). */
function PantallaQuien({ onElegir, onOtro }) {
  const lista = conocidos()
  return (
    <div className="k-centro">
      <div className="k-tarjeta k-quien">
        <div className="k-tarjeta-cab"><h1>Operaciones Agrícolas</h1><p>¿Quién maneja hoy?</p></div>
        <div className="k-tarjeta-cuerpo">
          <div className="k-quien-lista">
            {lista.map(c => (
              <button key={c.username} className="k-quien-nombre" onClick={() => onElegir(c)}>
                <span className="inicial">{(c.nombre || c.username).charAt(0)}</span>{c.nombre || c.username}
              </button>
            ))}
          </div>
          <button className="k-btn suave" style={{ width: '100%' }} onClick={onOtro}>
            <i className="bx bx-user-plus"></i> Otro tractorista / crear código
          </button>
        </div>
      </div>
    </div>
  )
}

/** Primera vez en esta tablet (o crear codigo nuevo): usuario nombre.apellido + cedula. */
function PantallaCedula({ onListo, onVolver }) {
  const [username, setUsername] = useState('')
  const [cedula, setCedula] = useState('')
  const [msg, setMsg] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const continuar = async () => {
    if (!username.trim()) return setMsg('Escriba su usuario (nombre.apellido)')
    if (cedula.length !== 10) return setMsg(cedula ? 'La cédula debe tener 10 dígitos' : 'Ingrese su cédula')
    setOcupado(true); setMsg('')
    try { onListo(await verificarCedula(cedula, username)) } catch (e) { setMsg(e.message) } finally { setOcupado(false) }
  }
  return (
    <div className="k-centro">
      {onVolver ? <button className="k-lateral" onClick={onVolver}>Volver</button> : null}
      <div className="k-tarjeta">
        <div className="k-tarjeta-cab"><h1>Operaciones Agrícolas</h1><p>Acceso Tractoristas</p></div>
        <div className="k-tarjeta-cuerpo">
          <label className="k-etiqueta" htmlFor="kiosko-usuario">USUARIO</label>
          <input id="kiosko-usuario" className="k-campo-num k-campo-texto" placeholder="nombre.apellido" autoCapitalize="none"
            autoComplete="off" value={username} onChange={e => { setMsg(''); setUsername(e.target.value.toLowerCase().replace(/\s/g, '')) }} />
          <span className="k-etiqueta">CÉDULA</span>
          <div className="k-campo-num" id="kiosko-cedula">{cedula}</div>
          <Teclado ocupado={ocupado} onOk={continuar}
            onDigito={n => { setMsg(''); setCedula(c => (c.length < 10 ? c + n : c)) }}
            onBorrar={() => { setMsg(''); setCedula('') }} />
          <div className="k-msg">{msg}</div>
        </div>
      </div>
      {onVolver ? <div style={{ width: 220 }}></div> : null}
    </div>
  )
}

/**
 * Codigo de 4 digitos. Si aun no tiene (primera vez) lo crea; si lo olvido,
 * con el codigo TEMPORAL de 6 digitos que da el supervisor (Catalogos >
 * Tractoristas) crea uno nuevo. Sin internet entra contra la huella guardada.
 */
function PantallaCodigo({ usuario, onEntrar, onCambiarUsuario }) {
  const [u, setU] = useState(usuario)
  // paso: 'temporal' (6 digitos) | 'nuevo' | 'confirmar' | 'ingresar'
  const pasoInicial = x => (x.temporal ? 'temporal' : x.tienePin ? 'ingresar' : 'nuevo')
  const [paso, setPaso] = useState(pasoInicial(usuario))
  const [valor, setValor] = useState('')
  const [temporal, setTemporal] = useState('')
  const [nuevo, setNuevo] = useState('')
  const [msg, setMsg] = useState({ texto: '', ok: false })
  const [ocupado, setOcupado] = useState(false)
  const largo = paso === 'temporal' ? 6 : 4
  useEffect(() => { setU(usuario); setPaso(pasoInicial(usuario)); setValor('') }, [usuario])

  const titulo = { temporal: 'Ingrese el código temporal de su supervisor', nuevo: 'Cree un código de 4 dígitos',
    confirmar: 'Confirme su código', ingresar: 'Ingrese su código' }[paso]
  const error = texto => { setMsg({ texto, ok: false }); setValor('') }

  const entrar = async () => {
    setOcupado(true)
    try {
      if (u.sinRed || navigator.onLine === false) {
        await ingresarOffline(u.username, valor)
      } else {
        let res
        try {
          res = await postJson(`${API_URL}/api/tractoristas/login`, { username: u.username, pin: valor,
            dispositivo: llaveDispositivo(), dispositivo_nombre: nombreDispositivo() })
        } catch (err) {
          if (esSinRed(err) && hayIngresoOffline(u.username)) { await ingresarOffline(u.username, valor); recordar(u); return onEntrar(u) }
          throw esSinRed(err) ? new Error('Sin conexión. La primera vez debe ingresar con internet.') : err
        }
        const d = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(d.detail || 'Código incorrecto')
        guardarSesionTablet(d.username, d.token)
        await guardarIngresoOffline(u.username, valor, d.nombre)
        localStorage.setItem('usuario_nombre', d.nombre || '')
        localStorage.setItem('usuario_username', d.username || u.username)
        localStorage.setItem('usuario_tipo', 'tractorista')
        u.nombre = d.nombre || u.nombre
      }
      recordar(u)
      onEntrar(u)
    } catch (e) { error(e.message) } finally { setOcupado(false) }
  }

  const crear = async () => {
    setOcupado(true)
    try {
      const res = await postJson(`${API_URL}/api/tractoristas/registro`, { username: u.username, cedula: u.cedula, pin: valor,
        codigo_temporal: temporal || null })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.detail || 'No se pudo guardar el código')
      setU({ ...u, tienePin: true, temporal: false }); setTemporal(''); setNuevo('')
      setPaso('ingresar'); setValor('')
      setMsg({ texto: '✓ Código guardado. Ingrese con su código nuevo.', ok: true })
    } catch (e) {
      setPaso(u.temporal ? 'temporal' : 'nuevo'); setTemporal(''); setNuevo('')
      error(esSinRed(e) ? 'Sin conexión: para crear el código se necesita internet.' : e.message)
    } finally { setOcupado(false) }
  }

  const ok = () => {
    if (valor.length !== largo) return setMsg({ texto: `Ingrese los ${largo} dígitos`, ok: false })
    setMsg({ texto: '', ok: false })
    if (paso === 'temporal') { setTemporal(valor); setPaso('nuevo'); setValor(''); return }
    if (paso === 'nuevo') { setNuevo(valor); setPaso('confirmar'); setValor(''); return }
    if (paso === 'confirmar') {
      if (valor !== nuevo) { setPaso('nuevo'); setNuevo(''); return error('Los códigos no coinciden. Créelo de nuevo.') }
      return crear()
    }
    entrar()
  }

  const olvide = () => {
    if (u.sinRed) return setMsg({ texto: 'Sin conexión: pida ayuda a su supervisor cuando haya señal.', ok: false })
    setU({ ...u, temporal: true }); setPaso('temporal'); setValor(''); setMsg({ texto: '', ok: false })
  }

  return (
    <div className="k-centro">
      <button className="k-lateral" onClick={onCambiarUsuario}>Cambiar usuario</button>
      <div className="k-tarjeta">
        <div className="k-acento"></div>
        <div className="k-tarjeta-cuerpo">
          <div className="k-hola">Hola, {u.nombre}</div>
          {u.sinRed && <div className="k-aviso"><i className="bx bx-wifi-off"></i> Sin conexión: ingrese con su código. Lo registrado se enviará al volver la señal.</div>}
          <div className="k-subtitulo">{titulo}</div>
          <div className="k-puntos">
            {Array.from({ length: largo }, (_, i) => <div key={i} className={`k-punto${i < valor.length ? ' lleno' : ''}`}>{i < valor.length ? '•' : ''}</div>)}
          </div>
          <Teclado ocupado={ocupado} onOk={ok}
            onDigito={n => { setMsg({ texto: '', ok: false }); setValor(v => (v.length < largo ? v + n : v)) }}
            onBorrar={() => setValor(v => v.slice(0, -1))} />
          <div className={`k-msg${msg.ok ? ' ok' : ''}`}>{msg.texto}</div>
        </div>
      </div>
      {paso === 'ingresar'
        ? <button className="k-lateral" onClick={olvide}>Olvidé mi código</button>
        : <div style={{ width: 220 }}></div>}
    </div>
  )
}

// ======================================================================
function Checklist({ onConfirmar }) {
  const [marcas, setMarcas] = useState({})
  const [enviando, setEnviando] = useState(false)
  const marcados = CHECKLIST.filter(([k]) => marcas[k]).length
  const todo = marcados === CHECKLIST.length
  return (
    <div className="k-checklist">
      <div className="k-fila-titulo">
        <h2>Checklist previo al uso</h2>
        <button className="k-btn suave" onClick={() => setMarcas(todo ? {} : Object.fromEntries(CHECKLIST.map(([k]) => [k, true])))}>
          {todo ? '✓ Todos' : '☐ Todos'}
        </button>
        <button className={`k-btn${todo ? '' : ' rojo'}`} disabled={enviando}
          onClick={async () => { setEnviando(true); await onConfirmar(marcas); setEnviando(false) }}>
          {todo ? 'Confirmar e ingresar' : 'Continuar e ingresar (con fallas)'}
        </button>
      </div>
      <div className="k-ayuda-check">
        <span>Marque solo si está en buen estado. Lo sin marcar se reporta como falla.</span>
        <span className={`progreso${todo ? ' todo' : ''}`}>
          {todo ? `✓ ${marcados}/${CHECKLIST.length} puntos en buen estado`
            : `${marcados}/${CHECKLIST.length} marcados — ${CHECKLIST.length - marcados} se reportarán como falla`}
        </span>
      </div>
      <div className="k-check-grid">
        {CHECKLIST.map(([k, texto]) => (
          <button key={k} className={`k-check-item${marcas[k] ? ' si' : ''}`} onClick={() => setMarcas(m => ({ ...m, [k]: !m[k] }))}>
            <span className="k-caja">{marcas[k] ? '✓' : ''}</span>{texto}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Campo con lista de sugerencias (botones grandes para el dedo) y ✕ para vaciarlo. */
function CampoSugerencias({ id, valor, onCambiar, opciones, onElegir, deshabilitado, placeholder }) {
  const [abierto, setAbierto] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const fuera = e => { if (ref.current && !ref.current.contains(e.target)) setAbierto(false) }
    document.addEventListener('pointerdown', fuera)
    return () => document.removeEventListener('pointerdown', fuera)
  }, [])
  return (
    <div className="k-campo" ref={ref}>
      <input id={id} value={valor} disabled={deshabilitado} placeholder={placeholder} autoComplete="off"
        onFocus={() => setAbierto(true)} onChange={e => { onCambiar(e.target.value); setAbierto(true) }} />
      {!deshabilitado && <button className="limpiar" onClick={() => { onCambiar(''); setAbierto(true) }} aria-label="Vaciar">✕</button>}
      {abierto && !deshabilitado && opciones.length > 0 && (
        <div className="k-sugerencias">
          {opciones.slice(0, 40).map((o, i) => (
            <button key={`${o.texto}-${i}`} onClick={() => { onElegir(o); setAbierto(false) }}>{o.texto}</button>
          ))}
        </div>
      )}
    </div>
  )
}

const FORM_VACIO = { actividad: '', subactividad: '', loteTexto: '', lote: null, apero: '' }

function Trabajo({ usuario, tractor, onFinJornada, onBloquear }) {
  const nombre = usuario.nombre
  const { isOnline } = useOnlineStatus()
  const [pendientes, setPendientes] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [checkHecho, setCheckHecho] = useState(false)
  const [idCheck, setIdCheck] = useState(null)
  const [registros, setRegistros] = useState([])
  const [catalogo, setCatalogo] = useState({ culturales: [], apoyos: [], aperos: [] })
  const [form, setForm] = useState(FORM_VACIO)
  const [lotes, setLotes] = useState([])
  const [sel, setSel] = useState(null)              // fila elegida en la tabla
  const [nuevo, setNuevo] = useState(false)          // formulario para una actividad nueva (si no, muestra la activa)
  const [msg, setMsg] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [, setTick] = useState(0)

  const avisar = (t, ms = 4000) => { setMsg(t); setTimeout(() => setMsg(m => (m === t ? '' : m)), ms) }
  const contarPendientes = () => getPendingCount().then(setPendientes).catch(() => {})

  const cargar = useCallback(async () => {
    const [regs, acts, aperos, checks] = await Promise.all([
      fetchWithOffline(`${API_URL}/api/registros`, 'registros'),
      fetchWithOffline(`${API_URL}/api/actividades`, 'actividades'),
      fetchWithOffline(`${API_URL}/api/aperos`, 'aperos'),
      fetchWithOffline(`${API_URL}/api/checks`, 'checks'),
    ])
    const lista = (await mezclar(Array.isArray(regs.data) ? regs.data : []))
      .filter(r => (r.equipo || 'Tractores') === 'Tractores' && r.usuario === nombre && r.tractor === tractor
        && !['Finalizado', 'Eliminado'].includes(r.estado))
      .sort((a, b) => String(b.fecha_creacion).localeCompare(String(a.fecha_creacion)))
    setRegistros(lista)
    const deTractor = (Array.isArray(acts.data) ? acts.data : []).filter(a => (a.equipo || 'Tractores') === 'Tractores')
    setCatalogo({
      culturales: deTractor.filter(a => a.tipo === 'Actividades Culturales'),
      apoyos: deTractor.filter(a => a.tipo === 'Apoyos Generales'),
      aperos: Array.isArray(aperos.data) ? aperos.data : [],
    })
    const delServidor = (Array.isArray(checks.data) ? checks.data : [])
      .find(c => c.tractor === tractor && c.estado === 'Activo' && c.usuario === nombre)
    const local = leer(CLAVE_CHECK, null)
    const localVale = local && local.tractor === tractor && local.usuario === nombre
    setIdCheck(delServidor?.id || null)
    // Hay registros abiertos: ya paso el checklist (aunque se haya hecho en otro equipo)
    setCheckHecho(!!delServidor || localVale || lista.some(r => r.estado !== 'Pendiente'))
    setCargando(false)
  }, [nombre, tractor])

  useEffect(() => { cargar(); contarPendientes() }, [cargar])
  useEffect(() => { const t = setInterval(() => setTick(n => n + 1), 1000); return () => clearInterval(t) }, [])

  // Envio de lo guardado sin internet: al volver la señal y cada 30 s
  useEffect(() => {
    const enviar = async () => {
      if (!navigator.onLine) return
      try { const { synced } = await processQueue(); if (synced > 0) await cargar() } catch { /* se reintenta */ }
      contarPendientes()
    }
    enviar()
    const t = setInterval(enviar, 30000)
    return () => clearInterval(t)
  }, [isOnline, cargar])

  // Todos los lotes en la tablet para buscar sin internet (con señal, como mucho una vez por hora)
  useEffect(() => {
    if (!navigator.onLine || Date.now() - Number(localStorage.getItem('oa_precarga_lotes') || 0) < 3600000) return
    fetchConTimeout(`${API_URL}/api/lotes-infx`, 30000)
      .then(async r => { if (r.ok) { await cacheData('lotes_all', await r.json()); localStorage.setItem('oa_precarga_lotes', String(Date.now())) } })
      .catch(() => {})
  }, [])

  // ---- envio: primero en la tablet (se ve al instante), luego al servidor o a la cola ----
  const enviar = async (url, metodo, body, descripcion) => {
    try {
      const res = await conPlazo(url, { method: metodo, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }, 8000)
      if (res.ok) return res
      if (res.status >= 400 && res.status < 500 && res.status !== 401) {
        const d = await res.json().catch(() => ({}))
        throw Object.assign(new Error(typeof d.detail === 'string' ? d.detail : `Error ${res.status}`), { definitivo: true })
      }
    } catch (e) { if (e.definitivo) throw e }
    await addToQueue(url, metodo, body, 'registro', descripcion)
    contarPendientes()
    return null
  }
  const ejecutarLocal = async (reg, cambios, metodo, url, body, descripcion) => {
    const actualizado = { ...reg, ...cambios }
    await guardarLocal(actualizado)
    setRegistros(prev => {
      const resto = prev.filter(r => claveRegistro(r) !== claveRegistro(reg))
      return ['Eliminado', 'Finalizado'].includes(actualizado.estado) ? resto : [actualizado, ...resto]
    })
    // Si ese registro ya tiene acciones en cola, la nueva va detras (orden)
    let enCola = false
    try {
      enCola = (await getPendingItems()).some(p => (reg.cliente_id && `${p.url} ${JSON.stringify(p.body || {})}`.includes(reg.cliente_id))
        || (!reg.cliente_id && reg.id && String(p.url).includes(`/api/registros/${reg.id}`)))
    } catch { enCola = false }
    if (enCola) { await addToQueue(url, metodo, body, 'registro', descripcion); contarPendientes(); return null }
    return enviar(url, metodo, body, descripcion)
  }

  // ---- checklist ----
  const confirmarChecklist = async (marcas) => {
    const body = { usuario: nombre, fecha: ahoraLocal(), tractor, estado: 'Activo', ubicacion: await ubicacionTablet(),
      ...Object.fromEntries(CHECKLIST.map(([k]) => [k, !!marcas[k]])) }
    try {
      const res = await enviar(`${API_URL}/api/checks`, 'POST', body, 'Checklist de inspección')
      if (res) { const d = await res.json().catch(() => null); if (d?.id) setIdCheck(d.id) }
    } catch (e) { avisar(e.message) }
    localStorage.setItem(CLAVE_CHECK, JSON.stringify({ tractor, usuario: nombre, fecha: body.fecha }))
    setCheckHecho(true)
  }

  // ---- formulario ----
  const opcionesActividad = [...catalogo.culturales.map(a => a.actividad), APOYOS]
  const subactividades = form.actividad === APOYOS
    ? catalogo.apoyos.map(a => a.actividad)
    : (catalogo.culturales.find(a => a.actividad === form.actividad)?.subactividades || [])
  const textoApero = a => `${a.numeracion || ''} - ${a.tipo_implemento || ''}`
  const textoLote = l => `${l.ocult_cod_ocult} / ${l.lote || ''} / ${l.hacienda || ''}`
  const loteDe = r => ({ lote: r.lote, hacienda: r.hacienda, ocult_cod_ocult: r.orden_cultivo })
  const loteVisible = r => `${r.lote || ''} ${r.hacienda || ''}`.trim() || r.orden_cultivo || ''

  const buscarLotes = async (texto) => {
    setForm(f => ({ ...f, loteTexto: texto, lote: null }))
    if (texto.trim().length < 2) return setLotes([])
    try {
      const res = await fetchConTimeout(`${API_URL}/api/lotes-infx/buscar?ocult=${encodeURIComponent(texto.trim())}`, 5000)
      if (!res.ok) throw new Error()
      setLotes(await res.json())
    } catch {
      const todos = (await getCachedData('lotes_all').catch(() => null)) || []
      setLotes(filtrar(todos, texto, l => `${l.ocult_cod_ocult} ${l.lote || ''} ${l.hacienda || ''}`).slice(0, 40))
    }
  }

  const ejecutando = registros.find(r => r.estado === 'Ejecutándose')
  const activo = registros.find(r => r.estado === 'Ejecutándose' || r.estado === 'Pausado')
  const vista = sel ? registros.find(r => claveRegistro(r) === sel) : (!nuevo ? activo : null)
  const enVista = !!vista

  const validar = () => (!form.actividad.trim() ? 'Seleccione una actividad'
    : !form.subactividad.trim() ? 'Seleccione una subactividad'
      : !form.lote ? 'Seleccione un lote / orden de cultivo de la lista' : null)

  const crear = async (estado) => {
    const error = validar()
    if (error) return avisar(error)
    if (estado === 'Ejecutándose' && ejecutando) return avisar('Ya tiene una actividad en ejecución. Páusela o finalícela antes de iniciar otra.')
    setOcupado(true)
    try {
      const fecha = ahoraLocal()
      const ubicacion = estado === 'Ejecutándose' ? await ubicacionTablet() : null
      const reg = {
        cliente_id: nuevoClienteId(), id: null, equipo: 'Tractores', estado, fecha_creacion: fecha, tractor,
        apero: form.apero.trim(), lote: form.lote.lote || '', hacienda: form.lote.hacienda || '', orden_cultivo: form.lote.ocult_cod_ocult || '',
        actividad: form.actividad, subactividad: form.subactividad, usuario: nombre, ubicacion, id_check: idCheck,
        tipo: form.actividad === APOYOS ? 'Apoyos Generales' : 'Actividades Culturales',
        fecha_historial: estado === 'Ejecutándose' ? [{ accion: 'inicio', fecha, ubicacion }] : [],
        tiempo_inicio: estado === 'Ejecutándose' ? fecha : null, tiempo_real: 0, tiempo_paro: 0, revision_estado: 'NO_REVISADO',
      }
      const { cliente_id, apero, lote, hacienda, orden_cultivo, actividad, subactividad, usuario, id_check, tipo } = reg
      await ejecutarLocal(reg, {}, 'POST', `${API_URL}/api/registros`,
        { cliente_id, fecha, tractor, apero, lote, hacienda, orden_cultivo, actividad, subactividad, usuario, ubicacion, id_check, tipo, estado, equipo: 'Tractores' },
        estado === 'Pendiente' ? 'Agregar actividad' : 'Iniciar actividad')
      setSel(null)
      if (estado === 'Pendiente') { setForm(f => ({ ...FORM_VACIO, loteTexto: f.loteTexto, lote: f.lote, apero: f.apero })); setNuevo(true) } else setNuevo(false)
    } catch (e) { avisar(e.message) } finally { setOcupado(false) }
  }

  const cambiarEstado = async (reg, estado, descripcion) => {
    if (estado === 'Ejecutándose' && ejecutando && claveRegistro(ejecutando) !== claveRegistro(reg)) {
      return avisar('Ya tiene una actividad en ejecución. Páusela o finalícela antes de iniciar otra.')
    }
    setOcupado(true)
    try {
      const fecha = ahoraLocal()
      const ubicacion = await ubicacionTablet()
      const cambios = {
        estado, fecha_historial: [...(reg.fecha_historial || []), { accion: accionDe(reg.estado, estado), fecha, ubicacion }],
        ...(estado === 'Finalizado' ? { fecha_fin: fecha } : {}),
        ...(estado === 'Ejecutándose' && reg.estado === 'Pendiente' ? { tiempo_inicio: fecha } : {}),
      }
      await ejecutarLocal(reg, cambios, 'PUT', urlRegistro(API_URL, reg), { estado, ubicacion, fecha }, descripcion)
      if (estado === 'Finalizado') { setSel(null); setNuevo(true); setForm(FORM_VACIO) } else { setSel(null); setNuevo(false) }
    } catch (e) { avisar(e.message) } finally { setOcupado(false) }
  }

  const eliminar = async (reg) => {
    setOcupado(true)
    try {
      await ejecutarLocal(reg, { estado: 'Eliminado' }, 'DELETE', urlRegistro(API_URL, reg), null, 'Eliminar registro')
      setSel(null); setNuevo(true)
    } catch (e) { avisar(e.message) } finally { setOcupado(false) }
  }

  // Nueva actividad con la misma orden de cultivo de la fila vista (editable)
  const agregarNuevo = () => {
    const base = vista
    setSel(null); setNuevo(true)
    setForm(base ? { ...FORM_VACIO, loteTexto: loteVisible(base), lote: loteDe(base), apero: base.apero || '' } : FORM_VACIO)
  }

  const finalizarJornada = async () => {
    setOcupado(true)
    try { await enviar(`${API_URL}/api/checks/desactivar-tractor/${encodeURIComponent(tractor)}`, 'PUT', {}, 'Finalizar jornada') } catch { /* igual se cierra */ }
    localStorage.removeItem(CLAVE_CHECK)
    setOcupado(false)
    onFinJornada()
  }

  const valoresForm = enVista
    ? { actividad: vista.actividad, subactividad: vista.subactividad || '', loteTexto: loteVisible(vista), apero: vista.apero || '' }
    : form
  const estadoVisto = enVista ? vista.estado : null

  return (
    <>
      <header className="k-cabecera">
        <div>
          <div className="tractor">{tractor}</div>
          <div className="operador">{nombre}</div>
        </div>
        <div className="espacio"></div>
        <div className={`k-estado-red${isOnline ? '' : ' sin'}`}>
          <i className={`bx ${isOnline ? 'bx-wifi' : 'bx-wifi-off'}`}></i>
          {isOnline ? 'En línea' : 'Sin conexión'}{pendientes > 0 ? ` · ${pendientes} por enviar` : ''}
        </div>
        <button className="k-btn-cab" onClick={onBloquear}><i className="bx bx-lock-alt"></i> Bloquear</button>
      </header>

      <div className="k-cuerpo">
        {cargando ? <div className="k-centro"><i className="bx bx-loader-alt bx-spin" style={{ fontSize: '2.5rem', color: 'var(--morado)' }}></i></div>
          : !checkHecho ? <Checklist onConfirmar={confirmarChecklist} />
            : (
              <>
                <section className="k-izq">
                  <h3>Actividades de hoy</h3>
                  <div className="k-tabla-cont">
                    <table className="k-tabla">
                      <thead><tr><th className="centro">Creada / Inicio</th><th>Actividad</th><th>Subactividad</th><th className="centro">Tiempo</th></tr></thead>
                      <tbody>
                        {registros.map(r => {
                          const k = claveRegistro(r)
                          const creada = hora(r.fecha_creacion); const inicio = hora(r.tiempo_inicio)
                          return (
                            <tr key={k} className={`${r.estado}${vista && claveRegistro(vista) === k ? ' sel' : ''}`}
                              onClick={() => { setSel(k); setNuevo(false) }}
                              onDoubleClick={() => r.estado === 'Pendiente' && cambiarEstado(r, 'Ejecutándose', 'Iniciar actividad')}>
                              <td className="centro">{inicio && inicio !== creada ? `${creada} / ${inicio}` : creada}</td>
                              <td>{r.actividad}</td>
                              <td>{r.subactividad || '-'}</td>
                              <td className="centro">{tiempoDe(r)}</td>
                            </tr>
                          )
                        })}
                        {registros.length === 0 && <tr><td colSpan="4" className="vacio">Sin actividades. Llene el formulario y toque Iniciar.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  <div className="k-pie-izq">
                    <span>Toque una fila para verla. Doble toque en una "Pendiente" para iniciarla.</span>
                    <span className="espacio"></span>
                    {vista?.estado === 'Pendiente' && <button className="k-btn-chico eliminar" disabled={ocupado} onClick={() => eliminar(vista)}>🗑 Eliminar</button>}
                    <button className="k-btn-chico" disabled={ocupado} onClick={enVista ? agregarNuevo : () => crear('Pendiente')}>
                      {enVista ? 'Agregar nuevo' : '＋ Agregar actividad'}
                    </button>
                    <button className="k-btn-chico jornada" disabled={ocupado || registros.length > 0} onClick={finalizarJornada}
                      title={registros.length ? 'Finalice todas las actividades primero' : ''}>Finalizar jornada</button>
                  </div>
                </section>

                <section className="k-form">
                  <div className="k-form-titulo">
                    <h3>{enVista ? 'Actividad' : 'Ingresar Actividad'}</h3>
                    <span className="k-estado" style={{ color: COLOR_ESTADO[estadoVisto || activo?.estado] || 'var(--gris)' }}>
                      ● {estadoVisto || (activo ? activo.estado : 'Sin actividad activa')}
                    </span>
                  </div>
                  <div className="k-form-msg">{msg}</div>

                  <label htmlFor="k-actividad">Actividad</label>
                  <CampoSugerencias id="k-actividad" valor={valoresForm.actividad} deshabilitado={enVista}
                    onCambiar={v => setForm(f => ({ ...f, actividad: v, subactividad: '' }))}
                    opciones={filtrar(opcionesActividad, form.actividad).map(t => ({ texto: t }))}
                    onElegir={o => setForm(f => ({ ...f, actividad: o.texto, subactividad: '' }))} />

                  <label htmlFor="k-subactividad">Subactividad</label>
                  <CampoSugerencias id="k-subactividad" valor={valoresForm.subactividad} deshabilitado={enVista || !form.actividad}
                    onCambiar={v => setForm(f => ({ ...f, subactividad: v }))}
                    opciones={filtrar(subactividades, form.subactividad).map(t => ({ texto: t }))}
                    onElegir={o => setForm(f => ({ ...f, subactividad: o.texto }))} />

                  <label htmlFor="k-lote">Lote / Orden de cultivo</label>
                  <CampoSugerencias id="k-lote" valor={valoresForm.loteTexto} deshabilitado={enVista} placeholder="Escriba la orden o el lote"
                    onCambiar={buscarLotes}
                    opciones={lotes.map(l => ({ texto: textoLote(l), lote: l }))}
                    onElegir={o => setForm(f => ({ ...f, lote: o.lote, loteTexto: `${o.lote.lote || ''} ${o.lote.hacienda || ''}`.trim() }))} />

                  <label htmlFor="k-apero">Apero</label>
                  <CampoSugerencias id="k-apero" valor={valoresForm.apero} deshabilitado={enVista}
                    onCambiar={v => setForm(f => ({ ...f, apero: v }))}
                    opciones={filtrar(catalogo.aperos, form.apero, a => `${a.numeracion || ''} ${a.nombre || ''} ${a.tipo_implemento || ''}`).map(a => ({ texto: textoApero(a) }))}
                    onElegir={o => setForm(f => ({ ...f, apero: o.texto }))} />

                  <div className="k-botonera">
                    {!enVista && <button className="k-btn" disabled={ocupado} onClick={() => crear('Ejecutándose')}>Iniciar</button>}
                    {estadoVisto === 'Pendiente' && <button className="k-btn" disabled={ocupado} onClick={() => cambiarEstado(vista, 'Ejecutándose', 'Iniciar actividad')}>Iniciar</button>}
                    {estadoVisto === 'Ejecutándose' && <button className="k-btn gris" disabled={ocupado} onClick={() => cambiarEstado(vista, 'Pausado', 'Pausar actividad')}>Pausar</button>}
                    {estadoVisto === 'Pausado' && <button className="k-btn" disabled={ocupado} onClick={() => cambiarEstado(vista, 'Ejecutándose', 'Reanudar actividad')}>Reanudar</button>}
                    {(estadoVisto === 'Ejecutándose' || estadoVisto === 'Pausado') &&
                      <button className="k-btn rojo" disabled={ocupado} onClick={() => cambiarEstado(vista, 'Finalizado', 'Finalizar actividad')}>Finalizar</button>}
                  </div>
                </section>
              </>
            )}
      </div>
    </>
  )
}

// ======================================================================
function KioskoTablet() {
  const tractor = tractorFijo()
  const [usuario, setUsuario] = useState(null)
  // quien (lista de los que ya entraron) | cedula (usuario + cedula) | codigo | trabajo
  const [pantalla, setPantalla] = useState(conocidos().length ? 'quien' : 'cedula')

  // Lo guardado sin internet se envia en CUALQUIER pantalla: si apagaron la
  // tablet en el campo, sube al prenderla en el patio (con señal).
  useEffect(() => {
    const enviar = () => { if (navigator.onLine) processQueue().catch(() => {}) }
    enviar()
    const t = setInterval(enviar, 30000)
    window.addEventListener('online', enviar)
    return () => { clearInterval(t); window.removeEventListener('online', enviar) }
  }, [])

  const elegir = (c) => {
    const sinRed = navigator.onLine === false
    setUsuario({ ...c, tienePin: true, temporal: false, sinRed: sinRed && hayIngresoOffline(c.username) })
    setPantalla('codigo')
    // Con señal se confirma el estado de su codigo (temporal pendiente, dado de baja...)
    if (!sinRed && c.cedula) {
      verificarCedula(c.cedula).then(setUsuario).catch(e => {
        if (!esSinRed(e) && /inactiv|no registrad|no encontrad/i.test(e.message)) { olvidar(c.username); setPantalla('quien') }
      })
    }
  }
  const salir = () => {
    ;['usuario_nombre', 'usuario_username', 'usuario_tipo'].forEach(k => localStorage.removeItem(k))
    setUsuario(null); setPantalla(conocidos().length ? 'quien' : 'cedula')
  }

  return (
    <div className="kiosko">
      {pantalla === 'quien' && <PantallaQuien onElegir={elegir} onOtro={() => setPantalla('cedula')} />}
      {pantalla === 'cedula' && <PantallaCedula onListo={u => { setUsuario(u); setPantalla('codigo') }}
        onVolver={conocidos().length ? () => setPantalla('quien') : null} />}
      {pantalla === 'codigo' && usuario && <PantallaCodigo usuario={usuario} onEntrar={u => { setUsuario(u); setPantalla('trabajo') }} onCambiarUsuario={salir} />}
      {pantalla === 'trabajo' && usuario && <Trabajo usuario={usuario} tractor={tractor} onFinJornada={salir} onBloquear={salir} />}
      {pantalla !== 'trabajo' && <img className="k-logo-pie" src="/LogoNintanga.png" alt="" onError={e => { e.target.style.display = 'none' }} />}
    </div>
  )
}

export default KioskoTablet
