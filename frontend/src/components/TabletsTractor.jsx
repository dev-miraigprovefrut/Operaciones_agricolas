import { useEffect, useState } from 'react'
import Swal from 'sweetalert2'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8007'

const fechaCorta = f => f ? new Date(f.replace(' ', 'T')).toLocaleString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'

/**
 * Tablets fijas en los tractores (APK "Tractor Nintanga"): generar el codigo de
 * vinculacion para un tractor y dar de baja. Va dentro de Catalogos > Tractoristas.
 */
function TabletsTractor() {
  const [tablets, setTablets] = useState([])

  const cargar = async () => {
    try {
      const r = await fetch(`${API_URL}/api/tablets`)
      if (r.ok) setTablets(await r.json())
    } catch (e) { console.error(e) }
  }
  useEffect(() => { cargar() }, [])

  const baja = async (t) => {
    const r = await Swal.fire({
      title: 'Dar de baja la tablet', html: `Tablet de <b>${t.tractor}</b> (${t.descripcion || 'sin vincular'}).<br>Dejará de funcionar de inmediato.`,
      icon: 'warning', showCancelButton: true, confirmButtonColor: '#dc3545', confirmButtonText: 'Dar de baja', cancelButtonText: 'Cancelar'
    })
    if (!r.isConfirmed) return
    await fetch(`${API_URL}/api/tablets/${t.id}/baja`, { method: 'POST' })
    cargar()
  }

  return (
    <div style={{ marginTop: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.2rem' }}><i className='bx bx-tab'></i> Tablets de tractor</h2>
          <p className="page-subtitle" style={{ margin: 0 }}>App "Tractor Nintanga": cada tablet elige su tractor la primera vez. Para cambiarla de tractor, dela de baja aquí.</p>
        </div>
      </div>
      <div className="tabla-container">
        <table className="tabla">
          <thead><tr><th>Tractor</th><th>Tablet</th><th>Registrada</th><th>Último uso</th><th style={{ width: '1%' }}></th></tr></thead>
          <tbody>
            {tablets.map(t => (
              <tr key={t.id}>
                <td><strong>{t.tractor}</strong></td>
                <td><i className='bx bx-tab'></i> {t.descripcion || 'Tablet'}</td>
                <td>{fechaCorta(t.fecha_alta)}</td>
                <td>{fechaCorta(t.ultimo_uso)}</td>
                <td><button className="btn btn-sm" onClick={() => baja(t)} style={{ background: '#dc3545', color: 'white', padding: '2px 8px', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                  <i className='bx bx-block'></i> Dar de baja</button></td>
              </tr>
            ))}
            {tablets.length === 0 && (
              <tr><td colSpan="5" style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--color-text-secondary)' }}>
                No hay tablets. Se registran solas al abrir la app "Tractor Nintanga" por primera vez y elegir el tractor.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default TabletsTractor
