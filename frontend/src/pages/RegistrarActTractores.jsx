import { useState, useRef, useEffect } from 'react'
import Swal from 'sweetalert2'
import { confirmar, exito, advertencia, error as swalError } from '../components/SwalConfig'
import { fetchWithOffline, addToQueue, processQueue, getPendingCount, getPendingItems, cacheData, getCachedData } from '../services/syncQueue'
import useOnlineStatus from '../services/useOnlineStatus'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8007'

function RegistrarActTractores({ equipo = 'Tractores' }) {
  // Bitacora Tractor (equipo='Tractores') o Bitacora Dron (equipo='Drones'):
  // mismo mecanismo. El dron no lleva horometro, apero ni (por ahora) checklist.
  const esDron = equipo === 'Drones'
  const nombreEquipo = esDron ? 'Dron' : 'Tractor'
  // Obtener operador desde localStorage
  const operadorActual = localStorage.getItem('usuario_nombre') || ''
  const esAdmin = (() => { try { return JSON.parse(localStorage.getItem('user_permisos_operagricola') || '{}').es_admin } catch { return false } })()
  const { isOnline } = useOnlineStatus()

  // Fetch con soporte offline: intenta enviar, si falla guarda en cola
  const offlineFetch = async (url, options, descripcion) => {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)
      const res = await fetch(url, { ...options, signal: controller.signal })
      clearTimeout(timeout)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res
    } catch (err) {
      const body = options.body ? JSON.parse(options.body) : null
      await addToQueue(url, options.method || 'GET', body, 'registro', descripcion || 'Registro de actividad')
      return null
    }
  }

  // Obtener ubicación GPS del dispositivo
  const obtenerUbicacion = () => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null)
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(`${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 30000 }
      )
    })
  }

  const [formData, setFormData] = useState({
    tractor: '',
    apero: '',
    horometro: '',
    lote: '',
    hacienda: '',
    ordenCultivo: '',
    edadSem: '',
    variedad: '',
    operador: operadorActual,
    actividad: '',
    subactividad: ''
  })

  const [estadoRegistro, setEstadoRegistro] = useState('nuevo') // nuevo, iniciado, pausado
  const [registroSeleccionado, setRegistroSeleccionado] = useState(null)
  const [vistaActiva, setVistaActiva] = useState('tabla') // para móvil: 'tabla' o 'formulario'
  const [cardActiva, setCardActiva] = useState('equipo') // 'equipo' o 'actividad'
  const [showTractorList, setShowTractorList] = useState(false)
  const [showAperoList, setShowAperoList] = useState(false)
  const [editandoApero, setEditandoApero] = useState(false)
  const [showAperoListActividad, setShowAperoListActividad] = useState(false)
  const [busquedaApero, setBusquedaApero] = useState('')
  const [showActividadList, setShowActividadList] = useState(false)
  const [showSubactividadList, setShowSubactividadList] = useState(false)
  const [showLoteList, setShowLoteList] = useState(false)
  const [lotesSugeridos, setLotesSugeridos] = useState([])
  const [loteHaciendaLocked, setLoteHaciendaLocked] = useState(false)
  const [filtroOperadorAdmin, setFiltroOperadorAdmin] = useState('')
  const [showOperadorList, setShowOperadorList] = useState(false)
  const [showChecklist, setShowChecklist] = useState(false)
  const [checklist, setChecklist] = useState({})
  const [procesando, setProcesando] = useState(false)
  const [dronesUsados, setDronesUsados] = useState([])   // sugerencias hasta que exista el catalogo de Activos

  // Items del checklist por sección
  const checklistItems = {
    'Inspección': [
      'Motor (sonidos extraños, vibración, fugas, banda)',
      'Bajo nivel de refrigerante de motor',
      'Bajo nivel de aceite de motor',
      'Bajo nivel de aceite hidráulico',
      'Fugas en sistema hidráulico',
      'Bomba hidráulica (fugas, sonidos extraños, vibración)',
      'Transmisiones (fugas de aceite, sonidos, vibraciones)',
      'Indicadores en el tablero',
      'Daños en neumáticos (desgaste, presión, daños)',
      'Reporte de daños en frenos',
      'Presencia de fisuras en estructura',
      'Fallo eléctrico',
    ],
    'Limpieza': [
      'Limpieza de radiador',
      'Limpieza e inspección de motor (filtros de aire)',
      'Limpieza del interior de la cabina',
      'Limpieza del sistema de frenos',
    ],
    'Lubricación': [
      'Articulaciones de la pala',
      'Pines y bocines de la dirección',
    ],
  }

  const initChecklist = () => {
    const initial = {}
    Object.entries(checklistItems).forEach(([seccion, items]) => {
      items.forEach((item, idx) => {
        initial[`${seccion}-${idx}`] = false
      })
    })
    return initial
  }

  const handleChecklistToggle = (key) => {
    setChecklist(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const allChecked = Object.values(checklist).length > 0 && Object.values(checklist).every(v => v)

  const handleContinuar = () => {
    if (esDron) {
      // El dron se escribe o se elige de los ya usados (el catalogo vendra de Activos).
      // PENDIENTE: checklist del dron (operaciones enviara el listado).
      const dron = formData.tractor.trim().toUpperCase()
      if (!dron) {
        advertencia({ titulo: 'Dron requerido', texto: 'Escriba o elija el dron.' })
        return
      }
      setFormData(prev => ({ ...prev, tractor: dron, apero: '', horometro: '' }))
      setShowTractorList(false)
      setCardActiva('actividad')
      return
    }
    // Validar que el tractor exista en la lista
    const tractorValido = tractores.some(t => `${t.marca} ${t.modelo} - ${t.numeracion}` === formData.tractor)
    if (!tractorValido) {
      advertencia({ titulo: 'Tractor no válido', texto: 'Debe seleccionar un tractor de la lista.' })
      return
    }
    // Si hay apero, validar que exista
    if (formData.apero) {
      const aperoValido = aperos.some(a => `${a.numeracion} - ${a.tipo_implemento}` === formData.apero)
      if (!aperoValido) {
        advertencia({ titulo: 'Apero no válido', texto: 'El apero ingresado no existe en la lista.' })
        return
      }
    }
    setChecklist(initChecklist())
    setShowChecklist(true)
    setShowTractorList(false)
    setShowAperoList(false)
  }

  // Mapeo directo de key del checklist → campo de BD
  const checklistKeyToField = {
    'Inspección-0': 'insp_motor',
    'Inspección-1': 'insp_refrigerante',
    'Inspección-2': 'insp_aceite_motor',
    'Inspección-3': 'insp_aceite_hidraulico',
    'Inspección-4': 'insp_fugas_hidraulico',
    'Inspección-5': 'insp_bomba_hidraulica',
    'Inspección-6': 'insp_transmisiones',
    'Inspección-7': 'insp_indicadores_tablero',
    'Inspección-8': 'insp_neumaticos',
    'Inspección-9': 'insp_frenos',
    'Inspección-10': 'insp_fisuras',
    'Inspección-11': 'insp_fallo_electrico',
    'Limpieza-0': 'limp_radiador',
    'Limpieza-1': 'limp_motor_filtros',
    'Limpieza-2': 'limp_cabina',
    'Limpieza-3': 'limp_frenos',
    'Lubricación-0': 'lub_articulaciones',
    'Lubricación-1': 'lub_pines_bocines',
  }

  const handleChecklistConfirm = async () => {
    try {
      const checkData = {}
      Object.entries(checklist).forEach(([key, value]) => {
        const field = checklistKeyToField[key]
        if (field) {
          checkData[field] = value
        }
      })

      // Obtener ubicación GPS para registrar en ot_fallas si hay fallas
      const ubicacionGPS = await obtenerUbicacion()

      const checkPayload = {
        usuario: operadorActual || 'Operador',
        fecha: new Date().toISOString(),
        tractor: formData.tractor,
        apero: formData.apero,
        horometro_inicial: formData.horometro ? parseFloat(formData.horometro) : null,
        estado: 'Activo',
        ubicacion: ubicacionGPS,
        ...checkData,
      }
      console.log('[CHECK] Enviando checklist:', checkPayload)

      const res = await offlineFetch(`${API_URL}/api/checks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(checkPayload)
      }, 'Checklist de inspección')
      console.log('[CHECK] Respuesta:', res ? `OK ${res.status}` : 'null (offline queue)')
    } catch (err) {
      console.error('Error guardando checklist:', err)
    }

    setShowChecklist(false)
    setCardActiva('actividad')
    // Limpiar registro seleccionado y formulario al cambiar de equipo
    setRegistroSeleccionado(null)
    setEstadoRegistro('nuevo')
    setFormData(prev => ({
      ...prev,
      lote: '',
      hacienda: '',
      ordenCultivo: '',
      edadSem: '',
      variedad: '',
      actividad: '',
      subactividad: ''
    }))
    setLoteHaciendaLocked(false)
    setSubactividadesDisponibles([])
  }
  
  // Datos del backend
  const [registros, setRegistros] = useState([])
  const [tractores, setTractores] = useState([])
  const [aperos, setAperos] = useState([])
  const [checksActivos, setChecksActivos] = useState([])
  const [actividades, setActividades] = useState([])        // Culturales
  const [apoyosGenerales, setApoyosGenerales] = useState([]) // Apoyos Generales
  const [subactividadesDisponibles, setSubactividadesDisponibles] = useState([])
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(true)

  // Para swipe
  const touchStartX = useRef(0)
  const touchEndX = useRef(0)
  const touchStartY = useRef(0)
  const touchEndY = useRef(0)
  const isSwiping = useRef(false)

  // Cargar datos al iniciar
  useEffect(() => {
    fetchData()
  }, [])

  // Sincronizar cola al volver online y actualizar contador
  useEffect(() => {
    getPendingCount().then(setPendingCount).catch(() => {})
    if (isOnline) {
      processQueue().then(({ synced }) => {
        getPendingCount().then(setPendingCount).catch(() => {})
        if (synced > 0) {
          fetchData()
          exito(`${synced} registro(s) sincronizado(s)`)
        }
      }).catch(() => {})
    }
  }, [isOnline])

  // Timer para actualizar tiempo en vivo cada segundo
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  // Cerrar listas al hacer click fuera
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!e.target.closest('.form-group')) {
        setShowTractorList(false)
        setShowAperoList(false)
        setShowActividadList(false)
        setShowSubactividadList(false)
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)

      const [registrosRes, tractoresRes, aperosRes, actividadesRes, checksRes] = await Promise.all([
        fetchWithOffline(`${API_URL}/api/registros`, 'registros'),
        esDron ? Promise.resolve({ data: [] }) : fetchWithOffline(`${API_URL}/api/tractores`, 'tractores'),
        esDron ? Promise.resolve({ data: [] }) : fetchWithOffline(`${API_URL}/api/aperos`, 'aperos'),
        fetchWithOffline(`${API_URL}/api/actividades`, 'actividades'),
        esDron ? Promise.resolve({ data: [] }) : fetchWithOffline(`${API_URL}/api/checks`, 'checks')
      ])

      // Solo los registros de este equipo (los viejos, sin `equipo`, son de tractores)
      const registrosData = (registrosRes.data || []).filter(r => (r.equipo || 'Tractores') === equipo)
      if (esDron) setDronesUsados([...new Set(registrosData.map(r => r.tractor).filter(Boolean))].sort())
      const tractoresData = tractoresRes.data
      const aperosData = aperosRes.data
      const actividadesData = actividadesRes.data
      const checksData = checksRes.data

      // Admin ve todos los registros, operador normal solo los suyos
      const misRegistros = esAdmin
        ? registrosData
        : operadorActual
          ? registrosData.filter(r => r.usuario === operadorActual)
          : registrosData
      setRegistros(misRegistros)
      setTractores(tractoresData)
      setAperos(aperosData)
      // Guardar checks activos (admin ve todos, operador solo los suyos)
      const misChecksActivos = esAdmin
        ? checksData.filter(c => c.estado === 'Activo')
        : operadorActual
          ? checksData.filter(c => c.estado === 'Activo' && c.usuario === operadorActual)
          : checksData.filter(c => c.estado === 'Activo')
      setChecksActivos(misChecksActivos)
      // Separar actividades culturales y apoyos generales
      const tractorActs = actividadesData.filter(a => (a.equipo || 'Tractores') === equipo)
      setActividades(tractorActs.filter(a => a.tipo === 'Actividades Culturales'))
      setApoyosGenerales(tractorActs.filter(a => a.tipo === 'Apoyos Generales'))

      // Buscar checklist activo
      const checkActivo = misChecksActivos[0]
      if (checkActivo) {
        // Buscar horómetro del tractor desde PostgreSQL (ot_equipo_horas)
        const tractorNombre = checkActivo.tractor || ''
        const tractorData = tractoresData.find(t => `${t.marca} ${t.modelo} - ${t.numeracion}` === tractorNombre)
        let horometroVal = tractorData?.horometro || ''
        if (tractorData) {
          try {
            const tractorIdPg = `${tractorData.marca}-${tractorData.modelo}-${tractorData.numeracion}`
            const res = await fetch(`${API_URL}/api/equipo-horas/${encodeURIComponent(tractorIdPg)}`)
            if (res.ok) {
              const data = await res.json()
              if (data.horas_actuales != null) horometroVal = data.horas_actuales
            }
          } catch (err) { console.warn('No se pudo obtener horas de PostgreSQL:', err) }
        }
        setFormData(prev => ({
          ...prev,
          tractor: checkActivo.tractor,
          apero: checkActivo.apero || '',
          horometro: horometroVal
        }))
        setCardActiva('actividad')
      } else if (misRegistros.some(r => r.estado === 'Ejecutándose' || r.estado === 'Pausado' || r.estado === 'Pendiente')) {
        // Si hay registros activos, ir directo a card de actividad
        const registroActivo = misRegistros.find(r => r.estado === 'Ejecutándose' || r.estado === 'Pausado') || misRegistros[0]
        if (registroActivo) {
          setFormData(prev => ({
            ...prev,
            tractor: registroActivo.tractor || prev.tractor,
            apero: registroActivo.apero || prev.apero,
            actividad: registroActivo.actividad || '',
            subactividad: registroActivo.subactividad || '',
            lote: registroActivo.lote || '',
            hacienda: registroActivo.hacienda || '',
            ordenCultivo: registroActivo.orden_cultivo || ''
          }))
          // Cargar subactividades disponibles
          const tractorActs = actividadesData.filter(a => (a.equipo || 'Tractores') === equipo)
          if (registroActivo.actividad === 'APOYOS GENERALES') {
            setSubactividadesDisponibles(tractorActs.filter(a => a.tipo === 'Apoyos Generales').map(a => a.actividad))
          } else {
            const actSel = tractorActs.find(a => a.actividad === registroActivo.actividad)
            setSubactividadesDisponibles(actSel?.subactividades || [])
          }
          // Lock del lote si tiene datos
          if (registroActivo.lote || registroActivo.hacienda) {
            setLoteHaciendaLocked(true)
          }
          // Seleccionar el registro
          setRegistroSeleccionado(registroActivo)
          if (registroActivo.estado === 'Ejecutándose') setEstadoRegistro('iniciado')
          else if (registroActivo.estado === 'Pausado') setEstadoRegistro('pausado')
          else if (registroActivo.estado === 'Pendiente') setEstadoRegistro('guardado')
        }
        setCardActiva('actividad')
      }
    } catch (err) {
      console.error('Error cargando datos:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX
    touchEndX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    touchEndY.current = e.touches[0].clientY
    isSwiping.current = false
  }

  const handleTouchMove = (e) => {
    touchEndX.current = e.touches[0].clientX
    touchEndY.current = e.touches[0].clientY
    const diffX = Math.abs(touchStartX.current - touchEndX.current)
    if (diffX > 30) {
      isSwiping.current = true
    }
  }

  const handleTouchEnd = () => {
    if (!isSwiping.current) return

    const diffX = touchStartX.current - touchEndX.current
    const diffY = Math.abs(touchStartY.current - touchEndY.current)
    const minSwipeDistance = 80

    // Solo cambiar vista si el swipe es más horizontal que vertical
    if (Math.abs(diffX) > minSwipeDistance && Math.abs(diffX) > diffY * 1.5) {
      if (diffX > 0) {
        setVistaActiva('formulario')
      } else {
        setVistaActiva('tabla')
      }
    }
  }

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))

    if (name === 'actividad') {
      if (value === 'APOYOS GENERALES') {
        // Mostrar las actividades de apoyo como subactividades
        setSubactividadesDisponibles(apoyosGenerales.map(a => a.actividad))
      } else {
        const actividadSeleccionada = actividades.find(a => a.actividad === value)
        setSubactividadesDisponibles(actividadSeleccionada?.subactividades || [])
      }
      setFormData(prev => ({ ...prev, subactividad: '' }))
    }
  }

  const seleccionarRegistro = (registro) => {
    setRegistroSeleccionado(registro)
    
    // Cargar subactividades de la actividad seleccionada
    if (registro.actividad === 'APOYOS GENERALES') {
      setSubactividadesDisponibles(apoyosGenerales.map(a => a.actividad))
    } else {
      const actividadSeleccionada = actividades.find(a => a.actividad === registro.actividad)
      setSubactividadesDisponibles(actividadSeleccionada?.subactividades || [])
    }
    
    // Rellenar el formulario
    setFormData(prev => ({
      ...prev,
      tractor: registro.tractor || prev.tractor,
      apero: registro.apero || prev.apero,
      lote: registro.lote || prev.lote,
      hacienda: registro.hacienda || prev.hacienda,
      ordenCultivo: registro.orden_cultivo || '',
      actividad: registro.actividad || '',
      subactividad: registro.subactividad || ''
    }))
    // Activar el lock del lote si tiene datos
    if (registro.lote || registro.hacienda) {
      setLoteHaciendaLocked(true)
    }
    
    // Actualizar estado según el registro
    if (registro.estado === 'Ejecutándose') {
      setEstadoRegistro('iniciado')
    } else if (registro.estado === 'Pausado') {
      setEstadoRegistro('pausado')
    } else if (registro.estado === 'Pendiente') {
      setEstadoRegistro('guardado')
    } else {
      setEstadoRegistro('nuevo')
    }
    
    // Ir a la card de actividad
    setCardActiva('actividad')
    setVistaActiva('formulario')
  }

  const handleGuardar = async () => {
    if (procesando) return
    // No permitir modificar un registro que ya fue iniciado
    if (registroSeleccionado && registroSeleccionado.estado !== 'Pendiente') {
      advertencia({
        titulo: 'No se puede modificar',
        texto: 'Esta actividad ya fue iniciada. Solo puede pausarla o finalizarla.'
      })
      return
    }

    // Confirmación con Swal
    const result = await confirmar({
      titulo: registroSeleccionado ? '¿Desea actualizar esta actividad?' : '¿Desea crear esta actividad?',
      html: `
        <div style="text-align:left; font-size:0.9rem; color: #ffffff !important;">
          <p style="color:var(--color-bg-white);"><strong>${nombreEquipo}:</strong> ${formData.tractor || '-'}</p>
          ${esDron ? '' : `<p style="color:var(--color-bg-white);"><strong>Apero:</strong> ${formData.apero || '-'}</p>`}
          <p style="color:var(--color-bg-white);"><strong>Lote:</strong> ${formData.lote || '-'}</p>
          <p style="color:var(--color-bg-white);"><strong>Hacienda:</strong> ${formData.hacienda || '-'}</p>
          <p style="color:var(--color-bg-white);"><strong>Actividad:</strong> ${formData.actividad || '-'}</p>
          <p style="color:var(--color-bg-white);"><strong>Subactividad:</strong> ${formData.subactividad || '-'}</p>
        </div>
      `,
      icono: 'question'
    })

    if (!result.isConfirmed) return

    setProcesando(true)
    try {
      let res
      if (registroSeleccionado) {
        res = await offlineFetch(`${API_URL}/api/registros/${registroSeleccionado.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tractor: formData.tractor,
            apero: formData.apero,
            lote: formData.lote,
            hacienda: formData.hacienda,
            orden_cultivo: formData.ordenCultivo,
            actividad: formData.actividad,
            subactividad: formData.subactividad,
            usuario: formData.operador
          })
        }, 'Actualizar actividad')
      } else {
        const ubicacion = await obtenerUbicacion()
        const checkActivoGuardar = checksActivos.find(c => c.tractor === formData.tractor)
        res = await offlineFetch(`${API_URL}/api/registros`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tractor: formData.tractor,
            apero: formData.apero,
            lote: formData.lote,
            hacienda: formData.hacienda,
            orden_cultivo: formData.ordenCultivo,
            actividad: formData.actividad,
            subactividad: formData.subactividad,
            usuario: formData.operador,
            ubicacion,
            id_check: checkActivoGuardar?.id || null,
            tipo: formData.actividad === 'APOYOS GENERALES' || apoyosGenerales.some(a => a.actividad === formData.actividad) ? 'Apoyos Generales' : 'Actividades Culturales',
            estado: 'Pendiente',
            equipo
          })
        }, 'Crear actividad')
      }
      await fetchData()
      if (res) {
        await exito('Actividad guardada')
      } else {
        await exito('Actividad guardada offline — se sincronizará cuando haya conexión')
      }
      limpiarFormulario()
    } catch (err) {
      console.error('Error guardando:', err)
      swalError('Error al guardar la actividad')
    } finally {
      setProcesando(false)
    }
  }

  const handleIniciar = async () => {
    if (procesando) return
    // Validar que no haya otra actividad ejecutándose (global, cualquier tractor)
    const enEjecucion = registros.find(r => r.estado === 'Ejecutándose')
    if (enEjecucion) {
      advertencia({
        titulo: 'Actividad en ejecución',
        texto: `Ya tiene una actividad ejecutándose en ${enEjecucion.tractor}. Debe pausarla o finalizarla antes de iniciar otra.`
      })
      return
    }
    // Evitar doble inicio: si ya hay un "Iniciar" pendiente de sincronizar sin conexión, no dejar iniciar otro
    if (!registroSeleccionado) {
      const pendientes = await getPendingItems()
      const yaHayInicioPendiente = pendientes.some(p => p.descripcion === 'Crear e iniciar actividad' && p.usuario === (localStorage.getItem('usuario_nombre') || 'desconocido'))
      if (yaHayInicioPendiente) {
        advertencia({
          titulo: 'Actividad pendiente de sincronizar',
          texto: 'Ya iniciaste una actividad sin conexión y todavía no se ha sincronizado. Espera a que haya conexión antes de iniciar otra, para evitar duplicados.'
        })
        return
      }
    }
    setProcesando(true)
    try {
      let nuevoRegistro = null
      let res
      if (registroSeleccionado) {
        const ubicacion = await obtenerUbicacion()
        res = await offlineFetch(`${API_URL}/api/registros/${registroSeleccionado.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            estado: 'Ejecutándose',
            ubicacion
          })
        }, 'Iniciar actividad')
        if (res) nuevoRegistro = await res.json()
      } else {
        const ubicacion = await obtenerUbicacion()
        const checkActivoIniciar = checksActivos.find(c => c.tractor === formData.tractor)
        res = await offlineFetch(`${API_URL}/api/registros`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tractor: formData.tractor,
            apero: formData.apero,
            lote: formData.lote,
            hacienda: formData.hacienda,
            orden_cultivo: formData.ordenCultivo,
            actividad: formData.actividad,
            subactividad: formData.subactividad,
            usuario: formData.operador,
            ubicacion,
            id_check: checkActivoIniciar?.id || null,
            tipo: formData.actividad === 'APOYOS GENERALES' || apoyosGenerales.some(a => a.actividad === formData.actividad) ? 'Apoyos Generales' : 'Actividades Culturales',
            estado: 'Ejecutándose',
            equipo
          })
        }, 'Crear e iniciar actividad')
        if (res) nuevoRegistro = await res.json()
      }
      await fetchData()
      setEstadoRegistro('iniciado')
      if (nuevoRegistro) setRegistroSeleccionado(nuevoRegistro)
      setVistaActiva('tabla')
      if (!res) await exito('Actividad guardada offline — se sincronizará cuando haya conexión')
    } catch (err) {
      console.error('Error iniciando:', err)
      swalError('Error al iniciar la actividad')
    } finally {
      setProcesando(false)
    }
  }

  const handlePausar = async () => {
    if (procesando) return
    if (!registroSeleccionado) {
      advertencia({ titulo: 'No hay actividad seleccionada', texto: 'Si la iniciaste sin conexión, espera a que sincronice (revisa el indicador de pendientes) antes de pausarla.' })
      return
    }
    setProcesando(true)
    try {
      const ubicacion = await obtenerUbicacion()
      const res = await offlineFetch(`${API_URL}/api/registros/${registroSeleccionado.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: 'Pausado', ubicacion })
      }, 'Pausar actividad')
      await fetchData()
      setEstadoRegistro('pausado')
      setVistaActiva('tabla')
      if (res === null) {
        advertencia({ titulo: 'Sin conexión', texto: 'No se pudo confirmar con el servidor. Se guardó para reintentar automáticamente — revisa el indicador de pendientes hasta que sincronice.' })
      }
    } catch (err) {
      console.error('Error pausando:', err)
    } finally {
      setProcesando(false)
    }
  }

  const handleReanudar = async () => {
    if (procesando) return
    if (!registroSeleccionado) {
      advertencia({ titulo: 'No hay actividad seleccionada', texto: 'Si la pausaste sin conexión, espera a que sincronice antes de reanudarla.' })
      return
    }
    // Validar que no haya otra actividad ejecutándose (global, cualquier tractor)
    const enEjecucion = registros.find(r => r.estado === 'Ejecutándose')
    if (enEjecucion) {
      Swal.fire({
        icon: 'warning',
        title: 'Actividad en ejecución',
        text: `Ya tiene una actividad ejecutándose en ${enEjecucion.tractor}. Debe pausarla o finalizarla antes de reanudar otra.`,
        confirmButtonColor: '#7b1fa2'
      })
      return
    }
    setProcesando(true)
    try {
      const ubicacion = await obtenerUbicacion()
      const res = await offlineFetch(`${API_URL}/api/registros/${registroSeleccionado.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: 'Ejecutándose', ubicacion })
      }, 'Reanudar actividad')
      await fetchData()
      setEstadoRegistro('iniciado')
      setVistaActiva('tabla')
      if (res === null) {
        advertencia({ titulo: 'Sin conexión', texto: 'No se pudo confirmar con el servidor. Se guardó para reintentar automáticamente — revisa el indicador de pendientes hasta que sincronice.' })
      }
    } catch (err) {
      console.error('Error reanudando:', err)
    } finally {
      setProcesando(false)
    }
  }

  const handleFinalizar = async () => {
    if (procesando) return
    if (!registroSeleccionado) {
      advertencia({ titulo: 'No hay actividad seleccionada', texto: 'Si la iniciaste sin conexión, espera a que sincronice antes de finalizarla.' })
      return
    }
    setProcesando(true)
    try {
      const ubicacion = await obtenerUbicacion()
      const res = await offlineFetch(`${API_URL}/api/registros/${registroSeleccionado.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: 'Finalizado', ubicacion })
      }, 'Finalizar actividad')
      await fetchData()
      limpiarFormulario()
      setVistaActiva('tabla')
      if (res === null) {
        advertencia({ titulo: 'Sin conexión', texto: 'No se pudo confirmar con el servidor. Se guardó para reintentar automáticamente — revisa el indicador de pendientes hasta que sincronice.' })
      }
    } catch (err) {
      console.error('Error finalizando:', err)
    } finally {
      setProcesando(false)
    }
  }

  const limpiarFormulario = () => {
    setFormData(prev => ({
      ...prev,
      actividad: '',
      subactividad: ''
      // lote y hacienda se mantienen
    }))
    setSubactividadesDisponibles([])
    setEstadoRegistro('nuevo')
    setRegistroSeleccionado(null)
    setShowActividadList(false)
    setShowSubactividadList(false)
    // No cambia a card equipo, se queda en actividad
  }

  const eliminarRegistro = async (id, e) => {
    e.stopPropagation()
    const result = await confirmar({
      titulo: '¿Desea eliminar este registro?',
      html: '<p style="color:var(--color-bg-white);">Esta acción no se puede deshacer.</p>',
      icono: 'warning'
    })
    if (result.isConfirmed) {
      try {
        const res = await offlineFetch(`${API_URL}/api/registros/${id}`, { method: 'DELETE' }, 'Eliminar registro')
        await fetchData()
        if (res) {
          await exito('Registro eliminado')
        } else {
          await exito('Eliminación guardada offline — se sincronizará cuando haya conexión')
        }
        if (registroSeleccionado?.id === id) {
          limpiarFormulario()
        }
      } catch (err) {
        console.error('Error eliminando:', err)
        swalError('Error al eliminar')
      }
    }
  }

  // Formatear hora desde fecha
  const formatHora = (fecha) => {
    if (!fecha) return ''
    const d = new Date(fecha)
    return d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })
  }

  // Calcular tiempo real de una actividad basado en fecha_historial
  const calcularTiempoReal = (registro) => {
    if (!registro.fecha_historial || registro.fecha_historial.length === 0) return 0
    if (registro.estado === 'Pendiente') return 0
    
    let tiempoReal = 0
    const historial = registro.fecha_historial
    
    for (let i = 0; i < historial.length; i++) {
      const evento = historial[i]
      if (evento.accion === 'inicio' || evento.accion === 'reanudado') {
        // Buscar el siguiente pausado o finalizado
        let fin = null
        for (let j = i + 1; j < historial.length; j++) {
          if (historial[j].accion === 'pausado' || historial[j].accion === 'finalizado') {
            fin = new Date(historial[j].fecha)
            break
          }
        }
        // Si no hay siguiente evento y está ejecutándose, usar hora actual
        if (!fin && registro.estado === 'Ejecutándose') {
          fin = new Date()
        }
        if (fin) {
          const inicio = new Date(evento.fecha)
          tiempoReal += (fin - inicio) / 60000 // en minutos con decimales
        }
      }
    }
    return tiempoReal
  }

  // Formatear tiempo en formato HH:MM:SS
  const formatTiempo = (minutos) => {
    if (!minutos || minutos === 0) return '00:00:00'
    const totalSegundos = Math.round(minutos * 60)
    const hrs = Math.floor(totalSegundos / 3600)
    const mins = Math.floor((totalSegundos % 3600) / 60)
    const segs = totalSegundos % 60
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(segs).padStart(2, '0')}`
  }

  // Capitalizar: primera letra mayúscula, resto minúsculas
  const capitalizar = (texto) => {
    if (!texto) return ''
    return texto.charAt(0).toUpperCase() + texto.slice(1).toLowerCase()
  }

  return (
    <>
      {/* Tabs para móvil */}
      <div className="mobile-tabs">
        <button 
          className={`mobile-tab ${vistaActiva === 'tabla' ? 'active' : ''}`}
          onClick={() => setVistaActiva('tabla')}
        >
          <i className='bx bx-list-ul'></i> Registros
        </button>
        <button 
          className={`mobile-tab ${vistaActiva === 'formulario' ? 'active' : ''}`}
          onClick={() => setVistaActiva('formulario')}
        >
          <i className='bx bx-edit'></i> Formulario
        </button>
      </div>

      {/* Layout: Tabla izquierda, Formulario derecha */}
      <div 
        className="registro-layout"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        
        {/* Tabla de actividades registradas - IZQUIERDA */}
        <div className={`registro-tabla ${vistaActiva === 'tabla' ? 'mobile-visible' : ''}`}>
          {/* Título sobre la tabla */}
          <div className="page-header" style={{marginBottom: '0.5rem'}}>
            <div>
              <h1><i className='bx bxs-edit'></i> {esDron ? 'Bitácora Dron' : 'Bitácora Tractor'}</h1>
              <p className="page-subtitle">Registro de actividades de {esDron ? 'drones' : 'tractores'}</p>
            </div>
          </div>

          {/* Filtro admin por operador */}
          {esAdmin && (
            <div style={{marginBottom: '0.5rem', position: 'relative'}}>
              <div style={{position: 'relative'}}>
                <i className='bx bx-search' style={{position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)'}}></i>
                <input
                  type="text"
                  className="form-control"
                  value={filtroOperadorAdmin}
                  onChange={(e) => setFiltroOperadorAdmin(e.target.value)}
                  placeholder="Buscar operador..."
                  style={{paddingLeft: '2rem', fontSize: '0.8rem'}}
                  onFocus={() => setShowOperadorList(true)}
                />
                {filtroOperadorAdmin && (
                  <i className='bx bx-x' style={{position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: '#dc3545', cursor: 'pointer', background: 'var(--color-bg-white)', padding: '2px'}} onClick={() => { setFiltroOperadorAdmin(''); setShowOperadorList(false) }}></i>
                )}
              </div>
              {showOperadorList && (
                <div className="sugerencias-lista sugerencias-abajo" style={{position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--color-bg-white)', border: '1px solid var(--color-border)', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 1000, maxHeight: '200px', overflowY: 'auto', marginTop: '4px'}}>
                  {[...new Set(registros.map(r => r.usuario).filter(Boolean))]
                    .filter(op => !filtroOperadorAdmin || op.toLowerCase().includes(filtroOperadorAdmin.toLowerCase()))
                    .sort()
                    .map(op => (
                      <div key={op} className="sugerencia-item" style={{padding: '0.5rem 0.8rem', cursor: 'pointer', borderBottom: '1px solid var(--color-border)', fontSize: '0.8rem'}}
                        onClick={() => { setFiltroOperadorAdmin(op); setShowOperadorList(false) }}>
                        <i className='bx bx-user' style={{marginRight: '0.4rem', color: '#7b1fa2'}}></i>{op}
                      </div>
                    ))
                  }
                </div>
              )}
            </div>
          )}

          {/* Registros agrupados por tractor */}
          {(() => {
            const registrosFiltrados = filtroOperadorAdmin
              ? registros.filter(r => r.usuario === filtroOperadorAdmin)
              : registros
            const registrosActivos = registrosFiltrados.filter(r => r.estado === 'Pendiente' || r.estado === 'Ejecutándose' || r.estado === 'Pausado')
            const tractoresConRegistros = [...new Set(registrosActivos.map(r => r.tractor).filter(Boolean))]
            // Incluir también tractores con checks activos que no tengan registros
            const checksFiltrados = filtroOperadorAdmin
              ? checksActivos.filter(c => c.usuario === filtroOperadorAdmin)
              : checksActivos
            const tractoresDeChecks = checksFiltrados.map(c => c.tractor).filter(Boolean)
            const todosTractores = [...new Set([...tractoresConRegistros, ...tractoresDeChecks])]
            
            if (todosTractores.length === 0) {
              const hayEquipoSeleccionado = cardActiva === 'actividad' && formData.tractor
              return (
                <div style={{textAlign: 'center', padding: '2rem'}}>
                  <p style={{color: 'var(--color-text-secondary)', marginBottom: '1rem'}}>
                    {hayEquipoSeleccionado ? 'No hay actividades registradas' : 'No hay equipo seleccionado'}
                  </p>
                  <div style={{display: 'flex', gap: '0.5rem', justifyContent: 'center'}}>
                    {hayEquipoSeleccionado ? (
                      <>
                        <button className="btn btn-primary" onClick={() => setVistaActiva('formulario')} style={{fontSize: '0.85rem'}}>
                          <i className='bx bx-plus'></i> Agregar actividad
                        </button>
                        {estadoRegistro !== 'iniciado' && (
                          <button className="btn btn-secondary" onClick={() => { setCardActiva('equipo'); setVistaActiva('formulario') }} style={{fontSize: '0.85rem'}}>
                            <i className='bx bx-car'></i> Cambiar equipo
                          </button>
                        )}
                      </>
                    ) : (
                      <button className="btn btn-primary" onClick={() => { setCardActiva('equipo'); setVistaActiva('formulario') }} style={{fontSize: '0.85rem'}}>
                        <i className='bx bx-car'></i> Agregar equipo
                      </button>
                    )}
                  </div>
                </div>
              )
            }

            return (<>
            {todosTractores.map(tractor => {
              const regsDelTractor = registrosActivos.filter(r => r.tractor === tractor)
              const checkDelTractor = checksActivos.find(c => c.tractor === tractor)
              const apero = regsDelTractor[0]?.apero || checkDelTractor?.apero || '-'
              const operadorDelTractor = regsDelTractor[0]?.usuario || checkDelTractor?.usuario || ''
              return (
                <div key={tractor} style={{marginBottom: '1rem'}}>
                  <div style={{
                    background: 'var(--color-bg-light)',
                    padding: '0.5rem 0.8rem',
                    borderRadius: '6px',
                    marginBottom: '0.5rem',
                    fontSize: '0.8rem',
                    borderLeft: '3px solid #7b1fa2',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <div style={{display: 'flex', alignItems: 'center', gap: '0.4rem'}}>
                      {!esDron && (
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation()
                          // Verificar que no haya actividades activas
                          if (regsDelTractor.length > 0) {
                            Swal.fire({
                              icon: 'warning',
                              title: 'No se puede cerrar',
                              text: 'Debe finalizar todas las actividades de este tractor antes de desactivarlo.',
                              confirmButtonColor: '#7b1fa2',
                              background: '#1e1e2e',
                              color: 'var(--color-bg-white)'
                            })
                            return
                          }
                          const horInicial = checkDelTractor?.horometro_inicial
                          const { value: horometroFinal } = await Swal.fire({
                            title: 'Registrar horómetro final',
                            html: `<p style="color:var(--color-border); margin-bottom:0.5rem;">${tractor} | ${apero}</p>${horInicial != null ? `<p style="color:#ff9800; font-weight:bold; font-size:1.1rem; margin-bottom:0;">Horómetro inicial: ${horInicial}</p>` : ''}`,
                            input: 'number',
                            inputAttributes: { min: 0, step: 0.1, placeholder: 'Horómetro final...' },
                            inputValidator: (value) => {
                              if (!value || isNaN(value) || parseFloat(value) < 0) return 'Ingrese un valor válido'
                              if (horInicial != null && parseFloat(value) < horInicial) return `No puede ser menor al inicial (${horInicial})`
                            },
                            showCancelButton: true,
                            confirmButtonText: 'Confirmar',
                            cancelButtonText: 'Cancelar',
                            confirmButtonColor: '#dc3545',
                            cancelButtonColor: 'var(--color-text-secondary)',
                            background: '#1e1e2e',
                            color: 'var(--color-bg-white)'
                          })
                          if (!horometroFinal) return
                          try {
                            await offlineFetch(`${API_URL}/api/checks/desactivar-tractor/${encodeURIComponent(tractor)}`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ horometro_final: parseFloat(horometroFinal) })
                            }, 'Desactivar equipo')
                            await fetchData()
                            limpiarFormulario()
                            setCardActiva('equipo')
                          } catch (err) { console.error(err) }
                        }}
                        title="Desactivar equipo"
                        style={{width: '20px', height: '20px', fontSize: '0.75rem', background: regsDelTractor.length > 0 ? 'var(--color-text-secondary)' : '#dc3545', border: 'none', color: 'white', borderRadius: '50%', cursor: regsDelTractor.length > 0 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'}}
                      >
                        <i className='bx bx-x'></i>
                      </button>
                      )}
                      <span><strong>{tractor}</strong>{!esDron && <> | {apero}</>}{esAdmin && operadorDelTractor ? <span style={{marginLeft: '0.5rem', color: 'var(--color-primary)', fontWeight: 500}}> — {operadorDelTractor}</span> : null}</span>
                    </div>
                  </div>
                  <div style={{textAlign: 'center', marginBottom: '0.5rem'}}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={async () => {
                        limpiarFormulario()
                        const tractorData = tractores.find(t => `${t.marca} ${t.modelo} - ${t.numeracion}` === tractor)
                        let horometroVal = tractorData?.horometro || ''
                        // Buscar horas actuales en PostgreSQL
                        if (tractorData) {
                          try {
                            const tractorIdPg = `${tractorData.marca}-${tractorData.modelo}-${tractorData.numeracion}`
                            const res = await fetch(`${API_URL}/api/equipo-horas/${encodeURIComponent(tractorIdPg)}`)
                            if (res.ok) {
                              const data = await res.json()
                              if (data.horas_actuales != null) horometroVal = data.horas_actuales
                            }
                          } catch (err) { console.warn('No se pudo obtener horas de PostgreSQL:', err) }
                        }
                        setFormData(prev => ({...prev, tractor, apero, horometro: horometroVal}))
                        setVistaActiva('formulario')
                      }}
                      style={{fontSize: '0.8rem'}}
                    >
                      <i className='bx bx-plus'></i> Agregar actividad
                    </button>
                  </div>
                  {regsDelTractor.length > 0 ? (
                  <div className="tabla-container">
                    <table className="tabla" style={{fontSize: '0.85rem'}}>
                      <thead>
                        <tr>
                          <th>Hora</th>
                          <th>Actividad</th>
                          <th>Subactividad</th>
                          <th>Tiempo</th>
                          <th style={{width: '35px'}}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {regsDelTractor.map(registro => (
                          <tr 
                            key={registro.id} 
                            className={`clickeable ${registroSeleccionado?.id === registro.id ? 'selected' : ''} estado-${registro.estado?.toLowerCase().replace(' ', '-')}`}
                            onClick={() => seleccionarRegistro(registro)}
                          >
                            <td>{formatHora(registro.fecha_creacion)}</td>
                            <td><strong>{capitalizar(registro.actividad) || '-'}</strong></td>
                            <td>{capitalizar(registro.subactividad) || '-'}</td>
                            <td>{registro.estado === 'Pendiente' ? '00:00:00' : formatTiempo(calcularTiempoReal(registro))}</td>
                            <td>
                              <button
                                onClick={(e) => eliminarRegistro(registro.id, e)}
                                style={{background:'transparent',border:'none',color:'var(--color-text-secondary)',cursor:'pointer',padding:'0.3rem',fontSize:'1rem'}}
                                title="Eliminar"
                              >
                                <i className='bx bx-trash'></i>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  ) : (
                    <div style={{textAlign: 'center', padding: '0.8rem', color: 'var(--color-text-secondary)', fontSize: '0.8rem'}}>
                      Sin actividades registradas
                    </div>
                  )}
                </div>
              )
            })}
            <div style={{textAlign: 'center', marginTop: '0.5rem'}}>
              <button className="btn btn-secondary" onClick={() => { setCardActiva('equipo'); setVistaActiva('formulario') }} style={{fontSize: '0.85rem'}}>
                <i className='bx bx-plus'></i> Agregar equipo
              </button>
            </div>
            </>)
          })()}
        </div>

        {/* Formulario - DERECHA */}
        <div className={`registro-formulario ${vistaActiva === 'formulario' ? 'mobile-visible' : ''}`}>
          
          {/* Card: Seleccionar Equipo */}
          {cardActiva === 'equipo' && (
            <div className="card card-primary" style={{overflow: 'visible'}}>
              <div className="card-header">
                <span><i className='bx bx-car'></i> Seleccionar Equipo</span>
              </div>
              <div className="card-body" style={{overflow: 'visible'}}>
                {/* Tractor */}
                <div className="form-group" style={{position: 'relative'}}>
                  <label className="form-label">{nombreEquipo} <span className="required">*</span></label>
                  <div style={{position: 'relative'}}>
                    <input
                      type="text"
                      className="form-control"
                      value={formData.tractor}
                      onChange={(e) => { setFormData(prev => ({...prev, tractor: e.target.value})); setShowTractorList(true) }}
                      onFocus={() => setShowTractorList(true)}
                      placeholder={esDron ? 'Escriba o elija el dron...' : 'Escribir para buscar tractor...'}
                      autoComplete="off"
                      style={{paddingRight: formData.tractor ? '2.5rem' : '2rem'}}
                    />
                    {formData.tractor ? (
                      <i className='bx bx-x' onClick={() => { setFormData(prev => ({...prev, tractor: '', horometro: ''})); setShowTractorList(false) }} style={{position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: '#dc3545', cursor: 'pointer', fontSize: '1.2rem'}}></i>
                    ) : (
                      <i className='bx bx-chevron-down' style={{position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)', pointerEvents: 'none'}}></i>
                    )}
                  </div>
                  {showTractorList && esDron && dronesUsados.length > 0 && (
                    <div className="sugerencias-lista sugerencias-abajo">
                      {dronesUsados
                        .filter(d => !formData.tractor || d.toLowerCase().includes(formData.tractor.toLowerCase()))
                        .map(d => (
                          <div key={d} className="sugerencia-item" onClick={() => { setFormData(prev => ({...prev, tractor: d})); setShowTractorList(false) }}>
                            {d}
                          </div>
                        ))}
                    </div>
                  )}
                  {showTractorList && !esDron && (
                    <div className="sugerencias-lista sugerencias-abajo">
                      {[...tractores]
                        .sort((a, b) => `${a.marca} ${a.modelo}`.localeCompare(`${b.marca} ${b.modelo}`))
                        .filter(t => {
                          if (!formData.tractor) return true
                          const busqueda = formData.tractor.toLowerCase().replace(/-/g, ' ')
                          const texto = `${t.marca} ${t.modelo} ${t.numeracion}`.toLowerCase()
                          return texto.includes(busqueda)
                        })
                        .map(t => (
                          <div key={t.id} className="sugerencia-item" onClick={async () => {
                            const tractorNombre = `${t.marca} ${t.modelo} - ${t.numeracion}`
                            const tractorIdPg = `${t.marca}-${t.modelo}-${t.numeracion}`
                            let horometroVal = t.horometro || ''
                            // Buscar horas actuales en PostgreSQL (ot_equipo_horas)
                            try {
                              const res = await fetch(`${API_URL}/api/equipo-horas/${encodeURIComponent(tractorIdPg)}`)
                              if (res.ok) {
                                const data = await res.json()
                                if (data.horas_actuales != null) {
                                  horometroVal = data.horas_actuales
                                }
                              }
                            } catch (err) {
                              console.warn('No se pudo obtener horas de PostgreSQL:', err)
                            }
                            setFormData(prev => ({...prev, tractor: tractorNombre, horometro: horometroVal}))
                            setShowTractorList(false)
                          }}>
                            {t.marca} {t.modelo} - {t.numeracion}
                          </div>
                        ))
                      }
                    </div>
                  )}
                </div>

                {!esDron && (<>
                {/* Horómetro */}
                <div className="form-group">
                  <label className="form-label">Horómetro Inicial</label>
                  <input
                    type="number"
                    className="form-control"
                    value={formData.horometro}
                    onChange={(e) => setFormData(prev => ({...prev, horometro: e.target.value}))}
                    placeholder="Horómetro inicial..."
                    step="0.1"
                    min="0"
                  />
                </div>

                {/* Apero */}
                <div className="form-group" style={{position: 'relative'}}>
                  <label className="form-label">Apero <span className="required">*</span></label>
                  <div style={{position: 'relative'}}>
                    <input
                      type="text"
                      className="form-control"
                      value={formData.apero}
                      onChange={(e) => { setFormData(prev => ({...prev, apero: e.target.value})); setShowAperoList(true) }}
                      onFocus={() => setShowAperoList(true)}
                      placeholder="Escribir para buscar apero..."
                      autoComplete="off"
                      style={{paddingRight: formData.apero ? '2.5rem' : '2rem'}}
                    />
                    {formData.apero ? (
                      <i className='bx bx-x' onClick={() => { setFormData(prev => ({...prev, apero: ''})); setShowAperoList(false) }} style={{position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: '#dc3545', cursor: 'pointer', fontSize: '1.2rem'}}></i>
                    ) : (
                      <i className='bx bx-chevron-down' style={{position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)', pointerEvents: 'none'}}></i>
                    )}
                  </div>
                  {showAperoList && (
                    <div className="sugerencias-lista sugerencias-abajo">
                      {[...aperos]
                        .sort((a, b) => (a.tipo_implemento || '').localeCompare(b.tipo_implemento || ''))
                        .filter(a => {
                          if (!formData.apero) return true
                          const busqueda = formData.apero.toLowerCase().replace(/-/g, ' ')
                          const texto = `${a.tipo_implemento} ${a.descripcion_implemento} ${a.numeracion}`.toLowerCase()
                          return texto.includes(busqueda)
                        })
                        .map(a => (
                          <div key={a.id} className="sugerencia-item" onClick={() => { setFormData(prev => ({...prev, apero: `${a.numeracion} - ${a.tipo_implemento}`})); setShowAperoList(false) }}>
                            {a.numeracion} - {a.tipo_implemento}
                          </div>
                        ))
                      }
                    </div>
                  )}
                </div>

                </>)}

                {/* Operador */}
                {/* Operador (desde localStorage) */}
                {operadorActual && (
                  <div style={{background: 'var(--color-bg-light)', padding: '0.6rem 1rem', borderRadius: '8px', marginBottom: '0.5rem', fontSize: '0.85rem'}}>
                    <strong>Operador:</strong> {operadorActual}
                  </div>
                )}

                {/* Botón Continuar */}
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleContinuar}
                  style={{width: '100%', marginTop: '1rem'}}
                >
                  Continuar <i className='bx bx-chevron-right'></i>
                </button>
              </div>
            </div>
          )}

          {/* Card: Ingresar Actividades */}
          {cardActiva === 'actividad' && (
            <div className="card card-primary" style={{overflow: 'visible'}}>
              <div className="card-header">
                <span><i className='bx bx-list-check'></i> Ingresar Actividades</span>
              </div>
              <div className="card-body" style={{overflow: 'visible'}}>
                {/* Resumen equipo seleccionado */}
                <div className="equipo-resumen" onClick={async () => { 
                  // No permitir cambiar equipo si hay actividad en ejecución
                  if (estadoRegistro === 'iniciado') {
                    advertencia({
                      titulo: 'No se puede cambiar',
                      texto: 'Debe pausar o finalizar la actividad en curso antes de cambiar de equipo.'
                    })
                    return
                  }
                  // Desactivar check del tractor actual pidiendo horómetro final
                  if (formData.tractor && !esDron) {
                    const checkActual = checksActivos.find(c => c.tractor === formData.tractor)
                    const horInicial = checkActual?.horometro_inicial
                    const { value: horometroFinal } = await Swal.fire({
                      title: 'Registrar horómetro final',
                      html: `<p style="color:var(--color-border); margin-bottom:0.5rem;">${formData.tractor}</p>${horInicial != null ? `<p style="color:#ff9800; font-weight:bold; font-size:1.1rem; margin-bottom:0;">Horómetro inicial: ${horInicial}</p>` : ''}`,
                      input: 'number',
                      inputAttributes: { min: 0, step: 0.1, placeholder: 'Horómetro final...' },
                      inputValidator: (value) => {
                        if (!value || isNaN(value) || parseFloat(value) < 0) return 'Ingrese un valor válido'
                        if (horInicial != null && parseFloat(value) < horInicial) return `No puede ser menor al inicial (${horInicial})`
                      },
                      showCancelButton: true,
                      confirmButtonText: 'Confirmar',
                      cancelButtonText: 'Cancelar',
                      confirmButtonColor: '#7b1fa2',
                      cancelButtonColor: 'var(--color-text-secondary)',
                      background: '#1e1e2e',
                      color: 'var(--color-bg-white)'
                    })
                    if (!horometroFinal) return
                    try {
                      await offlineFetch(`${API_URL}/api/checks/desactivar-tractor/${encodeURIComponent(formData.tractor)}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ horometro_final: parseFloat(horometroFinal) })
                      }, 'Desactivar equipo')
                    } catch (err) { console.error(err) }
                  }
                  setCardActiva('equipo')
                }} style={{cursor: estadoRegistro === 'iniciado' ? 'not-allowed' : 'pointer'}}>
                  <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                    <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                      <i className='bx bx-car' style={{fontSize: '1.3rem', color: '#7b1fa2'}}></i>
                      <div>
                        <div style={{fontWeight: 'bold', fontSize: '0.9rem'}}>{formData.tractor}</div>
                      </div>
                    </div>
                    {estadoRegistro !== 'iniciado' && (
                      <span style={{background: '#7b1fa2', color: 'white', padding: '0.3rem 0.6rem', borderRadius: '4px', fontSize: '0.75rem'}}>Cambiar equipo</span>
                    )}
                  </div>
                </div>
                {/* Cambiar apero sin cambiar tractor */}
                {!esDron && (
                <div style={{marginBottom: '0.75rem', position: 'relative'}}>
                  <label className="form-label" style={{fontSize: '0.8rem', marginBottom: '0.3rem'}}>Apero</label>
                  {!editandoApero ? (
                    <div style={{display: 'flex', gap: '0.4rem', alignItems: 'center'}}>
                      <div style={{flex: 1, padding: '0.5rem 0.8rem', background: 'var(--color-bg-light)', borderRadius: '6px', border: '1px solid var(--color-border)'}}>
                        <span style={{fontSize: '0.85rem', color: 'var(--color-text-primary)'}}>{formData.apero || 'Sin apero'}</span>
                      </div>
                      {estadoRegistro !== 'iniciado' && (
                        <button
                          type="button"
                          onClick={() => { setFormData(prev => ({...prev, apero: ''})); setEditandoApero(true); setBusquedaApero(''); setShowAperoListActividad(true) }}
                          style={{padding: '0.4rem 0.6rem', border: 'none', background: '#7b1fa2', color: 'white', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 600, borderRadius: '6px', whiteSpace: 'nowrap'}}
                        >
                          <i className='bx bx-transfer-alt' style={{marginRight: '0.2rem'}}></i> Cambiar
                        </button>
                      )}
                    </div>
                  ) : (
                    <div style={{position: 'relative'}}>
                      <input
                        type="text"
                        className="form-control"
                        value={busquedaApero}
                        onChange={(e) => { setBusquedaApero(e.target.value); setShowAperoListActividad(true) }}
                        onFocus={() => setShowAperoListActividad(true)}
                        placeholder="Buscar apero..."
                        autoComplete="off"
                        autoFocus
                        style={{fontSize: '0.85rem', paddingRight: '2rem'}}
                      />
                      <i className='bx bx-x' onClick={() => { setEditandoApero(false); setShowAperoListActividad(false); setBusquedaApero(''); setFormData(prev => ({...prev, apero: ''})) }} style={{position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: '#dc3545', cursor: 'pointer', fontSize: '1.2rem'}}></i>
                      {showAperoListActividad && (
                        <div className="sugerencias-lista sugerencias-abajo" style={{position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000}}>
                          {[...aperos]
                            .sort((a, b) => (a.tipo_implemento || '').localeCompare(b.tipo_implemento || ''))
                            .filter(a => {
                              if (!busquedaApero) return true
                              const busq = busquedaApero.toLowerCase().replace(/-/g, ' ')
                              const texto = `${a.tipo_implemento} ${a.descripcion_implemento} ${a.numeracion}`.toLowerCase()
                              return texto.includes(busq)
                            })
                            .map(a => (
                              <div key={a.id} className="sugerencia-item" onClick={() => {
                                setFormData(prev => ({...prev, apero: `${a.numeracion} - ${a.tipo_implemento}`}))
                                setEditandoApero(false)
                                setShowAperoListActividad(false)
                                setBusquedaApero('')
                              }}>
                                {a.numeracion} - {a.tipo_implemento}
                              </div>
                            ))
                          }
                        </div>
                      )}
                    </div>
                  )}
                </div>
                )}

                <form onSubmit={(e) => e.preventDefault()}>
                  {/* Lote y Hacienda */}
                  <div style={{display: 'flex', gap: '0.5rem', marginBottom: '1rem', alignItems: 'flex-end'}}>
                    <div className="form-group" style={{flex: 1, margin: 0, position: 'relative'}}>
                      <label className="form-label">Lote / Hacienda</label>
                      <input 
                        type="text"
                        className="form-control"
                        value={loteHaciendaLocked ? `${formData.lote} - ${formData.hacienda}${formData.ordenCultivo ? ' | ' + formData.ordenCultivo : ''}${formData.edadSem ? ' | Sem ' + formData.edadSem : ''}${formData.variedad ? ' | ' + formData.variedad : ''}` : formData.lote}
                        onChange={async (e) => {
                          const val = e.target.value
                          setFormData(prev => ({...prev, lote: val, hacienda: '', ordenCultivo: '', edadSem: '', variedad: ''}))
                          if (val.length >= 2) {
                            try {
                              const res = await fetch(`${API_URL}/api/lotes-infx/buscar?ocult=${encodeURIComponent(val)}`)
                              if (res.ok) {
                                const data = await res.json()
                                setLotesSugeridos(data)
                                setShowLoteList(true)
                                // Cachear lotes para uso offline
                                const cached = await getCachedData('lotes_all') || []
                                const merged = [...cached]
                                data.forEach(l => { if (!merged.find(c => c.ocult_cod_ocult === l.ocult_cod_ocult)) merged.push(l) })
                                await cacheData('lotes_all', merged)
                              }
                            } catch {
                              // Offline: buscar en cache local
                              const cached = await getCachedData('lotes_all') || []
                              const q = val.toLowerCase()
                              const filtrados = cached.filter(l =>
                                (l.ocult_cod_ocult || '').toLowerCase().includes(q) ||
                                (l.lote || '').toLowerCase().includes(q) ||
                                (l.hacienda || '').toLowerCase().includes(q) ||
                                (l.variedad || '').toLowerCase().includes(q)
                              )
                              setLotesSugeridos(filtrados)
                              setShowLoteList(filtrados.length > 0)
                            }
                          } else {
                            setLotesSugeridos([])
                            setShowLoteList(false)
                          }
                        }}
                        onFocus={() => { if (formData.lote && formData.lote.length >= 2) setShowLoteList(true) }}
                        placeholder="Buscar por lote, hacienda u orden..."
                        disabled={loteHaciendaLocked || estadoRegistro === 'iniciado' || estadoRegistro === 'pausado' || estadoRegistro === 'guardado'}
                        readOnly={loteHaciendaLocked}
                        style={loteHaciendaLocked ? {backgroundColor: 'var(--color-bg-light)'} : {}}
                      />
                      {showLoteList && lotesSugeridos.length > 0 && !loteHaciendaLocked && (
                        <div className="sugerencias-lista sugerencias-abajo" style={{position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--color-bg-white)', border: '1px solid var(--color-border)', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 1000, maxHeight: '180px', overflowY: 'auto', marginTop: '4px'}}>
                          {lotesSugeridos.map((l, i) => (
                            <div key={i} className="sugerencia-item" style={{padding: '0.5rem 0.8rem', cursor: 'pointer', borderBottom: '1px solid var(--color-border)', fontSize: '0.8rem'}}
                              onClick={() => {
                                setFormData(prev => ({...prev, lote: l.lote || '', hacienda: l.hacienda || '', ordenCultivo: l.ocult_cod_ocult || '', edadSem: l.edad_sem || '', variedad: l.variedad || ''}))
                                setShowLoteList(false)
                                setLotesSugeridos([])
                                setLoteHaciendaLocked(true)
                              }}>
                              <span style={{color:'#7b1fa2', fontWeight:'bold'}}>{l.ocult_cod_ocult}</span> / {l.lote} / {l.hacienda} | {l.ocult_cod_proda} {l.edad_sem ? <span style={{color:'#e65100', fontWeight:'bold'}}>| Sem {l.edad_sem}</span> : ''}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {!loteHaciendaLocked && estadoRegistro !== 'iniciado' && estadoRegistro !== 'pausado' && estadoRegistro !== 'guardado' && (
                      <button
                        type="button"
                        onClick={() => {
                          setFormData(prev => ({...prev, lote: 'SIN LOTE', hacienda: 'SIN LOTE', ordenCultivo: 'SIN LOTE', edadSem: '', variedad: ''}))
                          setShowLoteList(false)
                          setLotesSugeridos([])
                          setLoteHaciendaLocked(true)
                        }}
                        style={{
                          padding: '0.5rem 0.6rem',
                          border: '2px dashed #ff9800',
                          background: '#fff3e0',
                          color: '#e65100',
                          cursor: 'pointer',
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          borderRadius: '6px',
                          marginBottom: '0.25rem',
                          whiteSpace: 'nowrap'
                        }}
                        title="Registrar sin lote asignado"
                      >
                        <i className='bx bx-block' style={{marginRight: '0.2rem'}}></i>
                        Sin Lote
                      </button>
                    )}
                    {!loteHaciendaLocked && (formData.lote || formData.hacienda) && estadoRegistro !== 'iniciado' && estadoRegistro !== 'pausado' && estadoRegistro !== 'guardado' && (
                      <button
                        type="button"
                        onClick={() => { setLoteHaciendaLocked(true); setShowLoteList(false) }}
                        style={{
                          padding: '0.5rem 0.6rem',
                          border: 'none',
                          background: '#28a745',
                          color: 'white',
                          cursor: 'pointer',
                          fontSize: '1rem',
                          borderRadius: '6px',
                          marginBottom: '0.25rem'
                        }}
                        title="Fijar lote y hacienda"
                      >
                        <i className='bx bx-check'></i>
                      </button>
                    )}
                    {loteHaciendaLocked && estadoRegistro !== 'iniciado' && estadoRegistro !== 'pausado' && estadoRegistro !== 'guardado' && (
                      <button
                        type="button"
                        onClick={() => { setLoteHaciendaLocked(false); setFormData(prev => ({...prev, lote: '', hacienda: '', ordenCultivo: '', edadSem: '', variedad: ''})) }}
                        style={{
                          padding: '0.5rem 0.7rem',
                          border: 'none',
                          background: '#dc3545',
                          color: 'white',
                          cursor: 'pointer',
                          fontSize: '1rem',
                          borderRadius: '6px',
                          marginBottom: '0.25rem'
                        }}
                        title="Cambiar lote y hacienda"
                      >
                        <i className='bx bx-x'></i>
                      </button>
                    )}
                  </div>

                  {/* Actividad */}
                  <div className="form-group" style={{position: 'relative'}}>
                    <label className="form-label">Actividad <span className="required">*</span></label>
                    <div style={{position: 'relative'}}>
                      <input
                        type="text"
                        className="form-control select-capitalize"
                        value={formData.actividad}
                        onChange={(e) => { 
                          const val = e.target.value
                          setFormData(prev => ({...prev, actividad: val, subactividad: ''}))
                          setShowActividadList(true)
                          setSubactividadesDisponibles([])
                        }}
                        onFocus={() => setShowActividadList(true)}
                        placeholder="Buscar actividad..."
                        autoComplete="off"
                        disabled={estadoRegistro === 'iniciado' || estadoRegistro === 'pausado' || estadoRegistro === 'guardado'}
                        readOnly={formData.actividad === 'APOYOS GENERALES' || actividades.some(a => a.actividad === formData.actividad)}
                      />
                      {formData.actividad && (formData.actividad === 'APOYOS GENERALES' || actividades.some(a => a.actividad === formData.actividad)) && estadoRegistro !== 'iniciado' && estadoRegistro !== 'guardado' && estadoRegistro !== 'pausado' ? (
                        <i className='bx bx-x' style={{position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', color: 'white', cursor: 'pointer', background: '#dc3545', borderRadius: '4px', padding: '2px 4px', fontSize: '0.9rem'}} onClick={() => { setFormData(prev => ({...prev, actividad: '', subactividad: ''})); setSubactividadesDisponibles([]) }}></i>
                      ) : (
                        <i className='bx bx-chevron-down' style={{position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)', pointerEvents: 'none'}}></i>
                      )}
                    </div>
                    {showActividadList && !(formData.actividad === 'APOYOS GENERALES' || actividades.some(a => a.actividad === formData.actividad)) && (
                      <div className="sugerencias-lista sugerencias-abajo">
                        {actividades
                          .filter(a => !formData.actividad || a.actividad.toLowerCase().includes(formData.actividad.toLowerCase()))
                          .map(act => (
                            <div key={act.id} className="sugerencia-item" onClick={() => { setFormData(prev => ({...prev, actividad: act.actividad, subactividad: ''})); setSubactividadesDisponibles(act.subactividades || []); setShowActividadList(false) }}>
                              {capitalizar(act.actividad)}
                            </div>
                          ))
                        }
                        {(!formData.actividad || 'apoyos generales'.includes(formData.actividad.toLowerCase())) && (
                          <div className="sugerencia-item" style={{borderTop: '2px solid var(--color-border)', fontWeight: 'bold'}} onClick={() => { setFormData(prev => ({...prev, actividad: 'APOYOS GENERALES', subactividad: ''})); setSubactividadesDisponibles(apoyosGenerales.map(a => a.actividad)); setShowActividadList(false) }}>
                            Apoyos Generales
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Subactividad */}
                  <div className="form-group" style={{position: 'relative'}}>
                    <label className="form-label">Subactividad <span className="required">*</span></label>
                    <div style={{position: 'relative'}}>
                      <input
                        type="text"
                        className="form-control select-capitalize"
                        value={formData.subactividad}
                        onChange={(e) => { setFormData(prev => ({...prev, subactividad: e.target.value})); setShowSubactividadList(true) }}
                        onFocus={() => setShowSubactividadList(true)}
                        placeholder="Buscar subactividad..."
                        autoComplete="off"
                        disabled={!formData.actividad || estadoRegistro === 'iniciado' || estadoRegistro === 'pausado' || estadoRegistro === 'guardado'}
                        readOnly={subactividadesDisponibles.includes(formData.subactividad) || apoyosGenerales.some(a => a.actividad === formData.subactividad)}
                      />
                      {formData.subactividad && (subactividadesDisponibles.includes(formData.subactividad) || apoyosGenerales.some(a => a.actividad === formData.subactividad)) && estadoRegistro !== 'iniciado' && estadoRegistro !== 'guardado' && estadoRegistro !== 'pausado' ? (
                        <i className='bx bx-x' style={{position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', color: 'white', cursor: 'pointer', background: '#dc3545', borderRadius: '4px', padding: '2px 4px', fontSize: '0.9rem'}} onClick={() => setFormData(prev => ({...prev, subactividad: ''}))}></i>
                      ) : (
                        <i className='bx bx-chevron-down' style={{position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)', pointerEvents: 'none'}}></i>
                      )}
                    </div>
                    {showSubactividadList && !(subactividadesDisponibles.includes(formData.subactividad) || apoyosGenerales.some(a => a.actividad === formData.subactividad)) && (
                      <div className="sugerencias-lista sugerencias-abajo">
                        {subactividadesDisponibles
                          .filter(sub => !formData.subactividad || sub.toLowerCase().includes(formData.subactividad.toLowerCase()))
                          .map((sub, idx) => (
                            <div key={idx} className="sugerencia-item" onClick={() => { setFormData(prev => ({...prev, subactividad: sub})); setShowSubactividadList(false) }}>
                              {capitalizar(sub)}
                            </div>
                          ))
                        }
                      </div>
                    )}
                  </div>

                  {/* Sugerencias de apoyo general seleccionado */}
                  {formData.actividad === 'APOYOS GENERALES' && formData.subactividad && (() => {
                    const apoyo = apoyosGenerales.find(a => a.actividad === formData.subactividad)
                    if (!apoyo || !apoyo.subactividades?.length) return null
                    return (
                      <div className="sugerencias-apoyo">
                        <span className="sugerencias-apoyo-label">
                          <i className='bx bx-info-circle'></i> Detalle:
                        </span>
                        <div className="sugerencias-apoyo-tags">
                          {apoyo.subactividades.map((s, i) => (
                            <span key={i} className="sugerencia-tag">{s}</span>
                          ))}
                        </div>
                      </div>
                    )
                  })()}

                  {/* Botones: Guardar e Iniciar (estado inicial) */}
                  {estadoRegistro === 'nuevo' && (
                    <div className="registro-botones" style={{display: 'flex', gap: '0.5rem'}}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={handleGuardar}
                        disabled={procesando || !formData.actividad || !formData.subactividad}
                        style={{flex: 1, opacity: procesando ? 0.6 : 1}}
                      >
                        <i className={procesando ? 'bx bx-loader-alt bx-spin' : 'bx bx-save'}></i>
                        <span className="btn-text"> Guardar</span>
                      </button>
                      <button
                        type="button"
                        className="btn btn-control"
                        onClick={handleIniciar}
                        disabled={procesando || !formData.actividad || !formData.subactividad}
                        style={{flex: 1, background: '#28a745', color: 'white', opacity: procesando ? 0.6 : 1}}
                      >
                        <i className='bx bx-play'></i>
                        <span className="btn-text"> Iniciar</span>
                      </button>
                    </div>
                  )}

                  {/* Botón: Solo Iniciar (registro guardado/pendiente) */}
                  {estadoRegistro === 'guardado' && (
                    <div className="registro-botones" style={{display: 'flex', gap: '0.5rem'}}>
                      <button
                        type="button"
                        className="btn btn-control"
                        onClick={handleIniciar}
                        disabled={procesando}
                        style={{flex: 1, background: '#28a745', color: 'white', opacity: procesando ? 0.6 : 1}}
                      >
                        <i className={procesando ? 'bx bx-loader-alt bx-spin' : 'bx bx-play'}></i>
                        <span className="btn-text"> Iniciar</span>
                      </button>
                    </div>
                  )}

                  {/* Botones: Pausar y Finalizar (después de iniciar) */}
                  {(estadoRegistro === 'iniciado' || estadoRegistro === 'pausado') && (
                    <div className="registro-botones" style={{display: 'flex', gap: '0.5rem'}}>
                      {estadoRegistro === 'iniciado' && (
                        <button
                          type="button"
                          className="btn btn-control"
                          onClick={handlePausar}
                          disabled={procesando}
                          style={{flex: 1, background: '#ffc107', color: '#000', opacity: procesando ? 0.6 : 1}}
                        >
                          <i className={procesando ? 'bx bx-loader-alt bx-spin' : 'bx bx-pause'}></i>
                          <span className="btn-text"> Pausar</span>
                        </button>
                      )}
                      {estadoRegistro === 'pausado' && (
                        <button
                          type="button"
                          className="btn btn-control"
                          onClick={handleReanudar}
                          disabled={procesando}
                          style={{flex: 1, background: '#28a745', color: 'white', opacity: procesando ? 0.6 : 1}}
                        >
                          <i className={procesando ? 'bx bx-loader-alt bx-spin' : 'bx bx-play'}></i>
                          <span className="btn-text"> Reanudar</span>
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-control"
                        onClick={handleFinalizar}
                        disabled={procesando}
                        style={{flex: 1, background: '#dc3545', color: 'white', opacity: procesando ? 0.6 : 1}}
                      >
                        <i className={procesando ? 'bx bx-loader-alt bx-spin' : 'bx bx-stop'}></i>
                        <span className="btn-text"> Finalizar</span>
                      </button>
                    </div>
                  )}
                </form>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal Checklist */}
      {showChecklist && (
        <div className="checklist-overlay" onClick={() => setShowChecklist(false)}>
          <div className="checklist-modal" onClick={(e) => e.stopPropagation()}>
            <div className="checklist-header">
              <h3><i className='bx bx-check-shield'></i> Inspección, Limpieza y Lubricación</h3>
              <span className="checklist-equipo">{formData.tractor}</span>
            </div>
            <div className="checklist-body">
              {Object.entries(checklistItems).map(([seccion, items]) => (
                <div key={seccion} className="checklist-seccion">
                  <h4 className="checklist-seccion-titulo">{seccion}</h4>
                  {items.map((item, idx) => {
                    const key = `${seccion}-${idx}`
                    return (
                      <label key={key} className={`checklist-item ${checklist[key] ? 'checked' : ''}`}>
                        <input
                          type="checkbox"
                          checked={checklist[key] || false}
                          onChange={() => handleChecklistToggle(key)}
                        />
                        <span className="checklist-checkmark">
                          <i className={`bx ${checklist[key] ? 'bx-check' : ''}`}></i>
                        </span>
                        <span className="checklist-text">{item}</span>
                      </label>
                    )
                  })}
                </div>
              ))}
            </div>
            <div className="checklist-footer">
              <span className="checklist-progreso">
                {Object.values(checklist).filter(v => v).length} / {Object.values(checklist).length} completados
              </span>
              <div style={{display: 'flex', gap: '0.5rem'}}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowChecklist(false)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleChecklistConfirm}
                >
                  <i className='bx bx-check'></i> Confirmar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Estilos */}
      <style>{`
        .registro-layout {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
        }
        
        .sugerencias-lista {
          position: absolute;
          bottom: 100%;
          top: auto;
          left: 0;
          right: 0;
          background: var(--color-bg-white);
          border: 1px solid var(--color-border);
          border-radius: 8px;
          box-shadow: 0 -4px 12px rgba(0,0,0,0.12);
          z-index: 1000;
          max-height: 200px;
          overflow-y: auto;
          margin-bottom: 4px;
        }
        
        .card-body {
          overflow: visible !important;
        }
        
        .card {
          overflow: visible !important;
        }
        
        .sugerencia-item {
          padding: 0.6rem 1rem;
          cursor: pointer;
          border-bottom: 1px solid var(--color-border);
          font-size: 0.8rem;
          color: var(--color-text-primary);
          text-transform: capitalize;
          transition: background 0.15s;
        }
        
        .sugerencia-item:last-child {
          border-bottom: none;
        }
        
        .sugerencia-item:hover {
          background: var(--color-bg-light);
          color: var(--color-text-primary);
        }
        
        .sugerencias-abajo {
          bottom: auto !important;
          top: 100% !important;
          margin-bottom: 0 !important;
          margin-top: 4px !important;
          box-shadow: 0 4px 12px rgba(0,0,0,0.12) !important;
        }
        
        .control-botones {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 1rem;
          padding-bottom: 1rem;
          border-bottom: 1px solid var(--color-border);
        }
        
        .btn-control {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          padding: 0.6rem 1rem;
          border-radius: var(--radius-md);
          font-weight: 500;
          transition: all 0.2s;
        }
        
        .btn-control:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        .form-tabs {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 1rem;
        }
        
        .form-tab {
          flex: 1;
          padding: 0.6rem 0.75rem;
          border: none;
          background: var(--color-bg-light);
          color: var(--color-text-secondary);
          cursor: pointer;
          font-weight: 500;
          font-size: 0.85rem;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.4rem;
          transition: all 0.2s;
          border-radius: var(--radius-md);
        }
        
        .form-tab:hover {
          background: var(--color-border);
        }

        .form-tab.active {
          background: var(--color-primary);
          color: var(--color-on-primary);
        }
        
        .tab-content {
          animation: fadeIn 0.3s ease;
        }
        
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        .equipo-resumen {
          background: var(--color-bg-light);
          padding: 0.75rem;
          border-radius: var(--radius-md);
          margin-bottom: 1rem;
          font-size: 0.85rem;
          border-left: 3px solid #7b1fa2;
          transition: all 0.2s;
        }
        
        .equipo-resumen:hover {
          background: var(--color-bg-white);
        }
        
        .equipo-resumen div div {
          margin-bottom: 0.25rem;
        }
        
        .equipo-resumen div div:last-child {
          margin-bottom: 0;
        }
        
        .registro-botones {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          margin-top: 1.5rem;
        }
        
        .btn-nuevo-icon {
          background: var(--color-primary);
          border: none;
          color: white;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.4rem;
          transition: all 0.2s;
          font-weight: bold;
          box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        }
        
        .btn-nuevo-icon:hover {
          transform: scale(1.1);
          box-shadow: 0 3px 6px rgba(0,0,0,0.3);
        }
        
        .header-text-mobile {
          display: none;
        }
        
        .mobile-tabs {
          display: none;
          margin-bottom: 1rem;
          gap: 0.5rem;
        }
        
        .mobile-tab {
          flex: 1;
          padding: 0.75rem;
          border: 2px solid var(--color-border);
          background: var(--color-bg-white);
          cursor: pointer;
          font-weight: 500;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          transition: all 0.3s ease;
          border-radius: var(--radius-md);
          color: var(--color-text-secondary);
        }
        
        .mobile-tab:hover {
          border-color: var(--color-primary);
        }
        
        .mobile-tab.active {
          background: var(--color-primary);
          color: var(--color-on-primary);
          border-color: var(--color-primary);
          box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        }
        
        .tabla tr.selected {
          background: color-mix(in srgb, var(--color-primary) 15%, var(--color-bg-white)) !important;
        }

        /* Colores de estado en filas */
        .tabla tbody tr {
          background: var(--color-bg-white) !important;
        }

        .tabla tbody tr:nth-child(even) {
          background: var(--color-bg-light) !important;
        }
        
        .tabla tr.estado-ejecutándose,
        .tabla tr.estado-ejecutándose:nth-child(even) {
          background: #d4edda !important;
          color: #14532d !important;
        }

        .tabla tr.estado-ejecutándose:hover {
          background: #c3e6cb !important;
        }

        .tabla tr.estado-pausado,
        .tabla tr.estado-pausado:nth-child(even) {
          background: #fffde7 !important;
          color: #7a5b00 !important;
        }

        .tabla tr.estado-pausado:hover {
          background: #fff9c4 !important;
        }
        
        @media (max-width: 1024px) {
          .registro-layout {
            display: block;
            position: relative;
            overflow: visible;
          }
          
          .mobile-tabs {
            display: flex;
          }
          
          .registro-tabla,
          .registro-formulario {
            position: absolute;
            width: 100%;
            top: 0;
            left: 0;
            opacity: 0;
            transform: translateX(-100%);
            transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            pointer-events: none;
          }
          
          .registro-formulario {
            transform: translateX(100%);
          }
          
          .registro-tabla.mobile-visible {
            position: relative;
            opacity: 1;
            transform: translateX(0);
            pointer-events: auto;
            animation: slideInLeft 0.4s cubic-bezier(0.4, 0, 0.2, 1);
          }
          
          .registro-formulario.mobile-visible {
            position: relative;
            opacity: 1;
            transform: translateX(0);
            pointer-events: auto;
            animation: slideInRight 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            overflow: visible !important;
          }
          
          @keyframes slideInLeft {
            from {
              opacity: 0;
              transform: translateX(-30px);
            }
            to {
              opacity: 1;
              transform: translateX(0);
            }
          }
          
          @keyframes slideInRight {
            from {
              opacity: 0;
              transform: translateX(30px);
            }
            to {
              opacity: 1;
              transform: translateX(0);
            }
          }
          
          .registro-botones .btn-text {
            display: none;
          }
          
          .registro-botones .btn {
            padding: 0.75rem;
          }
          
          .control-botones .btn-text {
            display: none;
          }
          
          .control-botones .btn-control {
            padding: 0.6rem;
          }
          
          .header-text-full {
            display: none;
          }
          
          .header-text-mobile {
            display: inline;
          }
          
          .form-tab {
            font-size: 0.8rem;
            padding: 0.5rem;
          }
          
          .form-tab i {
            display: none;
          }
        }
        
        @media (max-width: 768px) {
          .col-hide-1200,
          .col-hide-1400 {
            display: none;
          }
          
          .registro-formulario select.form-control {
            max-width: 100%;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          
          .registro-formulario select.form-control option {
            font-size: 0.85rem;
          }
          
          .select-capitalize {
            font-size: 0.85rem !important;
          }
          
          .registro-formulario .card-body {
            overflow: visible;
          }
          
          .registro-formulario {
            max-width: 100vw;
            overflow: visible;
          }
        }

        /* Modal Checklist */
        .checklist-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0,0,0,0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 2000;
          padding: 1rem;
          animation: fadeIn 0.2s ease;
        }

        .checklist-modal {
          background: var(--color-bg-white);
          border-radius: var(--radius-lg, 12px);
          width: 100%;
          max-width: 520px;
          max-height: 85vh;
          display: flex;
          flex-direction: column;
          box-shadow: 0 8px 32px rgba(0,0,0,0.25);
          animation: slideUp 0.3s ease;
        }

        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .checklist-header {
          padding: 1rem 1.25rem;
          border-bottom: 1px solid var(--color-border);
          background: var(--color-primary);
          color: var(--color-on-primary);
          border-radius: var(--radius-lg, 12px) var(--radius-lg, 12px) 0 0;
        }

        .checklist-header h3 {
          margin: 0;
          font-size: 1rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .checklist-equipo {
          font-size: 0.8rem;
          opacity: 0.85;
          display: block;
          margin-top: 0.25rem;
        }

        .checklist-body {
          flex: 1;
          overflow-y: auto;
          padding: 1rem 1.25rem;
        }

        .checklist-seccion {
          margin-bottom: 1rem;
        }

        .checklist-seccion:last-child {
          margin-bottom: 0;
        }

        .checklist-seccion-titulo {
          font-size: 0.85rem;
          font-weight: 600;
          color: var(--color-primary-texto);
          text-transform: uppercase;
          margin: 0 0 0.5rem 0;
          padding-bottom: 0.35rem;
          border-bottom: 2px solid var(--color-border);
        }

        .checklist-item {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          padding: 0.5rem 0.6rem;
          margin-bottom: 0.25rem;
          border-radius: var(--radius-md, 8px);
          cursor: pointer;
          transition: all 0.15s;
          user-select: none;
        }

        .checklist-item:hover {
          background: var(--color-bg-light);
        }

        .checklist-item.checked {
          background: #e8f5e9;
        }

        .checklist-item input[type="checkbox"] {
          display: none;
        }

        .checklist-checkmark {
          width: 24px;
          height: 24px;
          min-width: 24px;
          border: 2px solid var(--color-border);
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.1rem;
          color: white;
          transition: all 0.15s;
          background: var(--color-bg-white);
        }

        .checklist-item.checked .checklist-checkmark {
          background: #28a745;
          border-color: #28a745;
        }

        .checklist-text {
          font-size: 0.88rem;
          color: var(--color-text-primary);
          line-height: 1.3;
        }

        .checklist-item.checked .checklist-text {
          color: #2e7d32;
        }

        .checklist-footer {
          padding: 0.75rem 1.25rem;
          border-top: 1px solid var(--color-border);
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: var(--color-bg-light);
          border-radius: 0 0 var(--radius-lg, 12px) var(--radius-lg, 12px);
        }

        .checklist-progreso {
          font-size: 0.8rem;
          color: var(--color-text-secondary);
          font-weight: 500;
        }

        /* Sugerencias de apoyo general */
        .sugerencias-apoyo {
          background: var(--color-bg-light);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-md, 8px);
          padding: 0.6rem 0.8rem;
          margin-bottom: 1rem;
        }

        .sugerencias-apoyo-label {
          font-size: 0.78rem;
          font-weight: 600;
          color: var(--color-primary-texto);
          display: flex;
          align-items: center;
          gap: 0.3rem;
          margin-bottom: 0.4rem;
        }

        .sugerencias-apoyo-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 0.3rem;
        }

        .sugerencia-tag {
          background: var(--color-bg-white);
          border: 1px solid var(--color-border);
          border-radius: 4px;
          padding: 0.2rem 0.5rem;
          font-size: 0.72rem;
          color: var(--color-text-secondary);
        }
      `}</style>
    </>
  )
}

export default RegistrarActTractores
