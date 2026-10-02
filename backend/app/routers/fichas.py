"""Fichas de aplicacion fitosanitaria (ver sync/fichas.py).

Flujo en la bitacora (tractor o dron):
  1. Al elegir el lote y la actividad fitosanitaria se muestra la ficha de la
     semana (GET /fichas-aplicacion?ocult=...), con su estado en el ERP.
  2. Aplicacion: antes de Iniciar se registran temperatura y velocidad del
     viento (POST /{id}/iniciar). Una ficha la aplica UN solo equipo.
  3. Al Finalizar se completa numero de bombas y cantidades reales
     (POST /{id}/finalizar): las horas salen de la actividad y todo se escribe
     en agdocul (sin cambiar el estado: CN lo ponen en el ERP).
"""
import logging
from datetime import timedelta
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..auth import Usuario, requiere, sesion_o_kiosko
from ..comun import ahora_ecuador
from ..config import settings
from ..database import get_db
from ..models import FichaAplicacion, Registro
from ..sync import fichas as sync

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/fichas-aplicacion")
_acceso = sesion_o_kiosko()                                  # bitacora tractor / dron y reportes
_gestion = requiere("reportes_actividades", "revisar_actividades")

ESTADOS_ERP = {"PE": "Pendiente de revisión", "AU": "Autorizada", "CN": "Confirmada", "FA": "FA"}
_REFRESCO = timedelta(minutes=15)


def _f(v):
    return float(v) if isinstance(v, Decimal) else v


def _out(f: FichaAplicacion) -> dict:
    return {
        "id": f.id, "ocult": f.ocult, "anio": f.anio, "semana": f.semana, "cod_acamp": f.cod_acamp,
        "actividad": f.actividad, "lote": f.lote, "hacienda": f.hacienda, "proyecto": f.proyecto, "cultivo": f.cultivo,
        "hectareas": _f(f.hectareas), "edad_sem": f.edad_sem, "estado_erp": f.estado_erp,
        "estado_erp_nombre": ESTADOS_ERP.get(f.estado_erp or "", f.estado_erp), "aplicada_en_erp": f.aplicada_en_erp,
        "estado_aplicacion": f.estado_aplicacion, "id_registro": f.id_registro, "equipo": f.equipo, "tractor": f.tractor,
        "bomba": f.bomba, "cod_mapli": f.cod_mapli,
        "metodo": {sync.METODO_DRON: "DRON", sync.METODO_TRACTOR: "ALTO DESPEJE ASPERSIÓN"}.get(f.cod_mapli or 0),
        "temperatura": _f(f.temperatura), "velocidad_viento": _f(f.velocidad_viento), "num_bombas": _f(f.num_bombas),
        "aplicador": f.aplicador, "fecha_aplicacion": f.fecha_aplicacion,
        "hora_inicio": f.hora_inicio.strftime("%H:%M") if f.hora_inicio else None,
        "hora_fin": f.hora_fin.strftime("%H:%M") if f.hora_fin else None,
        "envio_erp": f.envio_erp, "envio_error": f.envio_error, "fecha_envio": f.fecha_envio,
        "fecha_sincronizacion": f.fecha_sincronizacion,
        "productos": [{
            "cod_docul": p.cod_docul, "tipo": p.tipo, "cod_prod": p.cod_prod, "nombre_comercial": p.nombre_comercial,
            "descripcion": p.descripcion, "clasificacion": p.clasificacion, "unidad": p.unidad,
            "cantidad": _f(p.cantidad), "dosis_ha": _f(p.dosis_ha), "carencia": p.carencia, "estado_erp": p.estado_erp,
            "cantidad_salida": _f(p.cantidad_salida), "cantidad_aplicada": _f(p.cantidad_aplicada),
        } for p in f.productos],
    }


def _query():
    return select(FichaAplicacion).where(FichaAplicacion.tenant_id == settings.TENANT_ID,
                                         FichaAplicacion.numero_empresa == settings.NUMERO_EMPRESA)


def _ficha(db: Session, ficha_id: int, bloquear: bool = False) -> FichaAplicacion:
    q = _query().where(FichaAplicacion.id == ficha_id)
    f = db.scalar(q.with_for_update() if bloquear else q)
    if not f:
        raise HTTPException(404, "Ficha de aplicación no encontrada")
    return f


