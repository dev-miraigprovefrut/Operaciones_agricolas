"""Fichas de aplicacion fitosanitaria: Informix (agdocul) <-> ficha_aplicacion.

LECTURA: por semana se copian las filas de agdocul de las actividades 83
(aplicacion herbicida) y 93 (aplicacion fitosanitaria), tipos IN/SE, en
cualquier estado menos AN (anulado). El estado (PE pendiente de revision, AU
autorizada, CN confirmada) se muestra al operador. Se refrescan durante la
semana porque en el ERP se van actualizando.

ESCRITURA: al terminar la aplicacion se llenan en cada fila de agdocul fecha,
horas, temperatura, velocidad del viento, numero de bombas, metodo, aplicador y
cantidad real. El estado NO se toca: lo pasan a CN en el ERP al revisar.
"""
import logging
import re
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..comun import ahora_ecuador
from ..config import settings
from ..models import FichaAplicacion, FichaAplicacionProducto
from .informix import ejecutar_escritura, ejecutar_query

log = logging.getLogger(__name__)

ACTIVIDADES = (83, 93)          # agacamp: 83 APLICACION HERBICIDA, 93 APLICACION FITOSANITARIA
METODO_DRON, METODO_TRACTOR = 34, 14   # agmapli: 34 DRON, 14 ALTO DESPEJE ASPERSION
_ORDEN_ESTADO = {"PE": 0, "AU": 1, "FA": 2, "CN": 3}


def semanas_vigentes(hoy: date | None = None) -> list[tuple[int, int]]:
    """(anio, semana) de la semana pasada, la actual y la siguiente (ISO)."""
    hoy = hoy or ahora_ecuador().date()
    out = []
    for dias in (-7, 0, 7):
        a, s, _ = (hoy + timedelta(days=dias)).isocalendar()
        out.append((a, s))
    return out


def _num(v) -> Decimal | None:
    try:
        return Decimal(str(v).replace(",", "")) if v not in (None, "") else None
    except Exception:  # noqa: BLE001
        return None


def _int(v) -> int | None:
    try:
        return int(float(v)) if v not in (None, "") else None
    except Exception:  # noqa: BLE001
        return None


def _en(vals) -> str:
    return ",".join("'" + str(v).replace("'", "''") + "'" for v in vals) or "''"


def _consultar(semanas: list[tuple[int, int]], ocult: str | None = None) -> list[dict]:
    empresa = int(settings.NUMERO_EMPRESA)
    filtro_sem = " OR ".join(f"(d.docul_ani_ccult = {int(a)} AND d.docul_num_sema = {int(s)})" for a, s in semanas)
    filtro_ocult = f" AND d.docul_cod_ocult = {int(ocult)}" if ocult else ""
    filas = ejecutar_query(f"""
SELECT d.docul_cod_docul, d.docul_cod_ocult, d.docul_ani_ccult, d.docul_num_sema, d.docul_cod_acamp, a.acamp_nom_acamp,
       d.docul_tip_docul, d.docul_cod_prod, d.docul_nom_comer, d.docul_cod_unid, d.docul_cod_clasi, d.docul_can_aplic,
       d.docul_est_docul, d.docul_can_sali, d.docul_can_rapli, d.docul_fec_aplic, d.docul_cod_scult,
       o.ocult_cod_lotes, o.ocult_dim_lotes, o.ocult_cod_proda, h.hacda_nom_hacda, p.proye_nom_proye
FROM agdocul d, agocult o, agacamp a, agproye p, aghacda h
WHERE o.ocult_cod_ocult = d.docul_cod_ocult AND o.ocult_cod_empr = d.docul_cod_empr
  AND a.acamp_cod_acamp = d.docul_cod_acamp
  AND p.proye_cod_proye = o.ocult_cod_proye AND p.proye_cod_hacda = o.ocult_cod_hacda AND p.proye_cod_empr = o.ocult_cod_empr
  AND h.hacda_cod_hacda = p.proye_cod_hacda AND h.hacda_cod_empr = p.proye_cod_empr
  AND d.docul_cod_empr = {empresa}
  AND d.docul_cod_acamp IN ({",".join(str(x) for x in ACTIVIDADES)})
  AND d.docul_tip_docul IN ('IN', 'SE')
  AND d.docul_est_docul <> 'AN'
  AND ({filtro_sem}){filtro_ocult}""")
    cols = ["cod_docul", "ocult", "anio", "semana", "acamp", "actividad", "tipo", "cod_prod", "nom_comer", "cod_unid",
            "cod_clasi", "can_aplic", "estado", "can_sali", "can_rapli", "fec_aplic", "edad", "lote", "has", "cultivo",
            "hacienda", "proyecto"]
    filas = [dict(zip(cols, f)) for f in filas]
    if not filas:
        return []
    # Catalogos del ERP (descripcion, unidad, clasificacion, carencia)
    prods = {r[0]: r for r in ejecutar_query(f"""SELECT prod_cod_prod, prod_nom_prod, prod_des_prod FROM saeprod
        WHERE prod_cod_empr = {empresa} AND prod_cod_prod IN ({_en({f['cod_prod'] for f in filas})})""")}
    unids = {r[0]: r[1] for r in ejecutar_query(f"""SELECT unid_cod_unid, unid_sigl_unid FROM saeunid
        WHERE unid_cod_empr = {empresa} AND unid_cod_unid IN ({",".join({str(_int(f['cod_unid']) or 0) for f in filas})})""")}
    clasis = {r[0]: r[1] for r in ejecutar_query(f"""SELECT clasi_cod_clasi, clasi_nom_clasi FROM agclasi
        WHERE clasi_cod_clasi IN ({",".join({str(_int(f['cod_clasi']) or 0) for f in filas})})""")}
    carencias = {(r[0], r[1]): r[2] for r in ejecutar_query(f"""SELECT carpr_cod_proda, carpr_cod_prod, carpr_dia_carpr
        FROM agcarpr WHERE carpr_cod_empr = {empresa} AND carpr_cod_prod IN ({_en({f['cod_prod'] for f in filas})})""")}
    for f in filas:
        p = prods.get(f["cod_prod"])
        f["descripcion"] = (f"{p[1]}({p[2]})" if p and p[2] else (p[1] if p else f["nom_comer"]))[:250]
        f["unidad"] = unids.get(str(_int(f["cod_unid"]))) or ""
        f["clasificacion"] = clasis.get(str(_int(f["cod_clasi"]))) or ""
        f["carencia"] = carencias.get((f["cultivo"], f["cod_prod"])) or ""
    return filas


