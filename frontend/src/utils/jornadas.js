/**
 * Jornadas de trabajo de los tractoristas y clasificacion de sus horas.
 *
 * Una JORNADA son las actividades seguidas de un operador: si entre el fin de
 * una y el inicio de la siguiente pasan mas de `separacion_jornada_min`, empieza
 * otra. Asi una jornada que arranca en la tarde y termina al dia siguiente (o
 * que dura 40 h) se ve completa y no partida por dias.
 *
 * Horas (cualquier actividad, sea apoyo general o labor cultural). La jornada
 * es de turno DIA (hora_normal_*) o NOCHE (hora_nocturna_*), segun en cual
 * trabajo mas tiempo:
 *  - Normales:        L-V dentro del horario diurno (turno de dia).
 *  - Nocturnas (25%): L-V dentro del horario nocturno (turno de noche).
 *  - Al 50%:          L-V fuera del horario de su turno (horas adicionales).
 *  - Al 100%:         sabados, domingos y feriados.
 * Almuerzo: si en la jornada registro "RECESOS Y ALIMENTACIÓN", ese tiempo es
 * su almuerzo y no se paga. Si no lo registro, se descuenta almuerzo_min
 * (primero de las normales, luego del 50% y luego del 100%) y se alerta.
 * Se cuenta desde el inicio de la primera actividad redondeado hacia adelante a
 * 0/5 min hasta el fin de la ultima redondeado hacia atras a 0/5 min.
 * Las pausas (paro) no cuentan; si dos actividades se cruzan, el tiempo
 * compartido se cuenta una sola vez.
 */

// Valores por defecto (los reales vienen de GET /api/parametros/jornada).
export const CONFIG_JORNADA_DEFECTO = {
  hora_normal_inicio: '07:00',
  hora_normal_fin: '16:00',
  hora_nocturna_inicio: '19:00',
  hora_nocturna_fin: '06:00',
  almuerzo_min: 60,
  separacion_jornada_min: 240,
  feriados: [],
}

const aMin = (hhmm) => { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0) }

export const diaISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Feriado ({fecha, nombre}) de ese dia, o undefined */
export const feriadoDe = (d, cfg) => {
  const iso = diaISO(d)
  return (cfg.feriados || []).find(f => (typeof f === 'string' ? f : f.fecha) === iso)
}

/** 'FERIADO' | 'FIN_DE_SEMANA' | null */
export const tipoDia = (d, cfg) => {
  if (!d) return null
  if (feriadoDe(d, cfg)) return 'FERIADO'
  return d.getDay() === 0 || d.getDay() === 6 ? 'FIN_DE_SEMANA' : null
}

/** Tramos [desde, hasta] en que la actividad estuvo trabajando (sin pausas). Solo tramos cerrados. */
export function tramosTrabajados(historial) {
  const tramos = []
  let desde = null
  for (const ev of historial || []) {
    const f = new Date(ev.fecha)
    if (isNaN(f)) continue
    if (ev.accion === 'inicio' || ev.accion === 'reanudado') desde = f
    else if (ev.accion === 'pausado' || ev.accion === 'finalizado') {
      if (desde && f > desde) tramos.push([desde, f])
      desde = null
    }
  }
  return tramos
}

function unirTramos(tramos) {
  const out = []
  for (const [a, b] of [...tramos].sort((x, y) => x[0] - y[0])) {
    const u = out[out.length - 1]
    if (u && a <= u[1]) { if (b > u[1]) u[1] = b } else out.push([a, b])
  }
  return out
}

const enVentana = (m, ini, fin) => ini <= fin ? (m >= ini && m < fin) : (m >= ini || m < fin)   // fin < ini: cruza medianoche

/**
 * Minutos de unos tramos segun el turno (cortando en medianoche y en los bordes de los turnos):
 *  - Turno DIA:   L-V dentro del horario diurno -> normal
 *  - Turno NOCHE: L-V dentro del horario nocturno -> nocturna (recargo 25%)
 *  - L-V fuera del horario de su turno -> extra50; sab, dom y feriados -> extra100
 */
