import { useState, useEffect, useRef } from 'react'
import Swal from 'sweetalert2'
import { confirmar, exito } from './SwalConfig'
import { addToQueue } from '../services/syncQueue'
import { obtenerEmpresaNintanga, logoUrl } from '../services/empresasService'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8007'
const MAX_BINES = 30

// seg_foto_url guarda un JSON array de URLs; soporta el formato viejo (una sola URL en texto plano)
export function parseFotos(raw) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(Boolean) : []
  } catch {
    return raw.startsWith('http') ? [raw] : []
  }
}

function DrawerCosecha({ open, onClose, ficha, onSaved }) {
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
      await addToQueue(url, options.method || 'GET', body, 'cosecha', descripcion || 'Ficha de cosecha')
      return null
    }
  }
  const [paso, setPaso] = useState(1)
  const [formData, setFormData] = useState({
    placa: '',
    responsable: '',
    nombreChofer: '',
    idCamion: null,
    idSupervisor: null,
    cumpleNormativas: false,
    seguridad: { chaleco: false, cofia: false, casco: false, calzadoAdecuado: false, limpiezaBines: false, materialesExtranos: false, saran: false },
    seguridadFotoUrl: '',
    seguridadObservaciones: '',
    pesoEntrada: '',
    pesoSalida: '',
    pesoNeto: ''
  })
  const [fichaCreatedId, setFichaCreatedId] = useState(null)  // ID del transporte recién creado
  const [guardandoCamion, setGuardandoCamion] = useState(false)
  const fichaId = ficha?.id || fichaCreatedId  // usar prop o el recién creado
  const [productos, setProductos] = useState([])
  const [productoTemp, setProductoTemp] = useState({ producto: '', lote: '', centroCostos: '', ordenCultivo: '', variedad: '', numFichaOrg: '', numFicha: '', peso: '', cantidad: '', busqueda: '' })
  const [lotesSugeridos, setLotesSugeridos] = useState([])
  const busquedaLoteIdRef = useRef(0)
  const [showFichaPreview, setShowFichaPreview] = useState(false)
  const fichaIframeRef = useRef(null)
  const [empresaTema, setEmpresaTema] = useState(null)
  useEffect(() => { obtenerEmpresaNintanga().then(setEmpresaTema) }, [])
  const [camiones, setCamiones] = useState([])
  const [placaBusqueda, setPlacaBusqueda] = useState('')
  const [showCamionSugeridos, setShowCamionSugeridos] = useState(false)
  const cultivos = ['BRÓCOLI', 'ROMANESCO', 'COLIFLOR']
  const variedades = ['IRONMAN', 'VERONICA', 'LEGACY', 'STEEL', 'MARATHON']

  const [supervisores, setSupervisores] = useState([])
  const [proyectos, setProyectos] = useState([])

  // Cargar catálogos al montar
  useEffect(() => {
    const fetchCamiones = async () => {
      try {
        const res = await fetch(`${API_URL}/api/camiones`)
        if (res.ok) setCamiones(await res.json())
      } catch (err) { console.error(err) }
    }
    const fetchSupervisores = async () => {
      try {
        const res = await fetch(`${API_URL}/api/supervisores`)
        if (res.ok) {
          const data = await res.json()
          setSupervisores(data)
          // Auto-asociar: comparar usuario logueado con catálogo de supervisores
          const usuario = (localStorage.getItem('usuario_nombre') || '').toUpperCase().trim()
          if (usuario) {
            const match = data.find(s => s.estado === 'Activo' && usuario.includes(s.nombre.toUpperCase().trim()))
              || data.find(s => s.estado === 'Activo' && s.nombre.toUpperCase().trim().includes(usuario))
            if (match) {
              setFormData(prev => ({ ...prev, idSupervisor: match.id }))
            }
          }
        }
      } catch (err) { console.error(err) }
    }
    const fetchProyectos = async () => {
      try {
        const res = await fetch(`${API_URL}/api/proyectos`)
        if (res.ok) setProyectos(await res.json())
      } catch (err) { console.error(err) }
    }
    fetchCamiones()
    fetchSupervisores()
    fetchProyectos()
  }, [])

  // Cargar datos si hay ficha seleccionada
  useEffect(() => {
    if (ficha) {
      setFormData({
        placa: ficha.placa || '',
        responsable: ficha.propietario || '',
        nombreChofer: ficha.nombre_chofer || '',
        idSupervisor: ficha.id_supervisor || null,
        cumpleNormativas: true,
        seguridad: {
          chaleco: ficha.seg_chaleco || false,
          cofia: ficha.seg_cofia || false,
          casco: ficha.seg_casco || false,
          calzadoAdecuado: ficha.seg_calzado_adecuado || false,
          limpiezaBines: ficha.seg_limpieza_bines || false,
          materialesExtranos: ficha.seg_materiales_extranos || false,
          saran: ficha.seg_saran || false
        },
        seguridadFotoUrl: ficha.seg_foto_url || '',
        seguridadObservaciones: ficha.seg_observaciones || '',
        pesoEntrada: '',
        pesoSalida: '',
        pesoNeto: ''
      })
      // Cargar productos existentes
      fetchProductosExistentes(ficha.id)
      // Cargar numeración automática
      fetchNumeracion(ficha.id)
      setPaso(ficha.estado === 'Enviado' ? 3 : 2)
    } else {
      resetForm()
    }
  }, [ficha, open])

  const fetchProductosExistentes = async (idTransporte) => {
    try {
      const res = await offlineFetch(`${API_URL}/api/cosecha-productos/${idTransporte}`, { method: 'GET' }, 'Cargar productos')
      if (res && res.ok) {
        const data = await res.json()
        const productosExistentes = data.map(p => ({
          id: p.id,
          producto: p.producto || '',
          lote: p.lote || '',
          variedad: p.variedad || '',
          ordenCultivo: p.orden_cultivo || '',
          proyecto: p.centro_costos || '',
          cantidad: p.cantidad || 0,
          pesoNeto: p.peso || '',
          numFicha: p.num_ficha || '',
          numeracion: p.numeracion || '',
          responsable: p.responsable || ''
        }))
        setProductos(productosExistentes)
        const numFichaExistente = productosExistentes[0]?.numFicha || ''
        if (numFichaExistente) {
          setFormData(prev => ({ ...prev, numFicha: numFichaExistente }))
        }
      }
    } catch (err) {
      console.error('Error cargando productos:', err)
    }
  }

  const fetchNumeracion = async (idTransporte) => {
    try {
      const res = await fetch(`${API_URL}/api/cosecha-numeracion/${idTransporte}`)
      if (res.ok) {
        const data = await res.json()
        if (data.numeracion) {
          setFormData(prev => ({...prev, numeracionAuto: data.numeracion}))
        }
      }
    } catch (err) { console.error('Error cargando numeración:', err) }
  }

  const resetForm = () => {
    setPaso(1)
    setFichaCreatedId(null)
    setFormData({
      placa: '', responsable: '', nombreChofer: '', idCamion: null, idSupervisor: null, cumpleNormativas: false,
      seguridad: { chaleco: false, cofia: false, casco: false, calzadoAdecuado: false, limpiezaBines: false, materialesExtranos: false, saran: false },
      seguridadFotoUrl: '', seguridadObservaciones: '',
      pesoEntrada: '', pesoSalida: '', pesoNeto: ''
    })
    setPlacaBusqueda('')
    setShowCamionSugeridos(false)
    setProductos([])
    setProductoTemp({ producto: '', lote: '', centroCostos: '', ordenCultivo: '', variedad: '', numFichaOrg: '', numFicha: '', peso: '', cantidad: '' })
  }

  // Cerrar con ESC
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape' && open) onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target
    setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }))

    if (name === 'pesoEntrada' || name === 'pesoSalida') {
      const entrada = name === 'pesoEntrada' ? parseFloat(value) || 0 : parseFloat(formData.pesoEntrada) || 0
      const salida = name === 'pesoSalida' ? parseFloat(value) || 0 : parseFloat(formData.pesoSalida) || 0
      if (entrada && salida) {
        setFormData(prev => ({ ...prev, [name]: value, pesoNeto: (entrada - salida).toFixed(2) }))
      }
    }
  }

  const binesUsados = productos.reduce((sum, p) => sum + (parseInt(p.cantidad) || 0), 0)
  const binesDisponibles = MAX_BINES - binesUsados

  const esProductoOrganico = (prod) => { const p = (prod || '').toUpperCase(); return p.includes('ORGANIC') || p.includes('ORGÁNIC'); }

  const agregarProducto = async () => {
    if (!productoTemp.ordenCultivo || !productoTemp.cantidad) return
    const cant = parseInt(productoTemp.cantidad) || 0
    if (cant <= 0) return

    // No mezclar orgánico con convencional
    const productosExistentes = productos.filter(p => !productoTemp.editandoId || p.id !== productoTemp.editandoId)
    if (productosExistentes.length > 0) {
      const existenteEsOrganico = productosExistentes.some(p => esProductoOrganico(p.producto))
      const nuevoEsOrganico = esProductoOrganico(productoTemp.producto)
      if (existenteEsOrganico !== nuevoEsOrganico) {
        Swal.fire('No permitido', `No se puede mezclar productos orgánicos con convencionales en la misma ficha.`, 'warning')
        return
      }
    }

    if (!productoTemp.editandoId && cant > binesDisponibles) return

    // Guardar directamente en la base de datos
    if (fichaId) {
      try {
        const res = await fetch(`${API_URL}/api/cosecha-productos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id_transporte: fichaId,
            productos: [{
              producto: productoTemp.producto,
              lote: productoTemp.lote,
              centro_costos: productoTemp.proyecto || '',
              orden_cultivo: productoTemp.ordenCultivo,
              variedad: productoTemp.variedad,
              ubicacion: productoTemp.hacienda || '',
              cantidad: cant,
              responsable: localStorage.getItem('usuario_nombre') || ''
            }]
          })
        })
        if (res && res.ok) {
          await fetchProductosExistentes(fichaId)
          if (onSaved) onSaved()
        }
      } catch (err) {
        console.error('Error guardando producto:', err)
      }
    } else {
      if (productoTemp.editandoId) {
        setProductos(productos.map(p => p.id === productoTemp.editandoId
          ? { ...p, ordenCultivo: productoTemp.ordenCultivo, producto: productoTemp.producto, lote: productoTemp.lote, variedad: productoTemp.variedad, proyecto: productoTemp.proyecto, cantidad: productoTemp.cantidad }
          : p
        ))
      } else {
        setProductos([...productos, { ...productoTemp, id: Date.now() }])
      }
    }
    setProductoTemp({ producto: '', lote: '', centroCostos: '', ordenCultivo: '', variedad: '', numFichaOrg: '', numFicha: '', peso: '', cantidad: '', busqueda: '', hacienda: '', proyecto: '', dimension: '', editandoId: null })
  }

  const seleccionarProducto = (p) => {
    setProductoTemp({
      ...productoTemp,
      ordenCultivo: p.ordenCultivo || '',
      producto: p.producto || '',
      lote: p.lote || '',
      variedad: p.variedad || '',
      hacienda: p.hacienda || '',
      proyecto: p.proyecto || '',
      dimension: p.dimension || '',
      cantidad: String(p.cantidad || ''),
      busqueda: `${p.ordenCultivo || ''}`,
      editandoId: p.id
    })
  }

  const eliminarProducto = async (id) => {
    // Si es un id numérico bajo (de la BD), eliminarlo del backend
    if (typeof id === 'number' && id < 1000000000) {
      try {
        await offlineFetch(`${API_URL}/api/cosecha-productos/item/${id}`, { method: 'DELETE' }, 'Eliminar producto cosecha')
      } catch (err) { console.error(err) }
    }
    setProductos(productos.filter(p => p.id !== id))
  }

  const abrirSeguridadCheck = async () => {
    let fotosExistentes = parseFotos(formData.seguridadFotoUrl)
    let archivosNuevos = []

    const renderPreview = () => {
      const preview = document.getElementById('swal-foto-preview')
      if (!preview) return
      const bloques = [
        ...fotosExistentes.map((url, i) => `<div style="position:relative;" data-tipo="existente" data-idx="${i}"><img src="${url}" style="width:70px;height:70px;object-fit:cover;border-radius:6px;display:block;" /><span data-quitar="existente-${i}" style="position:absolute;top:-6px;right:-6px;background:#dc3545;color:#fff;border-radius:50%;width:18px;height:18px;font-size:0.7rem;display:flex;align-items:center;justify-content:center;cursor:pointer;">×</span></div>`),
        ...archivosNuevos.map((_, i) => `<div style="position:relative;" data-tipo="nuevo" data-idx="${i}"><img src="${archivosNuevos[i]._preview}" style="width:70px;height:70px;object-fit:cover;border-radius:6px;display:block;" /><span data-quitar="nuevo-${i}" style="position:absolute;top:-6px;right:-6px;background:#dc3545;color:#fff;border-radius:50%;width:18px;height:18px;font-size:0.7rem;display:flex;align-items:center;justify-content:center;cursor:pointer;">×</span></div>`)
      ]
      preview.innerHTML = bloques.join('')
      preview.querySelectorAll('[data-quitar]').forEach(el => {
        el.addEventListener('click', () => {
          const [tipo, idx] = el.getAttribute('data-quitar').split('-')
          if (tipo === 'existente') fotosExistentes.splice(Number(idx), 1)
          else archivosNuevos.splice(Number(idx), 1)
          renderPreview()
        })
      })
    }

    const agregarArchivos = (files) => {
      Array.from(files || []).forEach(file => {
        const reader = new FileReader()
        reader.onload = ev => { file._preview = ev.target.result; renderPreview() }
        reader.readAsDataURL(file)
        archivosNuevos.push(file)
      })
    }

    const { value: formValues } = await Swal.fire({
      title: '🛡️ Medidas de Seguridad',
      background: '#1e1e2e',
      color: '#ffffff',
      confirmButtonColor: '#7b1fa2',
      confirmButtonText: 'Confirmar',
      showCancelButton: true,
      cancelButtonText: 'Cancelar',
      cancelButtonColor: '#555',
      width: '420px',
      customClass: { popup: 'swal-seguridad-popup', title: 'swal-dark-title', htmlContainer: 'swal-dark-content' },
      didOpen: () => {
        renderPreview()
        const inputCamara = document.getElementById('swal-foto-camara')
        const inputGaleria = document.getElementById('swal-foto-galeria')
        if (inputCamara) inputCamara.addEventListener('change', (e) => { agregarArchivos(e.target.files); e.target.value = '' })
        if (inputGaleria) inputGaleria.addEventListener('change', (e) => { agregarArchivos(e.target.files); e.target.value = '' })

        // Foto de evidencia se pide si falta marcar algun item de cumplimiento,
        // incluido "Sin materiales extraños" (si NO esta marcado significa
        // que si se encontraron materiales extraños).
        const idsCumplimiento = ['swal-chaleco', 'swal-cofia', 'swal-casco', 'swal-calzado', 'swal-limpieza', 'swal-materiales', 'swal-saran']
        const actualizarVisibilidadFoto = () => {
          const faltaAlgo = idsCumplimiento.some(id => !document.getElementById(id).checked)
          const seccionFoto = document.getElementById('swal-foto-seccion')
          if (seccionFoto) seccionFoto.style.display = faltaAlgo ? 'block' : 'none'
        }
        idsCumplimiento.forEach(id => {
          document.getElementById(id).addEventListener('change', actualizarVisibilidadFoto)
        })
        actualizarVisibilidadFoto()
      },
      html: `
        <div style="padding: 0.3rem 0;">
          <div style="display:flex; flex-direction:column; gap:0.4rem;">
            <label style="display:flex; align-items:center; gap:0.6rem; cursor:pointer; color:#fff; font-size:0.88rem; padding:0.45rem 0.8rem; border-radius:6px; background:#2a2a3e;">
              <input type="checkbox" id="swal-chaleco" ${formData.seguridad.chaleco ? 'checked' : ''} style="width:16px;height:16px;accent-color:#7b1fa2;"> Chaleco
            </label>
            <label style="display:flex; align-items:center; gap:0.6rem; cursor:pointer; color:#fff; font-size:0.88rem; padding:0.45rem 0.8rem; border-radius:6px; background:#2a2a3e;">
              <input type="checkbox" id="swal-cofia" ${formData.seguridad.cofia ? 'checked' : ''} style="width:16px;height:16px;accent-color:#7b1fa2;"> Cofia
            </label>
            <label style="display:flex; align-items:center; gap:0.6rem; cursor:pointer; color:#fff; font-size:0.88rem; padding:0.45rem 0.8rem; border-radius:6px; background:#2a2a3e;">
              <input type="checkbox" id="swal-casco" ${formData.seguridad.casco ? 'checked' : ''} style="width:16px;height:16px;accent-color:#7b1fa2;"> Casco
            </label>
            <label style="display:flex; align-items:center; gap:0.6rem; cursor:pointer; color:#fff; font-size:0.88rem; padding:0.45rem 0.8rem; border-radius:6px; background:#2a2a3e;">
              <input type="checkbox" id="swal-calzado" ${formData.seguridad.calzadoAdecuado ? 'checked' : ''} style="width:16px;height:16px;accent-color:#7b1fa2;"> Calzado adecuado
            </label>
            <label style="display:flex; align-items:center; gap:0.6rem; cursor:pointer; color:#fff; font-size:0.88rem; padding:0.45rem 0.8rem; border-radius:6px; background:#2a2a3e;">
              <input type="checkbox" id="swal-limpieza" ${formData.seguridad.limpiezaBines ? 'checked' : ''} style="width:16px;height:16px;accent-color:#7b1fa2;"> Limpieza de bines
            </label>
            <label style="display:flex; align-items:center; gap:0.6rem; cursor:pointer; color:#fff; font-size:0.88rem; padding:0.45rem 0.8rem; border-radius:6px; background:#2a2a3e;">
              <input type="checkbox" id="swal-materiales" ${formData.seguridad.materialesExtranos ? 'checked' : ''} style="width:16px;height:16px;accent-color:#7b1fa2;"> Sin materiales extraños
            </label>
            <label style="display:flex; align-items:center; gap:0.6rem; cursor:pointer; color:#fff; font-size:0.88rem; padding:0.45rem 0.8rem; border-radius:6px; background:#2a2a3e;">
              <input type="checkbox" id="swal-saran" ${formData.seguridad.saran ? 'checked' : ''} style="width:16px;height:16px;accent-color:#7b1fa2;"> Sarán
            </label>
          </div>
          <div id="swal-foto-seccion" style="margin-top:0.8rem;">
            <label style="font-size:0.75rem; margin-bottom:0.4rem; display:block; color:#aaa;">Fotos de evidencia</label>
            <div style="display:flex; gap:0.5rem; margin-bottom:0.5rem;">
              <label style="flex:1; text-align:center; padding:0.5rem; background:#7b1fa2; color:#fff; border-radius:6px; cursor:pointer; font-size:0.78rem; display:flex; align-items:center; justify-content:center; gap:0.3rem;">
                <i class='bx bx-camera'></i> Tomar foto
                <input type="file" id="swal-foto-camara" accept="image/*" capture="environment" style="display:none;">
              </label>
              <label style="flex:1; text-align:center; padding:0.5rem; background:#444; color:#fff; border-radius:6px; cursor:pointer; font-size:0.78rem; display:flex; align-items:center; justify-content:center; gap:0.3rem;">
                <i class='bx bx-upload'></i> Subir foto
                <input type="file" id="swal-foto-galeria" accept="image/*" multiple style="display:none;">
              </label>
            </div>
            <div id="swal-foto-preview" style="display:flex; flex-wrap:wrap; gap:0.4rem;"></div>
          </div>
          <div style="margin-top:0.5rem;">
            <label style="font-size:0.75rem; margin-bottom:0.2rem; display:block; color:#aaa;">Observaciones</label>
            <input type="text" id="swal-observaciones" value="${formData.seguridadObservaciones}" style="width:100%;padding:0.4rem 0.6rem;border-radius:6px;border:1px solid #444;background:#2a2a3e;color:#fff;font-size:0.85rem;" placeholder="Observaciones...">
          </div>
        </div>
      `,
      preConfirm: async () => {
        const base = {
          chaleco: document.getElementById('swal-chaleco').checked,
          cofia: document.getElementById('swal-cofia').checked,
          casco: document.getElementById('swal-casco').checked,
          calzadoAdecuado: document.getElementById('swal-calzado').checked,
          limpiezaBines: document.getElementById('swal-limpieza').checked,
          materialesExtranos: document.getElementById('swal-materiales').checked,
          saran: document.getElementById('swal-saran').checked,
          observaciones: document.getElementById('swal-observaciones').value,
          fotoUrl: JSON.stringify(fotosExistentes)
        }
        if (archivosNuevos.length > 0) {
          Swal.showLoading()
          try {
            const urlsSubidas = []
            for (const archivo of archivosNuevos) {
              const fd = new FormData()
              fd.append('file', archivo)
              const res = await fetch(`${API_URL}/api/cosecha-transp/foto-seguridad`, {
                method: 'POST',
                headers: {},
                body: fd
              })
              if (!res.ok) throw new Error('upload failed')
              const data = await res.json()
              urlsSubidas.push(data.url)
            }
            base.fotoUrl = JSON.stringify([...fotosExistentes, ...urlsSubidas])
          } catch (err) {
            Swal.showValidationMessage('No se pudieron subir las fotos. Intenta de nuevo.')
            return false
          }
        }
        return base
      }
    })

    if (formValues) {
      setFormData(prev => ({
        ...prev, cumpleNormativas: true,
        seguridad: { chaleco: formValues.chaleco, cofia: formValues.cofia, casco: formValues.casco, calzadoAdecuado: formValues.calzadoAdecuado, limpiezaBines: formValues.limpiezaBines, materialesExtranos: formValues.materialesExtranos, saran: formValues.saran },
        seguridadFotoUrl: formValues.fotoUrl,
        seguridadObservaciones: formValues.observaciones
      }))
    }
  }

  const handleGuardarCamion = async () => {
    // Guarda contra doble/triple tap en pantalla tactil -- sin esto, cada
    // toque de mas antes de que termine el POST creaba una ficha "Activo"
    // vacia duplicada (visto en produccion: 3 fichas Activo del mismo
    // camion/dia creadas con ~150ms de diferencia entre si).
    if (guardandoCamion) return
    setGuardandoCamion(true)
    try {
      const response = await offlineFetch(`${API_URL}/api/cosecha-transp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_camion: formData.idCamion,
          id_supervisor: formData.idSupervisor,
          propietario: formData.responsable,
          placa: formData.placa,
          nombre_chofer: formData.nombreChofer,
          seg_chaleco: formData.seguridad.chaleco,
          seg_cofia: formData.seguridad.cofia,
          seg_casco: formData.seguridad.casco,
          seg_calzado_adecuado: formData.seguridad.calzadoAdecuado,
          seg_limpieza_bines: formData.seguridad.limpiezaBines,
          seg_materiales_extranos: formData.seguridad.materialesExtranos,
          seg_saran: formData.seguridad.saran,
          seg_foto_url: formData.seguridadFotoUrl,
          seg_observaciones: formData.seguridadObservaciones,
          estado: 'Activo'
        })
      }, 'Guardar datos del camión')
      if (response) {
        const data = await response.json()
        if (data.id) setFichaCreatedId(data.id)
        await exito('Datos del camión guardados')
      } else {
        await exito('Datos guardados offline — se sincronizará cuando haya conexión')
      }
      if (onSaved) onSaved()
      setPaso(2)
    } catch (err) {
      console.error('Error guardando camión:', err)
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo guardar', background: '#1e1e2e', color: '#fff', confirmButtonColor: '#7b1fa2' })
    } finally {
      setGuardandoCamion(false)
    }
  }

  const handleEnviarCamion = async () => {
    // La empresa destino es la del camión seleccionado (propietario/empresa)
    const plantaFinal = formData.responsable || ficha?.propietario || 'PROVEFRUT'

    const result = await Swal.fire({
      title: `Enviar a ${plantaFinal}`,
      text: `El camión ${formData.placa || ficha?.placa || ''} será enviado a ${plantaFinal}`,
      icon: 'question',
      background: '#1e1e2e',
      color: '#ffffff',
      confirmButtonColor: '#7b1fa2',
      confirmButtonText: 'Enviar',
      showCancelButton: true,
      cancelButtonText: 'Cancelar',
      cancelButtonColor: '#555'
    })

    if (!result.isConfirmed) return

    const usuario = localStorage.getItem('usuario_nombre') || ''

    try {
      // Guardar productos
      await offlineFetch(`${API_URL}/api/cosecha-productos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_transporte: fichaId || null,
          productos: productos.map(p => ({
            producto: p.producto,
            lote: p.lote,
            centro_costos: p.proyecto || '',
            orden_cultivo: p.ordenCultivo,
            variedad: p.variedad,
            ubicacion: p.hacienda || '',
            cantidad: parseInt(p.cantidad) || 0,
            responsable: usuario
          }))
        })
      }, 'Guardar productos para envío')

      // Generar numeración en operaciones_cosecha
      if (fichaId) {
        try {
          const numRes = await fetch(`${API_URL}/api/cosecha-numeracion/${fichaId}`, { method: 'POST' })
          if (numRes.ok) {
            const numData = await numRes.json()
            setFormData(prev => ({...prev, numeracionAuto: numData.numeracion}))
          }
        } catch (err) { console.error('Error generando numeración:', err) }
      }

      // Actualizar fecha_salida y planta en transporte
      if (fichaId) {
        await offlineFetch(`${API_URL}/api/cosecha-transp/${fichaId}/enviar`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ usuario, planta: plantaFinal })
        }, 'Enviar camión')
      }

      await exito('Camión enviado')
      if (onSaved) onSaved()
      setPaso(3)
    } catch (err) {
      console.error('Error enviando camión:', err)
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo enviar', background: '#1e1e2e', color: '#fff', confirmButtonColor: '#7b1fa2' })
    }
  }

  const handleGuardarPesos = async () => {
    if (!fichaId || productos.length === 0) return
    try {
      // Guardar pesos y num_ficha de cada producto
      for (const p of productos) {
        if (p.id) {
          await fetch(`${API_URL}/api/cosecha-productos/item/${p.id}/peso`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ peso_neto: parseFloat(p.pesoNeto) || 0, num_ficha: formData.numFicha || '' })
          })
        }
      }
      await exito('Pesos guardados')
      if (onSaved) onSaved()
    } catch (err) { console.error('Error guardando pesos:', err) }
  }

  const handleFinalizar = async () => {
    const pesoTotal = productos.reduce((sum, p) => sum + (parseFloat(p.pesoNeto) || 0), 0)
    const tienePesos = productos.some(p => parseFloat(p.pesoNeto) > 0)
    if (!tienePesos || !formData.numFicha) {
      Swal.fire({ icon: 'warning', title: 'Datos incompletos', text: 'Debe ingresar al menos un peso y el N° de ficha para marcar como recibido.', background: '#1e1e2e', color: '#fff', confirmButtonColor: '#7b1fa2' })
      return
    }
    const result = await confirmar({
      titulo: '¿Marcar como Recibido?',
      html: `<p style="color:#fff;">Total Bines: ${binesUsados} | Peso neto: ${pesoTotal} kg</p>`,
      icono: 'question'
    })
    if (!result.isConfirmed) return
    // Guardar pesos y num_ficha en cada producto
    try {
      for (const p of productos) {
        if (p.id) {
          await fetch(`${API_URL}/api/cosecha-productos/item/${p.id}/peso`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ peso_neto: parseFloat(p.pesoNeto) || 0, num_ficha: formData.numFicha || '' })
          })
        }
      }
    } catch (err) { console.error('Error guardando pesos:', err) }
    // Actualizar estado a Recibido
    if (fichaId) {
      try {
        await fetch(`${API_URL}/api/cosecha-transp/${fichaId}/finalizar`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recibido_por: localStorage.getItem('usuario_nombre') || '' })
        })
      } catch (err) { console.error('Error finalizando:', err) }
    }
    await exito('Ficha recibida')
    if (onSaved) onSaved()
    onClose()
  }

  const paso1Valido = formData.idCamion && formData.cumpleNormativas
  const fichaEnviada = ficha?.estado === 'Enviado'

  return (
    <>
      <div className={`drawer-overlay ${open ? 'active' : ''}`} onClick={onClose}></div>
      <div className={`drawer ${open ? 'open' : ''}`}>
        <div className="drawer-header">
          <div className="drawer-header-top">
            <h2><i className='bx bx-leaf'></i> {ficha ? 'Ficha de Cosecha' : 'Nueva Ficha'}</h2>
            <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
              {ficha && productos.length === 0 && (
                <button onClick={async () => {
                  const conf = await confirmar({ titulo: '¿Eliminar esta ficha?', html: 'Todavia no tiene productos agregados -- se borrara por completo, no se puede deshacer.', icono: 'warning' })
                  if (!conf.isConfirmed) return
                  try {
                    const res = await fetch(`${API_URL}/api/cosecha-transp/${fichaId}`, { method: 'DELETE', headers: {} })
                    if (res.ok) {
                      await exito('Ficha eliminada')
                      onSaved?.()
                      onClose()
                    } else {
                      Swal.fire('Error', 'No se pudo eliminar la ficha', 'error')
                    }
                  } catch {
                    Swal.fire('Error', 'Error de conexión', 'error')
                  }
                }} style={{background: '#dc3545', color: 'white', border: 'none', borderRadius: '6px', padding: '0.4rem 0.7rem', cursor: 'pointer', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem'}}>
                  <i className='bx bx-trash'></i> Eliminar
                </button>
              )}
              <button className="drawer-close" onClick={onClose}><i className='bx bx-x'></i></button>
            </div>
          </div>
        </div>

        <div className="drawer-content">
          {/* Indicador de pasos */}
          <div className="pasos-indicador">
            <div className={`paso-dot ${paso >= 1 ? 'activo' : ''}`}><span>1</span><small>Camión</small></div>
            <div className="paso-linea"></div>
            <div className={`paso-dot ${paso >= 2 ? 'activo' : ''}`}><span>2</span><small>Producto</small></div>
            <div className="paso-linea"></div>
            <div className={`paso-dot ${paso >= 3 ? 'activo' : ''}`}><span>3</span><small>Peso</small></div>
          </div>

          {/* Paso 1: Datos del camión */}
          {paso === 1 && (
            <div className="drawer-section">
              <h3><i className='bx bx-car'></i> Datos del Camión</h3>
              <div className="form-group" style={{position: 'relative'}}>
                <label className="form-label">Placa <span className="required">*</span></label>
                {formData.idCamion ? (
                  <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                    <input type="text" className="form-control" value={formData.placa} readOnly style={{fontWeight: 'bold', background: 'var(--color-bg-light)'}} />
                    <button onClick={() => {
                      setFormData(prev => ({...prev, placa: '', nombreChofer: '', responsable: '', idCamion: null, idSupervisor: null}))
                      setPlacaBusqueda('')
                    }} style={{background: '#dc3545', color: 'white', border: 'none', borderRadius: '6px', padding: '0.4rem 0.6rem', cursor: 'pointer', fontSize: '1rem', flexShrink: 0}}>
                      <i className='bx bx-x'></i>
                    </button>
                  </div>
                ) : (
                  <>
                    <input type="text" className="form-control" value={placaBusqueda} onChange={(e) => {
                      const val = e.target.value.toUpperCase()
                      setPlacaBusqueda(val)
                      setShowCamionSugeridos(val.length >= 1)
                    }} placeholder="Buscar placa..." autoComplete="off" />
                    {showCamionSugeridos && placaBusqueda.length >= 1 && (
                      <div style={{position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--color-bg-white)', border: '1px solid var(--color-border)', borderRadius: '0 0 8px 8px', maxHeight: '200px', overflowY: 'auto', zIndex: 100, boxShadow: '0 4px 12px rgba(0,0,0,0.15)'}}>
                        {camiones.filter(c => c.estado === 'Activo' && (c.placa || '').toUpperCase().includes(placaBusqueda)).map(c => (
                          <div key={c.id} onClick={() => {
                            setFormData(prev => ({
                              ...prev,
                              placa: c.placa || '',
                              nombreChofer: c.nombre || '',
                              responsable: c.empresa || '',
                              idCamion: c.id
                            }))
                            setPlacaBusqueda('')
                            setShowCamionSugeridos(false)
                          }} style={{padding: '0.6rem 0.8rem', cursor: 'pointer', borderBottom: '1px solid var(--color-border)', fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-light)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'var(--color-bg-white)'}>
                            <div>
                              <strong style={{color: '#7b1fa2'}}>{c.placa}</strong>
                              <span style={{marginLeft: '0.5rem', color: 'var(--color-text-primary)'}}>{c.nombre}</span>
                            </div>
                            <span style={{fontSize: '0.7rem', background: c.empresa === 'PROVEFRUT' ? '#1976d2' : '#e65100', color: 'white', padding: '1px 6px', borderRadius: '4px'}}>{c.empresa}</span>
                          </div>
                        ))}
                        {camiones.filter(c => c.estado === 'Activo' && (c.placa || '').toUpperCase().includes(placaBusqueda)).length === 0 && (
                          <div style={{padding: '0.8rem', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '0.8rem'}}>No se encontró placa</div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
              {formData.idCamion && (
                <>
                  <div className="form-group">
                    <label className="form-label">Chofer</label>
                    <input type="text" className="form-control" value={formData.nombreChofer} readOnly style={{background: 'var(--color-bg-light)'}} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Empresa</label>
                    <input type="text" className="form-control" value={formData.responsable} readOnly style={{background: 'var(--color-bg-light)'}} />
                  </div>
                </>
              )}
              {(() => {
                const sup = supervisores.find(s => s.id === formData.idSupervisor)
                return sup ? (
                  <div className="form-group">
                    <label className="form-label">Supervisor</label>
                    <input type="text" className="form-control" value={`${sup.nombre} — ${sup.proyecto || 'Sin proyecto'}`} readOnly style={{background: 'var(--color-bg-light)'}} />
                  </div>
                ) : null
              })()}
              <div className="form-group">
                <button type="button" className="btn btn-secondary" onClick={abrirSeguridadCheck}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                    background: formData.cumpleNormativas ? '#28a745' : undefined, color: formData.cumpleNormativas ? 'white' : undefined, border: formData.cumpleNormativas ? 'none' : undefined }}>
                  <i className={`bx ${formData.cumpleNormativas ? 'bx-check-shield' : 'bx-shield-quarter'}`}></i>
                  {formData.cumpleNormativas ? 'Seguridad ✓ Completado' : 'Medidas de Seguridad'}
                </button>
              </div>
            </div>
          )}

          {/* Paso 2: Producto a transportar */}
          {paso === 2 && (
            <div className="drawer-section">
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem'}}>
                <h3 style={{margin: 0}}><i className='bx bx-package'></i> Producto a Transportar</h3>
                {productos.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowFichaPreview(true)}
                    style={{background: 'transparent', border: '1px solid var(--color-primary-texto)', color: 'var(--color-primary-texto)', borderRadius: '6px', padding: '0.3rem 0.6rem', cursor: 'pointer', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem'}}
                  >
                    <i className='bx bx-file'></i> Ver Documento
                  </button>
                )}
              </div>
              <div style={{background: 'var(--color-bg-light)', padding: '0.5rem 1rem', borderRadius: '8px', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem'}}>
                <span><strong>Bines:</strong> {binesUsados} / {MAX_BINES}</span>
                <span style={{color: binesDisponibles <= 5 ? '#dc3545' : '#28a745'}}><strong>Disponibles: {binesDisponibles}</strong></span>
              </div>

              <div style={{display: 'flex', gap: '0.5rem'}}>
                <div className="form-group" style={{flex: 2, margin: 0, position: 'relative'}}>
                  <label className="form-label">Orden / Lote <span className="required">*</span></label>
                  <input type="text" className="form-control" value={productoTemp.busqueda || ''} 
                    disabled={binesDisponibles <= 0}
                    onChange={async (e) => {
                      const val = e.target.value
                      setProductoTemp(prev => ({...prev, busqueda: val}))
                      // Se descarta la respuesta si ya no es la ultima
                      // busqueda disparada -- si el usuario escribe rapido,
                      // varias peticiones quedan en vuelo a la vez y podian
                      // llegar desordenadas, pisando el resultado bueno con
                      // uno de una letra anterior (a veces salian las
                      // sugerencias, a veces no, sin razon aparente).
                      const idBusqueda = ++busquedaLoteIdRef.current
                      if (val.length >= 2) {
                        try {
                          const supProyecto = supervisores.find(s => s.id === (formData.idSupervisor || ficha?.id_supervisor))?.proyecto || ''
                          const res = await fetch(`${API_URL}/api/lotes-infx/buscar?ocult=${encodeURIComponent(val)}&cosecha=true${supProyecto ? `&proyecto=${encodeURIComponent(supProyecto)}` : ''}`)
                          if (res.ok) {
                            const data = await res.json()
                            if (idBusqueda === busquedaLoteIdRef.current) setLotesSugeridos(data)
                          }
                        } catch (err) { console.error(err) }
                      } else {
                        setLotesSugeridos([])
                      }
                    }}
                    placeholder="Buscar..."
                    autoComplete="off"
                    readOnly={!!productoTemp.ordenCultivo}
                  />
                  {productoTemp.ordenCultivo && (
                    <i className='bx bx-x' style={{position: 'absolute', right: '10px', top: '50%', marginTop: '12px', transform: 'translateY(-50%)', color: 'white', cursor: 'pointer', background: '#dc3545', borderRadius: '5px', padding: '4px 6px', fontSize: '1.1rem'}} onClick={() => { setProductoTemp({ producto: '', lote: '', variedad: '', ordenCultivo: '', cantidad: '', busqueda: '' }); setLotesSugeridos([]) }}></i>
                  )}
                  {lotesSugeridos.length > 0 && !productoTemp.ordenCultivo && (
                    <div className="sugerencias-lista" style={{position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--color-bg-white)', border: '1px solid var(--color-border)', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 1000, maxHeight: '200px', overflowY: 'auto', marginTop: '4px'}}>
                      {lotesSugeridos.map((l, i) => (
                        <div key={i} className="sugerencia-item" style={{padding: '0.6rem 1rem', cursor: 'pointer', borderBottom: '1px solid var(--color-border)', fontSize: '0.8rem'}}
                          onClick={() => {
                            setProductoTemp(prev => ({
                              ...prev,
                              ordenCultivo: l.ocult_cod_ocult,
                              producto: l.ocult_cod_proda || '',
                              lote: l.lote || '',
                              variedad: l.variedad || '',
                              hacienda: l.hacienda || '',
                              proyecto: l.proyecto || '',
                              dimension: l.dimension || '',
                              edadSem: l.edad_sem || '',
                              busqueda: `${l.ocult_cod_ocult}`
                            }))
                            setLotesSugeridos([])
                          }}>
                          <span style={{color:'#7b1fa2', fontWeight:'bold', fontStyle:'normal'}}>OC: {l.ocult_cod_ocult}</span> / {l.lote} {l.edad_sem ? <span style={{color:'#e65100', fontWeight:'bold'}}>Sem {l.edad_sem}</span> : ''} / {l.hacienda} | {l.ocult_cod_proda}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="form-group" style={{flex: 1, margin: 0}}>
                  <label className="form-label">Cantidad <span className="required">*</span></label>
                  <input type="number" className="form-control" value={productoTemp.cantidad} onChange={(e) => setProductoTemp(prev => ({...prev, cantidad: e.target.value}))} placeholder={`Máx: ${binesDisponibles}`} min="1" max={binesDisponibles} disabled={binesDisponibles <= 0} />
                </div>
              </div>

              {productoTemp.ordenCultivo && (
                <div style={{background: 'var(--color-bg-light)', padding: '0.6rem 0.8rem', borderRadius: '6px', marginTop: '0.5rem', fontSize: '0.8rem', borderLeft: '3px solid #7b1fa2'}}>
                  <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.3rem'}}>
                    <span><strong>Lote:</strong> {productoTemp.lote || '-'} {productoTemp.edadSem ? <span style={{color:'#e65100', fontWeight:'bold'}}>(Sem {productoTemp.edadSem})</span> : ''}</span>
                    <span><strong>Cultivo:</strong> {productoTemp.producto || '-'}</span>
                    <span><strong>Variedad:</strong> {productoTemp.variedad || '-'}</span>
                    <span><strong>Hacienda:</strong> {productoTemp.hacienda || '-'}</span>
                    <span><strong>C. Costo:</strong> {productoTemp.proyecto || '-'}</span>
                    <span><strong>Dimensión:</strong> {productoTemp.dimension ? `${productoTemp.dimension} ha` : '-'}</span>
                  </div>
                </div>
              )}

              <button type="button" className="btn btn-primary" onClick={agregarProducto} disabled={!productoTemp.ordenCultivo || !productoTemp.cantidad || parseInt(productoTemp.cantidad) > binesDisponibles} style={{width: '100%', marginTop: '0.75rem'}}>
                <i className='bx bx-plus'></i> Agregar Producto
              </button>

              {productos.length > 0 && (
                <div style={{marginTop: '1rem'}}>
                  <table className="tabla" style={{fontSize: '0.8rem'}}>
                    <thead><tr><th>Orden</th><th>Producto</th><th>Lote</th><th>Cant.</th><th style={{width:'30px'}}></th></tr></thead>
                    <tbody>
                      {productos.map(p => (
                        <tr key={p.id}>
                          <td>{p.ordenCultivo}</td>
                          <td>{p.producto}{p.variedad ? ` - ${p.variedad}` : ''}</td>
                          <td>{p.lote || '-'}</td>
                          <td>
                            <input type="number" value={p.cantidad} 
                              onChange={(e) => setProductos(productos.map(prod => prod.id === p.id ? {...prod, cantidad: e.target.value} : prod))}
                              style={{width: '50px', padding: '0.2rem 0.4rem', fontSize: '0.8rem', border: '1px solid var(--color-border)', borderRadius: '4px', textAlign: 'center'}}
                              min="1" max={MAX_BINES}
                            />
                          </td>
                          <td><button onClick={() => eliminarProducto(p.id)} style={{background:'transparent',border:'none',color:'var(--color-text-secondary)',cursor:'pointer'}}><i className='bx bx-trash'></i></button></td>
                        </tr>
                      ))}
                      <tr style={{fontWeight:'bold',background:'var(--color-bg-light)'}}><td colSpan="3" style={{textAlign:'right'}}>Total:</td><td>{binesUsados}</td><td></td></tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Paso 3: Peso y Número de Ficha */}
          {paso === 3 && (
            <div className="drawer-section">
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem'}}>
                <h3 style={{margin: 0}}><i className='bx bx-bar-chart'></i> Recepción - Peso y Ficha</h3>
                <button
                  type="button"
                  onClick={() => setShowFichaPreview(true)}
                  style={{background: 'transparent', border: '1px solid var(--color-primary-texto)', color: 'var(--color-primary-texto)', borderRadius: '6px', padding: '0.4rem 0.8rem', cursor: 'pointer', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem'}}
                >
                  <i className='bx bx-file'></i> Ver Documento
                </button>
              </div>

              {/* Resumen del transporte */}
              <div style={{background: 'var(--color-bg-light)', color: 'var(--color-text-primary)', padding: '0.6rem 0.8rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.8rem', borderLeft: '3px solid var(--color-primary)'}}>
                <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.3rem'}}>
                  <span><strong>Placa:</strong> {formData.placa || ficha?.placa || '-'}</span>
                  <span><strong>Dueño:</strong> {formData.responsable || ficha?.propietario || '-'}</span>
                  <span><strong>Chofer:</strong> {formData.nombreChofer || ficha?.nombre_chofer || '-'}</span>
                  <span><strong>Supervisor:</strong> {supervisores.find(s => s.id === (formData.idSupervisor || ficha?.id_supervisor))?.nombre || ficha?.supervisor_nombre || '-'}</span>
                </div>
              </div>

              {/* Número de ficha general */}
              <div className="form-group" style={{marginBottom: '1rem'}}>
                <label className="form-label">N° Ficha</label>
                <input
                  type="text"
                  className="form-control"
                  value={formData.numFicha || ''}
                  onChange={(e) => setFormData(prev => ({...prev, numFicha: e.target.value}))}
                  placeholder="000XXX"
                  style={{fontSize: '1rem', fontWeight: 'bold', textAlign: 'center'}}
                />
              </div>

              {/* Tabla de productos con peso */}
              <h4 style={{fontSize: '0.85rem', marginBottom: '0.5rem', color: 'var(--color-text-secondary)'}}>Productos</h4>
              {productos.length > 0 ? (
                <div style={{overflowX: 'auto'}}>
                  <table className="tabla" style={{fontSize: '0.75rem'}}>
                    <thead>
                      <tr>
                        <th>C. Costo</th>
                        <th>Producto</th>
                        <th>Variedad</th>
                        <th>Lote</th>
                        <th>Bines</th>
                        <th>Peso Neto (kg)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {productos.map((p, idx) => (
                        <tr key={p.id || idx}>
                          <td>{p.proyecto || p.centroCostos || '-'}</td>
                          <td>{p.producto || '-'}</td>
                          <td>{p.variedad || '-'}</td>
                          <td>{p.lote || '-'}</td>
                          <td>{p.cantidad || 0}</td>
                          <td>
                            <input
                              type="number"
                              value={p.pesoNeto || ''}
                              onChange={(e) => setProductos(productos.map((prod, i) => i === idx ? {...prod, pesoNeto: e.target.value} : prod))}
                              placeholder="0.00"
                              step="0.01"
                              style={{width: '80px', padding: '0.25rem 0.4rem', fontSize: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '4px', textAlign: 'center'}}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={{color: 'var(--color-text-secondary)', textAlign: 'center', fontSize: '0.8rem'}}>No hay productos registrados</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="drawer-footer">
          {paso > 1 && !ficha && (
            <button className="btn btn-secondary" onClick={() => setPaso(paso - 1)}>
              <i className='bx bx-chevron-left'></i> Atrás
            </button>
          )}
          <div style={{flex: 1}}></div>
          {paso === 1 && (
            <button className="btn btn-primary" onClick={handleGuardarCamion} disabled={!paso1Valido || guardandoCamion} style={(!paso1Valido || guardandoCamion) ? {opacity:0.5,cursor:'not-allowed'} : {}}>
              <i className={guardandoCamion ? 'bx bx-loader-alt bx-spin' : 'bx bx-save'}></i> Guardar
            </button>
          )}
          {paso === 2 && (
            <button className="btn btn-primary" onClick={handleEnviarCamion} disabled={productos.length === 0} style={productos.length === 0 ? {opacity:0.5,cursor:'not-allowed'} : {}}>
              <i className='bx bx-send'></i> Enviar Camión
            </button>
          )}
          {paso === 3 && (
            <div style={{display: 'flex', gap: '0.5rem'}}>
              <button className="btn btn-secondary" onClick={handleGuardarPesos}>
                <i className='bx bx-save'></i> Guardar
              </button>
              <button className="btn btn-primary" onClick={handleFinalizar}>
                <i className='bx bx-check'></i> Recibido
              </button>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .pasos-indicador {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0;
          margin-bottom: 1.5rem;
          padding: 0.5rem;
        }
        .paso-dot {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.3rem;
        }
        .paso-dot span {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          background: var(--color-border);
          color: var(--color-text-secondary);
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          font-size: 0.85rem;
          transition: all 0.3s;
        }
        .paso-dot.activo span {
          background: #7b1fa2;
          color: white;
        }
        .paso-dot small {
          font-size: 0.7rem;
          color: var(--color-text-secondary);
        }
        .paso-dot.activo small {
          color: #7b1fa2;
          font-weight: 500;
        }
        .paso-linea {
          width: 40px;
          height: 2px;
          background: var(--color-border);
          margin: 0 0.5rem;
          margin-bottom: 1rem;
        }
      `}</style>

      {/* Modal preview ficha impresa */}
      {showFichaPreview && (
        <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem'}}>
          <div style={{background: 'var(--color-bg-white)', borderRadius: '12px', width: '90vw', maxWidth: '750px', height: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.3)'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.8rem 1.2rem', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-light)'}}>
              <span style={{fontWeight: 600, color: 'var(--color-text-primary)'}}>Nota de Entrega de Producto Orgánico</span>
              <div style={{display: 'flex', gap: '0.5rem'}}>
                <button onClick={() => { if (fichaIframeRef.current) fichaIframeRef.current.contentWindow.print() }} style={{background: '#7b1fa2', color: 'white', border: 'none', borderRadius: '6px', padding: '0.4rem 1rem', cursor: 'pointer', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem'}}>
                  <i className='bx bx-printer'></i> Imprimir
                </button>
                <button onClick={() => setShowFichaPreview(false)} style={{background: 'var(--color-border)', border: 'none', borderRadius: '6px', padding: '0.4rem 0.7rem', cursor: 'pointer', fontSize: '1rem', color: 'var(--color-text-secondary)'}}>
                  <i className='bx bx-x'></i>
                </button>
              </div>
            </div>
            <div style={{flex: 1, overflow: 'auto', padding: '0.8rem', background: 'var(--color-bg-light)'}}>
            <iframe
              ref={fichaIframeRef}
              srcDoc={(() => {
                const fecha = ficha?.fecha_creacion ? new Date(ficha.fecha_creacion).toLocaleDateString('es-EC', {day:'2-digit', month:'2-digit', year:'numeric'}) : new Date().toLocaleDateString('es-EC', {day:'2-digit', month:'2-digit', year:'numeric'})
                const horaIngreso = ficha?.hora_ingreso || ''
                const horaSalida = ficha?.fecha_salida ? (() => { const d = new Date(ficha.fecha_salida); const h = d.getHours(); const mn = String(d.getMinutes()).padStart(2,'0'); const h12 = h % 12 || 12; return `${String(h12).padStart(2,'0')}:${mn} ${h < 12 ? 'a.m.' : 'p.m.'}` })() : ''
                const choferRaw = formData.nombreChofer || ficha?.nombre_chofer || ''
                const formatNombreFicha = (raw) => {
                  if (!raw) return ''
                  const partes = raw.trim().split(/\s+/)
                  if (partes.length >= 3) {
                    const nombre1 = partes[partes.length >= 4 ? 2 : 1]
                    const apellido1 = partes[0]
                    return `${nombre1.charAt(0).toUpperCase()}${nombre1.slice(1).toLowerCase()} ${apellido1.charAt(0).toUpperCase()}${apellido1.slice(1).toLowerCase()}`
                  }
                  return raw.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
                }
                const chofer = formatNombreFicha(choferRaw)
                const supervisorObj = supervisores.find(s => s.id === (formData.idSupervisor || ficha?.id_supervisor))
                const supervisor = supervisorObj?.nombre || ficha?.supervisor_nombre || ''
                const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()

                // Una ficha completa por producto (antes se mezclaban las filas de
                // varios productos distintos en una sola ficha con los datos del
                // primero -- mismo bug ya corregido en ReportesCosecha.jsx).
                const fichaHtml = (p, esUltima) => {
                  const prodUpper = (p.producto || '').toUpperCase()
                  const esOrganico = prodUpper.includes('ORGANIC') || prodUpper.includes('ORGÁNIC')
                  let proyectoNombre = supervisorObj?.proyecto || ''
                  let proyectoDireccion = supervisorObj?.proyecto_direccion || ''
                  if (!proyectoNombre) {
                    const ccosto = norm(p.proyecto || p.centroCostos || '')
                    const proyMatch = proyectos.find(pr => ccosto.startsWith(norm(pr.nombre)))
                    if (proyMatch) {
                      proyectoNombre = proyMatch.nombre
                      proyectoDireccion = proyMatch.direccion || ''
                    }
                  }
                  if (!proyectoNombre) {
                    // Sin match en el catalogo de proyectos: para organico se
                    // mantiene el default historico (SAN SEBASTIAN, de donde
                    // viene casi toda la fruta organica); para convencional
                    // se muestra el centro de costos tal cual antes de no
                    // mostrar nada.
                    proyectoNombre = esOrganico ? 'SAN SEBASTIÁN' : (p.proyecto || p.centroCostos || '')
                  }
                  proyectoNombre = proyectoNombre.replace(/-CC\d+$/i, '')
                  const numeroRojo = p.numeracion || formData.numeracionAuto || ficha?.numeracion || (() => {
                    const f = ficha?.fecha_creacion ? new Date(ficha.fecha_creacion) : new Date()
                    const aa = f.getFullYear().toString().slice(2)
                    const mm = (f.getMonth() + 1).toString().padStart(2, '0')
                    const num = String(ficha?.id || 0).padStart(5, '0')
                    return 'COS-' + aa + mm + '-' + num
                  })()
                  const filaProducto = `<tr><td>${p.lote || '-'}</td><td>${p.cantidad || 0}</td><td>${p.pesoNeto || ''}</td><td></td></tr>`
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
                      <span><strong>N°FICHA:</strong> <span style="border-bottom:1px solid #000; padding:0 10px; min-width:60px; display:inline-block;">${p.numFicha || formData.numFicha || '&nbsp;'}</span></span>
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
                      <p><strong>Supervisor:</strong> ${supervisor || p.responsable || ''}</p>
                      <p><strong>Recibido por:</strong> ${ficha?.recibido_por || ''}</p>
                    </div>
                    ${esOrganico ? `<div class="firmas-right" style="display:flex; align-items:center;">
                      <img src="${window.location.origin}/LogoOrganica.png" alt="Certificación Orgánica" style="width:1cm; height:1cm; object-fit:contain;" onerror="this.style.display='none'" />
                    </div>` : ''}
                  </div>
                  ${esOrganico ? `<div class="footer">
                    <div class="footer-left">
                      <p><strong>Dirección ${proyectoNombre || 'San Sebastián'}:</strong> ${proyectoDireccion || 'Panamericana Norte Km. 13, Guaytacama, Cotopaxi, Ecuador'}</p>
                      <p style="margin-top:2px; color:#666;">Resolución N° DAJ-20133ec-0201.0099</p>
                    </div>
                    <div class="footer-right">
                      <p><strong>Kiwa Ecuador Cía Ltda. código:</strong> P.O.A: 001-AC</p>
                      <p><strong>${proyectoNombre || 'San Sebastián'}:</strong> CÓDIGO POA N°: 0070-3</p>
                      <p>EC.BIO-141</p>
                    </div>
                  </div>` : ''}
                </div>`
                }

                const fichasHtml = (productos.length > 0 ? productos : [{}]).map((p, i) => fichaHtml(p, i === productos.length - 1)).join('\n')

                return `<html><head><style>
                  @import url('https://fonts.googleapis.com/css2?family=Archivo+Narrow&display=swap');
                  * { margin: 0; padding: 0; box-sizing: border-box; }
                  body { font-family: Helvetica, Arial, sans-serif; padding: 0; font-size: 10px; margin: 0; }
                  @page { size: 130mm 180mm; margin: 0; }
                  @media print { body { margin: 0; padding: 0; } }
                  .ficha { border: 1.5px solid #000; padding: 0; width: 125mm; margin: 0 auto; box-sizing: border-box; }
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
                  th { background: #f0f0f0; font-weight: bold; font-size: 8px; }
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
                </style></head><body>
                ${fichasHtml}
                </body></html>`
              })()}
              style={{border: 'none', width: '100%', height: '100%', background: 'white'}}
              title="Ficha de Cosecha"
            />
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default DrawerCosecha