def sincronizar(db: Session, semanas: list[tuple[int, int]] | None = None, ocult: str | None = None) -> dict:
    """Copia/actualiza las fichas de esas semanas (o de una orden). Lo que ya se
    aplico en campo no se pisa; los productos anulados en el ERP se quitan
    mientras la ficha no este aplicada."""
    semanas = semanas or semanas_vigentes()
    filas = _consultar(semanas, ocult)
    grupos: dict[tuple, list[dict]] = {}
    for f in filas:
        grupos.setdefault((str(_int(f["ocult"])), _int(f["anio"]), _int(f["semana"]), _int(f["acamp"])), []).append(f)

    ahora = ahora_ecuador()
    creadas = actualizadas = 0
    vistos: set[int] = set()
    for (ocult_k, anio, semana, acamp), prods in grupos.items():
        ficha = db.scalar(select(FichaAplicacion).where(
            FichaAplicacion.ocult == ocult_k, FichaAplicacion.anio == anio, FichaAplicacion.semana == semana,
            FichaAplicacion.cod_acamp == acamp, FichaAplicacion.tenant_id == settings.TENANT_ID,
            FichaAplicacion.numero_empresa == settings.NUMERO_EMPRESA))
        if not ficha:
            ficha = FichaAplicacion(ocult=ocult_k, anio=anio, semana=semana, cod_acamp=acamp)
            db.add(ficha)
            creadas += 1
        else:
            actualizadas += 1
        c = prods[0]
        ficha.actividad, ficha.lote, ficha.hacienda, ficha.proyecto = c["actividad"], c["lote"], c["hacienda"], c["proyecto"]
        ficha.cultivo, ficha.hectareas, ficha.edad_sem = c["cultivo"], _num(c["has"]), _int(c["edad"])
        estados = [p["estado"] for p in prods]
        ficha.estado_erp = min(estados, key=lambda e: _ORDEN_ESTADO.get(e, 9))   # el "mas atrasado" manda
        ficha.aplicada_en_erp = any(p["fec_aplic"] for p in prods)
        ficha.fecha_sincronizacion = ahora
        existentes = {pr.cod_docul: pr for pr in ficha.productos}
        actuales = set()
        for p in prods:
            cod = _int(p["cod_docul"])
            actuales.add(cod)
            vistos.add(cod)
            pr = existentes.get(cod)
            if not pr:
                pr = FichaAplicacionProducto(cod_docul=cod)
                ficha.productos.append(pr)
            has = _num(c["has"])
            cant = _num(p["can_aplic"])
            pr.tipo, pr.cod_prod, pr.nombre_comercial = p["tipo"], p["cod_prod"], p["nom_comer"]
            pr.descripcion, pr.clasificacion, pr.unidad, pr.carencia = (p["descripcion"], p["clasificacion"],
                                                                        p["unidad"], p["carencia"])
            pr.cantidad = cant
            pr.dosis_ha = (cant / has).quantize(Decimal("0.0001")) if cant is not None and has else None
            pr.estado_erp, pr.cantidad_salida = p["estado"], _num(p["can_sali"])
            if ficha.estado_aplicacion != "APLICADA" and _num(p["can_rapli"]):
                pr.cantidad_aplicada = _num(p["can_rapli"])
        if ficha.estado_aplicacion == "PENDIENTE":
            for cod, pr in existentes.items():
                if cod not in actuales:
                    ficha.productos.remove(pr)
    db.commit()
    log.info("sync fichas %s: %s creadas, %s actualizadas, %s productos", semanas, creadas, actualizadas, len(vistos))
    return {"semanas": [f"{s}-{a}" for a, s in semanas], "creadas": creadas, "actualizadas": actualizadas,
            "productos": len(vistos)}