export function clasificarTramos(tramos, cfg, turno = 'DIA') {
  const dIni = aMin(cfg.hora_normal_inicio), dFin = aMin(cfg.hora_normal_fin)
  const nIni = aMin(cfg.hora_nocturna_inicio), nFin = aMin(cfg.hora_nocturna_fin)
  const [vIni, vFin] = turno === 'NOCHE' ? [nIni, nFin] : [dIni, dFin]
  const cortes = [...new Set([dIni, dFin, nIni, nFin])].sort((x, y) => x - y)
  const res = { normal: 0, nocturna: 0, extra50: 0, extra100: 0, enDia: 0, enNoche: 0 }
  for (const [a, b] of tramos) {
    let t = new Date(a)
    while (t < b) {
      const minDia = t.getHours() * 60 + t.getMinutes() + t.getSeconds() / 60 + t.getMilliseconds() / 60000
      const sig = cortes.find(c => c > minDia)
      const corte = sig !== undefined
        ? new Date(t.getFullYear(), t.getMonth(), t.getDate(), 0, sig)
        : new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)
      const hasta = corte < b ? corte : b
      const min = (hasta - t) / 60000
      if (enVentana(minDia, dIni, dFin)) res.enDia += min
      if (enVentana(minDia, nIni, nFin)) res.enNoche += min
      if (tipoDia(t, cfg)) res.extra100 += min
      else if (enVentana(minDia, vIni, vFin)) res[turno === 'NOCHE' ? 'nocturna' : 'normal'] += min
      else res.extra50 += min
      t = hasta
    }
  }
  return res
}

const eventoInicio = (r) => r.fecha_historial?.find(h => h.accion === 'inicio')
const eventoFin = (r) => [...(r.fecha_historial || [])].reverse().find(h => h.accion === 'finalizado')

/** Actividad con la que el operador registra su almuerzo ("RECESOS Y ALIMENTACIÓN"). */
export const esAlmuerzo = (r) => /RECESO|ALIMENTACI/i.test(`${r.actividad || ''} ${r.subactividad || ''}`)

/** tramos menos los huecos (ambos ya unidos y ordenados) */
function restarTramos(tramos, huecos) {
  let res = tramos
  for (const [ha, hb] of huecos) {
    res = res.flatMap(([a, b]) => (hb <= a || ha >= b) ? [[a, b]]
      : [...(ha > a ? [[a, ha]] : []), ...(hb < b ? [[hb, b]] : [])])
  }
  return res
}

const CLASES = ['normal', 'nocturna', 'extra50', 'extra100']
const sumaHoras = (h) => CLASES.reduce((s, k) => s + h[k], 0)

// Redondeo a multiplos de 5 min (minutos terminados en 0 o 5): el inicio de la
// jornada hacia ADELANTE (7:59 -> 8:00, 3:43 -> 3:45) y el fin hacia ATRAS.
const CINCO_MIN = 5 * 60000
const inicioRedondeado = (d) => new Date(Math.ceil(Math.floor(d / 60000) * 60000 / CINCO_MIN) * CINCO_MIN)
const finRedondeado = (d) => new Date(Math.floor(d / CINCO_MIN) * CINCO_MIN)
const recortar = (tramos, a, b) => tramos.map(([x, y]) => [x < a ? a : x, y > b ? b : y]).filter(([x, y]) => y > x)

function resumirJornada(j, cfg) {
  const reales = unirTramos(j.items.flatMap(it => it.tramos))
  const inicioContado = reales.length ? inicioRedondeado(reales[0][0]) : null
  const finContado = reales.length ? finRedondeado(reales[reales.length - 1][1]) : null
  const todos = reales.length ? recortar(reales, inicioContado, finContado) : []
  const recesos = unirTramos(j.items.filter(it => esAlmuerzo(it.r)).flatMap(it => it.tramos))
  // Turno de la jornada: el horario (diurno o nocturno) en que trabajo mas tiempo
  const base = clasificarTramos(todos, cfg)
  const turno = base.enNoche > base.enDia ? 'NOCHE' : 'DIA'
  const trabajado = sumaHoras(base)   // incluye el receso registrado
  // Si registro su receso/almuerzo, ese tiempo es el almuerzo y sale de las
  // horas en que ocurrio. Si NO lo registro, se descuenta el almuerzo fijo
  // (horas de su turno -> 50% -> 100%) y la jornada queda con alerta.
  const almuerzoRegistrado = recesos.length > 0
  // "Sin almuerzo" marcado por quien revisa (no todos los tractoristas almuerzan):
  // no se descuenta el almuerzo fijo y la jornada no queda con alerta.
  const dia = j.inicio ? diaISO(j.inicio) : 'Sin fecha'
  const sinAlmuerzo = !almuerzoRegistrado && !!cfg.diasSinAlmuerzo?.has(dia)
  const { enDia: _d, enNoche: _n, ...horas } = clasificarTramos(almuerzoRegistrado ? restarTramos(todos, recesos) : todos, cfg, turno)
  if (!almuerzoRegistrado && !sinAlmuerzo) {
    let resto = Math.min(Number(cfg.almuerzo_min) || 0, sumaHoras(horas))
    for (const k of CLASES) { const d = Math.min(resto, horas[k]); horas[k] -= d; resto -= d }
  }
  const pagable = sumaHoras(horas)
  const regs = j.items.map(it => it.r)
  return {
    inicio: j.inicio, fin: j.fin, inicioContado, finContado, turno,
    dia,
    regs, trabajado, ...horas, pagable,
    almuerzo: trabajado - pagable,
    almuerzoRegistrado: almuerzoRegistrado || sinAlmuerzo,   // sin alerta
    sinAlmuerzoMarcado: sinAlmuerzo,
    paro: regs.reduce((s, r) => s + (r.tiempo_paro || 0), 0),
    enCurso: regs.some(r => r.estado === 'Ejecutándose'),
  }
}

