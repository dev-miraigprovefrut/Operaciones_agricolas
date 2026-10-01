import { useState, useEffect, useRef } from 'react'
import Swal from 'sweetalert2'
import ExcelJS from 'exceljs'
import { obtenerEmpresaNintanga, logoUrl } from '../services/empresasService'


const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8007'

function ReportesCosecha() {
  const [fichas, setFichas] = useState([])
  const [empresaTema, setEmpresaTema] = useState(null)
  useEffect(() => { obtenerEmpresaNintanga().then(setEmpresaTema) }, [])
  const [loading, setLoading] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('Todos')
  const [fechaDesde, setFechaDesde] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0]
  })
  const [fechaHasta, setFechaHasta] = useState(() => new Date().toISOString().split('T')[0])
  const [hoverFichaId, setHoverFichaId] = useState(null)
  const [fichaEditar, setFichaEditar] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [productosEdit, setProductosEdit] = useState([])
  const [camionEdit, setCamionEdit] = useState({ placa: '', nombre_chofer: '', propietario: '', id_camion: null })
  const [horaEnvioEdit, setHoraEnvioEdit] = useState('')
  const [guardandoHoraEnvio, setGuardandoHoraEnvio] = useState(false)
  const [sincronizando, setSincronizando] = useState(false)

  const handleSincronizarAhora = async () => {
    if (!fichaEditar) return
    setSincronizando(true)
    try {
      const res = await fetch(`${API_URL}/api/cosecha-transp/${fichaEditar.id}/sincronizar`, { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        await fetchData()
        const yaRecibido = !!data.recibidos
        Swal.fire({ icon: yaRecibido ? 'success' : 'info', title: yaRecibido ? 'Sincronizado' : 'Todavia no', text: data.message || 'Se reviso Informix.', timer: yaRecibido ? 2500 : undefined, showConfirmButton: !yaRecibido })
      } else {
        Swal.fire('Error', 'No se pudo sincronizar', 'error')
      }
    } catch {
      Swal.fire('Error', 'Error de conexión', 'error')
    } finally {
      setSincronizando(false)
    }
  }
  const [camiones, setCamiones] = useState([])
  const [placaBusqueda, setPlacaBusqueda] = useState('')
  const [showCamionSug, setShowCamionSug] = useState(false)
  const [loteSugIdx, setLoteSugIdx] = useState(null)
  const [loteBusqueda, setLoteBusqueda] = useState('')
  const [lotesSugeridos, setLotesSugeridos] = useState([])
  const fichaIframeRef = useRef(null)
  const [proyectos, setProyectos] = useState([])
  const [filtroEmpresa, setFiltroEmpresa] = useState('')
  const [filtroProyecto, setFiltroProyecto] = useState('')
  const [filtroProducto, setFiltroProducto] = useState('')
  const [filtroTransporte, setFiltroTransporte] = useState('')
  const [filtroSupervisor, setFiltroSupervisor] = useState('')

  useEffect(() => {
    const fetchCamiones = async () => {
      try { const r = await fetch(`${API_URL}/api/camiones`); if (r.ok) setCamiones(await r.json()) } catch {}
    }
    const fetchProyectos = async () => {
      try { const r = await fetch(`${API_URL}/api/proyectos`); if (r.ok) setProyectos(await r.json()) } catch {}
    }
    fetchCamiones()
    fetchProyectos()
  }, [])

  useEffect(() => { fetchData() }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      const res = await fetch(`${API_URL}/api/cosecha-transp`, {})
      if (res.status === 401) return  // la sesion vencida la maneja services/sesion.js
      if (res.ok) setFichas(await res.json())
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }


  // Muestra el valor tal cual llega del backend (puede ser centro de costo/hacienda)
  const resolverProyecto = (f) => f.proyecto_nombre || ''

  // Para filtrar: centro de costo del primer producto (sin caer a hacienda como fallback)
  const resolverProyectoFiltro = (f) => ((f.productos || [])[0]?.centro_costos || '').trim()

  const opcionesEmpresa = [...new Set(fichas.map(f => f.propietario).filter(Boolean))].sort()
  const opcionesProyecto = [...new Set(fichas.map(f => resolverProyectoFiltro(f)).filter(Boolean))].sort()
  const opcionesProducto = [...new Set(fichas.flatMap(f => (f.productos || []).map(p => p.producto)).filter(Boolean))].sort()
  const opcionesTransporte = [...new Set(fichas.map(f => f.nombre_chofer).filter(Boolean))].sort()
  const opcionesSupervisor = [...new Set(fichas.map(f => f.supervisor_nombre).filter(Boolean))].sort()

  const filtradas = fichas.filter(f => {
    const matchBusqueda = !busqueda ||
      (f.placa || '').toLowerCase().includes(busqueda.toLowerCase()) ||
      (f.nombre_chofer || '').toLowerCase().includes(busqueda.toLowerCase()) ||
      (f.propietario || '').toLowerCase().includes(busqueda.toLowerCase()) ||
      (f.numeracion || '').includes(busqueda) ||
      (f.productos || []).some(p => (p.lote || '').toLowerCase().includes(busqueda.toLowerCase()) || (p.producto || '').toLowerCase().includes(busqueda.toLowerCase()))
    let matchEstado = true
    if (filtroEstado !== 'Todos') {
      matchEstado = f.estado === filtroEstado
    } else {
      matchEstado = f.estado !== 'Falla' && f.estado !== 'Eliminado'
    }
    let matchFecha = true
    if (f.fecha_creacion) {
      const fichaDate = f.fecha_creacion.split('T')[0]
      if (fechaDesde) matchFecha = fichaDate >= fechaDesde
      if (fechaHasta && matchFecha) matchFecha = fichaDate <= fechaHasta
    }
    const matchEmpresa = !filtroEmpresa || (f.propietario || '') === filtroEmpresa
    const matchProyecto = !filtroProyecto || resolverProyectoFiltro(f) === filtroProyecto
    const matchProducto = !filtroProducto || (f.productos || []).some(p => (p.producto || '') === filtroProducto)
    const matchTransporte = !filtroTransporte || (f.nombre_chofer || '') === filtroTransporte
    const matchSupervisor = !filtroSupervisor || (f.supervisor_nombre || '') === filtroSupervisor
    return matchBusqueda && matchEstado && matchFecha && matchEmpresa && matchProyecto && matchProducto && matchTransporte && matchSupervisor
  })

  const totalGavetas = filtradas.reduce((sum, f) => sum + (f.productos || []).reduce((s, p) => s + (p.cantidad || 0), 0), 0)

  // Formatear APELLIDO1 APELLIDO2 NOMBRE1 NOMBRE2 → Nombre1 Apellido1
  const formatNombre = (raw) => {
    if (!raw) return '-'
    const partes = raw.trim().split(/\s+/)
    if (partes.length >= 3) {
      const nombre1 = partes[partes.length >= 4 ? 2 : 1]
      const apellido1 = partes[0]
      return `${nombre1.charAt(0).toUpperCase()}${nombre1.slice(1).toLowerCase()} ${apellido1.charAt(0).toUpperCase()}${apellido1.slice(1).toLowerCase()}`
    }
    return raw.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
  }

  const badgeColor = (estado) => {
    switch (estado) {
      case 'Cargado': return '#1976d2'
      case 'Enviado': return '#e65100'
      case 'Ingresado': return '#6a1b9a'
      case 'Finalizado': return '#28a745'
      case 'Recibido': return '#28a745'
      case 'Desactivado': return '#6c757d'
      case 'Eliminado': return '#343a40'
      case 'Activo': return '#1976d2'
      case 'Falla': return '#dc3545'
      case 'Corregida': return '#17a2b8'
      default: return 'var(--color-text-secondary)'
    }
  }

  const aInputDatetimeLocal = (valor) => {
    if (!valor) return ''
    const d = new Date(valor)
    if (isNaN(d.getTime())) return ''
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  const handleClickFicha = (f) => {
    setFichaEditar(f)
    setCamionEdit({ placa: f.placa || '', nombre_chofer: f.nombre_chofer || '', propietario: f.propietario || '', id_camion: f.id_camion || null })
    setPlacaBusqueda(f.placa || '')
    setProductosEdit((f.productos || []).map(p => ({ ...p, _busqueda: p.orden_cultivo || '' })))
    setHoraEnvioEdit(aInputDatetimeLocal(f.fecha_salida))
    setDrawerOpen(true)
  }

  const handleGuardarHoraEnvio = async () => {
    if (!fichaEditar || !horaEnvioEdit) return
    setGuardandoHoraEnvio(true)
    try {
      const res = await fetch(`${API_URL}/api/cosecha-transp/${fichaEditar.id}/fecha-salida`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fecha_salida: horaEnvioEdit })
      })
      if (res.ok) {
        Swal.fire('Guardado', 'Hora de envío actualizada', 'success')
        await fetchData()
        setFichaEditar(prev => prev ? { ...prev, fecha_salida: horaEnvioEdit, estado: prev.estado === 'Activo' ? 'Enviado' : prev.estado } : prev)
      } else {
        Swal.fire('Error', 'No se pudo guardar la hora de envío', 'error')
      }
    } catch {
      Swal.fire('Error', 'Error de conexión', 'error')
    } finally {
      setGuardandoHoraEnvio(false)
    }
  }

  const cerrarDrawer = () => {
    setDrawerOpen(false); setFichaEditar(null); setProductosEdit([]); setCamionEdit({ placa: '', nombre_chofer: '', propietario: '', id_camion: null }); setPlacaBusqueda(''); setShowCamionSug(false); setLoteSugIdx(null); setLotesSugeridos([]); setHoraEnvioEdit('')
  }

  const handleProductoChange = (idx, campo, valor) => {
    setProductosEdit(prev => prev.map((p, i) => i === idx ? { ...p, [campo]: valor } : p))
  }

  const buscarLotes = async (val, idx) => {
    setLoteSugIdx(idx)
    setLoteBusqueda(val)
    handleProductoChange(idx, '_busqueda', val)
    if (val.length >= 1) {
      try {
        const res = await fetch(`${API_URL}/api/lotes-infx/buscar?ocult=${encodeURIComponent(val)}&cosecha=true`)
        if (res.ok) setLotesSugeridos(await res.json())
      } catch {}
    } else {
      setLotesSugeridos([])
    }
  }

  const seleccionarLote = (l, idx) => {
    setProductosEdit(prev => prev.map((p, i) => i === idx ? {
      ...p, producto: l.ocult_cod_proda || '', lote: l.lote || '', variedad: l.variedad || '',
      orden_cultivo: l.ocult_cod_ocult || '', _busqueda: l.ocult_cod_ocult || ''
    } : p))
    setLotesSugeridos([])
    setLoteSugIdx(null)
  }

  const handleEliminarProducto = async (idx) => {
    const p = productosEdit[idx]
    const conf = await Swal.fire({
      title: '¿Eliminar este producto de la ficha?',
      text: `${p.producto || 'Producto'}${p.lote ? ' - Lote ' + p.lote : ''}`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#dc3545'
    })
    if (!conf.isConfirmed) return
    try {
      if (p.id) {
        const res = await fetch(`${API_URL}/api/cosecha-productos/item/${p.id}`, { method: 'DELETE' })
        if (!res.ok) {
          Swal.fire('Error', 'No se pudo eliminar el producto', 'error')
          return
        }
      }
      setProductosEdit(prev => prev.filter((_, i) => i !== idx))
      fetchData()
    } catch {
      Swal.fire('Error', 'Error de conexión', 'error')
    }
  }

  const hayCambios = () => {
    if (!fichaEditar) return false
    const orig = fichaEditar.productos || []
    const camionCambio = camionEdit.placa !== (fichaEditar.placa || '') || camionEdit.nombre_chofer !== (fichaEditar.nombre_chofer || '') || camionEdit.propietario !== (fichaEditar.propietario || '')
    const prodsCambio = productosEdit.some((p, i) => {
      const o = orig[i] || {}
      return (p.producto || '') !== (o.producto || '') || (p.lote || '') !== (o.lote || '') || (p.variedad || '') !== (o.variedad || '') ||
        String(p.cantidad || 0) !== String(o.cantidad || 0) || String(p.peso || '') !== String(o.peso || '') || (p.num_ficha || '') !== (o.num_ficha || '')
    })
    return camionCambio || prodsCambio
  }

  const handleEliminar = async () => {
    if (!fichaEditar) return
    const conf = await Swal.fire({
      title: '¿Eliminar ficha?',
      text: `La ficha ${fichaEditar.placa} quedará como Eliminada y no aparecerá en los reportes.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#dc3545'
    })
    if (!conf.isConfirmed) return
    try {
      const res = await fetch(`${API_URL}/api/cosecha-transp/${fichaEditar.id}/estado`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: 'Eliminado' })
      })
      if (res.ok) {
        Swal.fire('Eliminada', 'Ficha marcada como Eliminada', 'success')
        cerrarDrawer()
        fetchData()
      } else {
        Swal.fire('Error', 'No se pudo eliminar la ficha', 'error')
      }
    } catch {
      Swal.fire('Error', 'Error de conexión', 'error')
    }
  }

  const handleGuardar = async () => {
    if (!fichaEditar || !hayCambios()) return
    const conf = await Swal.fire({
      title: 'Guardar corrección',
      text: 'La ficha actual se marcará como "Falla" y se creará una nueva con los datos corregidos. ¿Continuar?',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, guardar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#7b1fa2'
    })
    if (!conf.isConfirmed) return
    try {
      const res = await fetch(`${API_URL}/api/cosecha-transp/${fichaEditar.id}/corregir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ camion: camionEdit, productos: productosEdit })
      })
      if (res.ok) {
        Swal.fire('Guardado', 'Ficha corregida creada exitosamente', 'success')
        cerrarDrawer()
        fetchData()
      } else {
        Swal.fire('Error', 'No se pudo guardar la corrección', 'error')
      }
    } catch (err) {
      Swal.fire('Error', 'Error de conexión', 'error')
    }
  }

  const generarDocumento = (f) => {
    const prods = f.productos || []
    const fechaFicha = f.fecha_salida || f.fecha_creacion
    const fecha = fechaFicha ? new Date(fechaFicha).toLocaleDateString('es-EC', {day:'2-digit', month:'2-digit', year:'numeric'}) : '-'
    const horaIngreso = f.hora_ingreso || ''
    const horaSalida = f.fecha_salida ? (() => { const d = new Date(f.fecha_salida); const h = d.getHours(); const mn = String(d.getMinutes()).padStart(2,'0'); const h12 = h % 12 || 12; return `${String(h12).padStart(2,'0')}:${mn} ${h < 12 ? 'a.m.' : 'p.m.'}` })() : ''
    const choferRaw = f.nombre_chofer || ''
    // Formatear APELLIDO1 APELLIDO2 NOMBRE1 NOMBRE2 → Nombre1 Apellido1
    const formatNombre = (raw) => {
      const partes = raw.trim().split(/\s+/)
      if (partes.length >= 3) {
        const nombre1 = partes[partes.length >= 4 ? 2 : 1]
        const apellido1 = partes[0]
        return `${nombre1.charAt(0).toUpperCase()}${nombre1.slice(1).toLowerCase()} ${apellido1.charAt(0).toUpperCase()}${apellido1.slice(1).toLowerCase()}`
      }
      return raw.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
    }
    const chofer = formatNombre(choferRaw)
    const supervisor = f.supervisor_nombre || (prods[0]?.responsable) || ''

    // Parsear observacion_falla para marcar SOLO el producto que realmente
    // cambio (el backend antepone "Producto N - " a cada cambio de
    // producto), en vez de marcar el mismo campo en todos los productos
    // del camion.
    const fallaFieldsPorProducto = {}
    if (f.estado === 'Falla' && f.observacion_falla) {
      f.observacion_falla.split('; ').forEach(cambio => {
        const m = cambio.match(/^Producto (\d+) - (.+)$/)
        const idxProd = m ? parseInt(m[1], 10) - 1 : null
        const lower = cambio.toLowerCase()
        const campos = []
        if (lower.includes('lote')) campos.push('lote')
        if (lower.includes('gavetas') || lower.includes('bines') || lower.includes('cantidad')) campos.push('cantidad')
        if (lower.includes('peso')) campos.push('peso')
        if (idxProd !== null && campos.length) {
          fallaFieldsPorProducto[idxProd] = [...(fallaFieldsPorProducto[idxProd] || []), ...campos]
        }
      })
    }
    const markStyle = 'position:relative; display:inline-block;'
    const circleOverlay = '<span style="position:absolute;top:-6px;left:-8px;right:-8px;bottom:-6px;border:2.5px solid red;border-radius:50%;pointer-events:none;"></span>'

    // Cada producto del camion es su propia ficha de cosecha (su propio
    // N Ficha y numeracion), asi que se genera una .ficha (hoja) por
    // producto en vez de una sola tabla con todos los productos juntos.
    const fichaHtml = (p, esUltima, idxProducto) => {
      const camposFalla = fallaFieldsPorProducto[idxProducto] || []
      const markLote = camposFalla.includes('lote')
      const markCant = camposFalla.includes('cantidad')
      const markPeso = camposFalla.includes('peso')
      const prodUpper = (p.producto || '').toUpperCase()
      const esOrganico = prodUpper.includes('ORGANIC') || prodUpper.includes('ORGÁNIC')
      let proyectoNombre = ''
      let proyectoDireccion = ''
      const normalizar = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
      const ccosto = normalizar(p.centro_costos || '')
      const proyMatch = proyectos.find(pr => ccosto.startsWith(normalizar(pr.nombre)))
      if (proyMatch) {
        proyectoNombre = proyMatch.nombre
        proyectoDireccion = proyMatch.direccion || ''
      }
      if (!proyectoNombre) {
        // Sin match en el catalogo de proyectos: para organico se mantiene
        // el default historico (SAN SEBASTIAN); para convencional se
        // muestra el centro de costos tal cual antes de no mostrar nada.
        proyectoNombre = esOrganico ? 'SAN SEBASTIÁN' : (p.centro_costos || '')
      }
      proyectoNombre = proyectoNombre.replace(/-CC\d+$/i, '')
      const filaProducto = `<tr><td>${markLote ? `<span style="${markStyle}">${p.lote || '-'}${circleOverlay}</span>` : (p.lote || '-')}</td><td>${markCant ? `<span style="${markStyle}">${p.cantidad || 0}${circleOverlay}</span>` : (p.cantidad || 0)}</td><td>${markPeso ? `<span style="${markStyle}">${p.peso || ''}${circleOverlay}</span>` : (p.peso || '')}</td><td></td></tr>`
      const numeroRojo = p.numeracion || f.numeracion || 'COS-????'

      return `
    <div class="ficha" style="${esUltima ? '' : 'page-break-after: always;'}">
      <div class="header">
        <img src="${logoUrl(empresaTema) || (window.location.origin + '/LogoNintanga.png')}" class="header-logo" alt="Nintanga" />
        <div class="header-text">
          <h1>NINTANGA S.A.S</h1>
          ${proyectoNombre ? `<h2>PROYECTO ${proyectoNombre}.</h2>` : ''}
          ${esOrganico ? `<p>Certificado orgánico por: Kiwa BCS Öko Garantie GmbH.</p>` : ''}
          <p style="font-weight:bold; font-size:11px;">NOTA DE ENTREGA DE PRODUCTO${esOrganico ? ' ORGÁNICO' : ''}.</p>
        </div>
        <div class="num-rojo">${numeroRojo}</div>
      </div>
      <div class="datos">
        <div class="datos-row" style="justify-content:space-between;">
          <span><strong>FECHA:</strong> ${fecha}</span>
          <span><strong>N°FICHA:</strong> <span style="border-bottom:1px solid #000; padding:0 10px; min-width:60px; display:inline-block;">${p.num_ficha || '&nbsp;'}</span></span>
        </div>
        <div class="datos-row" style="justify-content:space-between;">
          <span><strong>PRODUCTO:</strong> ${p.producto || ''}${esOrganico ? ' &nbsp;&nbsp;<strong>ORGÁNICO</strong>' : ''}</span>
          <span><strong>HORA/INGRESO:</strong> ${horaIngreso || '___________'}</span>
        </div>
        <div class="datos-row">
          <span><strong>VARIEDAD:</strong> ${p.variedad || ''}</span>
        </div>
        <div class="datos-row">
          <span><strong>HORA/SALIDA:</strong> ${horaSalida || '___________'}</span>
        </div>
      </div>
      <table>
        <colgroup><col class="col-lote"/><col class="col-bines"/><col class="col-peso"/><col class="col-obs"/></colgroup>
        <thead><tr><th>LOTE</th><th>N°BINES</th><th>PESO NETO</th><th>OBSERVACIONES</th></tr></thead>
        <tbody>
          ${filaProducto}
          <tr><td>&nbsp;</td><td></td><td></td><td></td></tr>
          <tr><td>&nbsp;</td><td></td><td></td><td></td></tr>
          <tr><td>&nbsp;</td><td></td><td></td><td></td></tr>
        </tbody>
      </table>
      <div class="firmas">
        <div class="firmas-left">
          <p><strong>Resp. Transporte:</strong> ${chofer}</p>
          <p><strong>Supervisor:</strong> ${supervisor}</p>
          <p><strong>Recibido por:</strong> ${f.recibido_por || ''}</p>
        </div>
        ${esOrganico ? `<div class="firmas-right" style="display:flex; align-items:center;">
          <img src="${window.location.origin}/LogoOrganica.png" alt="Certificación Orgánica" style="width:1cm; height:1cm; object-fit:contain;" onerror="this.style.display='none'" />
        </div>` : ''}
      </div>
      ${esOrganico ? `<div class="footer">
        <div class="footer-left">
          <p><strong>Dirección ${proyectoNombre || 'San Sebastián'}:</strong> ${proyectoDireccion || 'Panamericana Norte Km. 13, Guaytacama, Cotopaxi, Ecuador'}</p>
          <p style="margin-top:2px; color:var(--color-text-secondary);">Resolución N° DAJ-20133ec-0201.0099</p>
        </div>
        <div class="footer-right">
          <p><strong>Kiwa Ecuador Cía Ltda. código:</strong> P.O.A: 001-AC</p>
          <p><strong>${proyectoNombre || 'San Sebastián'}:</strong> CÓDIGO POA N°: 0070-3</p>
          <p>EC.BIO-141</p>
        </div>
      </div>` : ''}
    </div>`
    }

    const fichasHtml = (prods.length > 0 ? prods : [{}]).map((p, i) => fichaHtml(p, i === prods.length - 1, i)).join('\n')

    return `<html><head><style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: Helvetica, Arial, sans-serif; padding: 0; font-size: 10px; margin: 0; }
      @page { size: 130mm 180mm; margin: 0; }
      @media print { body { margin: 0; padding: 0; } }
      .ficha { border: 1.5px solid #000; padding: 0; width: 125mm; margin: 0 auto 10px auto; box-sizing: border-box; }
      .header { text-align: center; padding: 6px; border-bottom: 1px solid #000; position: relative; display: flex; align-items: center; }
      .header-logo { width: 70px; margin-left: 5px; object-fit: contain; }
      .header-text { flex: 1; text-align: center; }
      .header h1 { font-size: 11px; font-weight: bold; margin: 0; }
      .header h2 { font-size: 10px; font-weight: bold; margin: 2px 0; }
      .header p { font-size: 8px; margin: 1px 0; }
      .header .num-rojo { position: absolute; top: 5px; right: 8px; color: red; font-size: 10px; font-weight: bold; }
      .datos { padding: 5px 8px; border-bottom: 1px solid #000; }
      .datos-row { display: flex; margin-bottom: 2px; justify-content: space-between; }
      .datos-row span { font-size: 9px; }
      .datos-row strong { font-size: 9px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #000; padding: 3px 4px; text-align: center; font-size: 8px; }
      th { background: var(--color-bg-light); font-weight: bold; font-size: 8px; }
      td { min-height: 16px; }
      col.col-lote { width: 20%; }
      col.col-bines { width: 15%; }
      col.col-peso { width: 20%; }
      col.col-obs { width: 45%; }
      .firmas { padding: 5px 8px; border-top: 1px solid #000; display: flex; justify-content: space-between; }
      .firmas-left { flex: 1; }
      .firmas-left p { margin: 2px 0; font-size: 9px; }
      .firmas-right { text-align: right; font-size: 8px; }
      .footer { padding: 4px 8px; border-top: 1px solid #000; font-size: 7px; display: flex; justify-content: space-between; }
      .footer-left { }
      .footer-right { text-align: right; }
    </style></head><body>${fichasHtml}</body></html>`
  }

  const handleDescargar = async () => {
    const esOrganico = (producto) => {
      const up = (producto || '').toUpperCase()
      return up.includes('ORGANIC') || up.includes('ORGÁNIC')
    }

    const calcHoraSalida = (fechaSalida) => {
      if (!fechaSalida) return ''
      const d = new Date(fechaSalida)
      if (isNaN(d.getTime())) return ''
      const h = d.getHours()
      const mn = String(d.getMinutes()).padStart(2, '0')
      const h12 = h % 12 || 12
      return `${String(h12).padStart(2, '0')}:${mn} ${h < 12 ? 'a.m.' : 'p.m.'}`
    }

    const filas = []
    filtradas.forEach(f => {
      const fecha = f.fecha_creacion ? new Date(f.fecha_creacion).toLocaleDateString('es-EC', {day:'2-digit', month:'2-digit', year:'numeric'}) : '-'
      const prods = (f.productos && f.productos.length > 0) ? f.productos : [{}]
      prods.forEach(p => {
        filas.push({
          organico: esOrganico(p.producto),
          valores: [
            fecha, p.num_ficha || '-', f.placa || '-', formatNombre(f.nombre_chofer), f.propietario || '-',
            resolverProyecto(f) || '-', f.supervisor_nombre || (f.productos || [])[0]?.responsable || '-',
            p.producto || '-', p.lote || '-', p.variedad || '-', p.cantidad || 0, p.peso || '-', f.estado || '-',
            calcHoraSalida(f.fecha_salida) || '-', f.hora_ingreso || '-', f.recibido_por || '-'
          ]
        })
      })
    })

    const COLS = ['Fecha', 'N° Ficha', 'Placa', 'Resp. Transporte', 'Propietario', 'Proyecto', 'Supervisor', 'Producto', 'Lote', 'Variedad', 'Bines', 'Peso (kg)', 'Estado', 'Hora Salida', 'Hora Ingreso', 'Recibido por']
    const COL_LETRA = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P']
    const MORADO = 'FF7B1FA2'
    const MORADO_CLARO = 'FFF5F0FA'
    const AMARILLO = 'FFFFF3CD'
    const BLANCO = 'FFFFFFFF'
    const BORDE_FINO = { style: 'thin', color: { argb: 'FFBBBBBB' } }
    const BORDE = { top: BORDE_FINO, left: BORDE_FINO, bottom: BORDE_FINO, right: BORDE_FINO }

    const workbook = new ExcelJS.Workbook()

    const construirHoja = (nombre, datos) => {
      const hoja = workbook.addWorksheet(nombre)

      // --- Encabezado (imita el membrete de la ficha impresa), ancho completo de la tabla ---
      const ULTIMA_COL = COL_LETRA[COLS.length - 1]
      hoja.mergeCells(`A1:${ULTIMA_COL}1`)
      const empresa = hoja.getCell('A1')
      empresa.value = 'NINTANGA S.A.S'
      empresa.font = { bold: true, size: 16, color: { argb: BLANCO } }
      empresa.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MORADO } }
      empresa.alignment = { horizontal: 'center', vertical: 'middle' }
      hoja.getRow(1).height = 30

      hoja.mergeCells(`A2:${ULTIMA_COL}2`)
      const subtitulo = hoja.getCell('A2')
      subtitulo.value = `NOTA DE ENTREGA DE PRODUCTO — ${nombre.toUpperCase()}`
      subtitulo.font = { bold: true, size: 11, color: { argb: MORADO } }
      subtitulo.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MORADO_CLARO } }
      subtitulo.alignment = { horizontal: 'center', vertical: 'middle' }
      hoja.getRow(2).height = 20

      // --- Buscador de ficha ---
      const FILA_BUSCADOR = 4
      const celdaLabelBuscador = hoja.getCell(`A${FILA_BUSCADOR}`)
      celdaLabelBuscador.value = '🔍 Buscar N° Ficha'
      celdaLabelBuscador.font = { bold: true, color: { argb: 'FF555555' } }
      const celdaSelector = hoja.getCell(`B${FILA_BUSCADOR}`)
      celdaSelector.font = { bold: true, size: 12, color: { argb: MORADO } }
      celdaSelector.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AMARILLO } }

      // --- Plantilla de ficha: al elegir el N Ficha de arriba, estos campos se autocompletan ---
      const FILA_SELECTOR = 6
      const campos = ['Fecha', 'Placa', 'Resp. Transporte', 'Propietario', 'Proyecto', 'Supervisor', 'Producto', 'Lote', 'Variedad', 'Bines', 'Peso (kg)', 'Estado', 'Hora Salida', 'Hora Ingreso', 'Recibido por']
      const FILA_SECCION_TABLA = FILA_SELECTOR + campos.length + 1
      const FILA_HEADERS = FILA_SECCION_TABLA + 1
      const FILA_DATOS_INICIO = FILA_HEADERS + 1
      const FILA_DATOS_FIN = FILA_DATOS_INICIO + Math.max(datos.length - 1, 0)

      if (datos.length > 0) {
        celdaSelector.dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [`$B$${FILA_DATOS_INICIO}:$B$${FILA_DATOS_FIN}`]
        }
      }

      campos.forEach((label, i) => {
        const fila = FILA_SELECTOR + i
        const celdaLabel = hoja.getCell(`A${fila}`)
        celdaLabel.value = label
        celdaLabel.font = { bold: true, color: { argb: 'FF555555' } }
        celdaLabel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MORADO_CLARO } }
        const col = COL_LETRA[COLS.indexOf(label)]
        hoja.getCell(`B${fila}`).value = {
          formula: `IFERROR(INDEX($${col}$${FILA_DATOS_INICIO}:$${col}$${FILA_DATOS_FIN},MATCH($B$${FILA_BUSCADOR},$B$${FILA_DATOS_INICIO}:$B$${FILA_DATOS_FIN},0)),"")`
        }
      })

      // Borde tipo "documento" alrededor de todo el bloque de la ficha
      for (let fila = 1; fila <= FILA_SELECTOR + campos.length - 1; fila++) {
        hoja.getCell(`A${fila}`).border = BORDE
        hoja.getCell(`B${fila}`).border = BORDE
      }

      // --- Tabla de datos filtrados (fuente de la busqueda de arriba) ---
      const celdaSeccion = hoja.getCell(`A${FILA_SECCION_TABLA}`)
      celdaSeccion.value = `Fichas ${nombre} según filtro aplicado (${datos.length})`
      celdaSeccion.font = { bold: true, italic: true, color: { argb: MORADO } }

      COLS.forEach((c, idx) => {
        const celda = hoja.getRow(FILA_HEADERS).getCell(idx + 1)
        celda.value = c
        celda.font = { bold: true, color: { argb: BLANCO } }
        celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MORADO } }
      })
      datos.forEach((d, i) => {
        const fila = FILA_DATOS_INICIO + i
        d.valores.forEach((v, idx) => { hoja.getRow(fila).getCell(idx + 1).value = v })
      })

      hoja.columns = COLS.map((c, idx) => {
        let max = c.length
        datos.forEach(d => {
          const len = String(d.valores[idx] ?? '').length
          if (len > max) max = len
        })
        if (idx === 0) max = Math.max(max, ...campos.map(l => l.length))
        return { width: Math.min(Math.max(max + 2, 10), 40) }
      })
    }

    construirHoja('Convencional', filas.filter(d => !d.organico))
    construirHoja('Organica', filas.filter(d => d.organico))

    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `reporte-cosecha-${new Date().toISOString().split('T')[0]}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) return <div style={{textAlign:'center',padding:'3rem'}}><p>Cargando...</p></div>

  return (
    <>
      <div className="page-header" style={{display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center'}}>
        <div>
          <h1><i className='bx bx-leaf'></i> Reporte de Cosecha</h1>
          <p className="page-subtitle">{filtradas.length} fichas | {totalGavetas} bines</p>
        </div>
        <button onClick={handleDescargar} style={{background: '#7b1fa2', color: 'white', border: 'none', borderRadius: '8px', padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap'}}>
          <i className='bx bx-download'></i> Descargar
        </button>
      </div>

      {/* Panel de búsqueda y filtros */}
      <div style={{background: 'var(--color-bg-white)', borderRadius: '12px', boxShadow: '0 1px 6px rgba(0,0,0,0.07)', marginBottom: '0.8rem', overflow: 'hidden'}}>

        {/* Fila 1: búsqueda + fechas */}
        <div style={{display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', padding: '0.75rem 1rem', borderBottom: '1px solid var(--color-border)'}}>
          <div style={{flex: 1, position: 'relative', minWidth: '200px'}}>
            <i className='bx bx-search' style={{position:'absolute', left:'10px', top:'50%', transform:'translateY(-50%)', color:'var(--color-text-secondary)', fontSize:'1rem'}}></i>
            <input type="text" className="form-control" value={busqueda} onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar placa, chofer, lote..."
              style={{paddingLeft:'2.1rem', borderRadius:'8px', border:'1px solid var(--color-border)', fontSize:'0.82rem', height:'34px'}} />
          </div>
          <div style={{display:'flex', gap:'0.4rem', alignItems:'center'}}>
            <span style={{fontSize:'0.75rem', color:'var(--color-text-secondary)', whiteSpace:'nowrap'}}>Del</span>
            <input type="date" className="form-control" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)}
              style={{fontSize:'0.8rem', padding:'0.3rem 0.5rem', width:'138px', borderRadius:'8px', border:'1px solid var(--color-border)', height:'34px'}} />
            <span style={{fontSize:'0.75rem', color:'var(--color-text-secondary)'}}>al</span>
            <input type="date" className="form-control" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)}
              style={{fontSize:'0.8rem', padding:'0.3rem 0.5rem', width:'138px', borderRadius:'8px', border:'1px solid var(--color-border)', height:'34px'}} />
            {(fechaDesde || fechaHasta) && (
              <button onClick={() => { setFechaDesde(''); setFechaHasta('') }}
                style={{background:'var(--color-bg-light)', border:'none', borderRadius:'6px', color:'#dc3545', cursor:'pointer', padding:'0.3rem 0.5rem', fontSize:'0.85rem', lineHeight:1}}>
                <i className='bx bx-x'></i>
              </button>
            )}
          </div>
        </div>

        {/* Fila 2: filtros desplegables */}
        <div style={{display:'flex', alignItems:'center', gap:'0.5rem', padding:'0.6rem 1rem'}}>
          <span style={{fontSize:'0.72rem', color:'var(--color-text-secondary)', fontWeight:600, letterSpacing:'0.03em', textTransform:'uppercase', whiteSpace:'nowrap', flexShrink:0}}>
            <i className='bx bx-filter-alt' style={{verticalAlign:'middle', marginRight:'3px'}}></i>Filtrar
          </span>

          {[
            { label: 'Empresa', icon: 'bx-building', value: filtroEmpresa, set: setFiltroEmpresa, opciones: opcionesEmpresa },
            { label: 'Proyecto', icon: 'bx-map-pin', value: filtroProyecto, set: setFiltroProyecto, opciones: opcionesProyecto },
            { label: 'Producto', icon: 'bx-leaf', value: filtroProducto, set: setFiltroProducto, opciones: opcionesProducto },
            { label: 'Transporte', icon: 'bx-car', value: filtroTransporte, set: setFiltroTransporte, opciones: opcionesTransporte },
            { label: 'Supervisor', icon: 'bx-user', value: filtroSupervisor, set: setFiltroSupervisor, opciones: opcionesSupervisor },
          ].map(({ label, icon, value, set, opciones }) => (
            <div key={label} style={{flex:1, display:'flex', alignItems:'center',
              border: '1px solid ' + (value ? '#7b1fa2' : 'var(--color-bg-light)'),
              borderRadius:'8px', background: value ? 'var(--color-bg-light)' : 'var(--color-bg-light)',
              padding:'0 0.6rem 0 0.7rem', height:'34px', cursor:'pointer', transition:'all 0.15s', minWidth:0}}>
              <i className={`bx ${icon}`} style={{fontSize:'0.85rem', color: value ? '#7b1fa2' : 'var(--color-border)', marginRight:'6px', flexShrink:0}}></i>
              <select value={value} onChange={e => set(e.target.value)}
                style={{flex:1, border:'none', background:'transparent', fontSize:'0.8rem', color: value ? '#7b1fa2' : 'var(--color-text-secondary)',
                  fontWeight: value ? 600 : 400, cursor:'pointer', outline:'none', padding:0, minWidth:0,
                  appearance:'none', WebkitAppearance:'none'}}>
                <option value="">{label}</option>
                {opciones.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              <i className='bx bx-chevron-down' style={{fontSize:'0.8rem', color:'var(--color-border)', marginLeft:'4px', pointerEvents:'none', flexShrink:0}}></i>
            </div>
          ))}

          {(filtroEmpresa || filtroProyecto || filtroProducto || filtroTransporte || filtroSupervisor) && (
            <button onClick={() => { setFiltroEmpresa(''); setFiltroProyecto(''); setFiltroProducto(''); setFiltroTransporte(''); setFiltroSupervisor('') }}
              style={{height:'30px', background:'var(--color-bg-light)', border:'1px solid var(--color-border)', color:'#dc3545', borderRadius:'20px',
                padding:'0 0.7rem', cursor:'pointer', fontSize:'0.75rem', display:'flex', alignItems:'center', gap:'3px'}}>
              <i className='bx bx-x'></i> Limpiar
            </button>
          )}
          <button onClick={fetchData} disabled={loading} style={{marginLeft:'auto', background:'var(--color-primary-soft)', border:'1px solid var(--color-border)', borderRadius:'8px', color:'var(--color-primary-texto)', cursor:'pointer', padding:'0.4rem 0.8rem', fontSize:'0.8rem', display:'flex', alignItems:'center', gap:'0.35rem', height:'34px', whiteSpace:'nowrap'}}>
            <i className={`bx bx-refresh ${loading ? 'bx-spin' : ''}`}></i> Actualizar
          </button>
        </div>
      </div>

      {/* Filtros de estado */}
      <div style={{display:'flex', gap:'0.4rem', marginBottom:'0.8rem', flexWrap:'wrap'}}>
        {(['Todos', 'Activo', 'Enviado', 'Recibido', 'Desactivado', 'Falla', 'Eliminado']).map(est => {
          const dotColors = { Todos:'var(--color-text-secondary)', Activo:'#1976d2', Enviado:'#e65100', Recibido:'#28a745', Desactivado:'#6c757d', Falla:'#dc3545', Eliminado:'#343a40' }
          const active = filtroEstado === est
          return (
            <button key={est} onClick={() => setFiltroEstado(est)}
              style={{padding:'0.45rem 1rem', borderRadius:'20px', cursor:'pointer', fontSize:'0.8rem',
                fontWeight: active ? 600 : 400,
                border: active ? '2px solid ' + (dotColors[est] || 'var(--color-text-primary)') : '1px solid var(--color-border)',
                background: active ? 'var(--color-bg-white)' : 'var(--color-bg-light)', color: active ? (dotColors[est] || 'var(--color-text-primary)') : 'var(--color-text-secondary)',
                display:'flex', alignItems:'center', gap:'5px', transition:'all 0.15s'}}>
              <span style={{width:'8px', height:'8px', borderRadius:'50%', background: dotColors[est] || 'var(--color-text-secondary)', flexShrink:0}}></span>
              {est}
            </button>
          )
        })}
      </div>

      {/* Tabla */}
      <div className="tabla-container" style={{overflowX: 'auto'}}>
        <table className="tabla" style={{fontSize: '0.8rem', width: '100%', tableLayout: 'fixed'}}>
          <colgroup>
            <col className="col-fecha-cosecha" style={{width: '7%'}} />
            <col className="col-nficha-cosecha" style={{width: '6%'}} />
            <col className="col-placa-cosecha" style={{width: '8%'}} />
            <col className="col-ocultar-movil" style={{width: '10%'}} />
            <col className="col-ocultar-movil" style={{width: '8%'}} />
            <col className="col-ocultar-movil" style={{width: '10%'}} />
            <col className="col-ocultar-movil" style={{width: '10%'}} />
            <col className="col-ocultar-movil" style={{width: '10%'}} />
            <col className="col-lote-cosecha" style={{width: '6%'}} />
            <col className="col-ocultar-movil" style={{width: '8%'}} />
            <col className="col-bines-cosecha" style={{width: '5%'}} />
            <col className="col-peso-cosecha" style={{width: '6%'}} />
            <col className="col-estado-cosecha" style={{width: '6%'}} />
          </colgroup>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>N° Ficha</th>
              <th>Placa</th>
              <th className="col-ocultar-movil">Resp. Transporte</th>
              <th className="col-ocultar-movil">Propietario</th>
              <th className="col-ocultar-movil">Proyecto</th>
              <th className="col-ocultar-movil">Supervisor</th>
              <th className="col-ocultar-movil">Producto</th>
              <th>Lote</th>
              <th className="col-ocultar-movil">Variedad</th>
              <th>Bines</th>
              <th>Peso (kg)</th>
              <th><span className="col-ocultar-movil">Estado</span><span className="estado-badge-punto" style={{display: 'none'}}>E</span></th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              // Varias fichas separadas del mismo camion (mismo dia) se
              // agrupan bajo una sola celda combinada de Placa/Resp.
              // Transporte/Propietario/Proyecto/Supervisor -- igual que en
              // Fichas de Cosecha -- para verlas como un solo bloque en vez
              // de repetir esos datos en cada fila suelta.
              // ACTUALIZACION: fichas distintas (id distinto) NO se mezclan
              // entre si aunque sean el mismo camion el mismo dia -- cada
              // ficha es su propio bloque; el agrupamiento visual de aqui
              // abajo solo sigue aplicando a los PRODUCTOS dentro de UNA
              // misma ficha (eso ya existia desde antes).
              const gruposMap = new Map()
              filtradas.forEach(f => {
                gruposMap.set(f.id, [f])
              })
              const grupos = Array.from(gruposMap.values())

              return grupos.map((grupoFichas, gIdx) => {
                const filasPorFicha = grupoFichas.map(f => {
                  const prods = f.productos || []
                  let n = Math.max(prods.length, 1)
                  if (f.correccion_id) {
                    const fichaFalla = fichas.find(x => x.id === f.correccion_id)
                    if (fichaFalla?.observacion_falla) n += 1
                  }
                  if (f.estado === 'Falla' && f.observacion_falla) n += 1
                  return n
                })
                const totalFilasGrupo = filasPorFicha.reduce((a, b) => a + b, 0)
                const fondoGrupo = grupoFichas.length > 1 && gIdx % 2 === 1 ? 'var(--color-bg-light)' : undefined

                return grupoFichas.map((f, fi) => {
                  const prods = f.productos || []
                  // verticalAlign 'middle' en todas las celdas combinadas (Fecha,
                  // Placa, comunes, y el Estado de una ficha con varios
                  // productos) para que se vean centradas en medio de todas las
                  // filas de producto que abarcan, en vez de pegadas arriba.
                  const celdasComunes = fi === 0 && (
                    <>
                      <td className="col-ocultar-movil" rowSpan={totalFilasGrupo} style={{verticalAlign: 'middle'}}>{formatNombre(f.nombre_chofer)}</td>
                      <td className="col-ocultar-movil" rowSpan={totalFilasGrupo} style={{verticalAlign: 'middle'}}>{f.propietario || '-'}</td>
                      <td className="col-ocultar-movil" rowSpan={totalFilasGrupo} style={{verticalAlign: 'middle'}}>{resolverProyecto(f) || '-'}</td>
                      <td className="col-ocultar-movil" rowSpan={totalFilasGrupo} style={{verticalAlign: 'middle'}}>{f.supervisor_nombre || (f.productos || [])[0]?.responsable || '-'}</td>
                    </>
                  )
                  // La Placa no tiene className col-ocultar-movil (debe verse
                  // siempre) -- se separa de las demas celdas comunes.
                  const celdaPlaca = fi === 0 && (
                    <td rowSpan={totalFilasGrupo} style={{verticalAlign: 'middle'}}><strong>{f.placa || '-'}</strong></td>
                  )
                  // La Fecha es la misma para todo el grupo (la clave de
                  // agrupacion ya incluye el dia), asi que tambien se
                  // combina en una sola celda -- antes cada ficha suelta
                  // del grupo agregaba su propia celda de Fecha ademas de
                  // la del grupo, desalineando todas las columnas siguientes.
                  const celdaFecha = fi === 0 && (
                    <td rowSpan={totalFilasGrupo} style={{whiteSpace:'nowrap', verticalAlign: 'middle'}}>{f.fecha_creacion ? new Date(f.fecha_creacion).toLocaleDateString('es-EC', {day:'2-digit', month:'2-digit', year:'numeric'}) : '-'}</td>
                  )

                  if (prods.length <= 1) {
                    const p = prods[0] || {}
                    const rows = []
                    rows.push(
                      <tr key={f.id} className="clickeable" onClick={() => handleClickFicha(f)} style={{cursor: 'pointer', background: fondoGrupo, ...((f.correccion_id || (f.estado === 'Falla' && f.observacion_falla)) ? {borderBottom: 'none'} : {})}}>
                        {celdaFecha}
                        <td style={{whiteSpace:'nowrap', fontSize:'0.75rem', color:'#7b1fa2', fontWeight:600}}>{p.num_ficha || '-'}</td>
                        {celdaPlaca}
                        {celdasComunes}
                        <td className="col-ocultar-movil">{p.producto || '-'}</td>
                        <td>{p.lote || '-'}</td>
                        <td className="col-ocultar-movil">{p.variedad || '-'}</td>
                        <td style={{textAlign: 'center'}}>{p.cantidad || 0}</td>
                        <td style={{textAlign: 'center'}}>{p.peso || '-'}</td>
                        <td>
                          <span className="col-ocultar-movil" style={{background: badgeColor(f.estado), color: 'white', padding: '2px 8px', borderRadius: '4px', fontSize: '0.7rem'}}>{f.estado}</span>
                          <span className="estado-badge-punto" title={f.estado} style={{background: badgeColor(f.estado), width: '12px', height: '12px', borderRadius: '50%', display: 'none'}}></span>
                        </td>
                      </tr>
                    )
                    // Fila de detalle de corrección (para fichas que tienen correccion_id)
                    if (f.correccion_id) {
                      const fichaFalla = fichas.find(x => x.id === f.correccion_id)
                      if (fichaFalla?.observacion_falla) {
                        rows.push(
                          <tr key={`${f.id}-corr`} style={{borderTop: 'none'}}>
                            <td colSpan="13" style={{padding: '0.3rem 1rem', fontSize: '0.73rem', background: 'var(--color-bg-light)', borderTop: 'none', borderBottom: '1px solid var(--color-bg-light)'}}>
                              <i className='bx bx-check-circle' style={{color: '#17a2b8', marginRight: '4px', verticalAlign: 'middle'}}></i>
                              <span style={{color: 'var(--color-text-secondary)'}}><strong style={{color: '#17a2b8'}}>Corrección:</strong> {fichaFalla.observacion_falla}</span>
                            </td>
                          </tr>
                        )
                      }
                    }
                    if (f.estado === 'Falla' && f.observacion_falla) {
                      rows.push(
                        <tr key={`${f.id}-falla`} style={{borderTop: 'none', borderBottom: 'none'}}>
                          <td colSpan="13" style={{padding: '0.3rem 1rem', fontSize: '0.73rem', background: 'var(--color-bg-light)', borderTop: 'none'}}>
                            <i className='bx bx-error-circle' style={{color: '#dc3545', marginRight: '4px', verticalAlign: 'middle'}}></i>
                            <span style={{color: 'var(--color-text-secondary)'}}><strong style={{color: '#dc3545'}}>Detalle:</strong> {f.observacion_falla}</span>
                          </td>
                        </tr>
                      )
                    }
                    return rows
                  }
                  const filasMultiProd = prods.map((p, idx) => (
                    <tr key={`${f.id}-${idx}`} onClick={() => handleClickFicha(f)}
                      onMouseEnter={() => setHoverFichaId(f.id)} onMouseLeave={() => setHoverFichaId(null)}
                      style={{cursor: f.estado === 'Falla' || f.estado === 'Corregida' ? 'default' : 'pointer', opacity: f.estado === 'Falla' ? 0.6 : 1, ...(idx > 0 ? {borderTop: 'none'} : {}), backgroundColor: hoverFichaId === f.id ? 'var(--color-bg-light, #f5f5f7)' : fondoGrupo}}>

                      {idx === 0 && celdaFecha}
                      <td style={{whiteSpace:'nowrap', fontSize:'0.75rem', color:'#7b1fa2', fontWeight:600}}>{p.num_ficha || '-'}</td>
                      {idx === 0 && celdaPlaca}
                      {idx === 0 && celdasComunes}
                      <td className="col-ocultar-movil">{p.producto || '-'}</td>
                      <td>{p.lote || '-'}</td>
                      <td className="col-ocultar-movil">{p.variedad || '-'}</td>
                      <td style={{textAlign: 'center'}}>{p.cantidad || 0}</td>
                      <td style={{textAlign: 'center'}}>{p.peso || '-'}</td>
                      {idx === 0 && (
                        <td rowSpan={prods.length} style={{verticalAlign: 'middle'}}>
                          <span className="col-ocultar-movil" style={{background: badgeColor(f.estado), color: 'white', padding: '2px 8px', borderRadius: '4px', fontSize: '0.7rem'}}>{f.estado}</span>
                          <span className="estado-badge-punto" title={f.estado} style={{background: badgeColor(f.estado), width: '12px', height: '12px', borderRadius: '50%', display: 'none'}}></span>
                          {f.estado === 'Falla' && f.observacion_falla && <div style={{fontSize: '0.65rem', color: 'var(--color-text-secondary)', marginTop: '3px', lineHeight: 1.2}} title={f.observacion_falla}>{f.observacion_falla.length > 60 ? f.observacion_falla.substring(0, 60) + '...' : f.observacion_falla}</div>}
                          {f.estado === 'Corregida' && f.correccion_id && <div style={{fontSize: '0.65rem', color: '#17a2b8', marginTop: '3px'}}>Corrección de #{f.correccion_id}</div>}
                        </td>
                      )}
                    </tr>
                  ))
                  // El rowSpan de celdaFecha/celdaPlaca/celdasComunes (totalFilasGrupo)
                  // ya cuenta esta fila de detalle si aplica -- sin ella, el rowSpan
                  // se pasa de largo y se come columnas de la SIGUIENTE ficha en la
                  // tabla, desalineandola por completo (bug real visto en produccion).
                  if (f.correccion_id) {
                    const fichaFalla = fichas.find(x => x.id === f.correccion_id)
                    if (fichaFalla?.observacion_falla) {
                      filasMultiProd.push(
                        <tr key={`${f.id}-corr`} style={{borderTop: 'none'}}>
                          <td colSpan="13" style={{padding: '0.3rem 1rem', fontSize: '0.73rem', background: 'var(--color-bg-light)', borderTop: 'none', borderBottom: '1px solid var(--color-bg-light)'}}>
                            <i className='bx bx-check-circle' style={{color: '#17a2b8', marginRight: '4px', verticalAlign: 'middle'}}></i>
                            <span style={{color: 'var(--color-text-secondary)'}}><strong style={{color: '#17a2b8'}}>Corrección:</strong> {fichaFalla.observacion_falla}</span>
                          </td>
                        </tr>
                      )
                    }
                  }
                  if (f.estado === 'Falla' && f.observacion_falla) {
                    filasMultiProd.push(
                      <tr key={`${f.id}-falla`} style={{borderTop: 'none', borderBottom: 'none'}}>
                        <td colSpan="13" style={{padding: '0.3rem 1rem', fontSize: '0.73rem', background: 'var(--color-bg-light)', borderTop: 'none'}}>
                          <i className='bx bx-error-circle' style={{color: '#dc3545', marginRight: '4px', verticalAlign: 'middle'}}></i>
                          <span style={{color: 'var(--color-text-secondary)'}}><strong style={{color: '#dc3545'}}>Detalle:</strong> {f.observacion_falla}</span>
                        </td>
                      </tr>
                    )
                  }
                  return filasMultiProd
                })
              })
            })()}
            {filtradas.length === 0 && (
              <tr><td colSpan="13" style={{textAlign:'center',padding:'2rem',color:'var(--color-text-secondary)'}}>No hay fichas de cosecha</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Drawer lateral para ver ficha y editar */}
      {drawerOpen && fichaEditar && (
        <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99998}}>
          <div style={{position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)'}} onClick={cerrarDrawer} />
          <div className="drawer-detalle-cosecha" style={{position: 'absolute', top: 0, right: 0, bottom: 0, width: '95vw', maxWidth: '900px', background: 'var(--color-bg-white)', boxShadow: '-4px 0 20px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', overflow: 'hidden'}}>
            {/* Header */}
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 1rem', borderBottom: '1px solid var(--color-bg-light)', background: 'var(--color-bg-light)', flexShrink: 0}}>
              <span style={{fontWeight: 600, color: 'var(--color-text-primary)', fontSize: '0.85rem'}}>
                {fichaEditar.placa} - {fichaEditar.nombre_chofer}
                <span style={{marginLeft: '0.5rem', background: badgeColor(fichaEditar.estado), color: 'white', padding: '2px 8px', borderRadius: '4px', fontSize: '0.7rem'}}>{fichaEditar.estado}</span>
              </span>
              <div style={{display: 'flex', gap: '0.5rem'}}>
                <button onClick={handleSincronizarAhora} disabled={sincronizando} style={{background: '#17a2b8', color: 'white', border: 'none', borderRadius: '6px', padding: '0.4rem 0.8rem', cursor: sincronizando ? 'default' : 'pointer', fontSize: '0.8rem', opacity: sincronizando ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: '0.3rem'}}>
                  <i className={`bx ${sincronizando ? 'bx-loader-alt bx-spin' : 'bx-sync'}`}></i> <span className="col-ocultar-movil">{sincronizando ? 'Sincronizando...' : 'Sincronizar'}</span>
                </button>
                <button onClick={() => { if (fichaIframeRef.current) fichaIframeRef.current.contentWindow.print() }} style={{background: '#7b1fa2', color: 'white', border: 'none', borderRadius: '6px', padding: '0.4rem 0.8rem', cursor: 'pointer', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem'}}>
                  <i className='bx bx-printer'></i> <span className="col-ocultar-movil">Imprimir</span>
                </button>
                <button onClick={handleEliminar} style={{background: '#dc3545', color: 'white', border: 'none', borderRadius: '6px', padding: '0.4rem 0.8rem', cursor: 'pointer', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem'}}>
                  <i className='bx bx-trash'></i> <span className="col-ocultar-movil">Eliminar</span>
                </button>
                <button onClick={cerrarDrawer} style={{background: 'var(--color-bg-light)', border: 'none', borderRadius: '6px', padding: '0.4rem 0.7rem', cursor: 'pointer', fontSize: '1rem', color: 'var(--color-text-secondary)'}}>
                  <i className='bx bx-x'></i>
                </button>
              </div>
            </div>
            {/* Contenido scrollable */}
            <div style={{flex: 1, overflow: 'auto'}}>
              {/* Ficha documento */}
              <iframe
                key={fichaEditar.id}
                ref={fichaIframeRef}
                srcDoc={generarDocumento(fichaEditar)}
                style={{width: '100%', height: fichaEditar.estado === 'Falla' ? '70vh' : '285px', border: 'none', borderBottom: '1px solid var(--color-bg-light)', background: 'white'}}
                title="Ficha de Cosecha"
              />
              {/* Datos editables */}
              {fichaEditar.estado !== 'Falla' && (
                <div style={{padding: '1rem'}}>
                  {/* Editar Vehículo */}
                  <h4 style={{margin: '0 0 0.5rem', color: 'var(--color-text-secondary)', fontSize: '0.85rem'}}>
                    <i className='bx bx-car' style={{marginRight: '0.3rem'}}></i> Vehículo
                  </h4>
                  <div style={{background: 'var(--color-bg-light)', padding: '0.8rem', borderRadius: '8px', marginBottom: '1rem', position: 'relative'}}>
                    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', fontSize: '0.8rem'}}>
                      <div style={{position: 'relative'}}>
                        <label style={{fontSize: '0.7rem', color: 'var(--color-text-secondary)', marginBottom: '2px', display: 'block'}}>Placa</label>
                        <input type="text" value={placaBusqueda} onChange={e => { setPlacaBusqueda(e.target.value); setShowCamionSug(e.target.value.length >= 1) }}
                          style={{width: '100%', border: '1px solid var(--color-border)', borderRadius: '4px', padding: '4px 8px', fontSize: '0.8rem', background: 'var(--color-bg-white)', color: 'var(--color-text-primary)'}} placeholder="Buscar placa..." />
                        {showCamionSug && (
                          <div style={{position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--color-bg-white)', border: '1px solid var(--color-border)', borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 1000, maxHeight: '150px', overflowY: 'auto', marginTop: '2px'}}>
                            {camiones.filter(c => c.placa?.toLowerCase().includes(placaBusqueda.toLowerCase()) || c.nombre?.toLowerCase().includes(placaBusqueda.toLowerCase())).slice(0, 8).map((c, i) => (
                              <div key={i} style={{padding: '0.4rem 0.6rem', cursor: 'pointer', borderBottom: '1px solid var(--color-bg-light)', fontSize: '0.75rem'}}
                                onClick={() => {
                                  setCamionEdit({ placa: c.placa, nombre_chofer: c.nombre, propietario: c.empresa, id_camion: c.id })
                                  setPlacaBusqueda(c.placa)
                                  setShowCamionSug(false)
                                }}>
                                <strong>{c.placa}</strong> - {c.nombre} <span style={{color: 'var(--color-text-secondary)'}}>({c.empresa})</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div>
                        <label style={{fontSize: '0.7rem', color: 'var(--color-text-secondary)', marginBottom: '2px', display: 'block'}}>Resp. Transporte</label>
                        <input type="text" value={camionEdit.nombre_chofer} readOnly
                          style={{width: '100%', border: '1px solid var(--color-border)', borderRadius: '4px', padding: '4px 8px', fontSize: '0.8rem', background: 'var(--color-bg-light)'}} />
                      </div>
                      <div>
                        <label style={{fontSize: '0.7rem', color: 'var(--color-text-secondary)', marginBottom: '2px', display: 'block'}}>Propietario</label>
                        <input type="text" value={camionEdit.propietario} readOnly
                          style={{width: '100%', border: '1px solid var(--color-border)', borderRadius: '4px', padding: '4px 8px', fontSize: '0.8rem', background: 'var(--color-bg-light)'}} />
                      </div>
                    </div>
                    <div style={{display: 'flex', alignItems: 'flex-end', gap: '0.5rem', marginTop: '0.5rem'}}>
                      <div style={{flex: 1}}>
                        <label style={{fontSize: '0.7rem', color: 'var(--color-text-secondary)', marginBottom: '2px', display: 'block'}}>Hora de Envío</label>
                        <input type="datetime-local" value={horaEnvioEdit} onChange={e => setHoraEnvioEdit(e.target.value)}
                          style={{width: '100%', border: '1px solid var(--color-border)', borderRadius: '4px', padding: '4px 8px', fontSize: '0.8rem', background: 'var(--color-bg-white)', color: 'var(--color-text-primary)'}} />
                      </div>
                      <button onClick={handleGuardarHoraEnvio} disabled={guardandoHoraEnvio || !horaEnvioEdit}
                        style={{background: guardandoHoraEnvio || !horaEnvioEdit ? 'var(--color-border)' : '#28a745', color: 'white', border: 'none', borderRadius: '4px', padding: '6px 12px', cursor: guardandoHoraEnvio || !horaEnvioEdit ? 'default' : 'pointer', fontSize: '0.75rem', whiteSpace: 'nowrap'}}>
                        Guardar hora
                      </button>
                    </div>
                  </div>

                  {/* Editar Productos */}
                  <h4 style={{margin: '0 0 0.5rem', color: 'var(--color-text-secondary)', fontSize: '0.85rem'}}>
                    <i className='bx bx-leaf' style={{marginRight: '0.3rem'}}></i> Productos
                  </h4>
                  {productosEdit.map((p, i) => (
                    <div key={i} style={{background: 'var(--color-bg-light)', padding: '0.8rem', borderRadius: '8px', marginBottom: '0.5rem', borderLeft: '3px solid #7b1fa2'}}>
                      <div style={{display: 'flex', justifyContent: 'flex-end', marginBottom: '0.3rem'}}>
                        <button onClick={() => handleEliminarProducto(i)} title="Eliminar este producto"
                          style={{background: 'transparent', border: 'none', color: '#dc3545', cursor: 'pointer', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.2rem'}}>
                          <i className='bx bx-trash'></i>
                        </button>
                      </div>
                      <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.8rem'}}>
                        {/* Producto con sugerencias */}
                        <div style={{position: 'relative', gridColumn: '1 / -1'}}>
                          <label style={{fontSize: '0.7rem', color: 'var(--color-text-secondary)', marginBottom: '2px', display: 'block'}}>Orden de Cultivo / Producto</label>
                          <input type="text" value={p._busqueda !== undefined ? p._busqueda : (p.orden_cultivo || '')} onChange={e => buscarLotes(e.target.value, i)}
                            style={{width: '100%', border: '1px solid var(--color-border)', borderRadius: '4px', padding: '4px 8px', fontSize: '0.8rem', background: 'var(--color-bg-white)', color: 'var(--color-text-primary)'}} placeholder="Buscar OC, lote, producto..." />
                          {loteSugIdx === i && lotesSugeridos.length > 0 && (
                            <div style={{position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--color-bg-white)', border: '1px solid var(--color-border)', borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 1000, maxHeight: '150px', overflowY: 'auto', marginTop: '2px'}}>
                              {lotesSugeridos.map((l, j) => (
                                <div key={j} style={{padding: '0.4rem 0.6rem', cursor: 'pointer', borderBottom: '1px solid var(--color-bg-light)', fontSize: '0.75rem'}}
                                  onClick={() => seleccionarLote(l, i)}>
                                  <span style={{color:'#7b1fa2', fontWeight:'bold'}}>OC: {l.ocult_cod_ocult}</span> / {l.lote} {l.edad_sem ? <span style={{color:'#e65100', fontWeight:'bold'}}>Sem {l.edad_sem}</span> : ''} / {l.hacienda} | {l.ocult_cod_proda}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div>
                          <label style={{fontSize: '0.7rem', color: 'var(--color-text-secondary)', marginBottom: '2px', display: 'block'}}>Producto</label>
                          <input type="text" value={p.producto || ''} readOnly style={{width: '100%', border: '1px solid var(--color-border)', borderRadius: '4px', padding: '4px 8px', fontSize: '0.8rem', background: 'var(--color-bg-light)'}} />
                        </div>
                        <div>
                          <label style={{fontSize: '0.7rem', color: 'var(--color-text-secondary)', marginBottom: '2px', display: 'block'}}>Lote</label>
                          <input type="text" value={p.lote || ''} readOnly style={{width: '100%', border: '1px solid var(--color-border)', borderRadius: '4px', padding: '4px 8px', fontSize: '0.8rem', background: 'var(--color-bg-light)'}} />
                        </div>
                        <div>
                          <label style={{fontSize: '0.7rem', color: 'var(--color-text-secondary)', marginBottom: '2px', display: 'block'}}>Variedad</label>
                          <input type="text" value={p.variedad || ''} readOnly style={{width: '100%', border: '1px solid var(--color-border)', borderRadius: '4px', padding: '4px 8px', fontSize: '0.8rem', background: 'var(--color-bg-light)'}} />
                        </div>
                        <div>
                          <label style={{fontSize: '0.7rem', color: 'var(--color-text-secondary)', marginBottom: '2px', display: 'block'}}>Bines</label>
                          <input type="number" value={p.cantidad || ''} onChange={e => handleProductoChange(i, 'cantidad', e.target.value)}
                            style={{width: '100%', border: '1px solid var(--color-border)', borderRadius: '4px', padding: '4px 8px', fontSize: '0.8rem', textAlign: 'center', background: 'var(--color-bg-white)', color: 'var(--color-text-primary)'}} />
                        </div>
                        <div>
                          <label style={{fontSize: '0.7rem', color: 'var(--color-text-secondary)', marginBottom: '2px', display: 'block'}}>Peso (kg)</label>
                          <input type="number" step="0.01" value={p.peso || ''} onChange={e => handleProductoChange(i, 'peso', e.target.value)}
                            style={{width: '100%', border: '1px solid var(--color-border)', borderRadius: '4px', padding: '4px 8px', fontSize: '0.8rem', textAlign: 'center', background: 'var(--color-bg-white)', color: 'var(--color-text-primary)'}} />
                        </div>
                        <div>
                          <label style={{fontSize: '0.7rem', color: 'var(--color-text-secondary)', marginBottom: '2px', display: 'block'}}>N° Ficha</label>
                          <input type="text" value={p.num_ficha || ''} onChange={e => handleProductoChange(i, 'num_ficha', e.target.value)}
                            style={{width: '100%', border: '1px solid var(--color-border)', borderRadius: '4px', padding: '4px 8px', fontSize: '0.8rem', background: 'var(--color-bg-white)', color: 'var(--color-text-primary)'}} />
                        </div>
                      </div>
                    </div>
                  ))}
                  <div style={{display: 'flex', justifyContent: 'flex-end', marginTop: '0.8rem'}}>
                    <button onClick={handleGuardar} disabled={!hayCambios()}
                      style={{background: hayCambios() ? '#28a745' : 'var(--color-border)', color: 'white', border: 'none', borderRadius: '6px', padding: '0.5rem 1.5rem', cursor: hayCambios() ? 'pointer' : 'default', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600}}>
                      <i className='bx bx-save'></i> Guardar
                    </button>
                  </div>
                </div>
              )}
              {/* Indicador de Falla -- al final del drawer. Se muestra en la
                  ficha con Falla original, y tambien en su Corregida (busca
                  la observacion en la ficha original via correccion_id). */}
              {(() => {
                const fichaConFalla = fichaEditar.estado === 'Falla'
                  ? fichaEditar
                  : (fichaEditar.correccion_id ? fichas.find(x => x.id === fichaEditar.correccion_id) : null)
                if (!fichaConFalla?.observacion_falla) return null
                return (
                  <div style={{padding: '0.8rem 1rem', background: 'var(--color-bg-light)', borderTop: '1px solid var(--color-border)'}}>
                    <div style={{display: 'flex', alignItems: 'flex-start', gap: '0.5rem'}}>
                      <i className='bx bx-error-circle' style={{color: '#dc3545', fontSize: '1.2rem', marginTop: '2px'}}></i>
                      <div>
                        <strong style={{color: '#dc3545', fontSize: '0.85rem'}}>
                          {fichaEditar.estado === 'Falla' ? 'Ficha con Falla' : `Corrección de la ficha #${fichaConFalla.id}`}
                        </strong>
                        <p style={{margin: '0.3rem 0 0', fontSize: '0.8rem', color: 'var(--color-text-secondary)', lineHeight: 1.4}}>
                          {fichaConFalla.observacion_falla.split('; ').map((cambio, i) => (
                            <span key={i} style={{display: 'block', padding: '2px 0'}}>
                              <span style={{color: '#dc3545', marginRight: '4px'}}>●</span>{cambio}
                            </span>
                          ))}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default ReportesCosecha