@router.get("")
def listar(ocult: Optional[str] = None, anio: Optional[int] = None, semana: Optional[int] = None,
           id_registro: Optional[int] = None, db: Session = Depends(get_db), _: Usuario = Depends(_acceso)):
    """Por orden de cultivo (bitacora): fichas de la semana pasada, actual y
    siguiente; se refrescan de Informix si la copia tiene mas de 15 min (si la
    VPN esta caida se devuelve la copia). Por semana: listado para el reporte."""
    if id_registro is not None:
        return [_out(f) for f in db.scalars(_query().where(FichaAplicacion.id_registro == id_registro))]
    semanas = [(anio, semana)] if anio and semana else sync.semanas_vigentes()
    filtro_sem = [(FichaAplicacion.anio == a) & (FichaAplicacion.semana == s) for a, s in semanas]
    q = _query().where(or_(*filtro_sem))
    if ocult:
        ocult = ocult.strip()
        if not ocult.isdigit():
            return []
        actuales = list(db.scalars(q.where(FichaAplicacion.ocult == ocult)))
        vieja = not actuales or min(f.fecha_sincronizacion for f in actuales) < ahora_ecuador() - _REFRESCO
        if vieja:
            try:
                sync.sincronizar(db, semanas, ocult)
            except Exception:  # noqa: BLE001  (VPN caida: se usa la copia)
                db.rollback()
                logger.warning("No se pudo refrescar fichas de %s desde Informix", ocult)
        q = q.where(FichaAplicacion.ocult == ocult)
    filas = db.scalars(q.order_by(FichaAplicacion.anio, FichaAplicacion.semana, FichaAplicacion.lote,
                                  FichaAplicacion.cod_acamp))
    return [_out(f) for f in filas]


@router.get("/en-curso")
def en_curso(tractor: Optional[str] = None, db: Session = Depends(get_db), user: Usuario = Depends(_acceso)):
    """Fichas iniciadas y no finalizadas (para retomarlas al recargar la bitacora)."""
    q = _query().where(FichaAplicacion.estado_aplicacion == "EN_CURSO")
    if tractor:
        q = q.where(FichaAplicacion.tractor == tractor)
    return [_out(f) for f in db.scalars(q)]


class IniciarIn(BaseModel):
    equipo: str = "Tractores"
    tractor: str = Field(min_length=1, max_length=150)
    bomba: Optional[str] = Field(None, max_length=150)
    temperatura: float = Field(ge=-10, le=50)
    velocidad_viento: float = Field(ge=0, le=150)
    aplicador: Optional[str] = Field(None, max_length=200)
    id_registro: Optional[int] = None


@router.post("/{ficha_id}/iniciar")
def iniciar(ficha_id: int, body: IniciarIn, db: Session = Depends(get_db), user: Usuario = Depends(_acceso)):
    f = _ficha(db, ficha_id, bloquear=True)
    if f.estado_aplicacion != "PENDIENTE":
        # reintento de la cola offline del mismo equipo: idempotente
        if f.estado_aplicacion == "EN_CURSO" and f.tractor == body.tractor:
            if body.id_registro and not f.id_registro:
                f.id_registro = body.id_registro
                db.commit()
            return _out(f)
        quien = f"{f.tractor or ''} ({f.aplicador or f.usuario_inicio or ''})".strip()
        raise HTTPException(409, f"Esta ficha ya la {'está aplicando' if f.estado_aplicacion == 'EN_CURSO' else 'aplicó'} "
                                 f"{quien}: una ficha la aplica un solo equipo")
    f.estado_aplicacion = "EN_CURSO"
    f.equipo = body.equipo if body.equipo in ("Tractores", "Drones") else "Tractores"
    f.cod_mapli = sync.METODO_DRON if f.equipo == "Drones" else sync.METODO_TRACTOR
    f.tractor, f.bomba = body.tractor, body.bomba
    f.temperatura, f.velocidad_viento = Decimal(str(body.temperatura)), Decimal(str(body.velocidad_viento))
    f.aplicador = (body.aplicador or user.nombre or user.username)[:200]
    f.usuario_inicio = user.username
    f.id_registro = body.id_registro
    db.commit()
    return _out(f)


class ProductoFin(BaseModel):
    cod_docul: int
    cantidad_aplicada: float = Field(ge=0)


