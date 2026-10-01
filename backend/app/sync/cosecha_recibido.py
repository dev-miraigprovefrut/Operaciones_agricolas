"""Sync de fichas de cosecha con Informix (pesaje en planta).

PASO 1: asigna num_ficha, peso, hora_ingreso y recibido_por a los productos de
        fichas Enviado/Corregida (y Activo abandonadas) que aun no los tienen.
PASO 2: marca Recibido la ficha cuando TODOS sus productos tienen num_ficha y
        ajusta fecha_creacion / hora_ingreso / fecha_salida (llegada - 2h).
Misma logica que el sync anterior, sobre las tablas nuevas.
"""
import logging
import re
from datetime import datetime, timedelta

import psycopg

from ..config import settings
from .informix import ejecutar_query

log = logging.getLogger(__name__)
EMPRESA_MAP = {"182": "PROVEFRUT", "192": "PROCONGELADOS", "322": "322", "332": "332"}
OFFSETS = [0, -1]          # el dia registrado y, en caso extremo, un dia antes


def conectar():
    return psycopg.connect(host=settings.DB_HOST, port=settings.DB_PORT, dbname=settings.DB_NAME,
                           user=settings.DB_USER, password=settings.DB_PASSWORD, sslmode=settings.DB_SSLMODE,
                           connect_timeout=10, options=f"-c search_path={settings.DB_SCHEMA},public")


def parse_hora(raw) -> str:
    """HH:MM de Informix -> 'hh:mm a.m./p.m.'."""
    m = re.search(r"(\d{1,2}):(\d{2})", str(raw or "").strip())
    if not m:
        return ""
    h, mn = int(m.group(1)), m.group(2)
    return f"{(h % 12 or 12):02d}:{mn} {'a.m.' if h < 12 else 'p.m.'}"


def hora_ampm_a_datetime(fecha_iso, hora_str):
    if not fecha_iso or not hora_str:
        return None
    m = re.search(r"(\d{1,2}):(\d{2})\s*(a\.m\.|p\.m\.)", hora_str, re.IGNORECASE)
    if not m:
        return None
    h, mn, periodo = int(m.group(1)), int(m.group(2)), m.group(3).lower()
    if periodo == "p.m." and h != 12:
        h += 12
    if periodo == "a.m." and h == 12:
        h = 0
    try:
        return datetime.strptime(fecha_iso, "%Y-%m-%d").replace(hour=h, minute=mn)
    except ValueError:
        return None


def _consultar_informix(fechas: list[str]):
    infx_data, infx_grupos = {}, {}
    for fecha_iso in fechas:
        fecha_infx = f"{fecha_iso[8:10]}/{fecha_iso[5:7]}/{fecha_iso[0:4]}"
        q = f"""
        SELECT saeminv.minv_num_sec, saeminv.minv_cod_empr, saeminv.minv_cod_ocult, saeminv.minv_fmov,
               saedmov.dmov_can_dmov, saeminv.minv_hor_minv,
               (SELECT saeempl.empl_ape_nomb FROM saeempl
                 WHERE saeempl.empl_cod_empl = saeminv.minv_cod_empl
                   AND saeempl.empl_cod_empr = saeminv.minv_cod_empr) registrador
          FROM saedmov, saeminv
         WHERE saeminv.minv_num_comp = saedmov.dmov_num_comp
           AND saeminv.minv_cod_empr = saedmov.dmov_cod_empr
           AND saeminv.minv_cod_sucu = saedmov.dmov_cod_sucu
           AND saeminv.minv_num_prdo = saedmov.dmov_num_prdo
           AND saeminv.minv_cod_ejer = saedmov.dmov_cod_ejer
           AND saeminv.minv_cod_empr IN (182,192,322,332)
           AND saeminv.minv_fmov = TO_DATE('{fecha_infx}', '%d/%m/%Y')
           AND saeminv.minv_cod_tran = 'I05'
           AND saeminv.minv_cod_ocult IS NOT NULL"""
        try:
            rows = ejecutar_query(q)
        except Exception as e:  # noqa: BLE001
            log.error("Error Informix %s: %s", fecha_infx, e)
            continue
        for row in sorted(rows, key=lambda r: r[0]):
            num_sec, cod_empr, ocult, fmov_raw = row[0].strip(), row[1].strip(), row[2].strip(), row[3].strip()
            peso = float(row[4]) if row[4] else 0.0
            hora_ing = parse_hora(row[5]) if len(row) > 5 else ""
            registrador = (row[6] or "").strip() if len(row) > 6 else ""
            fmov_iso = fecha_iso
            for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
                try:
                    fmov_iso = datetime.strptime(fmov_raw[:19], fmt).strftime("%Y-%m-%d")
                    break
                except ValueError:
                    pass
            infx_data[num_sec] = (fmov_iso, hora_ing, registrador)
            infx_grupos.setdefault((ocult, EMPRESA_MAP.get(cod_empr, cod_empr), fecha_iso), []).append(
                (num_sec, peso, hora_ing, registrador))
    return infx_data, infx_grupos


