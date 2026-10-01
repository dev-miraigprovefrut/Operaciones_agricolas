"""Ordenes de cultivo (lotes) copiadas de Informix."""
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..auth import Usuario, sesion_o_kiosko
from ..database import get_db

router = APIRouter(prefix="/api")
_acceso = sesion_o_kiosko("registrar_cosecha", "reportes_cosecha")

_COLS = """ocult_cod_ocult, ocult_cod_proda, variedad, lote, lote_obs, empresa, hacienda, proyecto, edad_sem,
           dimension, fecha_siembra"""


@router.get("/lotes-infx")
def listar_lotes(db: Session = Depends(get_db), _: Usuario = Depends(_acceso)):
    return [dict(r) for r in db.execute(text(f"""SELECT DISTINCT ON (ocult_cod_ocult) {_COLS} FROM lote_informix
        ORDER BY ocult_cod_ocult, id_lote_informix DESC""")).mappings()]


@router.get("/lotes-infx/buscar")
def buscar_lote(lote: Optional[str] = None, hacienda: Optional[str] = None, ocult: Optional[str] = None,
                cosecha: bool = False, proyecto: Optional[str] = None, db: Session = Depends(get_db),
                _: Usuario = Depends(_acceso)):
    busq = ocult or lote or hacienda or ""
    if not busq:
        return []
    # Solo lotes listos para cosechar: brocoli/coliflor/romanesco desde la
    # semana 11; espinaca/kale desde la 8.
    filtro_semana = r"""
        AND COALESCE(NULLIF(TRIM(edad_sem::text), ''), '0') ~ '^[0-9]+(\.[0-9]+)?$'
        AND CASE
            WHEN UPPER(TRIM(ocult_cod_proda)) LIKE '%BROCOLI%' OR UPPER(TRIM(ocult_cod_proda)) LIKE '%BRÓCOLI%'
              OR UPPER(TRIM(ocult_cod_proda)) LIKE '%COLIFLOR%' OR UPPER(TRIM(ocult_cod_proda)) LIKE '%ROMANESCO%'
                THEN COALESCE(NULLIF(TRIM(edad_sem::text), ''), '0')::numeric >= 11
            ELSE COALESCE(NULLIF(TRIM(edad_sem::text), ''), '0')::numeric >= 8
        END""" if cosecha else ""
    # `proyecto` ya no restringe: el texto buscado tambien compara con el
    # proyecto. Primero los lotes que EMPIEZAN con lo buscado.
    filas = db.execute(text(f"""
        SELECT * FROM (
            SELECT DISTINCT ON (ocult_cod_ocult) id_lote_informix AS id, {_COLS}, anio, semana, fecha_sincronizacion
            FROM lote_informix
            WHERE (ocult_cod_ocult ILIKE :b OR lote ILIKE :b OR hacienda ILIKE :b OR ocult_cod_proda ILIKE :b
                   OR variedad ILIKE :b OR proyecto ILIKE :b) {filtro_semana}
            ORDER BY ocult_cod_ocult, id_lote_informix DESC
        ) sub ORDER BY (CASE WHEN lote ILIKE :bp THEN 0 ELSE 1 END), lote"""),
        {"b": f"%{busq}%", "bp": f"{busq}%"}).mappings()
    return [dict(r) for r in filas]
