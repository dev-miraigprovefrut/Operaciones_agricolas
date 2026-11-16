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
  const [codigoInfo, setCodigoInfo] = useState(null)

  const cargar = async () => {
    try {
      const [r, c] = await Promise.all([fetch(`${API_URL}/api/tablets`), fetch(`${API_URL}/api/tablets/codigo-ajuste`)])
      if (r.ok) setTablets(await r.json())
      if (c.ok) setCodigoInfo(await c.json())
    } catch (e) { console.error(e) }
  }
  useEffect(() => { cargar() }, [])

  // Codigo que pide el engranaje de la tablet para cambiar de equipo o corregir el horometro
  const definirCodigo = async () => {
    const { value: codigo } = await Swal.fire({
      title: codigoInfo?.configurado ? 'Cambiar código de ajuste' : 'Crear código de ajuste',
      html: 'Lo pide el <b>engranaje</b> de la tablet para <b>cambiar de equipo</b> o <b>corregir el horómetro</b>.<br>'
        + 'Compártalo solo con supervisores. Vale para todas las tablets.',
      input: 'password', inputPlaceholder: '4 a 8 dígitos', inputAttributes: { inputmode: 'numeric', maxlength: 8, autocomplete: 'new-password' },
      showCancelButton: true, confirmButtonText: 'Guardar', cancelButtonText: 'Cancelar',
      inputValidator: v => (!/^\d{4,8}$/.test(v || '') ? 'Use de 4 a 8 dígitos' : undefined)
    })
    if (!codigo) return
    const r = await fetch(`${API_URL}/api/tablets/codigo-ajuste`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo })
    })
    if (r.ok) { Swal.fire({ icon: 'success', title: 'Código guardado', timer: 1500, showConfirmButton: false }); cargar() }
    else Swal.fire('Error', (await r.json().catch(() => ({}))).detail || 'No se pudo guardar', 'error')
  }

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
          <p className="page-subtitle" style={{ margin: 0 }}>App "Tractor Nintanga": cada tablet elige su tractor la primera vez. Para cambiar de equipo o corregir el horómetro, use el engranaje de la tablet con el código de ajuste.</p>
        </div>
        <button className="btn btn-secondary" onClick={definirCodigo} title="Código que pide el engranaje de la tablet">
          <i className='bx bx-key'></i> {codigoInfo?.configurado ? 'Cambiar código de ajuste' : 'Crear código de ajuste'}
        </button>
      </div>
      {codigoInfo && !codigoInfo.configurado && (
        <div style={{ padding: '0.6rem 0.9rem', borderRadius: '8px', marginBottom: '0.75rem', background: 'rgba(255, 193, 7, 0.15)', fontSize: '0.85rem' }}>
          <i className='bx bx-info-circle'></i> Aún no hay código de ajuste: el engranaje de las tablets no funcionará hasta crearlo.
        </div>
      )}
      {codigoInfo?.configurado && (
        <p className="page-subtitle" style={{ margin: '0 0 0.75rem', fontSize: '0.8rem' }}>
          Código de ajuste definido por {codigoInfo.actualizado_por || '—'} el {fechaCorta(codigoInfo.fecha)}.
        </p>
      )}
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
