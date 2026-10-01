import { useState, useEffect, useRef } from 'react'
import Swal from 'sweetalert2'
import ExcelJS from 'exceljs'
import HoraRueda from '../components/HoraRueda'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8007'

function ReporteActividades() {
  const [registros, setRegistros] = useState([])
  const [fechaActual, setFechaActual] = useState(new Date())
  const [vista, setVista] = useState('semana')
  const [loading, setLoading] = useState(true)
  const [operadoresActivos, setOperadoresActivos] = useState({})
  const [busquedaOperador, setBusquedaOperador] = useState('')
  const [tabActiva, setTabActiva] = useState('calendario') // 'calendario' o 'reporte'
  const [reporteFechaDesde, setReporteFechaDesde] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split('T')[0]
  })
  const [reporteFechaHasta, setReporteFechaHasta] = useState(() => new Date().toISOString().split('T')[0])
  const [reporteOperador, setReporteOperador] = useState('')
  const [reporteBusqueda, setReporteBusqueda] = useState('')
  const [printPreviewHtml, setPrintPreviewHtml] = useState('')
  const [showPrintPreview, setShowPrintPreview] = useState(false)
  // Filtros adicionales para Reporte
  const [reporteActividad, setReporteActividad] = useState('')
  const [reporteEquipo, setReporteEquipo] = useState('')
  const [reporteRevision, setReporteRevision] = useState('') // '' | 'NO_REVISADO' | 'REVISADO'
  // Revision en la tabla: horas editadas {id: {inicio:'HH:MM', fin:'HH:MM'}} y filas marcadas {id: true}
  const [ediciones, setEdiciones] = useState({})
  const [seleccion, setSeleccion] = useState({})
  const [guardandoRevision, setGuardandoRevision] = useState(false)
  // Revisar/aprobar horas: admin del modulo o pestana 'revisar_actividades'
  const puedeRevisar = (() => {
    try {
      const p = JSON.parse(localStorage.getItem('user_permisos_operagricola') || '{}')
      return !!p.es_admin || (p.pestanas || []).includes('revisar_actividades')
    } catch { return false }
  })()
  const [zoomLevel, setZoomLevel] = useState(50) // px por hora
  const [tooltip, setTooltip] = useState(null) // {x, y, texto}
  const printIframeRef = useRef(null)
  const gridScrollRef = useRef(null)
  useEffect(() => {
    fetchRegistros()
  }, [])

  // Scroll a las 6am al cargar
  useEffect(() => {
    if (!loading && gridScrollRef.current) {
      gridScrollRef.current.scrollTop = 6 * zoomLevel
    }
  }, [loading])

  const fetchRegistros = async () => {
    try {
      setLoading(true)
      const res = await fetch(`${API_URL}/api/registros`)
      const data = await res.json()
      setRegistros(data)
      // Se preserva la seleccion de operadores que ya tenia el usuario --
      // solo se agregan los operadores nuevos (inactivos por defecto), no
      // se reinicia todo, para que el boton de actualizar no le desmarque
      // los operadores que ya tenia elegidos.
      setOperadoresActivos(prev => {
        const ops = { ...prev }
        data.forEach(r => { if (r.usuario && !(r.usuario in ops)) ops[r.usuario] = false })
        return ops
      })
    } catch (err) {
      console.error('Error cargando registros:', err)
    } finally {
      setLoading(false)
    }
  }

  // ---- Revision (aprobacion) de horas: en la tabla, check + Guardar ----
  // Las fechas del historial vienen en hora local sin zona ('2026-10-01T14:27:05.123'):
  // se edita SOLO la hora (HH:MM); la fecha se conserva.
  const fmtFechaHora = (iso) => iso ? new Date(iso).toLocaleString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'
  const horaDe = (iso) => (iso || '').substring(11, 16)
  const conHora = (iso, hhmm) => `${(iso || '').substring(0, 10)}T${hhmm}:00`
  const eventoInicio = (r) => r.fecha_historial?.find(h => h.accion === 'inicio')
  const eventoFin = (r) => [...(r.fecha_historial || [])].reverse().find(h => h.accion === 'finalizado')
  const esRevisable = (r) => puedeRevisar && r.estado === 'Finalizado' && r.revision_estado !== 'REVISADO'
  const cantidadSeleccion = Object.values(seleccion).filter(Boolean).length

  const editarHora = (r, campo, hhmm) => {
    setEdiciones(prev => ({ ...prev, [r.id]: { ...(prev[r.id] || {}), [campo]: hhmm } }))
    setSeleccion(prev => ({ ...prev, [r.id]: true }))   // al corregir una hora se marca la fila
  }

  const guardarRevision = async () => {
    const ids = Object.keys(seleccion).filter(id => seleccion[id]).map(Number)
    if (!ids.length) return
    const conf = await Swal.fire({
      title: `¿Marcar ${ids.length} ${ids.length === 1 ? 'actividad' : 'actividades'} como REVISADAS?`,
      text: 'Se guardan con las horas que ve en la tabla y después no se podrán modificar.',
      icon: 'question', showCancelButton: true, confirmButtonText: 'Sí, guardar', cancelButtonText: 'Cancelar',
      confirmButtonColor: '#28a745'
    })
    if (!conf.isConfirmed) return
    const porId = Object.fromEntries(registros.map(r => [r.id, r]))
    const items = ids.map(id => {
      const r = porId[id]; const ed = ediciones[id] || {}
      const ini = eventoInicio(r); const fi = eventoFin(r)
      return {
        id,
        inicio: ed.inicio && ini && ed.inicio !== horaDe(ini.fecha) ? conHora(ini.fecha, ed.inicio) : null,
        fin: ed.fin && fi && ed.fin !== horaDe(fi.fecha) ? conHora(fi.fecha, ed.fin) : null,
      }
    })
    setGuardandoRevision(true)
    try {
      const resp = await fetch(`${API_URL}/api/registros/revisar-lote`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items })
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data.detail || 'No se pudo guardar la revisión')
      const nuevos = Object.fromEntries((data.revisados || []).map(r => [r.id, r]))
      setRegistros(prev => prev.map(r => nuevos[r.id] || r))
      const ok = Object.keys(nuevos).map(Number)
      setSeleccion(prev => { const n = { ...prev }; ok.forEach(id => delete n[id]); return n })
      setEdiciones(prev => { const n = { ...prev }; ok.forEach(id => delete n[id]); return n })
      if (data.errores?.length) {
        Swal.fire({ icon: 'warning', title: `${ok.length} revisadas, ${data.errores.length} con problemas`,
          html: data.errores.map(e => { const r = porId[e.id]; return `<p style="text-align:left;font-size:0.85rem;"><b>${r?.usuario || ''} · ${r?.actividad || e.id}</b><br/>${e.detalle}</p>` }).join('') })
      } else {
        Swal.fire({ icon: 'success', title: `${ok.length} ${ok.length === 1 ? 'actividad revisada' : 'actividades revisadas'}`, timer: 1300, showConfirmButton: false })
      }
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Error', text: err.message || 'Sin conexión con el servidor' })
    } finally {
      setGuardandoRevision(false)
    }
  }

  const toggleOperador = (op) => {
    setOperadoresActivos(prev => ({ ...prev, [op]: !prev[op] }))
  }

  const activarTodos = () => {
    const ops = {}
    Object.keys(operadoresActivos).forEach(k => ops[k] = true)
    setOperadoresActivos(ops)
  }

  const desactivarTodos = () => {
    const ops = {}
    Object.keys(operadoresActivos).forEach(k => ops[k] = false)
    setOperadoresActivos(ops)
  }

  // Utilidades
  const nombresMeses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
  const diasSemanaCorto = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

  const getLunesDeSemana = (fecha) => {
    const d = new Date(fecha)
    const dia = d.getDay()
    const diff = dia === 0 ? -6 : 1 - dia
    d.setDate(d.getDate() + diff)
    d.setHours(0, 0, 0, 0)
    return d
  }

  const lunes = getLunesDeSemana(fechaActual)
  const diasSemana = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(lunes)
    d.setDate(d.getDate() + i)
    return d
  })

  // 24 horas
  const horas = Array.from({ length: 24 }, (_, i) => i)

  // Mini calendario
  const anio = fechaActual.getFullYear()
  const mes = fechaActual.getMonth()
  const diasEnMes = new Date(anio, mes + 1, 0).getDate()
  const primerDiaSemana = (() => {
    const d = new Date(anio, mes, 1).getDay()
    return d === 0 ? 6 : d - 1
  })()

  // Colores por operador
  const paletaColores = ['#7b1fa2', '#1565c0', '#2e7d32', '#e65100', '#c62828', '#00838f', '#4527a0', '#ef6c00', '#283593', '#1b5e20', '#6a1b9a', '#d84315']
  const coloresOperador = {}
  let colorIdx = 0
  const getColorOperador = (operador) => {
    if (!coloresOperador[operador]) {
      coloresOperador[operador] = paletaColores[colorIdx % paletaColores.length]
      colorIdx++
    }
    return coloresOperador[operador]
  }
  // Pre-asignar colores
  Object.keys(operadoresActivos).forEach(op => getColorOperador(op))

  // Eventos - genera un segmento por cada periodo de trabajo (inicio→pausa, reanudado→pausa, reanudado→fin)
  const getEventos = () => {
    const segmentos = []
    registros
      .filter(r => r.usuario && operadoresActivos[r.usuario])
      .filter(r => r.estado !== 'Pendiente')
      .forEach(r => {
        if (!r.fecha_historial || r.fecha_historial.length === 0) return

        const historial = r.fecha_historial
        for (let i = 0; i < historial.length; i++) {
          const h = historial[i]
          if (h.accion === 'inicio' || h.accion === 'reanudado') {
            const horaInicio = new Date(h.fecha)
            let horaFin = null
            // Buscar siguiente pausa o finalizado
            for (let j = i + 1; j < historial.length; j++) {
              if (historial[j].accion === 'pausado' || historial[j].accion === 'finalizado') {
                horaFin = new Date(historial[j].fecha)
                break
              }
            }
            // Si no hay fin y está ejecutándose, hasta ahora
            if (!horaFin && r.estado === 'Ejecutándose') {
              horaFin = new Date()
            }
            if (!horaFin) continue

            segmentos.push({
              ...r,
              horaInicio,
              horaFin,
              _segId: `${r.id}-seg${i}`
            })
          }
        }
      })
    return segmentos
  }

  const eventos = getEventos()

  // Calcular tiempos desde fecha_historial
  const calcularTiempos = (historial, estado) => {
    let tiempoTrabajado = 0
    let tiempoParo = 0
    if (!historial || historial.length === 0) return { tiempoTrabajado: 0, tiempoParo: 0 }

    for (let i = 0; i < historial.length; i++) {
      const evento = historial[i]
      const fechaEvento = new Date(evento.fecha)

      if (evento.accion === 'inicio' || evento.accion === 'reanudado') {
        // Buscar siguiente pausado o finalizado
        let fin = null
        for (let j = i + 1; j < historial.length; j++) {
          if (historial[j].accion === 'pausado' || historial[j].accion === 'finalizado') {
            fin = new Date(historial[j].fecha)
            break
          }
        }
        if (!fin && estado === 'Ejecutándose') {
          fin = new Date()
        }
        if (fin) {
          tiempoTrabajado += (fin - fechaEvento) / 60000
        }
      } else if (evento.accion === 'pausado') {
        // Buscar siguiente reanudado o finalizado
        let fin = null
        for (let j = i + 1; j < historial.length; j++) {
          if (historial[j].accion === 'reanudado' || historial[j].accion === 'finalizado') {
            fin = new Date(historial[j].fecha)
            break
          }
        }
        if (fin) {
          tiempoParo += (fin - fechaEvento) / 60000
        }
      }
    }
    return { tiempoTrabajado, tiempoParo }
  }

  // Mostrar detalle del evento
  const mostrarDetalle = (evt) => {
    const formatFechaHora = (d) => d ? d.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-'
    const formatTiempo = (min) => {
      if (!min) return '0 min'
      const totalSeg = Math.round(min * 60)
      const hrs = Math.floor(totalSeg / 3600)
      const mins = Math.floor((totalSeg % 3600) / 60)
      const segs = totalSeg % 60
      if (hrs > 0) return `${hrs}h ${mins}m ${segs}s`
      if (mins > 0) return `${mins}m ${segs}s`
      return `${segs}s`
    }

    // Calcular tiempos desde historial
    const { tiempoTrabajado, tiempoParo } = calcularTiempos(evt.fecha_historial, evt.estado)

    // Construir timeline del historial
    let timelineHtml = ''
    if (evt.fecha_historial && evt.fecha_historial.length > 0) {
      const iconos = {
        inicio: '▶️',
        reanudado: '▶️',
        pausado: '⏸️',
        finalizado: '⏹️'
      }
      const etiquetas = {
        inicio: 'Inicio',
        reanudado: 'Reanudado',
        pausado: 'Pausado',
        finalizado: 'Finalizado'
      }
      const colores = {
        inicio: '#28a745',
        reanudado: '#28a745',
        pausado: '#ffc107',
        finalizado: '#6c757d'
      }

      timelineHtml = `
        <div style="margin-top:10px; border-top:1px solid var(--color-bg-light); padding-top:10px;">
          <p style="font-weight:600; margin-bottom:6px; color:#7b1fa2;">Historial de ejecución:</p>
          <div style="display:flex; flex-direction:column; gap:4px;">
            ${evt.fecha_historial.map(h => {
              const fecha = new Date(h.fecha)
              const fechaHoraStr = fecha.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit' }) + ' ' + fecha.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
              return `
                <div style="display:flex; align-items:center; gap:8px; padding:4px 8px; background:var(--color-bg-light); border-radius:4px; border-left:3px solid ${colores[h.accion] || 'var(--color-text-secondary)'};">
                  <span>${iconos[h.accion] || '⚫'}</span>
                  <span style="font-weight:500; min-width:80px;">${etiquetas[h.accion] || h.accion}</span>
                  <span style="color:var(--color-text-secondary); font-size:0.8rem;">${fechaHoraStr}</span>
                </div>
              `
            }).join('')}
          </div>
        </div>
      `
    }

    const enEjecucion = evt.estado === 'Ejecutándose'

    Swal.fire({
      title: `<span style="font-size:1rem;">${evt.actividad === 'APOYOS GENERALES' ? (evt.subactividad || 'Apoyo General') : evt.actividad}</span>`,
      html: `
        <div style="text-align:left; font-size:0.82rem; line-height:1.6;">
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px 12px; margin-bottom:8px;">
            <div><strong>Subactividad:</strong> ${evt.subactividad || '-'}</div>
            <div><strong>Operador:</strong> ${evt.usuario || '-'}</div>
            <div><strong>Tractor:</strong> ${evt.tractor || '-'}</div>
            <div><strong>Apero:</strong> ${evt.apero || '-'}</div>
            <div><strong>Lote:</strong> ${evt.lote || '-'}</div>
            <div><strong>Hacienda:</strong> ${evt.hacienda || '-'}</div>
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; background:var(--color-bg-light); padding:8px; border-radius:6px; margin-bottom:8px;">
            <div style="text-align:center;">
              <div style="font-size:0.7rem; color:var(--color-text-secondary);">Inicio</div>
              <div style="font-weight:600;">${formatFechaHora(evt.horaInicio)}</div>
            </div>
            <div style="text-align:center;">
              <div style="font-size:0.7rem; color:var(--color-text-secondary);">${enEjecucion ? 'En curso' : 'Fin'}</div>
              <div style="font-weight:600;">${enEjecucion ? '<span style="color:#28a745;">⬤ Activo</span>' : formatFechaHora(evt.horaFin)}</div>
            </div>
            <div style="text-align:center;">
              <div style="font-size:0.7rem; color:var(--color-text-secondary);">Estado</div>
              <div><span style="background:${getEstadoColor(evt.estado)};color:white;padding:2px 8px;border-radius:4px;font-size:0.72rem;">${evt.estado}</span></div>
            </div>
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; background:var(--color-bg-light); padding:8px; border-radius:6px;">
            <div style="text-align:center;">
              <div style="font-size:0.7rem; color:var(--color-text-secondary);">Tiempo trabajado</div>
              <div id="swal-tiempo-trabajado" style="font-weight:600; color:#28a745; font-size:${enEjecucion ? '1.1rem' : '0.82rem'};">${formatTiempo(tiempoTrabajado)}</div>
            </div>
            <div style="text-align:center;">
              <div style="font-size:0.7rem; color:var(--color-text-secondary);">Tiempo de paro</div>
              <div id="swal-tiempo-paro" style="font-weight:600; color:#dc3545;">${formatTiempo(tiempoParo)}</div>
            </div>
          </div>
          ${timelineHtml}
        </div>
      `,
      confirmButtonColor: '#7b1fa2',
      confirmButtonText: 'Cerrar',
      width: '480px',
      didOpen: () => {
        if (!enEjecucion) return
        // Actualizar tiempo en vivo cada segundo
        const timer = setInterval(() => {
          const { tiempoTrabajado: tt, tiempoParo: tp } = calcularTiempos(evt.fecha_historial, evt.estado)
          const elTrabajado = document.getElementById('swal-tiempo-trabajado')
          const elParo = document.getElementById('swal-tiempo-paro')
          if (elTrabajado) elTrabajado.textContent = formatTiempo(tt)
          if (elParo) elParo.textContent = formatTiempo(tp)
        }, 1000)
        // Guardar timer para limpiarlo al cerrar
        Swal.getPopup().__timer = timer
      },
      willClose: () => {
        const timer = Swal.getPopup()?.__timer
        if (timer) clearInterval(timer)
      }
    })
  }

  const getEstadoColor = (estado) => {
    switch (estado) {
      case 'Ejecutándose': return '#28a745'
      case 'Pausado': return '#ffc107'
      case 'Finalizado': return '#6c757d'
      case 'Pendiente': return '#17a2b8'
      default: return 'var(--color-text-secondary)'
    }
  }

  // Navegación
  const semanaAnterior = () => { const d = new Date(fechaActual); d.setDate(d.getDate() - 7); setFechaActual(d) }
  const semanaSiguiente = () => { const d = new Date(fechaActual); d.setDate(d.getDate() + 7); setFechaActual(d) }
  const diaAnterior = () => { const d = new Date(fechaActual); d.setDate(d.getDate() - 1); setFechaActual(d) }
  const diaSiguiente = () => { const d = new Date(fechaActual); d.setDate(d.getDate() + 1); setFechaActual(d) }
  const irHoy = () => setFechaActual(new Date())
  const mesAnteriorMini = () => setFechaActual(new Date(anio, mes - 1, fechaActual.getDate()))
  const mesSiguienteMini = () => setFechaActual(new Date(anio, mes + 1, fechaActual.getDate()))

  const esHoy = (dia) => {
    const hoy = new Date()
    return dia.getFullYear() === hoy.getFullYear() && dia.getMonth() === hoy.getMonth() && dia.getDate() === hoy.getDate()
  }
  const esMismoDia = (d1, d2) => d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate()

  const formatRango = () => {
    if (vista === 'dia') {
      return `${fechaActual.getDate()} de ${nombresMeses[fechaActual.getMonth()]} de ${fechaActual.getFullYear()}`
    }
    const inicio = diasSemana[0], fin = diasSemana[6]
    if (inicio.getMonth() === fin.getMonth()) {
      return `${inicio.getDate()}–${fin.getDate()} de ${nombresMeses[inicio.getMonth()]} de ${inicio.getFullYear()}`
    }
    return `${inicio.getDate()} ${nombresMeses[inicio.getMonth()].substring(0,3)} – ${fin.getDate()} ${nombresMeses[fin.getMonth()].substring(0,3)} ${fin.getFullYear()}`
  }

  const navAnterior = () => vista === 'semana' ? semanaAnterior() : diaAnterior()
  const navSiguiente = () => vista === 'semana' ? semanaSiguiente() : diaSiguiente()

  // Función para mostrar preview de impresión
  const mostrarPrintPreview = (html) => {
    setPrintPreviewHtml(html)
    setShowPrintPreview(true)
  }

  const imprimirDesdePreview = () => {
    if (printIframeRef.current) {
      printIframeRef.current.contentWindow.print()
    }
  }

  const generarHtmlReporte = (titulo, subtitulo, periodo, tablas) => {
    return `<html><head><title>${titulo}</title>
      <style>body{font-family:Arial,sans-serif;padding:1.5rem;font-size:11px;} h1{text-align:center;color:#7b1fa2;margin-bottom:0;} h2{text-align:center;color:var(--color-text-secondary);font-size:14px;margin-top:4px;} .info{text-align:center;color:var(--color-text-secondary);margin-bottom:1rem;font-size:11px;} table{width:100%;border-collapse:collapse;font-size:10px;margin-bottom:0.5rem;} th,td{border:1px solid #ddd;padding:3px 5px;text-align:left;} th{background:#7b1fa2;color:white;} tr:nth-child(even){background:var(--color-bg-light);} h3{color:#7b1fa2;margin-top:1.5rem;border-bottom:2px solid #7b1fa2;padding-bottom:4px;} .footer{margin-top:2rem;font-size:9px;color:var(--color-text-secondary);text-align:center;border-top:1px solid #ddd;padding-top:0.5rem;}</style>
      </head><body>
      <h1>${titulo}</h1>
      <h2>${subtitulo}</h2>
      <p class="info">Período: ${periodo}</p>
      ${tablas}
      <p class="footer">Generado el ${new Date().toLocaleString('es-EC')} — Módulo Agrícola v0.0.1</p>
      </body></html>`
  }

  const fmtMinPrint = (min) => { if (!min) return '-'; const h = Math.floor(min/60); const m = Math.round(min%60); return h > 0 ? h+'h '+m+'m' : m+'m' }

  const generarTablaOperador = (regs) => {
    return `<table>
      <thead><tr><th>Fecha</th><th>Tractor</th><th>Actividad</th><th>Subactividad</th><th>Lote</th><th>Hacienda</th><th>Inicio</th><th>Fin</th><th>T. Trabajado</th><th>T. Paro</th><th>Estado</th><th>Revisión</th></tr></thead>
      <tbody>${regs.map(r => {
        const ini = r.fecha_historial?.find(h => h.accion === 'inicio')
        const fi = r.fecha_historial?.find(h => h.accion === 'finalizado')
        return '<tr><td>'+(r.fecha_creacion ? new Date(r.fecha_creacion).toLocaleDateString('es-EC') : '-')+'</td><td>'+(r.tractor||'-')+'</td><td>'+(r.actividad||'-')+'</td><td>'+(r.subactividad||'-')+'</td><td>'+(r.lote||'-')+'</td><td>'+(r.hacienda||'-')+'</td><td>'+(ini ? new Date(ini.fecha).toLocaleTimeString('es-EC',{hour:'2-digit',minute:'2-digit'}) : '-')+'</td><td>'+(fi ? new Date(fi.fecha).toLocaleTimeString('es-EC',{hour:'2-digit',minute:'2-digit'}) : '-')+'</td><td>'+fmtMinPrint(r.tiempo_real)+'</td><td>'+fmtMinPrint(r.tiempo_paro)+'</td><td>'+(r.estado||'-')+'</td><td>'+(r.revision_estado === 'REVISADO' ? 'Revisado ('+(r.revisado_por_nombre||r.revisado_por||'')+')' : 'No revisado')+'</td></tr>'
      }).join('')}</tbody></table>`
  }

  const getReporteFiltrados = () => {
    let filtrados = registros.filter(r => r.estado !== 'Pendiente')
    if (reporteFechaDesde) filtrados = filtrados.filter(r => r.fecha_creacion && r.fecha_creacion >= reporteFechaDesde)
    if (reporteFechaHasta) filtrados = filtrados.filter(r => r.fecha_creacion && r.fecha_creacion.substring(0, 10) <= reporteFechaHasta)
    if (reporteOperador) filtrados = filtrados.filter(r => r.usuario === reporteOperador)
    if (reporteActividad) filtrados = filtrados.filter(r => r.actividad === reporteActividad)
    if (reporteEquipo) filtrados = filtrados.filter(r => r.tractor === reporteEquipo)
    if (reporteRevision) filtrados = filtrados.filter(r => (r.revision_estado || 'NO_REVISADO') === reporteRevision)
    if (reporteBusqueda) {
      const b = reporteBusqueda.toLowerCase()
      filtrados = filtrados.filter(r =>
        (r.usuario||'').toLowerCase().includes(b) ||
        (r.tractor||'').toLowerCase().includes(b) ||
        (r.actividad||'').toLowerCase().includes(b) ||
        (r.lote||'').toLowerCase().includes(b) ||
        (r.hacienda||'').toLowerCase().includes(b) ||
        (r.subactividad||'').toLowerCase().includes(b)
      )
    }
    return filtrados
  }

  const handleDescargarExcel = async () => {
    const filtrados = getReporteFiltrados()
    const porOperador = {}
    filtrados.forEach(r => { const op = r.usuario || 'Sin operador'; if (!porOperador[op]) porOperador[op] = []; porOperador[op].push(r) })

    const COLS = ['Fecha', 'Tractor', 'Actividad', 'Subactividad', 'Lote', 'Hacienda', 'Inicio', 'Fin', 'T. Trabajado (min)', 'T. Paro (min)', 'Estado', 'Revisión', 'Revisado por', 'Fecha revisión']
    const MORADO = 'FF7B1FA2'
    const BLANCO = 'FFFFFFFF'
    const GRIS_RESUMEN = 'FFD9D9E3'
    const VERDE_TOTAL = 'FFE2F0D9'

    const workbook = new ExcelJS.Workbook()

    Object.entries(porOperador).sort((a, b) => a[0].localeCompare(b[0])).forEach(([operador, regs]) => {
      const nombreHoja = operador.replace(/[\\/*?:[\]]/g, '').substring(0, 31) || 'Sin operador'
      const hoja = workbook.addWorksheet(nombreHoja)

      COLS.forEach((c, idx) => {
        const celda = hoja.getRow(1).getCell(idx + 1)
        celda.value = c
        celda.font = { bold: true, color: { argb: BLANCO } }
        celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MORADO } }
      })

      // Agrupar por tractor + dia (mismo orden en que ya vienen: por fecha_creacion desc)
      const grupos = []
      let grupoActual = null
      regs.forEach(r => {
        const diaKey = r.fecha_creacion ? r.fecha_creacion.substring(0, 10) : 'sin-fecha'
        const key = `${r.tractor || '-'}|${diaKey}`
        if (!grupoActual || grupoActual.key !== key) {
          grupoActual = { key, tractor: r.tractor || '-', dia: diaKey, regs: [] }
          grupos.push(grupoActual)
        }
        grupoActual.regs.push(r)
      })

      let fila = 2
      grupos.forEach(grupo => {
        grupo.regs.forEach(r => {
          const ini = r.fecha_historial?.find(h => h.accion === 'inicio')
          const fi = r.fecha_historial?.find(h => h.accion === 'finalizado')
          const valores = [
            r.fecha_creacion ? new Date(r.fecha_creacion).toLocaleDateString('es-EC') : '-',
            r.tractor || '-', r.actividad || '-', r.subactividad || '-', r.lote || '-', r.hacienda || '-',
            ini ? new Date(ini.fecha).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' }) : '-',
            fi ? new Date(fi.fecha).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' }) : '-',
            r.tiempo_real ? Math.round(r.tiempo_real) : 0,
            r.tiempo_paro ? Math.round(r.tiempo_paro) : 0,
            r.estado || '-',
            r.revision_estado === 'REVISADO' ? 'Revisado' : 'No revisado',
            r.revisado_por_nombre || r.revisado_por || '',
            r.fecha_revision ? fmtFechaHora(r.fecha_revision) : ''
          ]
          valores.forEach((v, idx) => { hoja.getRow(fila).getCell(idx + 1).value = v })
          fila++
        })

        // Resumen de horas del grupo (tractor + dia): total, apoyos generales, trabajo real
        const minTotal = grupo.regs.reduce((s, r) => s + (r.tiempo_real ? Math.round(r.tiempo_real) : 0), 0)
        const minApoyos = grupo.regs.filter(r => r.tipo === 'Apoyos Generales').reduce((s, r) => s + (r.tiempo_real ? Math.round(r.tiempo_real) : 0), 0)
        const minTrabajo = minTotal - minApoyos

        const filasResumen = [
          { minutos: minTotal, etiqueta: 'Horas diarias', fill: GRIS_RESUMEN },
          { minutos: minApoyos, etiqueta: 'Horas de apoyos generales', fill: GRIS_RESUMEN },
          { minutos: minTrabajo, etiqueta: 'Horas de trabajo diarias', fill: VERDE_TOTAL },
        ]
        filasResumen.forEach(({ minutos, etiqueta, fill }) => {
          const celdaMin = hoja.getRow(fila).getCell(9)
          celdaMin.value = minutos
          celdaMin.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }
          const celdaHoras = hoja.getRow(fila).getCell(10)
          celdaHoras.value = Number((minutos / 60).toFixed(2))
          celdaHoras.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }
          celdaHoras.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
          const celdaEtiqueta = hoja.getRow(fila).getCell(11)
          celdaEtiqueta.value = etiqueta
          celdaEtiqueta.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }
          fila++
        })
        fila++ // fila en blanco entre grupos
      })

      hoja.columns = COLS.map((c, idx) => {
        let max = c.length
        for (let r = 2; r < fila; r++) {
          const len = String(hoja.getRow(r).getCell(idx + 1).value ?? '').length
          if (len > max) max = len
        }
        return { width: Math.min(Math.max(max + 2, 10), 40) }
      })
      hoja.views = [{ state: 'frozen', ySplit: 1 }]
    })

    if (workbook.worksheets.length === 0) workbook.addWorksheet('Sin datos')

    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `reporte-actividades-${new Date().toISOString().split('T')[0]}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  const diasAMostrar = vista === 'semana' ? diasSemana : [fechaActual]

  if (loading) {
    return <div style={{textAlign: 'center', padding: '3rem'}}><p>Cargando...</p></div>
  }

  return (
    <div className="reporte-cal">
      {/* Tabs */}
      <div className="cal-tabs">
        <button className={`cal-tab ${tabActiva === 'calendario' ? 'cal-tab-activa' : ''}`} onClick={() => setTabActiva('calendario')}>
          <i className='bx bx-calendar'></i> Calendario
        </button>
        <button className={`cal-tab ${tabActiva === 'reporte' ? 'cal-tab-activa' : ''}`} onClick={() => setTabActiva('reporte')}>
          <i className='bx bx-file'></i> Reporte
        </button>
      </div>

      {/* Vista Reporte */}
      {tabActiva === 'reporte' && (
        <div className="reporte-vista">
          {/* Buscador general e imprimir */}
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', gap: '0.5rem'}}>
            <div style={{position: 'relative', flex: 1}}>
              <i className='bx bx-search' style={{position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)'}}></i>
              <input
                type="text"
                className="form-control"
                value={reporteBusqueda}
                onChange={e => setReporteBusqueda(e.target.value)}
                placeholder="Buscar por operador, tractor, actividad, lote..."
                style={{paddingLeft: '2rem', fontSize: '0.8rem'}}
              />
            </div>
            <button
              onClick={() => {
                const filtrados = getReporteFiltrados()
                const porOperador = {}
                filtrados.forEach(r => { const op = r.usuario || 'Sin operador'; if (!porOperador[op]) porOperador[op] = []; porOperador[op].push(r) })
                const periodo = `${reporteFechaDesde || 'Inicio'} al ${reporteFechaHasta || 'Actual'}`
                const tablas = Object.entries(porOperador).sort((a,b) => a[0].localeCompare(b[0])).map(([op, regs]) =>
                  `<h3>${op} <span style="font-size:11px;color:var(--color-text-secondary);font-weight:normal;">(${regs.length} actividades)</span></h3>${generarTablaOperador(regs)}`
                ).join('')
                mostrarPrintPreview(generarHtmlReporte('Operaciones Agrícolas', 'Actividades de Tractores', periodo, tablas))
              }}
              style={{background: '#7b1fa2', border: 'none', color: 'white', borderRadius: '6px', padding: '0.4rem 0.8rem', cursor: 'pointer', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem', whiteSpace: 'nowrap'}}
              title="Imprimir todo"
            >
              <i className='bx bx-printer'></i> Imprimir
            </button>
            {puedeRevisar && (
              <button
                onClick={guardarRevision}
                disabled={!cantidadSeleccion || guardandoRevision}
                style={{background: cantidadSeleccion ? '#28a745' : 'var(--color-bg-light)', border: 'none', color: cantidadSeleccion ? 'white' : 'var(--color-text-secondary)', borderRadius: '6px', padding: '0.4rem 0.8rem', cursor: cantidadSeleccion ? 'pointer' : 'default', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem', whiteSpace: 'nowrap'}}
                title="Marcar como REVISADAS las actividades con check (quedan bloqueadas)"
              >
                <i className={`bx ${guardandoRevision ? 'bx-loader-alt bx-spin' : 'bx-check-double'}`}></i> Guardar revisión{cantidadSeleccion ? ` (${cantidadSeleccion})` : ''}
              </button>
            )}
            <button
              onClick={handleDescargarExcel}
              style={{background: '#7b1fa2', border: 'none', color: 'white', borderRadius: '6px', padding: '0.4rem 0.8rem', cursor: 'pointer', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem', whiteSpace: 'nowrap'}}
              title="Descargar Excel (una hoja por operador)"
            >
              <i className='bx bxs-file-export'></i> Excel
            </button>
          </div>

          {/* Filtros */}
          <div style={{display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap'}}>
            {/* Botones rápidos de semana */}
            {[
              { label: 'Hoy', fn: () => { const h = new Date().toISOString().split('T')[0]; setReporteFechaDesde(h); setReporteFechaHasta(h) }},
              { label: 'Esta semana', fn: () => { const h = new Date(); const d = h.getDay(); const diff = d === 0 ? -6 : 1 - d; const lun = new Date(h); lun.setDate(h.getDate() + diff); setReporteFechaDesde(lun.toISOString().split('T')[0]); setReporteFechaHasta(new Date().toISOString().split('T')[0]) }},
              { label: 'Sem. pasada', fn: () => { const h = new Date(); const d = h.getDay(); const diff = d === 0 ? -6 : 1 - d; const lunEsta = new Date(h); lunEsta.setDate(h.getDate() + diff); const lunPas = new Date(lunEsta); lunPas.setDate(lunEsta.getDate() - 7); const domPas = new Date(lunEsta); domPas.setDate(lunEsta.getDate() - 1); setReporteFechaDesde(lunPas.toISOString().split('T')[0]); setReporteFechaHasta(domPas.toISOString().split('T')[0]) }},
              { label: 'Este mes', fn: () => { const h = new Date(); setReporteFechaDesde(new Date(h.getFullYear(), h.getMonth(), 1).toISOString().split('T')[0]); setReporteFechaHasta(new Date().toISOString().split('T')[0]) }},
            ].map(b => (
              <button key={b.label} onClick={b.fn} style={{background: 'var(--color-bg-light)', border: '1px solid var(--color-border)', color: '#7b1fa2', borderRadius: '4px', padding: '0.25rem 0.5rem', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 500, whiteSpace: 'nowrap'}}>
                {b.label}
              </button>
            ))}
            <div style={{height: '20px', width: '1px', background: 'var(--color-border)', margin: '0 0.2rem'}}></div>
            <input type="date" className="form-control" value={reporteFechaDesde} onChange={e => setReporteFechaDesde(e.target.value)} style={{fontSize: '0.75rem', padding: '0.25rem 0.4rem', maxWidth: '140px'}} />
            <span style={{fontSize: '0.72rem', color: 'var(--color-text-secondary)'}}>—</span>
            <input type="date" className="form-control" value={reporteFechaHasta} onChange={e => setReporteFechaHasta(e.target.value)} style={{fontSize: '0.75rem', padding: '0.25rem 0.4rem', maxWidth: '140px'}} />
          </div>
          <div style={{display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.8rem', flexWrap: 'wrap'}}>
            <select className="form-control" value={reporteOperador} onChange={e => setReporteOperador(e.target.value)} style={{fontSize: '0.75rem', padding: '0.25rem 0.4rem', maxWidth: '160px'}}>
              <option value="">Todos los operadores</option>
              {[...new Set(registros.map(r => r.usuario).filter(Boolean))].sort().map(op => (
                <option key={op} value={op}>{op}</option>
              ))}
            </select>
            <select className="form-control" value={reporteActividad} onChange={e => setReporteActividad(e.target.value)} style={{fontSize: '0.75rem', padding: '0.25rem 0.4rem', maxWidth: '160px'}}>
              <option value="">Todas las actividades</option>
              {[...new Set(registros.map(r => r.actividad).filter(Boolean))].sort().map(act => (
                <option key={act} value={act}>{act}</option>
              ))}
            </select>
            <select className="form-control" value={reporteEquipo} onChange={e => setReporteEquipo(e.target.value)} style={{fontSize: '0.75rem', padding: '0.25rem 0.4rem', maxWidth: '160px'}}>
              <option value="">Todos los equipos</option>
              {[...new Set(registros.map(r => r.tractor).filter(Boolean))].sort().map(eq => (
                <option key={eq} value={eq}>{eq}</option>
              ))}
            </select>
            <select className="form-control" value={reporteRevision} onChange={e => setReporteRevision(e.target.value)} style={{fontSize: '0.75rem', padding: '0.25rem 0.4rem', maxWidth: '160px'}}>
              <option value="">Revisadas y no revisadas</option>
              <option value="NO_REVISADO">No revisadas</option>
              <option value="REVISADO">Revisadas</option>
            </select>
            {(reporteOperador || reporteActividad || reporteEquipo || reporteBusqueda || reporteRevision) && (
              <button onClick={() => { setReporteOperador(''); setReporteActividad(''); setReporteEquipo(''); setReporteBusqueda(''); setReporteRevision('') }}
                style={{background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: '0.72rem', padding: '0.25rem 0.5rem', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '0.2rem'}}
                title="Limpiar filtros"
              >
                <i className='bx bx-x'></i> Limpiar
              </button>
            )}
          </div>

          {/* Tabla de reporte */}
          <div className="reporte-tabla-container">
            {(() => {
              const filtrados = getReporteFiltrados()

              // Agrupar por operador
              const porOperador = {}
              filtrados.forEach(r => {
                const op = r.usuario || 'Sin operador'
                if (!porOperador[op]) porOperador[op] = []
                porOperador[op].push(r)
              })

              if (Object.keys(porOperador).length === 0) {
                return <p style={{textAlign: 'center', color: 'var(--color-text-secondary)', padding: '2rem'}}>No hay actividades en el rango seleccionado</p>
              }

              const formatMin = (min) => { if (!min) return '-'; const h = Math.floor(min / 60); const m = Math.round(min % 60); return h > 0 ? `${h}h ${m}m` : `${m}m` }

              return Object.entries(porOperador).sort((a, b) => a[0].localeCompare(b[0])).map(([operador, regs]) => {
                const totalReal = regs.reduce((s, r) => s + (r.tiempo_real || 0), 0)
                const totalParo = regs.reduce((s, r) => s + (r.tiempo_paro || 0), 0)

                // Agrupar por día
                const porDia = {}
                regs.forEach(r => {
                  const fecha = r.fecha_creacion ? r.fecha_creacion.substring(0, 10) : 'Sin fecha'
                  if (!porDia[fecha]) porDia[fecha] = []
                  porDia[fecha].push(r)
                })

                return (
                <div key={operador} className="reporte-operador-grupo">
                  <div className="reporte-operador-header" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                    <div style={{display: 'flex', alignItems: 'center', gap: '0.8rem'}}>
                      <div>
                        <i className='bx bx-user'></i> <strong>{operador}</strong>
                        <span style={{marginLeft: '0.5rem', fontSize: '0.75rem', color: 'var(--color-text-secondary)'}}>{regs.length} actividades</span>
                      </div>
                      <span style={{color: '#28a745', fontSize: '0.78rem', fontWeight: 600}}>{formatMin(totalReal)}</span>
                      <span style={{color: '#dc3545', fontSize: '0.75rem'}}>{formatMin(totalParo)} paro</span>
                    </div>
                    <button
                      onClick={() => {
                        const periodo = `${reporteFechaDesde || 'Inicio'} al ${reporteFechaHasta || 'Actual'}`
                        const tablas = `<h3>${operador} <span style="font-size:11px;color:var(--color-text-secondary);font-weight:normal;">(${regs.length} actividades)</span></h3>${generarTablaOperador(regs)}`
                        mostrarPrintPreview(generarHtmlReporte('Operaciones Agrícolas', 'Actividades de Tractores', periodo, tablas))
                      }}
                      style={{background: 'transparent', border: '1px solid var(--color-border)', borderRadius: '4px', padding: '0.3rem 0.5rem', cursor: 'pointer', color: '#7b1fa2', fontSize: '0.85rem'}}
                      title="Imprimir reporte"
                    >
                      <i className='bx bx-printer'></i>
                    </button>
                  </div>

                  {Object.entries(porDia).sort((a, b) => b[0].localeCompare(a[0])).map(([fecha, regsDia]) => {
                    const horasDia = regsDia.reduce((s, r) => s + (r.tiempo_real || 0), 0)
                    const paroDia = regsDia.reduce((s, r) => s + (r.tiempo_paro || 0), 0)
                    const fechaLabel = fecha !== 'Sin fecha'
                      ? new Date(fecha + 'T12:00:00').toLocaleDateString('es-EC', {weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'})
                      : 'Sin fecha'
                    return (
                      <div key={fecha} style={{marginBottom: '0.3rem'}}>
                        <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.3rem 0.8rem', background: 'var(--color-bg-light)', borderLeft: '2px solid var(--color-border)', fontSize: '0.76rem'}}>
                          <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                            <i className='bx bx-calendar' style={{color: 'var(--color-primary-texto)', fontSize: '0.85rem'}}></i>
                            <span style={{fontWeight: 600, color: 'var(--color-text-primary)', textTransform: 'capitalize'}}>{fechaLabel}</span>
                            <span style={{color: 'var(--color-text-secondary)', fontSize: '0.7rem'}}>{regsDia.length} {regsDia.length === 1 ? 'actividad' : 'actividades'}</span>
                          </div>
                          <div style={{display: 'flex', gap: '0.8rem'}}>
                            <span style={{color: '#28a745', fontWeight: 600}}>{formatMin(horasDia)}</span>
                            <span style={{color: '#dc3545', fontSize: '0.72rem'}}>{formatMin(paroDia)} paro</span>
                          </div>
                        </div>
                        <div style={{overflowX: 'auto'}}>
                          <table className="tabla" style={{fontSize: '0.78rem'}}>
                            <thead>
                              <tr>
                                <th>Tractor</th>
                                <th>Actividad</th>
                                <th>Subactividad</th>
                                <th>Lote</th>
                                <th>Hacienda</th>
                                <th>Inicio</th>
                                <th>Fin</th>
                                <th>T. Trabajado</th>
                                <th>T. Paro</th>
                                <th>Estado</th>
                                <th style={{whiteSpace: 'nowrap'}}>
                                  {puedeRevisar && regsDia.some(esRevisable) ? (
                                    <label style={{display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer'}} title="Marcar todas las del día">
                                      <input type="checkbox"
                                        checked={regsDia.filter(esRevisable).every(r => seleccion[r.id])}
                                        onChange={e => { const v = e.target.checked; setSeleccion(prev => { const n = { ...prev }; regsDia.filter(esRevisable).forEach(r => { n[r.id] = v }); return n }) }} />
                                      Revisión
                                    </label>
                                  ) : 'Revisión'}
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {regsDia.map(r => {
                                const inicio = r.fecha_historial?.find(h => h.accion === 'inicio')
                                const fin = eventoFin(r)
                                return (
                                  <tr key={r.id}>
                                    <td>{r.tractor || '-'}</td>
                                    <td><strong>{r.actividad === 'APOYOS GENERALES' ? (r.subactividad || 'Apoyo General') : (r.actividad || '-')}</strong></td>
                                    <td>{r.actividad === 'APOYOS GENERALES' ? 'Apoyo General' : (r.subactividad || '-')}</td>
                                    <td>{r.lote || '-'}</td>
                                    <td>{r.hacienda || '-'}</td>
                                    {[['inicio', inicio], ['fin', fin]].map(([campo, ev]) => (
                                      <td key={campo}>
                                        {esRevisable(r) && ev ? (
                                          <HoraRueda
                                            value={ediciones[r.id]?.[campo] || horaDe(ev.fecha)}
                                            modificado={!!ediciones[r.id]?.[campo] && ediciones[r.id][campo] !== horaDe(ev.fecha)}
                                            onChange={hhmm => editarHora(r, campo, hhmm)} />
                                        ) : (ev ? new Date(ev.fecha).toLocaleTimeString('es-EC', {hour:'2-digit', minute:'2-digit'}) : '-')}
                                      </td>
                                    ))}
                                    <td style={{color: '#28a745', fontWeight: 500}}>{formatMin(r.tiempo_real)}</td>
                                    <td style={{color: '#dc3545', fontWeight: 500}}>{formatMin(r.tiempo_paro)}</td>
                                    <td><span style={{background: r.estado === 'Finalizado' ? '#6c757d' : r.estado === 'Ejecutándose' ? '#28a745' : '#ffc107', color: 'white', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem'}}>{r.estado}</span></td>
                                    <td>
                                      {r.revision_estado === 'REVISADO' ? (
                                        <span title={`Revisado por ${r.revisado_por_nombre || r.revisado_por || '-'} el ${fmtFechaHora(r.fecha_revision)}`}
                                          style={{background: '#1b5e20', color: 'white', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', whiteSpace: 'nowrap', cursor: 'help'}}>
                                          <i className='bx bxs-lock-alt'></i> Revisado
                                        </span>
                                      ) : esRevisable(r) ? (
                                        <label style={{display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer', fontSize: '0.7rem', whiteSpace: 'nowrap'}} title="Marcar para guardar como revisada">
                                          <input type="checkbox" checked={!!seleccion[r.id]}
                                            onChange={e => setSeleccion(prev => ({ ...prev, [r.id]: e.target.checked }))} />
                                          No revisado
                                        </label>
                                      ) : (
                                        <span style={{color: 'var(--color-text-secondary)', fontSize: '0.7rem', whiteSpace: 'nowrap'}}>No revisado</span>
                                      )}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )})
            })()}
          </div>
        </div>
      )}


      {/* Vista Calendario */}
      {tabActiva === 'calendario' && (<>
      {/* Toolbar */}
      <div className="cal-toolbar">
        <div className="cal-toolbar-left">
          <h2 className="cal-toolbar-title"><i className='bx bx-calendar'></i> Calendario</h2>
        </div>
        <div className="cal-toolbar-center">
          <button className="cal-btn-hoy" onClick={irHoy}>Hoy</button>
          <button className="cal-btn-nav" onClick={navAnterior}><i className='bx bx-chevron-left'></i></button>
          <button className="cal-btn-nav" onClick={navSiguiente}><i className='bx bx-chevron-right'></i></button>
          <span className="cal-rango">{formatRango()}</span>
        </div>
        <div className="cal-toolbar-right">
          <div className="cal-zoom-controls">
            <button className="cal-btn-zoom" onClick={() => setZoomLevel(z => Math.max(25, z - 15))} title="Alejar"><i className='bx bx-minus'></i></button>
            <span className="cal-zoom-label" title="Zoom">{Math.round(zoomLevel / 50 * 100)}%</span>
            <button className="cal-btn-zoom" onClick={() => setZoomLevel(z => Math.min(150, z + 15))} title="Acercar"><i className='bx bx-plus'></i></button>
          </div>
          <select className="cal-select-vista" value={vista} onChange={e => setVista(e.target.value)}>
            <option value="semana">Semana</option>
            <option value="dia">Día</option>
          </select>
          <button className="cal-btn-zoom" onClick={fetchRegistros} disabled={loading} title="Actualizar">
            <i className={`bx bx-refresh ${loading ? 'cal-icon-girando' : ''}`}></i>
          </button>
        </div>
      </div>

      <div className="cal-layout">
        {/* Sidebar */}
        <div className="cal-sidebar">
          {/* Mini calendario */}
          <div className="cal-mini">
            <div className="cal-mini-header">
              <button className="cal-mini-nav" onClick={mesAnteriorMini}><i className='bx bx-chevron-up'></i></button>
              <span className="cal-mini-titulo">{nombresMeses[mes]} {anio}</span>
              <button className="cal-mini-nav" onClick={mesSiguienteMini}><i className='bx bx-chevron-down'></i></button>
            </div>
            <div className="cal-mini-grid">
              {['L','M','X','J','V','S','D'].map(d => (
                <div key={d} className="cal-mini-dia-header">{d}</div>
              ))}
              {Array.from({ length: primerDiaSemana }, (_, i) => (
                <div key={`e-${i}`} className="cal-mini-celda"></div>
              ))}
              {Array.from({ length: diasEnMes }, (_, i) => {
                const dia = i + 1
                const fecha = new Date(anio, mes, dia)
                const selected = esMismoDia(fecha, fechaActual)
                const hoy = esHoy(fecha)
                const enSemana = diasSemana.some(d => esMismoDia(d, fecha))
                return (
                  <div
                    key={dia}
                    className={`cal-mini-celda ${selected ? 'cal-mini-selected' : ''} ${hoy ? 'cal-mini-hoy' : ''} ${enSemana ? 'cal-mini-en-semana' : ''}`}
                    onClick={() => setFechaActual(fecha)}
                  >
                    {dia}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Filtro operadores */}
          <div className="cal-leyenda">
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem'}}>
              <h4 style={{fontSize: '0.8rem', margin: 0, color: 'var(--color-text-primary)'}}>Operadores</h4>
              <div style={{display: 'flex', gap: '0.3rem'}}>
                <button className="cal-btn-mini" onClick={activarTodos} title="Mostrar todos">
                  <i className='bx bx-show'></i>
                </button>
                <button className="cal-btn-mini" onClick={desactivarTodos} title="Ocultar todos">
                  <i className='bx bx-hide'></i>
                </button>
              </div>
            </div>
            <input
              type="text"
              placeholder="Buscar operador..."
              value={busquedaOperador}
              onChange={(e) => setBusquedaOperador(e.target.value)}
              style={{
                width: '100%',
                padding: '0.3rem 0.5rem',
                border: '1px solid var(--color-border)',
                borderRadius: '4px',
                fontSize: '0.7rem',
                marginBottom: '0.5rem',
                outline: 'none',
                background: 'var(--color-bg-white)',
                color: 'var(--color-text-primary)'
              }}
            />
            <div style={{maxHeight: '300px', overflowY: 'auto'}}>
              {Object.keys(operadoresActivos)
                .filter(op => !busquedaOperador || op.toLowerCase().includes(busquedaOperador.toLowerCase()))
                .sort()
                .map(op => (
                <div
                  key={op}
                  className={`cal-leyenda-item ${operadoresActivos[op] ? '' : 'cal-leyenda-inactivo'}`}
                  onClick={() => toggleOperador(op)}
                >
                  <span className="cal-leyenda-check">
                    {operadoresActivos[op] 
                      ? <i className='bx bxs-checkbox-checked' style={{color: getColorOperador(op)}}></i>
                      : <i className='bx bx-checkbox' style={{color: 'var(--color-border)'}}></i>
                    }
                  </span>
                  <span className="cal-leyenda-dot" style={{background: operadoresActivos[op] ? getColorOperador(op) : 'var(--color-border)'}}></span>
                  <span>{op}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Grid principal */}
        <div className="cal-main">
          {/* Header días */}
          <div className="cal-dias-header">
            <div className="cal-hora-col"></div>
            {diasAMostrar.map((dia, idx) => (
              <div key={idx} className={`cal-dia-col-header ${esHoy(dia) ? 'cal-dia-hoy' : ''}`}>
                <span className="cal-dia-nombre">{diasSemanaCorto[dia.getDay() === 0 ? 6 : dia.getDay() - 1]}</span>
                <span className={`cal-dia-numero ${esHoy(dia) ? 'cal-numero-hoy' : ''}`}>{dia.getDate().toString().padStart(2, '0')}</span>
              </div>
            ))}
          </div>

          {/* Grid horas */}
          <div className="cal-grid-scroll" ref={gridScrollRef}>
            <div className="cal-grid-body">
              {/* Filas de hora (solo las líneas) */}
              {horas.map(hora => (
                <div key={hora} className="cal-fila-hora" style={{minHeight: `${zoomLevel}px`}}>
                  <div className="cal-hora-label">{hora.toString().padStart(2,'0')}:00</div>
                  {diasAMostrar.map((dia, idx) => (
                    <div key={idx} className="cal-celda-hora" style={{minHeight: `${zoomLevel}px`}}></div>
                  ))}
                </div>
              ))}

              {/* Eventos posicionados absolutamente */}
              {diasAMostrar.map((dia, diaIdx) => {
                // Incluir eventos que empezaron este día O que cruzan a este día
                const diaStart = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), 0, 0, 0)
                const diaEnd = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), 23, 59, 59)
                const eventosDia = eventos.filter(e =>
                  (e.horaInicio >= diaStart && e.horaInicio <= diaEnd) ||
                  (e.horaInicio < diaStart && e.horaFin > diaStart)
                )

                // Calcular posición vertical
                const eventosConPos = eventosDia.map(evt => {
                  // Si el evento empezó antes de este día, empieza a las 0:00
                  const empiezaEsteDia = evt.horaInicio.getFullYear() === dia.getFullYear() &&
                    evt.horaInicio.getMonth() === dia.getMonth() &&
                    evt.horaInicio.getDate() === dia.getDate()
                  const horaInicioDecimal = empiezaEsteDia
                    ? evt.horaInicio.getHours() + evt.horaInicio.getMinutes() / 60
                    : 0

                  const terminaEsteDia = evt.horaFin &&
                    evt.horaFin.getFullYear() === dia.getFullYear() &&
                    evt.horaFin.getMonth() === dia.getMonth() &&
                    evt.horaFin.getDate() === dia.getDate()
                  let horaFinDecimal = terminaEsteDia
                    ? evt.horaFin.getHours() + evt.horaFin.getMinutes() / 60
                    : 24

                  if (!evt.horaFin) horaFinDecimal = horaInicioDecimal + 0.25

                  return { ...evt, inicio: horaInicioDecimal, fin: Math.max(horaFinDecimal, horaInicioDecimal + 0.15) }
                }).sort((a, b) => a.inicio - b.inicio)

                // Asignar columnas solo cuando DIFERENTES operadores se solapan
                // Para un mismo operador, los eventos son secuenciales (no se solapan)
                const operadoresUnicos = [...new Set(eventosConPos.map(e => e.usuario))]
                
                if (operadoresUnicos.length <= 1) {
                  // Un solo operador: todo en una columna, sin solapamiento
                  eventosConPos.forEach(evt => { evt.col = 0 })
                  var totalColumnas = 1
                } else {
                  // Múltiples operadores: asignar una columna por operador
                  const colPorOperador = {}
                  operadoresUnicos.forEach((op, idx) => { colPorOperador[op] = idx })
                  eventosConPos.forEach(evt => { evt.col = colPorOperador[evt.usuario] })
                  var totalColumnas = operadoresUnicos.length
                }

                return eventosConPos.map((evt, evtIdx) => {
                  const totalDias = diasAMostrar.length
                  // Calcular posición horizontal dentro del grid
                  // El grid tiene: 50px (hora) + el resto repartido entre los días
                  const colWidth = `calc((100% - 50px) / ${totalDias})`
                  const evtWidth = `calc((100% - 50px) / ${totalDias} / ${totalColumnas} - 4px)`
                  const evtLeft = `calc(50px + (100% - 50px) / ${totalDias} * ${diaIdx} + (100% - 50px) / ${totalDias} / ${totalColumnas} * ${evt.col} + 2px)`
                  const color = getColorOperador(evt.usuario)

                  // Limitar al rango del día (0-24)
                  const inicioLimitado = Math.max(evt.inicio, 0)
                  const finLimitado = Math.min(evt.fin, 24)
                  if (inicioLimitado >= finLimitado) return null

                  const top = inicioLimitado * zoomLevel
                  const height = Math.max((finLimitado - inicioLimitado) * zoomLevel, 12)

                  const actLabel = evt.actividad === 'APOYOS GENERALES' ? (evt.subactividad || 'Apoyo General') : evt.actividad
                  const horaIniStr = evt.horaInicio.toLocaleTimeString('es-EC', {hour:'2-digit', minute:'2-digit'})
                  const horaFinStr = evt.horaFin ? evt.horaFin.toLocaleTimeString('es-EC', {hour:'2-digit', minute:'2-digit'}) : 'En curso'

                  return (
                    <div
                      key={`evt-${evt._segId || evt.id}-${evtIdx}`}
                      className="cal-evento-abs"
                      style={{
                        top: `${top}px`,
                        height: `${height}px`,
                        left: evtLeft,
                        width: evtWidth,
                        borderLeftColor: color
                      }}
                      onClick={() => mostrarDetalle(evt)}
                      onMouseEnter={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect()
                        setTooltip({
                          x: rect.left + rect.width / 2,
                          y: rect.top - 4,
                          operador: evt.usuario,
                          actividad: actLabel,
                          tractor: evt.tractor || '',
                          hora: `${horaIniStr} - ${horaFinStr}`,
                          color
                        })
                      }}
                      onMouseLeave={() => setTooltip(null)}
                    >
                      <div className="cal-evento-content" style={{background: color + '18'}}>
                        <span className="cal-evento-titulo">
                          <span className="cal-evento-dot" style={{background: color}}></span>
                          {actLabel}
                        </span>
                        {height > 25 && <span className="cal-evento-sub">{evt.usuario}</span>}
                      </div>
                    </div>
                  )
                })
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Tooltip flotante */}
      {tooltip && (
        <div className="cal-tooltip" style={{
          left: `${tooltip.x}px`,
          top: `${tooltip.y}px`,
        }}>
          <div className="cal-tooltip-header" style={{borderLeftColor: tooltip.color}}>
            <strong>{tooltip.operador}</strong>
          </div>
          <div className="cal-tooltip-body">
            <span>{tooltip.actividad}</span>
            {tooltip.tractor && <span className="cal-tooltip-dim">{tooltip.tractor}</span>}
            <span className="cal-tooltip-dim">{tooltip.hora}</span>
          </div>
        </div>
      )}
      </>)}

      {/* Modal de preview de impresión */}
      {showPrintPreview && (
        <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem'}}>
          <div style={{background: 'var(--color-bg-white)', borderRadius: '12px', width: '90vw', maxWidth: '900px', height: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.3)'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.8rem 1.2rem', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-light)'}}>
              <span style={{fontWeight: 600, color: 'var(--color-text-primary)'}}>Vista previa de impresión</span>
              <div style={{display: 'flex', gap: '0.5rem'}}>
                <button onClick={imprimirDesdePreview} style={{background: '#7b1fa2', color: 'white', border: 'none', borderRadius: '6px', padding: '0.4rem 1rem', cursor: 'pointer', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem'}}>
                  <i className='bx bx-printer'></i> Imprimir
                </button>
                <button onClick={() => setShowPrintPreview(false)} style={{background: 'var(--color-border)', border: 'none', borderRadius: '6px', padding: '0.4rem 0.7rem', cursor: 'pointer', fontSize: '1rem', color: 'var(--color-text-secondary)'}}>
                  <i className='bx bx-x'></i>
                </button>
              </div>
            </div>
            <iframe
              ref={printIframeRef}
              srcDoc={printPreviewHtml}
              style={{flex: 1, border: 'none', width: '100%', background: 'white'}}
              title="Print Preview"
            />
          </div>
        </div>
      )}

      <style>{`
        .reporte-cal {
          height: calc(100vh - 60px);
          display: flex;
          flex-direction: column;
          background: var(--color-bg-light);
          color: var(--color-text-primary);
          overflow: hidden;
        }

        .cal-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.6rem 1.2rem;
          border-bottom: 1px solid var(--color-border);
          background: var(--color-bg-white);
          box-shadow: 0 1px 3px rgba(0,0,0,0.04);
        }

        .cal-toolbar-title {
          font-size: 1.1rem;
          font-weight: 600;
          margin: 0;
          color: #7b1fa2;
          display: flex;
          align-items: center;
          gap: 0.4rem;
        }

        .cal-toolbar-center {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .cal-toolbar-right {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .cal-btn-hoy {
          background: #7b1fa2;
          border: none;
          color: var(--color-bg-white);
          padding: 0.35rem 0.9rem;
          border-radius: 6px;
          cursor: pointer;
          font-size: 0.8rem;
          font-weight: 500;
        }
        .cal-btn-hoy:hover { background: #6a1b9a; }

        .cal-btn-nav {
          background: transparent;
          border: none;
          color: var(--color-text-secondary);
          cursor: pointer;
          font-size: 1.3rem;
          padding: 0.2rem 0.4rem;
          border-radius: 4px;
        }
        .cal-btn-nav:hover { background: var(--color-bg-light); color: #7b1fa2; }

        .cal-rango {
          font-size: 0.9rem;
          color: var(--color-text-primary);
          font-weight: 500;
        }

        .cal-select-vista {
          background: var(--color-bg-white);
          border: 1px solid var(--color-border);
          color: var(--color-text-primary);
          padding: 0.35rem 0.7rem;
          border-radius: 6px;
          font-size: 0.8rem;
          cursor: pointer;
        }

        .cal-layout {
          display: flex;
          flex: 1;
          overflow: hidden;
        }

        /* Sidebar */
        .cal-sidebar {
          width: 210px;
          border-right: 1px solid var(--color-border);
          padding: 1rem 0.8rem;
          overflow-y: auto;
          background: var(--color-bg-white);
        }

        .cal-mini-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 0.5rem;
        }

        .cal-mini-titulo {
          font-size: 0.78rem;
          font-weight: 600;
          color: var(--color-text-primary);
        }

        .cal-mini-nav {
          background: transparent;
          border: none;
          color: var(--color-text-secondary);
          cursor: pointer;
          font-size: 1rem;
          padding: 0.1rem;
          border-radius: 4px;
        }
        .cal-mini-nav:hover { background: var(--color-bg-light); }

        .cal-mini-grid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 1px;
          margin-bottom: 1rem;
        }

        .cal-mini-dia-header {
          text-align: center;
          font-size: 0.6rem;
          color: var(--color-text-secondary);
          padding: 3px 0;
          font-weight: 600;
        }

        .cal-mini-celda {
          text-align: center;
          font-size: 0.65rem;
          padding: 3px 0;
          border-radius: 50%;
          cursor: pointer;
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto;
          color: var(--color-text-primary);
          transition: all 0.15s;
        }
        .cal-mini-celda:hover { background: var(--color-bg-light); }
        .cal-mini-selected { background: #7b1fa2 !important; color: white !important; font-weight: bold; }
        .cal-mini-hoy { border: 2px solid #7b1fa2; font-weight: bold; }
        .cal-mini-en-semana { background: var(--color-bg-light); }

        .cal-leyenda { margin-top: 0.5rem; }

        .cal-btn-mini {
          background: transparent;
          border: 1px solid var(--color-border);
          color: var(--color-text-secondary);
          cursor: pointer;
          font-size: 0.75rem;
          padding: 0.15rem 0.3rem;
          border-radius: 4px;
        }
        .cal-btn-mini:hover { background: var(--color-bg-light); }

        .cal-leyenda-item {
          display: flex;
          align-items: center;
          gap: 0.35rem;
          font-size: 0.75rem;
          padding: 0.3rem 0.4rem;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.15s;
          color: var(--color-text-primary);
        }
        .cal-leyenda-item:hover { background: var(--color-bg-light); }
        .cal-leyenda-inactivo { opacity: 0.5; }
        .cal-leyenda-inactivo span:last-child { text-decoration: line-through; }

        .cal-leyenda-check { font-size: 1rem; display: flex; }
        .cal-leyenda-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        /* Main grid */
        .cal-main {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background: var(--color-bg-white);
        }

        .cal-dias-header {
          display: flex;
          border-bottom: 2px solid var(--color-border);
          background: var(--color-bg-white);
          position: sticky;
          top: 0;
          z-index: 10;
          min-width: 900px;
        }

        .cal-hora-col { width: 50px; flex-shrink: 0; }

        .cal-dia-col-header {
          flex: 1;
          min-width: 120px;
          text-align: center;
          padding: 0.6rem 0 0.4rem;
          border-left: 1px solid var(--color-border);
        }

        .cal-dia-hoy { background: var(--color-bg-light); }

        .cal-dia-nombre {
          display: block;
          font-size: 0.68rem;
          color: var(--color-text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .cal-dia-numero {
          display: block;
          font-size: 1.4rem;
          font-weight: 700;
          color: var(--color-text-primary);
        }

        .cal-numero-hoy {
          color: var(--color-primary-texto);
          background: var(--color-bg-light);
          border-radius: 50%;
          width: 32px;
          height: 32px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .cal-grid-scroll { flex: 1; overflow-y: auto; overflow-x: auto; }
        .cal-grid-body { position: relative; min-width: 900px; }

        .cal-fila-hora {
          display: flex;
          min-height: 50px;
          border-bottom: 1px solid var(--color-border);
        }
        .cal-fila-hora:hover { background: var(--color-bg-light); }

        .cal-hora-label {
          width: 50px;
          flex-shrink: 0;
          font-size: 0.68rem;
          color: var(--color-text-secondary);
          padding: 0.15rem 0.4rem 0 0;
          text-align: right;
          font-weight: 500;
        }

        .cal-celda-hora {
          flex: 1;
          min-width: 120px;
          border-left: 1px solid var(--color-border);
          min-height: 50px;
        }

        /* Eventos absolutos */
        .cal-evento-abs {
          position: absolute;
          border-left: 3px solid #7b1fa2;
          border-radius: 4px;
          cursor: pointer;
          overflow: hidden;
          z-index: 5;
          transition: transform 0.1s, box-shadow 0.1s;
        }
        .cal-evento-abs:hover {
          transform: scale(1.02);
          box-shadow: 0 2px 8px rgba(0,0,0,0.15);
          z-index: 10;
        }

        .cal-evento-content {
          display: flex;
          flex-direction: column;
          gap: 1px;
          padding: 3px 6px;
          height: 100%;
          background: var(--color-bg-light);
          border-radius: 0 4px 4px 0;
        }

        .cal-evento-pausa {
          position: absolute;
          left: 3px;
          right: 0;
          background: repeating-linear-gradient(
            45deg,
            rgba(255,193,7,0.15),
            rgba(255,193,7,0.15) 3px,
            rgba(255,193,7,0.05) 3px,
            rgba(255,193,7,0.05) 6px
          );
          border-left: 2px solid #ffc107;
          z-index: 1;
        }

        .cal-evento-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          flex-shrink: 0;
          display: inline-block;
        }

        .cal-evento-titulo {
          font-weight: 600;
          color: var(--color-text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-size: 0.65rem;
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .cal-evento-sub {
          font-size: 0.6rem;
          color: var(--color-text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* Zoom controls */
        .cal-zoom-controls {
          display: flex;
          align-items: center;
          gap: 2px;
          background: var(--color-bg-light);
          border-radius: 6px;
          padding: 2px;
        }
        .cal-btn-zoom {
          background: transparent;
          border: none;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 4px;
          color: var(--color-text-secondary);
          font-size: 0.85rem;
          display: flex;
          align-items: center;
          transition: background 0.15s;
        }
        .cal-btn-zoom:hover { background: var(--color-border); }
        .cal-btn-zoom:disabled { cursor: default; opacity: 0.6; }
        .cal-icon-girando { animation: cal-girar 0.8s linear infinite; }
        @keyframes cal-girar {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .cal-zoom-label {
          font-size: 0.7rem;
          color: var(--color-text-secondary);
          min-width: 36px;
          text-align: center;
          font-weight: 500;
        }

        /* Tooltip */
        .cal-tooltip {
          position: fixed;
          transform: translate(-50%, -100%);
          background: #1e1e2e;
          color: var(--color-bg-white);
          border-radius: 8px;
          padding: 0;
          box-shadow: 0 4px 16px rgba(0,0,0,0.3);
          z-index: 9999;
          pointer-events: none;
          min-width: 160px;
          max-width: 260px;
          overflow: hidden;
        }
        .cal-tooltip-header {
          padding: 6px 10px;
          border-left: 4px solid #7b1fa2;
          background: rgba(255,255,255,0.08);
          font-size: 0.78rem;
        }
        .cal-tooltip-body {
          padding: 5px 10px 8px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          font-size: 0.73rem;
        }
        .cal-tooltip-dim {
          color: var(--color-text-secondary);
          font-size: 0.68rem;
        }

        @media (max-width: 768px) {
          .cal-sidebar { display: none; }
          .cal-toolbar-title { display: none; }
          .cal-hora-col, .cal-hora-label { width: 36px; }
          .cal-dia-numero { font-size: 1rem; }
          .cal-evento { font-size: 0.58rem; }
          .cal-toolbar { padding: 0.4rem 0.6rem; }
          .cal-rango { font-size: 0.75rem; }
        }

        /* Tabs */
        .cal-tabs {
          display: flex;
          border-bottom: 2px solid var(--color-border);
          background: var(--color-bg-white);
          padding: 0 1rem;
        }
        .cal-tab {
          padding: 0.6rem 1.2rem;
          border: none;
          background: transparent;
          cursor: pointer;
          font-size: 0.85rem;
          font-weight: 500;
          color: var(--color-text-secondary);
          border-bottom: 2px solid transparent;
          margin-bottom: -2px;
          display: flex;
          align-items: center;
          gap: 0.4rem;
          transition: all 0.2s;
        }
        .cal-tab:hover { color: #7b1fa2; }
        .cal-tab-activa {
          color: #7b1fa2;
          border-bottom-color: #7b1fa2;
        }

        /* Reporte */
        .reporte-vista {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          padding: 1rem;
        }
        .reporte-filtros {
          display: flex;
          gap: 0.8rem;
          align-items: flex-end;
          margin-bottom: 1rem;
          flex-wrap: wrap;
        }
        .reporte-tabla-container {
          flex: 1;
          overflow-y: auto;
        }
        .reporte-operador-grupo {
          margin-bottom: 1.5rem;
        }
        .reporte-operador-header {
          background: var(--color-bg-light);
          padding: 0.5rem 0.8rem;
          border-radius: 6px;
          margin-bottom: 0.5rem;
          font-size: 0.85rem;
          border-left: 3px solid #7b1fa2;
        }
      `}</style>
    </div>
  )
}

export default ReporteActividades