/** Jornadas de UN operador, en orden cronologico; dentro de cada una, actividades por hora de inicio. */
export function armarJornadas(regs, cfg) {
  const sep = (Number(cfg.separacion_jornada_min) || 0) * 60000
  const items = regs.map(r => {
    const tramos = tramosTrabajados(r.fecha_historial)
    const ini = eventoInicio(r), fi = eventoFin(r)
    const inicio = ini ? new Date(ini.fecha) : (r.fecha_creacion ? new Date(r.fecha_creacion) : null)
    const fin = fi ? new Date(fi.fecha)
      : r.estado === 'Ejecutándose' ? new Date()
      : tramos.length ? tramos[tramos.length - 1][1] : inicio
    return { r, inicio, fin, tramos }
  }).sort((a, b) => (a.inicio?.getTime() ?? 0) - (b.inicio?.getTime() ?? 0))

  const jornadas = []
  let actual = null
  for (const it of items) {
    if (!actual || !it.inicio || !actual.fin || it.inicio - actual.fin > sep) {
      actual = { inicio: it.inicio, fin: it.fin, items: [] }
      jornadas.push(actual)
    }
    actual.items.push(it)
    if (it.fin && (!actual.fin || it.fin > actual.fin)) actual.fin = it.fin
  }
  return jornadas.map(j => resumirJornada(j, cfg))
}

/**
 * Fechas de inicio/fin con las HORAS corregidas en el reporte, eligiendo el DIA
 * solo: el fin es el mismo dia del inicio, o el siguiente si la hora es menor
 * (turno que cruza la medianoche). Asi, si el tractorista olvido cerrar la
 * actividad (17:20 -> 05:36 del dia siguiente) y se corrige el fin a 18:00,
 * queda el MISMO dia y no arrastra la jornada del dia siguiente.
 * El inicio corregido (sin tocar el fin) toma el dia del fin, o el anterior.
 */
export function fechasEditadas(r, ed = {}) {
  const ini = eventoInicio(r)?.fecha
  const fi = eventoFin(r)?.fecha
  const conHora = (iso, hhmm) => `${iso.substring(0, 10)}T${hhmm}:00`
  const corto = (iso) => (iso || '').substring(0, 16)
  const moverDia = (iso, n) => {
    const d = new Date(`${iso.substring(0, 10)}T12:00:00`)
    d.setDate(d.getDate() + n)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}${iso.substring(10)}`
  }
  const horaDe = (iso) => (iso || '').substring(11, 16)
  let inicio = ini
  if (ini && ed.inicioDia) {
    inicio = `${ed.inicioDia}T${ed.inicio || horaDe(ini)}:00`       // dia elegido a mano
  } else if (ini && ed.inicio) {
    inicio = conHora(ini, ed.inicio)
    if (fi && !ed.fin && !ed.finDia) {
      inicio = conHora(fi, ed.inicio)
      if (corto(inicio) > corto(fi)) inicio = moverDia(inicio, -1)
    }
  }
  let fin = fi
  if (fi && ed.finDia) {
    fin = `${ed.finDia}T${ed.fin || horaDe(fi)}:00`                  // dia elegido a mano
  } else if (fi && ed.fin) {
    fin = conHora(inicio || fi, ed.fin)
    if (inicio && corto(fin) <= corto(inicio)) fin = moverDia(fin, 1)
  }
  return { inicio, fin }
}

export function totalizarJornadas(jornadas) {
  const t = { trabajado: 0, almuerzo: 0, normal: 0, nocturna: 0, extra50: 0, extra100: 0, pagable: 0, paro: 0, actividades: 0, sinAlmuerzo: 0 }
  for (const j of jornadas) {
    for (const k of ['trabajado', 'almuerzo', 'normal', 'nocturna', 'extra50', 'extra100', 'pagable', 'paro']) t[k] += j[k]
    t.actividades += j.regs.length
    if (!j.almuerzoRegistrado) t.sinAlmuerzo++
  }
  return t
}
