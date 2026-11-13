/**
 * Dashboard de Operaciones Agricolas: cosecha por proyecto, horas de tractores y
 * operadores, actividades mas realizadas, quien trabaja ahora y lo que hay que revisar.
 *
 * Todo sale de GET /api/dashboard (backend/app/routers/dashboard.py). Cada parte se
 * muestra solo si el usuario tiene el permiso del reporte (cosecha / actividades).
 * Graficos en SVG propio (sin librerias): una serie por grafico, nunca dos ejes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { API_URL } from '../services/sesion'
import './Dashboard.css'

// ---------------------------------------------------------------- utilidades
const nf0 = new Intl.NumberFormat('es-EC', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('es-EC', { maximumFractionDigits: 1 })
const n0 = v => nf0.format(v || 0)
const horas = v => `${(v || 0) >= 100 ? nf0.format(v || 0) : nf1.format(v || 0)} h`
const kg = v => ((v || 0) >= 10000 ? `${nf1.format((v || 0) / 1000)} t` : `${nf0.format(v || 0)} kg`)
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const deIso = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d) }
const sumarDias = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r }
const ddmm = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
const lunes = d => sumarDias(d, -((d.getDay() + 6) % 7))
const hora = s => (s ? String(s).slice(11, 16) : '')
const fechaCorta = s => (s ? `${ddmm(deIso(s))} ${hora(s)}` : '')

function transcurrido(desde) {
  if (!desde) return ''
  const min = Math.max(0, Math.round((Date.now() - new Date(String(desde).replace(' ', 'T')).getTime()) / 60000))
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`
}

const RANGOS = [
  { id: 'hoy', label: 'Hoy' },
  { id: '7d', label: '7 días' },
  { id: 'mes', label: 'Este mes' },
  { id: '90d', label: '90 días' },
  { id: 'otro', label: 'Elegir fechas' },
]

function fechasDe(rango) {
  const hoy = new Date()
  if (rango === 'hoy') return [iso(hoy), iso(hoy)]
  if (rango === 'mes') return [iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), iso(hoy)]
  if (rango === '90d') return [iso(sumarDias(hoy, -89)), iso(hoy)]
  return [iso(sumarDias(hoy, -6)), iso(hoy)]
}

/** Completa con ceros los dias/semanas sin datos (la tendencia no debe "saltar" huecos). */
function serieCompleta(filas, desde, hasta, paso, campo) {
  const mapa = Object.fromEntries((filas || []).map(f => [String(f.periodo).slice(0, 10), f[campo] || 0]))
  const out = []
  let d = paso === 'semana' ? lunes(deIso(desde)) : deIso(desde)
  const fin = deIso(hasta)
  while (d <= fin && out.length < 500) {
    out.push({ fecha: d, valor: mapa[iso(d)] || 0 })
    d = sumarDias(d, paso === 'semana' ? 7 : 1)
  }
  return out
}

// ------------------------------------------------------------------ tooltip
function useTooltip() {
  const [tip, setTip] = useState(null)
  const mostrar = useCallback((e, contenido) => setTip({ x: e.clientX, y: e.clientY, contenido }), [])
  const ocultar = useCallback(() => setTip(null), [])
  const nodo = tip && (
    <div className="dsh-tip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 240), top: tip.y + 14 }} role="tooltip">
      {tip.contenido}
    </div>
  )
  return { mostrar, ocultar, nodo }
}

// ------------------------------------------------------------------ piezas
function Tarjeta({ titulo, icono, extra, children, className = '' }) {
  return (
    <section className={`dsh-card ${className}`}>
      <header className="dsh-card-head">
        <h2><i className={`bx ${icono}`} aria-hidden="true"></i>{titulo}</h2>
        {extra}
      </header>
      {children}
    </section>
  )
}

function Kpi({ icono, valor, etiqueta, detalle, tono = '', vivo = false }) {
  return (
    <div className={`dsh-kpi ${tono}`}>
      <div className="dsh-kpi-icono"><i className={`bx ${icono}`} aria-hidden="true"></i></div>
      <div className="dsh-kpi-txt">
        <div className="dsh-kpi-valor">{vivo && <span className="dsh-pulso" aria-hidden="true"></span>}{valor}</div>
        <div className="dsh-kpi-etq">{etiqueta}</div>
        {detalle && <div className="dsh-kpi-det">{detalle}</div>}
      </div>
    </div>
  )
}