_HORA = re.compile(r"^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$")


def enviar_erp(db: Session, ficha: FichaAplicacion, probar: bool = False) -> int:
    """Escribe la aplicacion en las filas de agdocul de la ficha (sin tocar el
    estado). Devuelve filas actualizadas. Deja envio_erp en ENVIADO o ERROR."""
    if ficha.estado_aplicacion != "APLICADA":
        raise ValueError("La ficha todavia no esta aplicada")
    hin, hfi = ficha.hora_inicio.strftime("%H:%M:%S"), ficha.hora_fin.strftime("%H:%M:%S")
    if not (_HORA.match(hin) and _HORA.match(hfi)):
        raise ValueError("Horas invalidas")
    f = ficha.fecha_aplicacion
    sentencias = []
    for pr in ficha.productos:
        cantidad = pr.cantidad_aplicada if pr.cantidad_aplicada is not None else (pr.cantidad_salida or pr.cantidad)
        sentencias.append((f"""UPDATE agdocul SET docul_fec_aplic = MDY(?, ?, ?),
                docul_hin_docul = DATETIME({hin}) HOUR TO SECOND, docul_hfi_docul = DATETIME({hfi}) HOUR TO SECOND,
                docul_tmp_docul = ?, docul_vvi_docul = ?, docul_nbm_docul = ?, docul_cod_mapli = ?,
                docul_apl_resp = ?, docul_can_rapli = ?
              WHERE docul_cod_docul = ? AND docul_cod_empr = ? AND docul_est_docul <> 'AN'""",
                           [f.month, f.day, f.year, ficha.temperatura or Decimal(0), ficha.velocidad_viento or Decimal(0),
                            ficha.num_bombas or Decimal(0), int(ficha.cod_mapli or 0), (ficha.aplicador or "")[:50],
                            cantidad if cantidad is not None else Decimal(0), int(pr.cod_docul), int(settings.NUMERO_EMPRESA)]))
    try:
        n = ejecutar_escritura(sentencias, probar=probar)
    except Exception as e:  # noqa: BLE001
        if not probar:
            ficha.envio_erp, ficha.envio_error = "ERROR", str(e)[:1000]
            db.commit()
        raise
    if not probar:
        ficha.envio_erp, ficha.envio_error, ficha.fecha_envio = "ENVIADO", None, ahora_ecuador()
        ficha.aplicada_en_erp = True
        db.commit()
    return n


def reenviar_pendientes(db: Session) -> dict:
    """Reintenta las aplicaciones que no se pudieron escribir (VPN caida...)."""
    ok = err = 0
    for ficha in db.scalars(select(FichaAplicacion).where(FichaAplicacion.estado_aplicacion == "APLICADA",
                                                          FichaAplicacion.envio_erp.in_(["PENDIENTE", "ERROR"]))):
        try:
            enviar_erp(db, ficha)
            ok += 1
        except Exception:  # noqa: BLE001
            err += 1
    return {"enviadas": ok, "con_error": err}


def main() -> dict:
    """Para el scheduler: sincroniza las semanas vigentes y reintenta envios."""
    from ..database import SessionLocal
    db = SessionLocal()
    try:
        r = sincronizar(db)
        r["reenvio"] = reenviar_pendientes(db)
        return r
    finally:
        db.close()


# Fecha/hora de la actividad de la bitacora (historial en hora local)
def tiempos_registro(historial: list[dict]) -> tuple[datetime | None, datetime | None]:
    ini = next((e for e in historial if e.get("accion") == "inicio"), None)
    fin = next((e for e in reversed(historial) if e.get("accion") == "finalizado"), None)
    return (datetime.fromisoformat(ini["fecha"]) if ini else None,
            datetime.fromisoformat(fin["fecha"]) if fin else None)
