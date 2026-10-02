/**
 * Ficha de aplicacion fitosanitaria (copia de agdocul del ERP) en la bitacora
 * de tractores / drones. Muestra el estado en el ERP (para que el operador sepa
 * si esta pendiente de revision, autorizada o confirmada), los productos y,
 * si la subactividad es de aplicacion, pide temperatura y velocidad del viento
 * antes de Iniciar.
 */
export const ESTADO_ERP = {
  PE: { texto: 'Pendiente de revisión', fondo: '#fff3cd', color: '#8a5300', borde: '#f0ad4e' },
  AU: { texto: 'Autorizada', fondo: '#e2f4e6', color: '#1b5e20', borde: '#81c784' },
  CN: { texto: 'Confirmada', fondo: '#e9ecef', color: '#495057', borde: '#adb5bd' },
}

const num = (v, dec = 2) => (v === null || v === undefined || v === '') ? '-'
  : Number(v).toLocaleString('es-EC', { minimumFractionDigits: 0, maximumFractionDigits: dec })

export function EstadoErpBadge({ estado }) {
  const e = ESTADO_ERP[estado] || { texto: estado || '-', fondo: '#f1f1f1', color: '#555', borde: '#ccc' }
  return (
    <span style={{background: e.fondo, color: e.color, border: `1px solid ${e.borde}`, borderRadius: '4px', padding: '1px 6px', fontSize: '0.7rem', fontWeight: 600, whiteSpace: 'nowrap'}}>
      {e.texto}
    </span>
  )
}

export function estadoAplicacionTexto(f) {
  if (f.estado_aplicacion === 'APLICADA') return `Aplicada ${f.fecha_aplicacion || ''} ${f.hora_inicio || ''}–${f.hora_fin || ''} · ${f.tractor || ''}`
  if (f.estado_aplicacion === 'EN_CURSO') return `En aplicación · ${f.tractor || ''} (${f.aplicador || ''})`
  return f.aplicada_en_erp ? 'Ya tiene datos de aplicación en el ERP' : 'Por aplicar'
}

