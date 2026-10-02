import { memo } from 'react'
import HoraRueda from './HoraRueda'
import { diaISO } from '../utils/jornadas'

/**
 * Tabla de actividades de UNA jornada en el Reporte de actividades.
 * Memoizada: al marcar un check o mover una hora solo se vuelve a dibujar la
 * tabla de esa jornada (no todo el reporte), para que el clic responda al toque.
 * `sel` y `ed` llegan como texto (ids marcados / horas editadas de ESTA
 * jornada) para que memo compare barato.
 */
const fmtMin = (min) => { if (!min || min < 0.5) return '-'; const h = Math.floor(min / 60); const m = Math.round(min % 60); return h > 0 ? `${h}h ${m}m` : `${m}m` }
const fmtHora = (d) => d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })
const fmtDiaMes = (d) => d.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit' })
const fmtFechaHora = (iso) => iso ? new Date(iso).toLocaleString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'
const horaDe = (iso) => (iso || '').substring(11, 16)
const eventoInicio = (r) => r.fecha_historial?.find(h => h.accion === 'inicio')
const eventoFin = (r) => [...(r.fecha_historial || [])].reverse().find(h => h.accion === 'finalizado')

function TablaJornada({ j, sel, ed, puedeRevisar, onToggle, onMarcar, onEditar, onEliminar }) {
  const marcados = new Set(sel ? sel.split(',').map(Number) : [])
  const ediciones = ed ? JSON.parse(ed) : {}
  const esRevisable = (r) => puedeRevisar && r.estado === 'Finalizado' && r.revision_estado !== 'REVISADO'
  // Se puede eliminar mientras no este revisada (y no este en curso)
  const esEliminable = (r) => puedeRevisar && r.revision_estado !== 'REVISADO' && r.estado !== 'Ejecutándose'
  const hayEliminables = j.regs.some(esEliminable)
  const revisables = j.regs.filter(esRevisable).map(r => r.id)
  const todas = revisables.length > 0 && revisables.every(id => marcados.has(id))
  // dd/mm cuando el evento cae en otro dia que el inicio de la jornada
  const otroDia = (ev) => ev && diaISO(new Date(ev.fecha)) !== j.dia ? fmtDiaMes(new Date(ev.fecha)) : null

  return (
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
            {revisables.length ? (
              // Toda la celda es clicable (no solo el cuadro)
              <th className="celda-check" onClick={() => onMarcar(revisables, !todas)} title="Marcar todas las de la jornada">
                <span>
                  <input type="checkbox" checked={todas}
                    onClick={e => e.stopPropagation()}
                    onChange={e => onMarcar(revisables, e.target.checked)} />
                  Revisión
                </span>
              </th>
            ) : <th style={{whiteSpace: 'nowrap'}}>Revisión</th>}
            {hayEliminables && <th style={{width: '1%'}}></th>}
          </tr>
        </thead>
        <tbody>
          {j.regs.map(r => {
            const inicio = eventoInicio(r)
            const fin = eventoFin(r)
            const revisable = esRevisable(r)
            return (
              <tr key={r.id}>
                <td>{r.tractor || '-'}</td>
                <td><strong>{r.actividad === 'APOYOS GENERALES' ? (r.subactividad || 'Apoyo General') : (r.actividad || '-')}</strong>
                  {r.fecha_historial?.[0]?.manual && <span title={`Agregada en el reporte por ${r.fecha_historial[0].por || ''}`} style={{marginLeft: '0.4rem', background: '#e3f2fd', color: '#1565c0', border: '1px solid #90caf9', borderRadius: '4px', padding: '0 4px', fontSize: '0.62rem', fontWeight: 600, textTransform: 'none'}}>Agregada</span>}
                </td>
                <td>{r.actividad === 'APOYOS GENERALES' ? 'Apoyo General' : (r.subactividad || '-')}</td>
                <td>{r.lote || '-'}</td>
                <td>{r.hacienda || '-'}</td>
                {[['inicio', inicio], ['fin', fin]].map(([campo, ev]) => (
                  <td key={campo} style={{whiteSpace: 'nowrap'}}>
                    {otroDia(ev) && <span style={{display: 'block', fontSize: '0.65rem', color: '#e67e22', fontWeight: 600}} title="Otro día que el inicio de la jornada">{otroDia(ev)}</span>}
                    {revisable && ev ? (
                      <HoraRueda
                        value={ediciones[r.id]?.[campo] || horaDe(ev.fecha)}
                        modificado={!!ediciones[r.id]?.[campo] && ediciones[r.id][campo] !== horaDe(ev.fecha)}
                        onChange={hhmm => onEditar(r, campo, hhmm)} />
                    ) : (ev ? fmtHora(new Date(ev.fecha)) : '-')}
                  </td>
                ))}
                <td style={{color: '#28a745', fontWeight: 500}}>{fmtMin(r.tiempo_real)}</td>
                <td style={{color: '#dc3545', fontWeight: 500}}>{fmtMin(r.tiempo_paro)}</td>
                <td><span style={{background: r.estado === 'Finalizado' ? '#6c757d' : r.estado === 'Ejecutándose' ? '#28a745' : '#ffc107', color: 'white', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem'}}>{r.estado}</span></td>
                <td className={revisable ? 'celda-check' : undefined}
                  onClick={revisable ? () => onToggle(r.id) : undefined}
                  title={revisable ? 'Marcar para guardar como revisada' : undefined}>
                  {r.revision_estado === 'REVISADO' ? (
                    <span title={`Revisado por ${r.revisado_por_nombre || r.revisado_por || '-'} el ${fmtFechaHora(r.fecha_revision)}`}
                      style={{background: '#1b5e20', color: 'white', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', whiteSpace: 'nowrap', cursor: 'help'}}>
                      <i className='bx bxs-lock-alt'></i> Revisado
                    </span>
                  ) : revisable ? (
                    <span>
                      <input type="checkbox" checked={marcados.has(r.id)}
                        onClick={e => e.stopPropagation()}
                        onChange={() => onToggle(r.id)} />
                      No revisado
                    </span>
                  ) : (
                    <span style={{color: 'var(--color-text-secondary)', fontSize: '0.7rem', whiteSpace: 'nowrap'}}>No revisado</span>
                  )}
                </td>
                {hayEliminables && (
                  <td style={{width: '1%'}}>
                    {esEliminable(r) && (
                      <button type="button" onClick={() => onEliminar(r)} title="Eliminar esta actividad"
                        style={{background: 'transparent', border: 'none', color: '#dc3545', cursor: 'pointer', fontSize: '1.15rem', padding: '0.2rem 0.3rem', lineHeight: 1}}>
                        <i className='bx bx-trash'></i>
                      </button>
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default memo(TablaJornada)
