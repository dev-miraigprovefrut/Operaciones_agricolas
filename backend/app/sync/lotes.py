"""Sync semanal de ordenes de cultivo (lotes) de Nintanga desde Informix a
lote_informix. Un registro por orden de cultivo, con su variedad. Se corre
viernes y lunes y carga la semana SIGUIENTE (misma logica que antes)."""
import logging
from datetime import datetime

from ..config import settings
from .cosecha_recibido import conectar
from .informix import ejecutar_query

log = logging.getLogger(__name__)


def _variedad(ocult: str) -> str | None:
    ocult = ocult.replace("'", "''")
    try:
        r = ejecutar_query(f"""SELECT FIRST 1 vcospi_cod_prvar FROM v_picospi_vari
            WHERE vcospi_cod_ocult = '{ocult}' AND vcospi_est_cospi = 'VA'
              AND vcospi_tip_cospi NOT IN ('CR','VR','DV')""")
        if r and r[0][0]:
            return r[0][0]
        r = ejecutar_query(f"SELECT FIRST 1 prod_nom_prod FROM v_semilla_saeminv WHERE minv_cod_ocult = '{ocult}'")
        return r[0][0] if r and r[0][0] else None
    except Exception:  # noqa: BLE001
        return None


def main() -> dict:
    hoy = datetime.now()
    semana, anio = hoy.isocalendar()[1] + 1, hoy.year
    empresa = int(settings.NUMERO_EMPRESA)
    rows = ejecutar_query(f"""
SELECT agocult.ocult_cod_ocult, agocult.ocult_cod_proda, agocult.ocult_cod_lotes lote, agocult.ocult_cod_lotes lote_obs,
       saeempr.empr_nom_empr Empresa, aghacda.hacda_nom_hacda Hacienda, agproye.proye_nom_proye Proyecto,
       agscult.scult_cod_scult edad_sem, agocult.ocult_dim_lotes Dimension, agocult.ocult_fec_siemb fecha_siembra,
       agdocul.docul_ani_ccult anio, agdocul.docul_num_sema semana
FROM agdocul, aghacda, agocult, agproda, agproye, agscult, saeempr
WHERE (agproda.proda_cod_proda = agocult.ocult_cod_proda)
  and (agproye.proye_cod_proye = agocult.ocult_cod_proye)
  and (agproye.proye_cod_hacda = agocult.ocult_cod_hacda)
  and (agproye.proye_cod_empr = agocult.ocult_cod_empr)
  and (agproye.proye_cod_hacda = aghacda.hacda_cod_hacda)
  and (agproye.proye_cod_empr = aghacda.hacda_cod_empr)
  and (agscult.scult_cod_scult = agdocul.docul_cod_scult)
  and (saeempr.empr_cod_empr = aghacda.hacda_cod_empr)
  and (agocult.ocult_cod_ocult = agdocul.docul_cod_ocult)
  and (agocult.ocult_cod_empr = agdocul.docul_cod_empr)
  and (agocult.ocult_cod_empr = {empresa})
  and (agocult.ocult_est_ocult = 'EJ')
  and (agdocul.docul_num_sema = {semana})
  and (agdocul.docul_ani_ccult = {anio})""")
    if not rows:
        log.info("sync_lotes: sin datos para la semana %s/%s", semana, anio)
        return {"semana": semana, "anio": anio, "insertados": 0}
    unicos = {}
    for r in rows:
        unicos.setdefault(r[0], r)
    insertados = 0
    with conectar() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM lote_informix WHERE semana = %s AND anio = %s", (semana, anio))
        for ocult, r in unicos.items():
            cur.execute("""INSERT INTO lote_informix (ocult_cod_ocult, ocult_cod_proda, variedad, lote, lote_obs, empresa,
                           hacienda, proyecto, edad_sem, dimension, fecha_siembra, anio, semana)
                           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                        (ocult or None, r[1] or None, _variedad(ocult), r[2] or None, r[3] or None, r[4] or None,
                         r[5] or None, r[6] or None, r[7] or None, float(r[8]) if r[8] else None, r[9] or None,
                         int(r[10]) if r[10] else None, int(r[11]) if r[11] else None))
            insertados += 1
        conn.commit()
    log.info("sync_lotes: semana %s/%s, %s ordenes", semana, anio, insertados)
    return {"semana": semana, "anio": anio, "insertados": insertados}