def main(solo_transp_id=None, incluir_activo_abandonado=False) -> dict:
    """solo_transp_id: solo esa ficha (boton 'Sincronizar'), incluida una Activo
    de cualquier edad. incluir_activo_abandonado: en la corrida periodica,
    rescata fichas Activo con productos cargados y mas de 24h de creadas."""
    estados = ["Enviado", "Corregida"] + (["Activo"] if (solo_transp_id or incluir_activo_abandonado) else [])
    filtro_id = "AND t.id_cosecha_transporte = %s" if solo_transp_id else ""
    filtro_edad = "" if solo_transp_id else "AND (t.estado != 'Activo' OR t.fecha_creacion < NOW() - INTERVAL '24 hours')"
    params = (estados,) + ((solo_transp_id,) if solo_transp_id else ())

    with conectar() as conn, conn.cursor() as cur:
        cur.execute(f"""
            SELECT t.id_cosecha_transporte, t.placa, t.propietario, t.fecha_creacion::date,
                   p.id_cosecha, p.orden_cultivo, p.num_ficha, p.lote
            FROM cosecha_transporte t JOIN cosecha p ON p.id_cosecha_transporte = t.id_cosecha_transporte
            WHERE t.estado = ANY(%s) {filtro_id} {filtro_edad}
            ORDER BY t.fecha_creacion, t.id_cosecha_transporte""", params)
        modulo = cur.fetchall()
        if not modulo:
            return {"asignados": 0, "recibidos": 0}
        fechas = sorted({str(r[3]) for r in modulo})
        consulta = sorted({(datetime.strptime(f, "%Y-%m-%d") + timedelta(days=o)).strftime("%Y-%m-%d")
                           for f in fechas for o in OFFSETS})
        infx_data, infx_grupos = _consultar_informix(consulta)

        # PASO 1
        cur.execute("SELECT num_ficha FROM cosecha WHERE num_ficha IS NOT NULL AND num_ficha != ''")
        usados = {r[0] for r in cur.fetchall()}
        grupos = {}
        for r in modulo:
            if not str(r[6] or "").strip():
                grupos.setdefault(((r[5] or "").strip(), (r[2] or "").strip().upper(), str(r[3])), []).append((r[4], r[0]))
        p1 = 0
        for (ocult, empresa, fecha), lista in grupos.items():
            infx = infx_grupos.get((ocult, empresa, fecha), [])
            if not infx:
                f = datetime.strptime(fecha, "%Y-%m-%d")
                for o in OFFSETS[1:]:
                    alt = (ocult, empresa, (f + timedelta(days=o)).strftime("%Y-%m-%d"))
                    if infx_grupos.get(alt):
                        infx = infx_grupos[alt]
                        break
            infx = [e for e in infx if e[0] not in usados]
            for i, (prod_id, t_id) in enumerate(lista):
                if i >= len(infx):
                    break
                num_sec, peso, hora_ing, registrador = infx[i]
                if peso <= 0:          # entregado pero aun sin pesar: se reintenta luego
                    continue
                cur.execute("UPDATE cosecha SET num_ficha = %s, peso = %s WHERE id_cosecha = %s", (num_sec, peso, prod_id))
                usados.add(num_sec)
                cur.execute("""UPDATE cosecha_transporte SET hora_ingreso = COALESCE(NULLIF(%s, ''), hora_ingreso),
                               recibido_por = COALESCE(NULLIF(%s, ''), recibido_por) WHERE id_cosecha_transporte = %s""",
                            (hora_ing, registrador, t_id))
                p1 += 1
        conn.commit()

        # PASO 2
        cur.execute(f"""
            SELECT t.id_cosecha_transporte, t.placa, p.num_ficha, t.hora_ingreso
            FROM cosecha_transporte t JOIN cosecha p ON p.id_cosecha_transporte = t.id_cosecha_transporte
            WHERE t.estado = ANY(%s) {filtro_id} {filtro_edad}
              AND p.num_ficha IS NOT NULL AND p.num_ficha != ''
              AND NOT EXISTS (SELECT 1 FROM cosecha p2 WHERE p2.id_cosecha_transporte = t.id_cosecha_transporte
                              AND (p2.num_ficha IS NULL OR p2.num_ficha = ''))
            ORDER BY t.id_cosecha_transporte""", params)
        p2, hechos = 0, set()
        for t_id, _placa, num_ficha, hora_previa in cur.fetchall():
            num_ficha = (num_ficha or "").strip()
            if t_id in hechos or num_ficha not in infx_data:
                continue
            fmov_iso, hora_ing, registrador = infx_data[num_ficha]
            llegada = hora_ampm_a_datetime(fmov_iso, hora_ing or hora_previa)
            cur.execute("""UPDATE cosecha_transporte SET estado = 'Recibido', fecha_creacion = %s,
                           hora_ingreso = COALESCE(NULLIF(%s, ''), hora_ingreso),
                           recibido_por = COALESCE(NULLIF(%s, ''), recibido_por),
                           fecha_salida = COALESCE(%s, fecha_salida)
                           WHERE id_cosecha_transporte = %s""",
                        (fmov_iso, hora_ing or None, registrador or None,
                         (llegada - timedelta(hours=2)) if llegada else None, t_id))
            hechos.add(t_id)
            p2 += 1
        conn.commit()
    log.info("sync_cosecha: %s asignados, %s recibidos", p1, p2)
    return {"asignados": p1, "recibidos": p2}