export default function FichaAplicacion({ fichas, fichaId, onSeleccionar, cargando, ocult, esAplicacion,
  datos, onDatos, tractor }) {
  if (!ocult || ocult === 'SIN LOTE') {
    return (
      <div className="ficha-aplic ficha-aplic-vacia">
        <i className='bx bx-spray-can'></i> Seleccione el lote para ver la ficha de aplicación
      </div>
    )
  }
  if (cargando) {
    return <div className="ficha-aplic ficha-aplic-vacia"><i className='bx bx-loader-alt bx-spin'></i> Buscando ficha de aplicación…</div>
  }
  if (!fichas.length) {
    return (
      <div className="ficha-aplic ficha-aplic-vacia">
        <i className='bx bx-info-circle'></i> No hay ficha de aplicación para la orden {ocult} en estas semanas
      </div>
    )
  }
  const f = fichas.find(x => x.id === fichaId) || fichas[0]
  const mia = f.estado_aplicacion === 'EN_CURSO' && f.tractor === tractor
  const pideDatos = esAplicacion && (f.estado_aplicacion === 'PENDIENTE')
  const tomadaPorOtro = esAplicacion && f.estado_aplicacion !== 'PENDIENTE' && !mia

  return (
    <div className="ficha-aplic">
      <div className="ficha-aplic-titulo">
        <span><i className='bx bx-spray-can'></i> Ficha de aplicación</span>
        <EstadoErpBadge estado={f.estado_erp} />
      </div>

      {fichas.length > 1 && (
        <div className="ficha-aplic-opciones">
          {fichas.map(x => (
            <button key={x.id} type="button" onClick={() => onSeleccionar(x.id)}
              className={x.id === f.id ? 'activa' : ''}>
              Sem {x.semana} · {x.cod_acamp === 83 ? 'Herbicida' : 'Fitosanitaria'}
              {x.estado_aplicacion === 'APLICADA' ? ' ✓' : ''}
            </button>
          ))}
        </div>
      )}

      <div className="ficha-aplic-datos">
        <span><b>Orden:</b> {f.ocult}</span>
        <span><b>Lote:</b> {f.lote}</span>
        <span><b>Has:</b> {num(f.hectareas)}</span>
        <span><b>Producto:</b> {f.cultivo}</span>
        <span><b>Edad:</b> Semana {f.edad_sem ?? '-'}</span>
        <span><b>Sem. aplicación:</b> {f.semana}-{f.anio}</span>
        <span style={{gridColumn: '1 / -1'}}><b>{f.actividad}</b> · {estadoAplicacionTexto(f)}</span>
      </div>

      <div style={{overflowX: 'auto'}}>
        <table className="ficha-aplic-tabla">
          <thead>
            <tr><th>Producto</th><th>Descripción</th><th>Clasificación</th><th className="num">Dosis/Ha</th><th className="num">Cantidad</th><th>Carencia</th></tr>
          </thead>
          <tbody>
            {f.productos.map(p => (
              <tr key={p.cod_docul}>
                <td>{p.cod_prod}</td>
                <td>{p.descripcion}</td>
                <td>{p.clasificacion}</td>
                <td className="num">{num(p.dosis_ha)} {p.unidad}</td>
                <td className="num">{num(p.cantidad)} {p.unidad}</td>
                <td>{p.carencia || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {tomadaPorOtro && (
        <div className="ficha-aplic-aviso">
          <i className='bx bx-error'></i> {f.estado_aplicacion === 'APLICADA' ? 'Esta ficha ya fue aplicada' : `Esta ficha la está aplicando ${f.tractor}`}: una ficha la aplica un solo equipo.
        </div>
      )}

      {mia && (
        <div className="ficha-aplic-datos" style={{marginTop: '0.5rem'}}>
          <span><b>Temperatura:</b> {num(f.temperatura)} °C</span>
          <span><b>Viento:</b> {num(f.velocidad_viento)} km/h</span>
          {f.bomba && <span><b>Bomba:</b> {f.bomba}</span>}
        </div>
      )}

      {pideDatos && (
        <div className="ficha-aplic-inputs">
          <label><span>Temperatura (°C) <span className="required">*</span></span>
            <input type="number" inputMode="decimal" step="0.1" className="form-control" value={datos.temperatura}
              onChange={e => onDatos({ ...datos, temperatura: e.target.value })} placeholder="Ej. 9" />
          </label>
          <label><span>Velocidad del viento (km/h) <span className="required">*</span></span>
            <input type="number" inputMode="decimal" step="0.1" min="0" className="form-control" value={datos.viento}
              onChange={e => onDatos({ ...datos, viento: e.target.value })} placeholder="Ej. 5" />
          </label>
        </div>
      )}

      <style>{`
        .ficha-aplic { border: 1px solid var(--color-border); border-left: 3px solid #7b1fa2; border-radius: 8px; padding: 0.6rem 0.75rem; margin: 0.25rem 0 1rem; background: var(--color-bg-light); font-size: 0.8rem; color: var(--color-text-primary); }
        .ficha-aplic-vacia { color: var(--color-text-secondary); display: flex; gap: 0.4rem; align-items: center; }
        .ficha-aplic-titulo { display: flex; justify-content: space-between; align-items: center; font-weight: 700; color: #7b1fa2; margin-bottom: 0.4rem; gap: 0.5rem; }
        .ficha-aplic-opciones { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-bottom: 0.4rem; }
        .ficha-aplic-opciones button { border: 1px solid var(--color-border); background: var(--color-bg-white); color: var(--color-text-secondary); border-radius: 4px; padding: 0.15rem 0.5rem; font-size: 0.72rem; cursor: pointer; }
        .ficha-aplic-opciones button.activa { background: #7b1fa2; color: white; border-color: #7b1fa2; }
        .ficha-aplic-datos { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 0.2rem 0.8rem; margin-bottom: 0.5rem; }
        .ficha-aplic-tabla { width: 100%; border-collapse: collapse; font-size: 0.72rem; background: var(--color-bg-white); }
        .ficha-aplic-tabla th { background: #7b1fa2; color: white; padding: 3px 5px; text-align: left; white-space: nowrap; }
        .ficha-aplic-tabla td { border-bottom: 1px solid var(--color-border); padding: 3px 5px; }
        .ficha-aplic-tabla .num { text-align: right; white-space: nowrap; }
        .ficha-aplic-aviso { margin-top: 0.5rem; background: #fdecea; color: #b71c1c; border: 1px solid #f5c6cb; border-radius: 6px; padding: 0.4rem 0.6rem; }
        .ficha-aplic-inputs { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; margin-top: 0.6rem; }
        .ficha-aplic-inputs label { display: grid; gap: 0.2rem; font-weight: 600; font-size: 0.75rem; }
        @media (max-width: 480px) { .ficha-aplic-inputs { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  )
}