function Vacio({ texto = 'Sin datos en este rango' }) {
  return <div className="dsh-vacio"><i className="bx bx-bar-chart-alt-2" aria-hidden="true"></i>{texto}</div>
}

/**
 * Barras horizontales (ranking). segmentos: [{campo, clase, nombre}] - el primero es la
 * medida principal; el resto se apila a continuacion (p.ej. horas de paro).
 */
function Ranking({ filas, segmentos, etiquetaValor, detalle, tip, onClick, activo, sub }) {
  if (!filas?.length) return <Vacio />
  const total = f => segmentos.reduce((s, sg) => s + (f[sg.campo] || 0), 0)
  const max = Math.max(...filas.map(total), 1)
  return (
    <ol className="dsh-rank">
      {filas.map((f, i) => (
        <li key={f.nombre ?? f.proyecto ?? i}
            className={`${onClick ? 'clic' : ''} ${activo && activo === (f.proyecto ?? f.nombre) ? 'activo' : ''}`}
            onClick={onClick ? () => onClick(f) : undefined}
            onMouseMove={e => tip.mostrar(e, detalle(f))} onMouseLeave={tip.ocultar}>
          <span className="dsh-rank-pos">{i + 1}</span>
          <div className="dsh-rank-cuerpo">
            <div className="dsh-rank-fila">
              <span className="dsh-rank-nombre" title={f.nombre ?? f.proyecto}>{f.nombre ?? f.proyecto}</span>
              <span className="dsh-rank-valor">{etiquetaValor(f)}</span>
            </div>
            {sub && <div className="dsh-rank-sub">{sub(f)}</div>}
            <div className="dsh-barra" aria-hidden="true">
              {segmentos.map(sg => (f[sg.campo] > 0) && (
                <span key={sg.campo} className={`dsh-seg ${sg.clase}`} style={{ width: `${(f[sg.campo] / max) * 100}%` }} />
              ))}
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}

function Leyenda({ items }) {
  return (
    <div className="dsh-leyenda">
      {items.map(it => <span key={it.nombre}><i className={`dsh-punto ${it.clase}`} />{it.nombre}</span>)}
    </div>
  )
}

/** Columnas de una sola serie (tendencia). */
function Columnas({ serie, paso, clase, formato, nombre, tip }) {
  const ref = useRef(null)
  const [ancho, setAncho] = useState(600)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setAncho(Math.max(240, e.contentRect.width)))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  const alto = 150, base = alto - 22, arriba = 14
  const max = Math.max(...serie.map(s => s.valor), 0)
  const hayDatos = max > 0
  const n = serie.length || 1
  const paso_x = ancho / n
  const barra = Math.max(3, Math.min(34, paso_x - 4))
  const cadaN = Math.ceil(n / Math.max(1, Math.floor(ancho / 56)))
  const total = serie.reduce((s, x) => s + x.valor, 0)
  const pico = serie.reduce((a, b) => (b.valor > (a?.valor ?? -1) ? b : a), null)
  return (
    <div className="dsh-cols" ref={ref}>
      <div className="dsh-cols-tit">
        <span>{nombre}</span>
        <span className="dsh-sub">Total {formato(total)}{hayDatos && pico ? ` · pico ${formato(pico.valor)} (${ddmm(pico.fecha)})` : ''}</span>
      </div>
      {!hayDatos ? <Vacio /> : (
        <svg width={ancho} height={alto} role="img" aria-label={`${nombre} por ${paso}`}>
          {[0.5, 1].map(t => (
            <g key={t}>
              <line className="dsh-gridline"x1="0" x2={ancho} y1={base - (base - arriba) * t} y2={base - (base - arriba) * t} />
              <text className="dsh-eje" x="2" y={base - (base - arriba) * t - 3}>{formato(max * t)}</text>
            </g>
          ))}
          <line className="dsh-base" x1="0" x2={ancho} y1={base} y2={base} />
          {serie.map((s, i) => {
            const h = (s.valor / max) * (base - arriba)
            const x = i * paso_x + (paso_x - barra) / 2
            const etiqueta = paso === 'semana' ? `Semana del ${ddmm(s.fecha)}` : s.fecha.toLocaleDateString('es-EC', { weekday: 'short', day: '2-digit', month: '2-digit' })
            return (
              <g key={i} onMouseMove={e => tip.mostrar(e, <><b>{etiqueta}</b><div>{nombre}: {formato(s.valor)}</div></>)} onMouseLeave={tip.ocultar}>
                <rect x={i * paso_x} y={arriba} width={paso_x} height={base - arriba} fill="transparent" />
                {h > 0 && <path className={`dsh-col ${clase}`} d={colRedondeada(x, base, barra, Math.max(h, 2))} />}
                {i % cadaN === 0 && <text className="dsh-eje" x={x + barra / 2} y={alto - 6} textAnchor="middle">{ddmm(s.fecha)}</text>}
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}

/** Columna con las esquinas de arriba redondeadas (4px) y la base recta sobre el eje. */
function colRedondeada(x, base, w, h) {
  const r = Math.min(4, w / 2, h)
  const y = base - h
  return `M${x},${base} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${base} Z`
}

// ------------------------------------------------------------------ pagina
function Dashboard() {
  const [rango, setRango] = useState('7d')
  const [desde, setDesde] = useState(() => fechasDe('7d')[0])
  const [hasta, setHasta] = useState(() => fechasDe('7d')[1])
  const [equipo, setEquipo] = useState('')
  const [proyecto, setProyecto] = useState('')
  const [datos, setDatos] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [, setReloj] = useState(0)
  const tip = useTooltip()

  const elegirRango = id => {
    setRango(id)
    if (id !== 'otro') { const [d, h] = fechasDe(id); setDesde(d); setHasta(h) }
  }

  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true)
    const qs = new URLSearchParams({ desde, hasta })
    if (equipo) qs.set('equipo', equipo)
    if (proyecto) qs.set('proyecto', proyecto)
    try {
      const res = await fetch(`${API_URL}/api/dashboard?${qs}`)
      if (res.status === 401) return
      if (res.status === 403) { setError('No tiene permiso para ver el dashboard (necesita reportes de cosecha o de actividades).'); setDatos(null); return }
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'No se pudo cargar')
      setDatos(await res.json()); setError('')
    } catch (e) {
      if (!silencioso) setError(e.message || 'No se pudo cargar el dashboard')
    } finally {
      setCargando(false)
    }
  }, [desde, hasta, equipo, proyecto])

  useEffect(() => { if (desde && hasta && desde <= hasta) cargar() }, [cargar, desde, hasta])

  // Si el rango incluye hoy se actualiza solo cada 2 min; el "hace X min" cada 30 s
  useEffect(() => {
    const incluyeHoy = hasta >= iso(new Date())
    const t1 = incluyeHoy ? setInterval(() => { if (!document.hidden) cargar(true) }, 120000) : null
    const t2 = setInterval(() => setReloj(r => r + 1), 30000)
    return () => { if (t1) clearInterval(t1); clearInterval(t2) }
  }, [cargar, hasta])

  const tr = datos?.tractores
  const co = datos?.cosecha
  const kt = tr?.kpi || {}
  const kc = co?.kpi || {}
  const paso = datos?.paso || 'dia'

  const serieHoras = useMemo(() => (tr ? serieCompleta(tr.tendencia, datos.desde, datos.hasta, paso, 'horas') : []), [tr, datos, paso])
  const serieFichas = useMemo(() => (co ? serieCompleta(co.tendencia, datos.desde, datos.hasta, paso, 'fichas') : []), [co, datos, paso])
  const proyectos = useMemo(() => (co?.por_proyecto || []).map(p => p.proyecto), [co])
  const enCurso = (tr?.ahora || []).filter(a => a.estado !== 'Pausado')
  const pausados = (tr?.ahora || []).filter(a => a.estado === 'Pausado')

  return (
    <div className="page-container dsh">
      <div className="page-header dsh-encabezado">
        <div>
          <h1><i className="bx bxs-dashboard"></i> Dashboard</h1>
          <p className="page-subtitle">
            Cosecha y maquinaria · {datos ? `${ddmm(deIso(datos.desde))} al ${ddmm(deIso(datos.hasta))}` : '...'}
            {datos?.generado && <span className="dsh-sub"> · actualizado {hora(datos.generado)}</span>}
          </p>
        </div>
        <button className="dsh-btn" onClick={() => cargar()} disabled={cargando} title="Actualizar">
          <i className={`bx bx-refresh ${cargando ? 'bx-spin' : ''}`}></i><span>Actualizar</span>
        </button>
      </div>

      {/* Filtros: una sola fila */}
      <div className="dsh-filtros">
        <div className="dsh-chips" role="group" aria-label="Rango de fechas">
          {RANGOS.map(r => (
            <button key={r.id} className={`dsh-chip ${rango === r.id ? 'activo' : ''}`} onClick={() => elegirRango(r.id)}>{r.label}</button>
          ))}
        </div>
        {rango === 'otro' && (
          <div className="dsh-fechas">
            <input type="date" value={desde} max={hasta} onChange={e => setDesde(e.target.value)} aria-label="Desde" />
            <span>al</span>
            <input type="date" value={hasta} min={desde} max={iso(new Date())} onChange={e => setHasta(e.target.value)} aria-label="Hasta" />
          </div>
        )}
        {datos?.ver_tractores && (
          <select value={equipo} onChange={e => setEquipo(e.target.value)} aria-label="Equipo">
            <option value="">Tractores y drones</option>
            <option value="Tractores">Solo tractores</option>
            <option value="Drones">Solo drones</option>
          </select>
        )}
        {datos?.ver_cosecha && (
          <select value={proyecto} onChange={e => setProyecto(e.target.value)} aria-label="Proyecto">
            <option value="">Todos los proyectos</option>
            {proyectos.map(p => <option key={p} value={p}>{p}</option>)}
            {proyecto && !proyectos.includes(proyecto) && <option value={proyecto}>{proyecto}</option>}
          </select>
        )}
      </div>

      {error && <div className="dsh-error"><i className="bx bx-error-circle"></i>{error}</div>}
      {!datos && cargando && <div className="dsh-cargando"><i className="bx bx-loader-alt bx-spin"></i> Cargando...</div>}

      {datos && (
        <div className={`dsh-cuerpo ${cargando ? 'recargando' : ''}`}>
          {/* Indicadores */}
          <div className="dsh-kpis">
            {co && <Kpi icono="bxs-truck" valor={n0(kc.fichas)} etiqueta="Fichas de cosecha"
                        detalle={`${pct(kc.recibidas, kc.fichas)}% recibidas en planta · ${n0(kc.productos)} productos`} />}
            {co && <Kpi icono="bx-package" valor={kg(kc.peso)} etiqueta="Cosechado (peso de campo)"
                        detalle={`${n0(kc.proyectos)} proyecto${kc.proyectos === 1 ? '' : 's'}${kc.con_falla ? ` · ${n0(kc.con_falla)} con falla` : ''}`} />}
            {tr && <Kpi icono="bx-time-five" valor={horas(kt.horas)} etiqueta="Horas trabajadas"
                        detalle={`${horas(kt.horas_paro)} de paro · ${n0(kt.actividades)} actividades`} />}
            {tr && <Kpi icono="bx-group" valor={`${n0(kt.operadores)} / ${n0(kt.tractores)}`} etiqueta="Operadores / equipos"
                        detalle={kt.operadores ? `${horas(kt.horas / kt.operadores)} promedio por operador` : 'Sin actividad'} />}
            {tr && <Kpi icono="bx-play-circle" valor={n0(enCurso.length)} etiqueta="Trabajando ahora" vivo={enCurso.length > 0}
                        detalle={pausados.length ? `${pausados.length} en pausa` : 'En tiempo real'} tono="vivo" />}
            {tr && <Kpi icono="bx-wrench" valor={n0(tr.fallas?.pendientes)} etiqueta="Fallas pendientes"
                        detalle={`En ${n0(tr.fallas?.tractores)} equipos (todas las fechas)`} tono={tr.fallas?.pendientes ? 'alerta' : ''} />}
          </div>

          <div className="dsh-grid">
            {/* Cosecha por proyecto */}
            {co && (
              <Tarjeta titulo="Fichas de cosecha por proyecto" icono="bxs-leaf"
                       extra={<Leyenda items={[{ nombre: 'Recibida', clase: 'st-ok' }, { nombre: 'En camino', clase: 'st-camino' }, { nombre: 'Con falla', clase: 'st-falla' }]} />}>
                <p className="dsh-ayuda">Toque un proyecto para ver solo su cosecha (las horas de maquinaria no se separan por proyecto).</p>
                <Ranking filas={co.por_proyecto} tip={tip} activo={proyecto}
                         onClick={f => setProyecto(p => (p === f.proyecto ? '' : f.proyecto))}
                         segmentos={[{ campo: 'recibidas', clase: 'st-ok' }, { campo: 'en_camino', clase: 'st-camino' }, { campo: 'con_falla', clase: 'st-falla' }]}
                         etiquetaValor={f => <><b>{n0(f.fichas)}</b> fichas · {kg(f.peso)}</>}
                         detalle={f => <><b>{f.proyecto}</b><div>{n0(f.fichas)} fichas · {n0(f.productos)} productos</div>
                           <div>Recibidas {n0(f.recibidas)} · En camino {n0(f.en_camino)} · Con falla {n0(f.con_falla)}</div><div>Peso de campo {kg(f.peso)}</div></>} />
              </Tarjeta>
            )}

            {/* Equipos y sus operadores: un solo ranking (cada operador anda en su equipo) */}
            {tr && (
              <Tarjeta titulo="Equipos y operadores con más horas" icono="bxs-car-mechanic"
                       extra={<Leyenda items={[{ nombre: 'Trabajo', clase: 'serie-principal' }, { nombre: 'Paro', clase: 'serie-paro' }]} />}>
                <Ranking filas={tr.top_tractores} tip={tip}
                         segmentos={[{ campo: 'horas', clase: 'serie-principal' }, { campo: 'paro', clase: 'serie-paro' }]}
                         etiquetaValor={f => <><b>{horas(f.horas)}</b>{f.paro >= 0.5 ? ` · ${horas(f.paro)} paro` : ''}</>}
                         sub={f => {
                           const ops = f.lista || []
                           const nom = o => (ops.length > 1 ? `${o.nombre} (${horas(o.horas)})` : o.nombre)
                           return <><i className="bx bxs-user" aria-hidden="true"></i>{ops.slice(0, 2).map(nom).join(' · ')}{ops.length > 2 ? ` · +${ops.length - 2} más` : ''}</>
                         }}
                         detalle={f => <><b>{f.nombre}</b><div>Trabajo {horas(f.horas)} · Paro {horas(f.paro)} · {n0(f.actividades)} actividades</div>
                           {(f.lista || []).map(o => <div key={o.nombre}>· {o.nombre}: {horas(o.horas)} en {n0(o.dias)} día{o.dias === 1 ? '' : 's'}</div>)}</>} />
              </Tarjeta>
            )}

            {/* Tendencia */}
            {(tr || co) && (
              <Tarjeta titulo={`Tendencia por ${paso}`} icono="bx-line-chart" className="ancho">
                <div className="dsh-tendencia">
                  {co && <Columnas serie={serieFichas} paso={paso} clase="serie-cosecha" formato={n0} nombre="Fichas de cosecha" tip={tip} />}
                  {tr && <Columnas serie={serieHoras} paso={paso} clase="serie-principal" formato={horas} nombre="Horas de maquinaria" tip={tip} />}
                </div>
              </Tarjeta>
            )}

            {tr && (
              <Tarjeta titulo="Actividades más realizadas" icono="bx-list-check">
                <Ranking filas={tr.top_actividades} tip={tip}
                         segmentos={[{ campo: 'veces', clase: 'serie-principal' }]}
                         etiquetaValor={f => <><b>{n0(f.veces)}</b> veces · {horas(f.horas)}</>}
                         detalle={f => <><b>{f.nombre}</b><div>{n0(f.veces)} veces · {horas(f.horas)}</div>
                           <div>{horas(f.horas / (f.veces || 1))} en promedio</div></>} />
              </Tarjeta>
            )}

            {co && (
              <Tarjeta titulo="Qué se cosechó" icono="bx-basket">
                <Ranking filas={co.por_producto} tip={tip}
                         segmentos={[{ campo: 'peso', clase: 'serie-cosecha' }]}
                         etiquetaValor={f => <><b>{kg(f.peso)}</b> · {n0(f.productos)}</>}
                         detalle={f => <><b>{f.nombre}</b><div>{kg(f.peso)} en {n0(f.productos)} registros</div></>} />
              </Tarjeta>
            )}

            {/* En este momento */}
            {tr && (
              <Tarjeta titulo="En este momento" icono="bx-broadcast"
                       extra={<span className="dsh-sub">{enCurso.length} trabajando{pausados.length ? ` · ${pausados.length} en pausa` : ''}</span>}>
                {!tr.ahora.length ? <Vacio texto="Nadie está trabajando ahora" /> : (
                  <ul className="dsh-ahora">
                    {tr.ahora.map(a => (
                      <li key={a.id} className={a.estado === 'Pausado' ? 'pausa' : ''}>
                        <span className={`dsh-estado ${a.estado === 'Pausado' ? 'pausa' : 'vivo'}`}>
                          <i className={`bx ${a.estado === 'Pausado' ? 'bx-pause' : 'bx-play'}`} aria-hidden="true"></i>
                          {a.estado === 'Pausado' ? 'Pausa' : 'Trabajando'}
                        </span>
                        <div className="dsh-ahora-txt">
                          <b>{a.usuario || 'Sin operador'}</b>
                          <span>{a.tractor || a.equipo} · {a.actividad}{a.subactividad ? ` / ${a.subactividad}` : ''}</span>
                          {(a.lote || a.hacienda) && <span className="dsh-sub">{[a.hacienda, a.lote].filter(Boolean).join(' · ')}</span>}
                        </div>
                        <span className="dsh-ahora-t" title={`Desde ${fechaCorta(a.desde)}`}>{transcurrido(a.desde)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Tarjeta>
            )}

            {/* Para revisar */}
            {tr && (
              <Tarjeta titulo="Para revisar" icono="bx-error">
                <div className="dsh-revisar-res">
                  <Link to="/reportes/actividades" className={`dsh-aviso ${kt.largas ? 'alerta' : ''}`}>
                    <b>{n0(kt.largas)}</b><span>actividades de más de {datos.horas_max} h (no suman en el tablero)</span>
                  </Link>
                  <Link to="/reportes/actividades" className="dsh-aviso">
                    <b>{n0(kt.sin_revisar)}</b><span>actividades sin revisar en el rango</span>
                  </Link>
                </div>
                {tr.largas.length > 0 && (
                  <>
                    <h3 className="dsh-h3">Probablemente quedaron sin cerrar</h3>
                    <ul className="dsh-lista">
                      {tr.largas.slice(0, 6).map(l => (
                        <li key={l.id}>
                          <span className="dsh-lista-n">{horas(l.horas)}</span>
                          <span className="dsh-lista-t">{l.usuario || 'Sin operador'} · {l.tractor}<small>{fechaCorta(l.fecha)} · {l.actividad}</small></span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {tr.fallas_tractores?.length > 0 && (
                  <>
                    <h3 className="dsh-h3">Equipos con más fallas pendientes</h3>
                    <ul className="dsh-lista">
                      {tr.fallas_tractores.map(f => (
                        <li key={f.nombre}>
                          <span className="dsh-lista-n falla">{n0(f.fallas)}</span>
                          <span className="dsh-lista-t">{f.nombre}<small>última {fechaCorta(f.ultima)}</small></span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </Tarjeta>
            )}
          </div>
        </div>
      )}
      {tip.nodo}
    </div>
  )
}

export default Dashboard
