import { useState, useEffect } from 'react'
import DrawerActTrac from '../components/DrawerActTrac'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8007'
const ITEMS_PER_PAGE = 15

function ActividadesTractores() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerMode, setDrawerMode] = useState('crear-actividad')
  const [searchTerm, setSearchTerm] = useState('')
  const [filterTipo, setFilterTipo] = useState('')
  const [selectedActividad, setSelectedActividad] = useState(null)
  const [actividades, setActividades] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)

  // Cargar actividades desde el backend
  const fetchActividades = async () => {
    try {
      setLoading(true)
      const response = await fetch(`${API_URL}/api/actividades`)
      if (!response.ok) throw new Error('Error al cargar actividades')
      const data = await response.json()
      // Filtrar solo las de equipo Tractores y mapear formato
      const actividadesTractores = data
        .filter(act => act.equipo === 'Tractores')
        .map(act => ({
          id: act.id,
          codigo: act.codigo_act,
          nombre: act.actividad,
          tipo: act.tipo,
          subactividades: (act.subactividades || []).map((sub, idx) => ({
            id: `${act.id}-${idx}`,
            nombre: sub
          }))
        }))
      setActividades(actividadesTractores)
      setError(null)
    } catch (err) {
      console.error('Error:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchActividades()
  }, [])

  const openDrawerCrear = () => {
    setDrawerMode('crear-actividad')
    setSelectedActividad(null)
    setDrawerOpen(true)
  }

  const openDrawerEditar = (actividad) => {
    setDrawerMode('editar-actividad')
    setSelectedActividad(actividad)
    setDrawerOpen(true)
  }

  const handleSave = async (data) => {
    try {
      // Convertir subactividades a array de strings
      const subactividadesArray = (data.subactividades || []).map(s => 
        typeof s === 'string' ? s : s.nombre
      )
      
      if (drawerMode === 'crear-actividad') {
        const response = await fetch(`${API_URL}/api/actividades`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actividad: data.nombre.toUpperCase(),
            tipo: data.tipo,
            equipo: 'Tractores',
            subactividades: subactividadesArray,
            cantidad: 0
          })
        })
        if (!response.ok) throw new Error('Error al crear actividad')
      } else if (drawerMode === 'editar-actividad') {
        const response = await fetch(`${API_URL}/api/actividades/${data.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actividad: data.nombre.toUpperCase(),
            tipo: data.tipo,
            equipo: 'Tractores',
            subactividades: subactividadesArray,
            cantidad: 0
          })
        })
        if (!response.ok) throw new Error('Error al actualizar actividad')
      }
      await fetchActividades()
      setDrawerOpen(false)
    } catch (err) {
      console.error('Error:', err)
      alert('Error al guardar: ' + err.message)
    }
  }

  const handleDelete = async (id) => {
    try {
      const response = await fetch(`${API_URL}/api/actividades/${id}`, {
        method: 'DELETE'
      })
      if (!response.ok) throw new Error('Error al eliminar actividad')
      await fetchActividades()
      setDrawerOpen(false)
    } catch (err) {
      console.error('Error:', err)
      alert('Error al eliminar: ' + err.message)
    }
  }

  const actividadesFiltradas = actividades.filter(act => {
    const matchSearch = act.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
                       act.codigo.toLowerCase().includes(searchTerm.toLowerCase()) ||
                       act.subactividades.some(sub => sub.nombre.toLowerCase().includes(searchTerm.toLowerCase()))
    const matchTipo = filterTipo === '' || act.tipo === filterTipo
    return matchSearch && matchTipo
  })

  // Paginación
  const totalPages = Math.ceil(actividadesFiltradas.length / ITEMS_PER_PAGE)
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
  const actividadesPaginadas = actividadesFiltradas.slice(startIndex, startIndex + ITEMS_PER_PAGE)

  // Reset página cuando cambia filtro o búsqueda
  useEffect(() => {
    setCurrentPage(1)
  }, [filterTipo, searchTerm])

  if (loading) {
    return (
      <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh'}}>
        <div style={{textAlign: 'center'}}>
          <i className='bx bx-loader-alt bx-spin' style={{fontSize: '3rem', color: 'var(--color-primary)'}}></i>
          <p style={{marginTop: '1rem', color: 'var(--color-text-secondary)'}}>Cargando actividades...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh'}}>
        <div style={{textAlign: 'center', color: 'var(--color-danger)'}}>
          <i className='bx bx-error-circle' style={{fontSize: '3rem'}}></i>
          <p style={{marginTop: '1rem'}}>{error}</p>
          <button className="btn btn-primary mt-md" onClick={fetchActividades}>
            <i className='bx bx-refresh'></i> Reintentar
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1><i className='bx bxs-cog'></i> Actividades de Tractores</h1>
          <p className="page-subtitle">Gestión de actividades y subactividades agrícolas</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={openDrawerCrear}>
            <i className='bx bx-plus'></i> Nueva Actividad
          </button>
        </div>
      </div>

      {/* Buscador */}
      <div className="filters-container">
        <div className="search-input-wrapper">
          <i className='bx bx-search'></i>
          <input 
            type="text" 
            className="form-control" 
            placeholder="Buscar actividad o subactividad..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Filtros de tipo y paginación */}
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem'}}>
        {/* Filtros */}
        <div style={{display: 'flex', gap: '0.5rem'}}>
          <button 
            onClick={() => setFilterTipo('')}
            style={{
              padding: '0.5rem 1rem', 
              fontSize: '0.85rem',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              backgroundColor: filterTipo === '' ? 'var(--color-primary)' : 'var(--color-bg-light)',
              color: filterTipo === '' ? 'var(--color-on-primary)' : 'var(--color-text-secondary)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem'
            }}
          >
            <span style={{width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#e91e63'}}></span>
            Todos ({actividades.length})
          </button>
          <button 
            onClick={() => setFilterTipo('Actividades Culturales')}
            style={{
              padding: '0.5rem 1rem', 
              fontSize: '0.85rem', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.4rem',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              backgroundColor: filterTipo === 'Actividades Culturales' ? 'var(--color-primary)' : 'var(--color-bg-light)',
              color: filterTipo === 'Actividades Culturales' ? 'var(--color-on-primary)' : 'var(--color-text-secondary)'
            }}
          >
            <span style={{width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#28a745'}}></span>
            Actividades Culturales ({actividades.filter(a => a.tipo === 'Actividades Culturales').length})
          </button>
          <button
            onClick={() => setFilterTipo('Apoyos Generales')}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              backgroundColor: filterTipo === 'Apoyos Generales' ? 'var(--color-primary)' : 'var(--color-bg-light)',
              color: filterTipo === 'Apoyos Generales' ? 'var(--color-on-primary)' : 'var(--color-text-secondary)'
            }}
          >
            <span style={{width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#007bff'}}></span>
            Apoyos Generales ({actividades.filter(a => a.tipo === 'Apoyos Generales').length})
          </button>
        </div>

        {/* Paginación */}
        <div style={{display: 'flex', alignItems: 'center', gap: '0.75rem'}}>
          <span style={{fontSize: '0.85rem', color: 'var(--color-text-secondary)'}}>
            Página {currentPage} de {totalPages || 1}
          </span>
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            style={{
              padding: '0.5rem 0.75rem',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
              backgroundColor: currentPage === 1 ? 'var(--color-bg-light)' : 'var(--color-primary)',
              color: currentPage === 1 ? 'var(--color-text-secondary)' : 'var(--color-on-primary)',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <i className='bx bx-chevron-left' style={{fontSize: '1.2rem'}}></i>
          </button>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
            style={{
              padding: '0.5rem 0.75rem',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer',
              backgroundColor: currentPage >= totalPages ? 'var(--color-bg-light)' : 'var(--color-primary)',
              color: currentPage >= totalPages ? 'var(--color-text-secondary)' : 'var(--color-on-primary)',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <i className='bx bx-chevron-right' style={{fontSize: '1.2rem'}}></i>
          </button>
        </div>
      </div>

      {/* Tabla */}
      <div className="tabla-container mt-lg">
        <table className="tabla">
          <thead>
            <tr>
              <th style={{width: '80px'}}>Código</th>
              <th>Nombre</th>
              <th style={{width: '90px'}}>Tipo</th>
              <th>Subactividades</th>
            </tr>
          </thead>
          <tbody>
            {actividadesPaginadas.map(actividad => (
              <tr 
                key={actividad.id} 
                className="clickeable"
                onClick={() => openDrawerEditar(actividad)}
              >
                <td><strong>{actividad.codigo}</strong></td>
                <td><strong>{actividad.nombre}</strong></td>
                <td>
                  <span className={`badge ${actividad.tipo === 'Actividades Culturales' ? 'badge-aprobado' : 'badge-cotizando'}`}>
                    {actividad.tipo === 'Actividades Culturales' ? 'Cultural' : 'Apoyo'}
                  </span>
                </td>
                <td style={{fontSize: '0.85rem', color: 'var(--color-text-secondary)'}}>
                  {actividad.subactividades.length > 0 
                    ? actividad.subactividades.map(sub => sub.nombre).join(', ')
                    : <span style={{fontStyle: 'italic'}}>Sin subactividades</span>
                  }
                </td>
              </tr>
            ))}
            {actividadesFiltradas.length === 0 && (
              <tr>
                <td colSpan="4" style={{textAlign: 'center', padding: '2rem'}}>
                  No se encontraron actividades
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Drawer */}
      <DrawerActTrac 
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        mode={drawerMode}
        actividad={selectedActividad}
        onSave={handleSave}
        onDelete={handleDelete}
      />
    </>
  )
}

export default ActividadesTractores
