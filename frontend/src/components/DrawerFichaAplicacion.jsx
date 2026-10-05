import { useEffect, useState } from 'react'
import { EstadoErpBadge, estadoAplicacionTexto } from './FichaAplicacion'

/**
 * Drawer lateral de una ficha de aplicacion (Reportes > Fichas de aplicacion).
 * Muestra la ficha como en el papel; si ya se aplico, la oficina puede
 * corregir los datos y con un boton la sincroniza con Jireh (agdocul).
 */
const num = (v, dec = 2) => (v === null || v === undefined || v === '') ? '-'
  : Number(v).toLocaleString('es-EC', { minimumFractionDigits: 0, maximumFractionDigits: dec })

export const ENVIO = {
  ENVIADO: { t: 'Sincronizada con Jireh', c: '#1b5e20', i: 'bx-check-circle' },
  ERROR: { t: 'Error al sincronizar', c: '#b71c1c', i: 'bx-error' },
  POR: { t: 'Por sincronizar', c: '#8a5300', i: 'bx-time-five' },
}
export const estadoEnvio = (f) => f.estado_aplicacion !== 'APLICADA' ? null
  : f.envio_erp === 'ENVIADO' ? ENVIO.ENVIADO : f.envio_erp === 'ERROR' ? ENVIO.ERROR : ENVIO.POR