class FinalizarIn(BaseModel):
    id_registro: Optional[int] = None
    num_bombas: float = Field(ge=0, le=999)
    productos: List[ProductoFin] = []


@router.post("/{ficha_id}/finalizar")
def finalizar(ficha_id: int, body: FinalizarIn, db: Session = Depends(get_db), user: Usuario = Depends(_acceso)):
    f = _ficha(db, ficha_id, bloquear=True)
    if f.estado_aplicacion == "PENDIENTE":
        raise HTTPException(400, "La aplicación de esta ficha no se ha iniciado")
    if f.estado_aplicacion == "APLICADA" and f.envio_erp == "ENVIADO":
        return _out(f)                                      # reintento: ya quedo
    # Horas: las de la actividad de la bitacora (inicio y fin reales)
    reg = db.get(Registro, body.id_registro or f.id_registro) if (body.id_registro or f.id_registro) else None
    if reg is None:
        reg = db.scalar(select(Registro).where(Registro.tractor == f.tractor, Registro.estado == "Finalizado",
                                               Registro.actividad.ilike("%FITOSANITARI%"))
                        .order_by(Registro.fecha_creacion.desc()))
    if reg is None or reg.estado != "Finalizado":
        raise HTTPException(400, "Primero finalice la actividad en la bitácora")
    inicio, fin = sync.tiempos_registro(list(reg.fecha_historial or []))
    if not inicio or not fin:
        raise HTTPException(400, "La actividad no tiene registrado su inicio y fin")
    f.id_registro = reg.id
    f.fecha_aplicacion = inicio.date()
    f.hora_inicio, f.hora_fin = inicio.time().replace(second=0, microsecond=0), fin.time().replace(second=0, microsecond=0)
    f.num_bombas = Decimal(str(body.num_bombas))
    cant = {p.cod_docul: p.cantidad_aplicada for p in body.productos}
    for pr in f.productos:
        if pr.cod_docul in cant:
            pr.cantidad_aplicada = Decimal(str(cant[pr.cod_docul]))
        elif pr.cantidad_aplicada is None:
            pr.cantidad_aplicada = pr.cantidad_salida or pr.cantidad
    f.estado_aplicacion, f.envio_erp, f.envio_error = "APLICADA", "PENDIENTE", None
    db.commit()
    try:
        sync.enviar_erp(db, f)
    except Exception:  # noqa: BLE001  (queda en ERROR y el scheduler reintenta)
        logger.exception("No se pudo escribir la ficha %s en Informix", f.id)
        db.refresh(f)
    return _out(f)


@router.post("/{ficha_id}/reenviar")
def reenviar(ficha_id: int, db: Session = Depends(get_db), _: Usuario = Depends(_gestion)):
    f = _ficha(db, ficha_id)
    if f.estado_aplicacion != "APLICADA":
        raise HTTPException(400, "La ficha no está aplicada")
    try:
        sync.enviar_erp(db, f)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"No se pudo escribir en Informix: {str(e)[:200]}") from e
    return _out(f)


@router.post("/{ficha_id}/liberar")
def liberar(ficha_id: int, db: Session = Depends(get_db), _: Usuario = Depends(_gestion)):
    """Deshace un inicio por error (ficha EN_CURSO) para que otro equipo la aplique."""
    f = _ficha(db, ficha_id, bloquear=True)
    if f.estado_aplicacion != "EN_CURSO":
        raise HTTPException(400, "Solo se puede liberar una ficha en curso")
    f.estado_aplicacion = "PENDIENTE"
    for campo in ("equipo", "tractor", "bomba", "cod_mapli", "temperatura", "velocidad_viento", "aplicador",
                  "usuario_inicio", "id_registro"):
        setattr(f, campo, None)
    db.commit()
    return _out(f)


class SincronizarIn(BaseModel):
    anio: Optional[int] = None
    semana: Optional[int] = Field(None, ge=1, le=53)


@router.post("/sincronizar")
def sincronizar(body: SincronizarIn, db: Session = Depends(get_db), _: Usuario = Depends(_gestion)):
    semanas = [(body.anio, body.semana)] if body.anio and body.semana else None
    try:
        r = sync.sincronizar(db, semanas)
    except Exception as e:  # noqa: BLE001
        db.rollback()
        raise HTTPException(502, "No se pudo leer Informix (¿VPN caída?)") from e
    r["reenvio"] = sync.reenviar_pendientes(db)
    return r