export default function DrawerFichaAplicacion({ ficha, open, onClose, onGuardar, onSincronizar, onLiberar, onImprimir, ocupado }) {
  const [form, setForm] = useState(null)

  useEffect(() => {
    if (!ficha) { setForm(null); return }
    setForm({
      fecha_aplicacion: ficha.fecha_aplicacion || '', hora_inicio: ficha.hora_inicio || '', hora_fin: ficha.hora_fin || '',
      temperatura: ficha.temperatura ?? '', velocidad_viento: ficha.velocidad_viento ?? '', num_bombas: ficha.num_bombas ?? '',
      aplicador: ficha.aplicador || '',
      cantidades: Object.fromEntries(ficha.productos.map(p => [p.cod_docul, p.cantidad_aplicada ?? ''])),
    })
  }, [ficha])

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape' && open) onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [open, onClose])

  const f = ficha
  const aplicada = f?.estado_aplicacion === 'APLICADA'
  const env = f ? estadoEnvio(f) : null
  const cambiado = !!(f && form && aplicada && (
    form.fecha_aplicacion !== (f.fecha_aplicacion || '') || form.hora_inicio !== (f.hora_inicio || '') || form.hora_fin !== (f.hora_fin || '') ||
    String(form.temperatura) !== String(f.temperatura ?? '') || String(form.velocidad_viento) !== String(f.velocidad_viento ?? '') ||
    String(form.num_bombas) !== String(f.num_bombas ?? '') || form.aplicador !== (f.aplicador || '') ||
    f.productos.some(p => String(form.cantidades[p.cod_docul]) !== String(p.cantidad_aplicada ?? ''))))
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }))
  const datosForm = () => ({
    fecha_aplicacion: form.fecha_aplicacion || null, hora_inicio: form.hora_inicio || null, hora_fin: form.hora_fin || null,
    temperatura: form.temperatura === '' ? null : Number(form.temperatura),
    velocidad_viento: form.velocidad_viento === '' ? null : Number(form.velocidad_viento),
    num_bombas: form.num_bombas === '' ? null : Number(form.num_bombas),
    aplicador: form.aplicador || null,
    productos: f.productos.filter(p => form.cantidades[p.cod_docul] !== '').map(p => ({ cod_docul: p.cod_docul, cantidad_aplicada: Number(form.cantidades[p.cod_docul]) })),
  })

  return (
    <>
      <div className={`drawer-overlay ${open ? 'active' : ''}`} onClick={onClose}></div>
      <div className={`drawer ${open ? 'open' : ''}`}>
        {f && form && (<>
          <div className="drawer-header">
            <div className="drawer-header-top">
              <h2><i className='bx bx-spray-can'></i> Orden {f.ocult} · Lote {f.lote}</h2>
              <button className="drawer-close" onClick={onClose}><i className='bx bx-x'></i></button>
            </div>
            <div style={{display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', fontSize: '0.8rem'}}>
              <EstadoErpBadge estado={f.estado_erp} />
              <span style={{color: 'var(--color-text-secondary)'}}>{estadoAplicacionTexto(f)}</span>
              {env && <span style={{color: env.c, fontWeight: 600}}><i className={`bx ${env.i}`}></i> {env.t}</span>}
            </div>
          </div>

          <div className="drawer-content">
            <div className="drawer-section">
              <h3><i className='bx bx-file'></i> {f.actividad}</h3>
              <div className="dfa-grid">
                <span><b>Hacienda:</b> {f.hacienda}</span>
                <span><b>Has.:</b> {num(f.hectareas)}</span>
                <span><b>Producto:</b> {f.cultivo}</span>
                <span><b>Edad:</b> Semana {f.edad_sem ?? '-'}</span>
                <span><b>Sem. aplicación:</b> {f.semana}-{f.anio}</span>
                <span><b>Proyecto:</b> {f.proyecto || '-'}</span>
              </div>
            </div>

            <div className="drawer-section">
              <h3><i className='bx bx-cog'></i> Aplicación</h3>
              {f.estado_aplicacion === 'PENDIENTE' ? (
                <p style={{color: 'var(--color-text-secondary)', margin: 0}}>Todavía no se ha aplicado desde la bitácora.</p>
              ) : (
                <div className="dfa-grid">
                  <span><b>Equipo:</b> {f.tractor}{f.bomba ? ` · ${f.bomba}` : ''}</span>
                  <span><b>Método:</b> {f.metodo}</span>
                  {aplicada ? (<>
                    <label>Aplicador<input className="form-control" value={form.aplicador} onChange={e => set('aplicador', e.target.value)} maxLength={50} /></label>
                    <label>Fecha<input type="date" className="form-control" value={form.fecha_aplicacion} onChange={e => set('fecha_aplicacion', e.target.value)} /></label>
                    <label>Hora inicio<input type="time" className="form-control" value={form.hora_inicio} onChange={e => set('hora_inicio', e.target.value)} /></label>
                    <label>Hora fin<input type="time" className="form-control" value={form.hora_fin} onChange={e => set('hora_fin', e.target.value)} /></label>
                    <label>Temperatura (°C)<input type="number" step="0.1" className="form-control" value={form.temperatura} onChange={e => set('temperatura', e.target.value)} /></label>
                    <label>Velocidad del viento (km/h)<input type="number" step="0.1" min="0" className="form-control" value={form.velocidad_viento} onChange={e => set('velocidad_viento', e.target.value)} /></label>
                    <label># Bombas<input type="number" step="0.5" min="0" className="form-control" value={form.num_bombas} onChange={e => set('num_bombas', e.target.value)} /></label>
                  </>) : (<>
                    <span><b>Aplicador:</b> {f.aplicador}</span>
                    <span><b>Temperatura:</b> {num(f.temperatura)} °C</span>
                    <span><b>Viento:</b> {num(f.velocidad_viento)} km/h</span>
                  </>)}
                </div>
              )}
              {f.envio_error && <p style={{color: '#b71c1c', fontSize: '0.8rem', marginBottom: 0}}><i className='bx bx-error'></i> {f.envio_error}</p>}
            </div>

            <div className="drawer-section">
              <h3><i className='bx bx-list-ul'></i> Productos ({f.productos.length})</h3>
              <div style={{overflowX: 'auto'}}>
                <table className="dfa-tabla">
                  <thead><tr><th>Producto</th><th>Clasificación</th><th className="n">Dosis/Ha</th><th className="n">Cantidad</th><th className="n">Despachada</th><th className="n">Aplicada</th><th>Carencia</th><th>Es</th></tr></thead>
                  <tbody>
                    {f.productos.map(p => (
                      <tr key={p.cod_docul}>
                        <td><b>{p.nombre_comercial || p.cod_prod}</b><br /><small>{p.cod_prod} · {p.descripcion}</small></td>
                        <td>{p.clasificacion}</td>
                        <td className="n">{num(p.dosis_ha)} {p.unidad}</td>
                        <td className="n">{num(p.cantidad)}</td>
                        <td className="n">{num(p.cantidad_salida)}</td>
                        <td className="n">{aplicada
                          ? <input type="number" step="0.01" min="0" className="form-control" style={{width: '95px', textAlign: 'right', padding: '0.2rem 0.4rem'}}
                              value={form.cantidades[p.cod_docul]} onChange={e => setForm(prev => ({ ...prev, cantidades: { ...prev.cantidades, [p.cod_docul]: e.target.value } }))} />
                          : num(p.cantidad_aplicada)}</td>
                        <td>{p.carencia || '-'}</td>
                        <td><EstadoErpBadge estado={p.estado_erp} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="drawer-footer" style={{justifyContent: 'space-between', flexWrap: 'wrap'}}>
            <div style={{display: 'flex', gap: '0.5rem'}}>
              <button className="btn btn-secondary" onClick={() => onImprimir(f)}><i className='bx bx-printer'></i> Imprimir</button>
              {f.estado_aplicacion === 'EN_CURSO' && (
                <button className="btn btn-danger" onClick={() => onLiberar(f)} disabled={ocupado}><i className='bx bx-reset'></i> Liberar</button>
              )}
            </div>
            {aplicada && (
              <div style={{display: 'flex', gap: '0.5rem'}}>
                <button className="btn btn-secondary" onClick={() => onGuardar(f, datosForm())} disabled={!cambiado || ocupado}>
                  <i className='bx bx-save'></i> Guardar cambios
                </button>
                <button className="btn btn-primary" onClick={() => onSincronizar(f, cambiado ? datosForm() : null)} disabled={ocupado}>
                  <i className={`bx ${ocupado ? 'bx-loader-alt bx-spin' : 'bx-sync'}`}></i> {f.envio_erp === 'ENVIADO' ? 'Volver a sincronizar' : 'Sincronizar con Jireh'}
                </button>
              </div>
            )}
          </div>
        </>)}
      </div>
      <style>{`
        .dfa-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 0.5rem 1rem; font-size: 0.85rem; }
        .dfa-grid label { display: grid; gap: 0.2rem; font-size: 0.75rem; font-weight: 600; color: var(--color-text-secondary); }
        .dfa-tabla { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
        .dfa-tabla th { background: var(--color-primary); color: var(--color-on-primary); padding: 4px 6px; text-align: left; white-space: nowrap; }
        .dfa-tabla td { border-bottom: 1px solid var(--color-border); padding: 4px 6px; vertical-align: top; }
        .dfa-tabla td small { color: var(--color-text-secondary); }
        .dfa-tabla .n { text-align: right; white-space: nowrap; }
      `}</style>
    </>
  )
}
