"""Registrar actividades de tractores: equipos, horometros, telemetria,
checklists y registros de actividad.

Estos endpoints los usa tambien el kiosko de la Raspberry (sistema aparte):
ver auth.sesion_o_kiosko.
"""
import logging
from datetime import date, datetime, timedelta
from typing import Any, List, Optional

import requests
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ..auth import Usuario, requiere, requiere_admin, sesion_o_kiosko
from ..clients import equipos, notificaciones, servicio
from ..comun import TZ_ECUADOR, ahora_ecuador
from ..config import settings
from ..database import get_db, get_mant_db
from .tablets import tablet_por_llave
from ..models import Actividad, CheckList, Parametro, Registro, RegistroRevision, TractorFalla

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")
_kiosko = sesion_o_kiosko()


def _kiosko_o_tablet(request: Request, db: Session = Depends(get_db)) -> Usuario:
    """Una tablet vinculada (X-Equipo) reporta telemetria aunque no haya un
    tractorista con sesion (el motor puede estar encendido sin nadie logueado)."""
    from .tablets import tablet_por_llave as _tb
    t = _tb(db, request.headers.get("X-Equipo"))
    if t:
        return Usuario(username=f"tablet:{t.id}", tipo="tablet", nombre=f"Tablet {t.tractor}", pestanas=[])
    return _kiosko(request, db)


# ------------------------------------------------------------------ equipos
@router.get("/tractores")
def listar_tractores(_: Usuario = Depends(_kiosko)):
    try:
        return equipos.tractores()
    except Exception as e:  # noqa: BLE001
        logger.exception("DynamoDB tractores")
        raise HTTPException(502, "No se pudo leer el catálogo de tractores") from e


@router.get("/aperos")
def listar_aperos(_: Usuario = Depends(_kiosko)):
    try:
        return equipos.aperos()
    except Exception as e:  # noqa: BLE001
        logger.exception("DynamoDB aperos")
        raise HTTPException(502, "No se pudo leer el catálogo de aperos") from e


@router.get("/drones")
def listar_drones(_: Usuario = Depends(_kiosko)):
    """Drones del maestro de Activos (vacio si Activos no responde)."""
    return equipos.drones()


def _horas(mant: Session | None, tractor_id: str):
    if mant is None:
        return None
    return mant.execute(text("SELECT tractor_id, marca_modelo, horas_actuales, estado FROM ot_equipo_horas "
                             "WHERE tractor_id = :t"), {"t": tractor_id}).fetchone()


@router.get("/equipo-horas/{tractor_id}")
def equipo_horas(tractor_id: str, mant: Session = Depends(get_mant_db), _: Usuario = Depends(_kiosko)):
    row = _horas(mant, tractor_id)
    if not row:
        raise HTTPException(404, f"No se encontraron horas para tractor: {tractor_id}")
    return {"tractor_id": row[0], "marca_modelo": row[1], "horas_actuales": row[2], "estado": row[3]}


# --------------------------------------------------------------- telemetria
# Sesion de horometro "abierta" por tractor (en memoria) para extender la misma
# jornada en el backend de Mantenimiento en vez de crear un registro cada minuto.
_sesiones_horometro: dict[str, dict] = {}


class TelemetriaIn(BaseModel):
    tractor_id: str = ""
    operador: Optional[str] = None
    fecha: Optional[datetime] = None     # hora real del reporte (tablet sin internet)
    horas_delta: float = 0.0
    lat: Optional[float] = None
    lon: Optional[float] = None


def _cabecera_mant() -> dict:
    """Token de servicio del modulo para Mantenimiento (antes iba sin token)."""
    try:
        return {"Authorization": f"Bearer {servicio.token()}"}
    except Exception:  # noqa: BLE001
        logger.warning("Sin token de servicio para Mantenimiento")
        return {}


def _mant(method: str, ruta: str, body=None):
    resp = requests.request(method, f"{settings.MANTENIMIENTO_API_URL.rstrip('/')}{ruta}", json=body, timeout=10,
                            headers=_cabecera_mant())
    if not resp.ok:
        raise HTTPException(resp.status_code, resp.text[:300])
    return resp.json() if resp.content else None


def _id_mantenimiento(tractor: str) -> str:
    """'CASE JX100 - 029' -> 'CASE-JX100-029' (asi lo identifica Mantenimiento)."""
    partes = (tractor or "").split(" - ")
    if len(partes) == 2:
        return f"{partes[0].strip().replace(' ', '-')}-{partes[1].strip()}"
    return (tractor or "").strip()


@router.post("/telemetria")
def telemetria(data: TelemetriaIn, request: Request, db: Session = Depends(get_db),
               user: Usuario = Depends(_kiosko_o_tablet)):
    """Telemetria de los kioskos / tablets: se reenvia al backend de
    Mantenimiento. Una tablet (cabecera X-Equipo) reporta SIEMPRE su tractor."""
    ahora = ahora_ecuador().replace(tzinfo=TZ_ECUADOR)
    tablet = tablet_por_llave(db, request.headers.get("X-Equipo"))
    tractor_id = _id_mantenimiento(tablet.tractor) if tablet else data.tractor_id.strip()
    # Motor encendido sin nadie logueado en la tablet: Mantenimiento exige texto
    data.operador = (data.operador or "").strip() or "Sin operador"
    if data.fecha:                       # reporte que se envia tarde (cola sin internet)
        f = data.fecha.astimezone(TZ_ECUADOR) if data.fecha.tzinfo else data.fecha.replace(tzinfo=TZ_ECUADOR)
        if ahora - timedelta(days=7) <= f <= ahora + timedelta(minutes=5):
            ahora = f
    resultado = {}
    horas_reales = None
    try:
        r = requests.get(f"{settings.MANTENIMIENTO_API_URL.rstrip('/')}/equipo-horas", timeout=10,
                         headers=_cabecera_mant())
        if r.ok:
            for e in r.json():
                if e.get("tractor_id") == tractor_id:
                    horas_reales = e.get("horas_actuales") or 0.0
                    break
    except requests.RequestException as e:
        logger.warning("Mantenimiento no responde: %s", e)

    if data.lat is not None and data.lon is not None:
        try:
            _mant("POST", "/equipo-horas/actualizar-historial", {"tractor_id": tractor_id, "ubicaciones": [{
                "time": ahora.strftime("%H:%M"), "lat": data.lat, "lon": data.lon,
                "horometro": int(horas_reales) if horas_reales is not None else None}]})
        except HTTPException as e:
            resultado["gps_error"] = e.detail
            logger.warning("GPS de %s no se publico en Mantenimiento: %s", tractor_id, e.detail)

    # Solo ubicacion (motor apagado / tablet sin cargar): no se registran horas
    if data.horas_delta <= 0:
        resultado["message"] = "Ubicacion registrada" if "gps_error" not in resultado else "Ubicacion no publicada"
        return resultado

    sesion = _sesiones_horometro.get(tractor_id)
    mismo_dia = sesion and sesion.get("hora_inicio", "")[:10] == ahora.date().isoformat()
    coincide = (not sesion or horas_reales is None
                or abs(horas_reales - sesion.get("horometro_final_anterior", horas_reales)) < 0.01)
    if sesion and sesion.get("operador") == data.operador and mismo_dia and coincide:
        try:
            _mant("POST", "/equipo-horas/eliminar-registro",
                  {"tractor_id": tractor_id, "fecha_registro": sesion["fecha_registro"]})
        except HTTPException:
            pass
        horometro_inicial, hora_inicio = sesion["horometro_inicial"], sesion["hora_inicio"]
    else:
        horometro_inicial = horas_reales or 0.0
        hora_inicio = (ahora - timedelta(hours=data.horas_delta)).isoformat()

    resp = _mant("POST", "/equipo-horas/registrar-actividad", {
        "tractor_id": tractor_id, "operador": data.operador, "horometro_inicial": horometro_inicial,
        "hora_inicio": hora_inicio, "hora_final": ahora.isoformat()})
    _sesiones_horometro[tractor_id] = {
        "operador": data.operador, "horometro_inicial": horometro_inicial, "hora_inicio": hora_inicio,
        "fecha_registro": resp["registro_historial"]["fecha_registro"],
        "horometro_final_anterior": resp.get("horometro_final")}
    resultado.update({"message": "Telemetria registrada", "horas_actuales": resp.get("horometro_final")})
    return resultado


# ------------------------------------------------------------------- checks
class CheckListIn(BaseModel):
    usuario: str
    fecha: str
    tractor: str
    apero: Optional[str] = None
    insp_motor: bool = False
    insp_refrigerante: bool = False
    insp_aceite_motor: bool = False
    insp_aceite_hidraulico: bool = False
    insp_fugas_hidraulico: bool = False
    insp_bomba_hidraulica: bool = False
    insp_transmisiones: bool = False
    insp_indicadores_tablero: bool = False
    insp_neumaticos: bool = False
    insp_frenos: bool = False
    insp_fisuras: bool = False
    insp_fallo_electrico: bool = False
    limp_radiador: bool = False
    limp_motor_filtros: bool = False
    limp_cabina: bool = False
    limp_frenos: bool = False
    lub_articulaciones: bool = False
    lub_pines_bocines: bool = False
    horometro_inicial: Optional[float] = None
    horometro_final: Optional[float] = None
    estado: Optional[str] = None
    ubicacion: Optional[str] = None


class CheckListOut(BaseModel):
    id: int
    usuario: Optional[str] = None
    fecha: Optional[datetime] = None
    tractor: Optional[str] = None
    apero: Optional[str] = None
    insp_motor: bool
    insp_refrigerante: bool
    insp_aceite_motor: bool
    insp_aceite_hidraulico: bool
    insp_fugas_hidraulico: bool
    insp_bomba_hidraulica: bool
    insp_transmisiones: bool
    insp_indicadores_tablero: bool
    insp_neumaticos: bool
    insp_frenos: bool
    insp_fisuras: bool
    insp_fallo_electrico: bool
    limp_radiador: bool
    limp_motor_filtros: bool
    limp_cabina: bool
    limp_frenos: bool
    lub_articulaciones: bool
    lub_pines_bocines: bool
    horometro_inicial: Optional[float] = None
    horometro_final: Optional[float] = None
    estado: Optional[str] = None

    class Config:
        from_attributes = True


_CAMPOS_CHECK = [c for c in CheckListIn.model_fields if c.startswith(("insp_", "limp_", "lub_"))]

# Si se MARCA = se reporto el problema
_FALLAS = {
    "insp_motor": "Motor (sonidos, vibracion, fugas, banda)",
    "insp_fugas_hidraulico": "Fugas en sistema hidraulico",
    "insp_bomba_hidraulica": "Bomba hidraulica (fugas, sonidos, vibracion)",
    "insp_transmisiones": "Transmisiones (fugas, sonidos, vibraciones)",
    "insp_indicadores_tablero": "Indicadores en el tablero",
    "insp_neumaticos": "Danos en neumaticos (desgaste, presion)",
    "insp_frenos": "Reporte de danos en frenos",
    "insp_fisuras": "Presencia de fisuras en estructura",
    "insp_refrigerante": "Bajo nivel de refrigerante de motor",
    "insp_aceite_motor": "Bajo nivel de aceite de motor",
    "insp_aceite_hidraulico": "Bajo nivel de aceite hidraulico",
    "insp_fallo_electrico": "Fallo electrico",
}


@router.get("/checks", response_model=List[CheckListOut])
def listar_checks(db: Session = Depends(get_db), _: Usuario = Depends(_kiosko)):
    return list(db.scalars(select(CheckList).order_by(CheckList.fecha.desc())))


@router.post("/checks", response_model=CheckListOut)
def crear_check(check: CheckListIn, db: Session = Depends(get_db), mant: Session = Depends(get_mant_db),
                user: Usuario = Depends(_kiosko)):
    # El tractor llega como "MARCA MODELO - NUM" (ej. "CASE JX100 - 029"); en
    # Mantenimiento/DynamoDB se identifica como "CASE-JX100-029".
    horometro = check.horometro_inicial
    try:
        partes = (check.tractor or "").split(" - ")
        if len(partes) == 2:
            tractor_id = f"{partes[0].strip().replace(' ', '-')}-{partes[1].strip()}"
            row = _horas(mant, tractor_id)
            if row and row[2] is not None:
                horometro = float(row[2])
            if horometro is not None:
                try:
                    equipos.actualizar_horometro(f"TRACTOR#{tractor_id}", horometro)
                except Exception as e:  # noqa: BLE001
                    logger.warning("No se pudo actualizar DynamoDB: %s", e)
    except Exception as e:  # noqa: BLE001
        logger.warning("Error consultando ot_equipo_horas: %s", e)

    if check.estado == "Activo":
        db.query(CheckList).filter(CheckList.tractor == check.tractor, CheckList.estado == "Activo") \
            .update({"estado": "Inactivo"})
    check.usuario = _operador(user, check.usuario)
    nuevo = CheckList(usuario=check.usuario, fecha=ahora_ecuador(), tractor=check.tractor, apero=check.apero,
                      horometro_inicial=horometro, estado=check.estado, id_tractorista=user.id_tractorista,
                      **{c: getattr(check, c) for c in _CAMPOS_CHECK})
    db.add(nuevo)
    db.commit()
    db.refresh(nuevo)

    fallas = [nombre for campo, nombre in _FALLAS.items() if getattr(check, campo)]
    if fallas:
        try:
            db.add(TractorFalla(id_check=nuevo.id, id_tractorista=user.id_tractorista,
                                usuario=check.usuario or "Operador", tractor=check.tractor,
                                detalle=", ".join(fallas), ubicacion=check.ubicacion, estado="pendiente"))
            db.commit()
        except Exception:  # noqa: BLE001
            db.rollback()
            logger.exception("Error registrando falla del check %s", nuevo.id)
        else:
            corto = ", ".join(fallas[:3]) + (f" (+{len(fallas) - 3} mas)" if len(fallas) > 3 else "")
            notificaciones.notificar_en_segundo_plano(
                settings.aviso_fallas, f"Falla detectada - {check.tractor}",
                f"Operador {check.usuario or 'N/A'} reporto: {corto}",
                metadata={"tractor": check.tractor, "fallas": fallas})
    return nuevo


@router.put("/checks/desactivar-tractor/{tractor}")
def desactivar_checks_tractor(tractor: str, body: Optional[dict] = None, db: Session = Depends(get_db),
                              _: Usuario = Depends(_kiosko)):
    horometro_final = (body or {}).get("horometro_final")
    for c in db.scalars(select(CheckList).where(CheckList.tractor == tractor, CheckList.estado == "Activo")):
        c.estado = "Desactivado"
        if horometro_final is not None:
            c.horometro_final = horometro_final
    db.commit()
    return {"message": "Checks desactivados"}


@router.put("/checks/{check_id}")
def desactivar_check(check_id: int, db: Session = Depends(get_db), _: Usuario = Depends(_kiosko)):
    c = db.get(CheckList, check_id)
    if not c:
        raise HTTPException(404, "Check no encontrado")
    c.estado = "Desactivado"
    db.commit()
    return {"message": "Check desactivado"}


# ---------------------------------------------------------------- registros
class RegistroIn(BaseModel):
    actividad: str
    subactividad: Optional[str] = None
    tractor: Optional[str] = None
    apero: Optional[str] = None
    lote: Optional[str] = None
    hacienda: Optional[str] = None
    orden_cultivo: Optional[str] = None
    tipo: Optional[str] = None
    usuario: Optional[str] = None
    ubicacion: Optional[str] = None
    id_check: Optional[int] = None
    estado: str = "Pendiente"
    equipo: str = "Tractores"          # Tractores | Drones (Bitacora Tractor / Bitacora Dron)
    # Trabajo SIN INTERNET: el celular genera el id (cliente_id) y manda la hora
    # real de la accion (fecha); la cola offline lo envia despues.
    cliente_id: Optional[str] = Field(None, max_length=40)
    fecha: Optional[datetime] = None


class RegistroUpdate(BaseModel):
    actividad: Optional[str] = None
    subactividad: Optional[str] = None
    tractor: Optional[str] = None
    apero: Optional[str] = None
    lote: Optional[str] = None
    hacienda: Optional[str] = None
    orden_cultivo: Optional[str] = None
    tipo: Optional[str] = None
    usuario: Optional[str] = None
    ubicacion: Optional[str] = None
    estado: Optional[str] = None
    fecha_fin: Optional[datetime] = None
    tiempo_inicio: Optional[datetime] = None
    fecha_historial: Optional[List[Any]] = None
    tiempo_paro: Optional[float] = None
    tiempo_real: Optional[float] = None
    fecha: Optional[datetime] = None     # hora real de la accion (cola offline)


class RegistroOut(BaseModel):
    id: int
    fecha_creacion: datetime
    fecha_fin: Optional[datetime] = None
    tiempo_inicio: Optional[datetime] = None
    fecha_historial: List[Any] = []
    actividad: str
    subactividad: Optional[str] = None
    tractor: Optional[str] = None
    apero: Optional[str] = None
    lote: Optional[str] = None
    hacienda: Optional[str] = None
    orden_cultivo: Optional[str] = None
    tipo: Optional[str] = None
    usuario: Optional[str] = None
    ubicacion: Optional[str] = None
    id_check: Optional[int] = None
    tiempo_paro: float = 0.0
    tiempo_real: float = 0.0
    estado: str
    equipo: str = "Tractores"
    cliente_id: Optional[str] = None
    revision_estado: str = "NO_REVISADO"
    revisado_por: Optional[str] = None
    revisado_por_nombre: Optional[str] = None
    fecha_revision: Optional[datetime] = None

    class Config:
        from_attributes = True


def _fecha_evento(fecha: datetime | None, minimo: datetime | None = None) -> datetime:
    """Hora de una accion: la que manda el celular (hecha sin internet y enviada
    despues por la cola) o la del servidor. Se acota: no en el futuro, no mas de
    30 dias atras y nunca antes del evento anterior."""
    ahora = ahora_ecuador()
    f = ahora
    if fecha is not None:
        f = fecha.astimezone(TZ_ECUADOR).replace(tzinfo=None) if fecha.tzinfo else fecha
        if f > ahora + timedelta(minutes=5) or f < ahora - timedelta(days=30):
            f = ahora
    if minimo is not None and f < minimo:
        f = minimo
    return f.replace(microsecond=0)


def _no_revisado(r: Registro) -> None:
    """Un registro REVISADO (horas aprobadas) queda bloqueado para cambios."""
    if r.revision_estado == "REVISADO":
        quien = r.revisado_por_nombre or r.revisado_por or "un supervisor"
        cuando = r.fecha_revision.strftime("%d/%m/%Y %H:%M") if r.fecha_revision else ""
        raise HTTPException(409, f"Actividad ya revisada por {quien} {cuando}: no se puede modificar".strip())


def _gestor(user: Usuario) -> bool:
    """Revisa/corrige actividades de todos (admins del modulo y revisores)."""
    return user.tipo == "kiosko" or (not user.es_tractorista and user.puede("revisar_actividades"))


def _operador(user: Usuario, pedido: str | None) -> str | None:
    """Nombre del operador: el de la SESION (antes lo ponia el cliente). Los
    gestores pueden registrar a nombre de otro operador; el kiosko anonimo manda
    el suyo."""
    if _gestor(user):
        return pedido
    return user.nombre or pedido


def _es_mio(user: Usuario, r: Registro) -> bool:
    if _gestor(user):
        return True
    if user.es_tractorista and r.id_tractorista:
        return r.id_tractorista == user.id_tractorista
    return (r.usuario or "").strip().lower() == (user.nombre or "").strip().lower()


def _solo_mio(user: Usuario, r: Registro) -> None:
    if not _es_mio(user, r):
        raise HTTPException(403, "Solo puede modificar sus propias actividades")


ESTADOS_REGISTRO = {"Pendiente", "Ejecutándose", "Pausado", "Finalizado", "Eliminado"}
EQUIPOS = {"Tractores", "Drones"}


@router.get("/registros", response_model=List[RegistroOut])
def listar_registros(id_check: Optional[int] = None, db: Session = Depends(get_db), _: Usuario = Depends(_kiosko)):
    q = select(Registro).where(Registro.estado != "Eliminado")
    if id_check is not None:
        q = q.where(Registro.id_check == id_check)
    return list(db.scalars(q.order_by(Registro.fecha_creacion.desc())))


@router.get("/registros/{registro_id}", response_model=RegistroOut)
def ver_registro(registro_id: int, db: Session = Depends(get_db), _: Usuario = Depends(_kiosko)):
    r = db.get(Registro, registro_id)
    if not r:
        raise HTTPException(404, "Registro no encontrado")
    return r


@router.post("/registros", response_model=RegistroOut)
def crear_registro(registro: RegistroIn, db: Session = Depends(get_db), user: Usuario = Depends(_kiosko)):
    if registro.estado not in ESTADOS_REGISTRO:
        raise HTTPException(400, f"Estado inválido: {registro.estado}")
    if registro.equipo not in EQUIPOS:
        raise HTTPException(400, f"Equipo inválido: {registro.equipo}")
    registro.usuario = _operador(user, registro.usuario)
    if registro.cliente_id:
        # Reintento de la cola offline: el mismo registro ya llego
        existente = db.scalar(select(Registro).where(Registro.cliente_id == registro.cliente_id))
        if existente:
            return existente
    # Evitar duplicados por reintentos de la cola offline / doble clic (registros sin cliente_id).
    if registro.estado == "Ejecutándose" and registro.usuario and not registro.cliente_id:
        existente = db.scalar(select(Registro).where(Registro.usuario == registro.usuario,
                                                     Registro.equipo == registro.equipo,
                                                     Registro.estado == "Ejecutándose")
                              .order_by(Registro.fecha_creacion.desc()))
        if existente:
            return existente
    if registro.estado == "Pendiente" and registro.usuario and not registro.cliente_id:
        hoy = ahora_ecuador().replace(hour=0, minute=0, second=0, microsecond=0)
        dup = db.scalar(select(Registro).where(
            Registro.usuario == registro.usuario, Registro.tractor == registro.tractor, Registro.equipo == registro.equipo,
            Registro.actividad == registro.actividad, Registro.subactividad == registro.subactividad,
            Registro.orden_cultivo == registro.orden_cultivo, Registro.apero == registro.apero,
            Registro.estado.in_(["Pendiente", "Ejecutándose", "Pausado"]), Registro.fecha_creacion >= hoy)
            .order_by(Registro.fecha_creacion.desc()))
        if dup:
            return dup

    ahora = _fecha_evento(registro.fecha)
    historial = ([{"accion": "inicio", "fecha": ahora.isoformat(), "ubicacion": registro.ubicacion}]
                 if registro.estado == "Ejecutándose" else [])
    id_check = registro.id_check
    if not id_check and registro.tractor and registro.equipo == "Tractores":   # el checklist es de tractores
        activo = db.scalar(select(CheckList).where(CheckList.tractor == registro.tractor, CheckList.estado == "Activo"))
        if activo:
            id_check = activo.id
    act = db.scalar(select(Actividad).where(Actividad.actividad == registro.actividad,
                                            Actividad.equipo == registro.equipo)) if registro.actividad else None
    nuevo = Registro(
        fecha_creacion=ahora, tiempo_inicio=ahora if registro.estado == "Ejecutándose" else None,
        actividad=registro.actividad, subactividad=registro.subactividad, tractor=registro.tractor,
        apero=registro.apero, lote=registro.lote, hacienda=registro.hacienda, orden_cultivo=registro.orden_cultivo,
        tipo=registro.tipo, usuario=registro.usuario, ubicacion=registro.ubicacion, id_check=id_check,
        id_actividad=act.id if act else None, id_tractorista=user.id_tractorista,
        estado=registro.estado, equipo=registro.equipo, cliente_id=registro.cliente_id,
        fecha_historial=historial, tiempo_paro=0.0, tiempo_real=0.0)
    db.add(nuevo)
    if act:
        act.cantidad = (act.cantidad or 0) + 1
    try:
        db.commit()
    except IntegrityError:          # dos envios del mismo cliente_id a la vez
        db.rollback()
        existente = db.scalar(select(Registro).where(Registro.cliente_id == registro.cliente_id))
        if existente:
            return existente
        raise
    db.refresh(nuevo)
    return nuevo


def _calcular_tiempos(historial: list[dict]) -> tuple[float, float]:
    """(tiempo_paro, tiempo_real) en minutos a partir del historial de eventos."""
    tiempo_paro = tiempo_real = 0.0
    ultimo_inicio = ultima_pausa = None
    for ev in historial:
        f = datetime.fromisoformat(ev["fecha"])
        if ev["accion"] in ("inicio", "reanudado"):
            ultimo_inicio = f
        elif ev["accion"] == "pausado":
            if ultimo_inicio:
                tiempo_real += (f - ultimo_inicio).total_seconds() / 60.0
            ultima_pausa, ultimo_inicio = f, None
        elif ev["accion"] == "finalizado":
            if ultimo_inicio:
                tiempo_real += (f - ultimo_inicio).total_seconds() / 60.0
            if ultima_pausa and ultimo_inicio is None:
                tiempo_paro += (f - ultima_pausa).total_seconds() / 60.0
    for i, ev in enumerate(historial):            # pausas intermedias
        if ev["accion"] == "pausado":
            for sig in historial[i + 1:]:
                if sig["accion"] in ("reanudado", "finalizado"):
                    if sig["accion"] == "reanudado":
                        tiempo_paro += (datetime.fromisoformat(sig["fecha"])
                                        - datetime.fromisoformat(ev["fecha"])).total_seconds() / 60.0
                    break
    return round(tiempo_paro, 2), round(tiempo_real, 2)


@router.put("/registros/{registro_id}", response_model=RegistroOut)
def editar_registro(registro_id: int, registro: RegistroUpdate, db: Session = Depends(get_db),
                    user: Usuario = Depends(_kiosko)):
    r = db.get(Registro, registro_id)
    if not r:
        raise HTTPException(404, "Registro no encontrado")
    _solo_mio(user, r)
    return _editar(db, r, registro, user)


@router.put("/registros/cliente/{cliente_id}", response_model=RegistroOut)
def editar_registro_cliente(cliente_id: str, registro: RegistroUpdate, db: Session = Depends(get_db),
                            user: Usuario = Depends(_kiosko)):
    """Igual que PUT /registros/{id} pero con el id que genero el celular (el
    registro pudo crearse sin internet y aun no conocer su id del servidor)."""
    r = db.scalar(select(Registro).where(Registro.cliente_id == cliente_id))
    if not r:
        raise HTTPException(404, "Registro no encontrado")
    _solo_mio(user, r)
    return _editar(db, r, registro, user)


def _editar(db: Session, r: Registro, registro: RegistroUpdate, user: Usuario) -> Registro:
    if registro.usuario is not None:
        registro.usuario = _operador(user, registro.usuario)
    if registro.estado is not None and registro.estado not in ESTADOS_REGISTRO:
        raise HTTPException(400, f"Estado inválido: {registro.estado}")
    # Idempotencia: reintento de la cola offline de un cambio ya aplicado.
    if registro.estado is not None and registro.estado == r.estado:
        return r
    # Una accion atrasada de la cola offline no reabre una actividad ya finalizada
    if r.estado == "Finalizado" and registro.estado is not None and registro.estado != "Finalizado":
        return r
    _no_revisado(r)

    historial = list(r.fecha_historial or [])
    ultimo =datetime.fromisoformat(historial[-1]["fecha"]) if historial else None
    ahora = _fecha_evento(registro.fecha, ultimo)
    if registro.estado is not None:
        ub = registro.ubicacion
        if registro.estado == "Pausado":
            historial.append({"accion": "pausado", "fecha": ahora.isoformat(), "ubicacion": ub})
        elif registro.estado == "Ejecutándose":
            if r.estado == "Pendiente":
                historial.append({"accion": "inicio", "fecha": ahora.isoformat(), "ubicacion": ub})
                r.tiempo_inicio = ahora
            else:
                historial.append({"accion": "reanudado", "fecha": ahora.isoformat(), "ubicacion": ub})
        elif registro.estado == "Finalizado":
            historial.append({"accion": "finalizado", "fecha": ahora.isoformat(), "ubicacion": ub})
            r.fecha_fin = ahora
            r.tiempo_paro, r.tiempo_real = _calcular_tiempos(historial)
        r.estado = registro.estado
        r.fecha_historial = historial
        flag_modified(r, "fecha_historial")

    for campo in ("actividad", "subactividad", "tractor", "apero", "lote", "hacienda", "orden_cultivo", "tipo",
                  "usuario", "ubicacion"):
        valor = getattr(registro, campo)
        if valor is not None:
            setattr(r, campo, valor)
    db.commit()
    db.refresh(r)
    return r


@router.delete("/registros/cliente/{cliente_id}")
def eliminar_registro_cliente(cliente_id: str, db: Session = Depends(get_db), user: Usuario = Depends(_kiosko)):
    r = db.scalar(select(Registro).where(Registro.cliente_id == cliente_id))
    if not r:
        raise HTTPException(404, "Registro no encontrado")
    return eliminar_registro(r.id, db, user)


@router.delete("/registros/{registro_id}")
def eliminar_registro(registro_id: int, db: Session = Depends(get_db), user: Usuario = Depends(_kiosko)):
    r = db.get(Registro, registro_id)
    if not r:
        raise HTTPException(404, "Registro no encontrado")
    _solo_mio(user, r)
    if r.estado == "Eliminado":         # reintento de la cola offline
        return {"message": "Registro eliminado"}
    _no_revisado(r)
    r.estado = "Eliminado"           # borrado logico
    db.commit()
    return {"message": "Registro eliminado"}


# --------------------------------------------------- revision de horas
class RevisionIn(BaseModel):
    inicio: Optional[datetime] = None     # hora local (Ecuador), como se guarda
    fin: Optional[datetime] = None


def _primera(historial: list[dict], accion: str) -> int | None:
    return next((i for i, e in enumerate(historial) if e.get("accion") == accion), None)


def _ultima(historial: list[dict], accion: str) -> int | None:
    return next((i for i in range(len(historial) - 1, -1, -1) if historial[i].get("accion") == accion), None)


def _revisar(db: Session, registro_id: int, inicio: datetime | None, fin: datetime | None,
             user: Usuario) -> Registro:
    """Revisa (aprueba) las horas de una actividad FINALIZADA: corrige inicio y
    fin si vienen, recalcula los tiempos, la deja REVISADA y BLOQUEADA y guarda
    quien y que cambio. No hace commit. Lanza HTTPException si no se puede."""
    r = db.query(Registro).filter(Registro.id == registro_id).with_for_update().first()
    if not r:
        raise HTTPException(404, "Registro no encontrado")
    _no_revisado(r)
    if r.estado != "Finalizado":
        raise HTTPException(400, "Solo se pueden revisar actividades finalizadas")
    historial = [dict(e) for e in (r.fecha_historial or [])]
    i_ini, i_fin = _primera(historial, "inicio"), _ultima(historial, "finalizado")
    if i_ini is None or i_fin is None:
        raise HTTPException(400, "La actividad no tiene registrado su inicio y fin")

    cambios: dict = {}
    antes = {"inicio": historial[i_ini]["fecha"], "fin": historial[i_fin]["fecha"],
             "tiempo_real": r.tiempo_real, "tiempo_paro": r.tiempo_paro}
    for campo, idx, nuevo in (("inicio", i_ini, inicio), ("fin", i_fin, fin)):
        if nuevo is None:
            continue
        nuevo = nuevo.replace(tzinfo=None, microsecond=0)
        if datetime.fromisoformat(historial[idx]["fecha"]).replace(microsecond=0) != nuevo:
            historial[idx]["fecha"] = nuevo.isoformat()
            cambios[campo] = [antes[campo], nuevo.isoformat()]

    if cambios:
        fechas = [datetime.fromisoformat(e["fecha"]) for e in historial]
        if any(b < a for a, b in zip(fechas, fechas[1:])):
            raise HTTPException(400, "Las horas no son coherentes: el inicio debe ser anterior a las pausas "
                                     "y el fin posterior a la última pausa/reanudación")
        if fechas[i_fin] <= fechas[i_ini]:
            raise HTTPException(400, "El fin debe ser posterior al inicio")
        r.tiempo_paro, r.tiempo_real = _calcular_tiempos(historial)
        r.tiempo_inicio, r.fecha_fin = fechas[i_ini], fechas[i_fin]
        if fechas[i_ini].date() != r.fecha_creacion.date():
            # la actividad se cambio de dia: el reporte la agrupa por fecha_creacion
            cambios["fecha"] = [r.fecha_creacion.isoformat(), fechas[i_ini].isoformat()]
            r.fecha_creacion = fechas[i_ini]
        cambios["tiempo_real"] = [antes["tiempo_real"], r.tiempo_real]
        cambios["tiempo_paro"] = [antes["tiempo_paro"], r.tiempo_paro]
        r.fecha_historial = historial
        flag_modified(r, "fecha_historial")

    ahora = ahora_ecuador()
    r.revision_estado, r.revisado_por, r.revisado_por_nombre, r.fecha_revision = (
        "REVISADO", user.username, user.nombre, ahora)
    db.add(RegistroRevision(id_registro=r.id, accion="REVISADO", usuario=user.username,
                            usuario_nombre=user.nombre, cambios=cambios, fecha=ahora))
    return r


@router.post("/registros/{registro_id}/revisar", response_model=RegistroOut)
def revisar_registro(registro_id: int, body: RevisionIn, db: Session = Depends(get_db),
                     user: Usuario = Depends(requiere("revisar_actividades"))):
    r = _revisar(db, registro_id, body.inicio, body.fin, user)
    db.commit()
    db.refresh(r)
    return r


class RevisionItem(RevisionIn):
    id: int


class RevisionLoteIn(BaseModel):
    items: List[RevisionItem]


@router.post("/registros/revisar-lote")
def revisar_lote(body: RevisionLoteIn, db: Session = Depends(get_db),
                 user: Usuario = Depends(requiere("revisar_actividades"))):
    """Revisa varias actividades de una vez (check + Guardar del reporte). Cada
    una se procesa por separado: si alguna no se puede (horas incoherentes, ya
    revisada...), las demas igual se guardan y se informa cual fallo."""
    if not body.items:
        raise HTTPException(400, "No hay actividades para revisar")
    if len(body.items) > 500:
        raise HTTPException(400, "Máximo 500 actividades por vez")
    revisados, errores = [], []
    for it in body.items:
        sp = db.begin_nested()
        try:
            r = _revisar(db, it.id, it.inicio, it.fin, user)
            sp.commit()
            revisados.append(r)
        except HTTPException as e:
            sp.rollback()
            errores.append({"id": it.id, "detalle": e.detail})
    db.commit()
    for r in revisados:
        db.refresh(r)
    return {"revisados": [RegistroOut.model_validate(r).model_dump(mode="json") for r in revisados],
            "errores": errores}


# ------------------------------------- agregar / eliminar desde el reporte
# Quien revisa las horas puede AGREGAR una actividad que el tractorista no
# registro y ELIMINAR una mal registrada, mientras NO este revisada. Queda en
# registro_revision quien lo hizo (AGREGADO / ELIMINADO).
class RegistroManualIn(BaseModel):
    usuario: str = Field(min_length=1, max_length=150)
    actividad: str = Field(min_length=1, max_length=250)
    subactividad: Optional[str] = Field(None, max_length=250)
    tipo: Optional[str] = Field(None, max_length=50)
    tractor: Optional[str] = Field(None, max_length=150)
    lote: Optional[str] = Field(None, max_length=100)
    hacienda: Optional[str] = Field(None, max_length=150)
    inicio: datetime          # hora local (Ecuador), como se guarda
    fin: datetime
    motivo: Optional[str] = Field(None, max_length=300)
    equipo: str = "Tractores"


@router.post("/registros/manual", response_model=RegistroOut)
def agregar_registro_manual(body: RegistroManualIn, db: Session = Depends(get_db),
                            user: Usuario = Depends(requiere("revisar_actividades"))):
    if body.equipo not in EQUIPOS:
        raise HTTPException(400, f"Equipo inválido: {body.equipo}")
    inicio = body.inicio.replace(tzinfo=None, microsecond=0)
    fin = body.fin.replace(tzinfo=None, microsecond=0)
    if fin <= inicio:
        raise HTTPException(400, "La hora de fin debe ser posterior a la de inicio")
    if fin - inicio > timedelta(hours=48):
        raise HTTPException(400, "Una actividad no puede durar más de 48 horas")
    if fin > ahora_ecuador().replace(tzinfo=None) + timedelta(minutes=5):
        raise HTTPException(400, "No se pueden agregar actividades en el futuro")
    marca = {"manual": True, "por": user.username}
    historial = [{"accion": "inicio", "fecha": inicio.isoformat(), "ubicacion": "Agregada en el reporte", **marca},
                 {"accion": "finalizado", "fecha": fin.isoformat(), "ubicacion": "Agregada en el reporte", **marca}]
    tiempo_paro, tiempo_real = _calcular_tiempos(historial)
    act = db.scalar(select(Actividad).where(Actividad.actividad == body.actividad, Actividad.equipo == body.equipo))
    # mismo tractorista que sus otros registros (usuario = nombre del operador)
    previo = db.scalar(select(Registro).where(Registro.usuario == body.usuario, Registro.id_tractorista.is_not(None))
                       .order_by(Registro.fecha_creacion.desc()))
    r = Registro(
        fecha_creacion=inicio, tiempo_inicio=inicio, fecha_fin=fin, fecha_historial=historial,
        actividad=body.actividad, subactividad=body.subactividad, tipo=body.tipo or (act.tipo if act else None),
        tractor=body.tractor, lote=body.lote, hacienda=body.hacienda, usuario=body.usuario,
        ubicacion="Agregada en el reporte", id_actividad=act.id if act else None,
        id_tractorista=previo.id_tractorista if previo else None,
        estado="Finalizado", equipo=body.equipo, tiempo_paro=tiempo_paro, tiempo_real=tiempo_real)
    db.add(r)
    db.flush()
    db.add(RegistroRevision(id_registro=r.id, accion="AGREGADO", usuario=user.username, usuario_nombre=user.nombre,
                            cambios={"inicio": inicio.isoformat(), "fin": fin.isoformat(), "motivo": body.motivo},
                            fecha=ahora_ecuador()))
    db.commit()
    db.refresh(r)
    return r


class EliminarIn(BaseModel):
    motivo: Optional[str] = Field(None, max_length=300)


@router.post("/registros/{registro_id}/eliminar")
def eliminar_desde_reporte(registro_id: int, body: EliminarIn, db: Session = Depends(get_db),
                           user: Usuario = Depends(requiere("revisar_actividades"))):
    r = db.query(Registro).filter(Registro.id == registro_id).with_for_update().first()
    if not r or r.estado == "Eliminado":
        raise HTTPException(404, "Registro no encontrado")
    _no_revisado(r)
    if r.estado == "Ejecutándose":
        raise HTTPException(400, "La actividad está en curso: el tractorista debe finalizarla antes de eliminarla")
    db.add(RegistroRevision(id_registro=r.id, accion="ELIMINADO", usuario=user.username, usuario_nombre=user.nombre,
                            cambios={"estado": [r.estado, "Eliminado"], "actividad": r.actividad,
                                     "subactividad": r.subactividad, "motivo": body.motivo},
                            fecha=ahora_ecuador()))
    r.estado = "Eliminado"           # borrado logico
    db.commit()
    return {"id": r.id, "message": "Actividad eliminada"}


@router.get("/registros/{registro_id}/revisiones")
def historial_revision(registro_id: int, db: Session = Depends(get_db),
                       _: Usuario = Depends(requiere("revisar_actividades", "reportes_actividades"))):
    """Quien reviso la actividad y que cambio."""
    filas = db.scalars(select(RegistroRevision).where(RegistroRevision.id_registro == registro_id)
                       .order_by(RegistroRevision.fecha))
    return [{"accion": f.accion, "usuario": f.usuario, "usuario_nombre": f.usuario_nombre,
             "cambios": f.cambios, "fecha": f.fecha} for f in filas]


# ------------------------------------------------- parametros de jornada (horas)
# Los usa el reporte de actividades (frontend utils/jornadas.js) para clasificar
# las horas de cada jornada: turno de dia (normales) o de noche (recargo 25%),
# al 50% fuera del horario de su turno y al 100% sabado, domingo y feriados.
JORNADA_DEFECTO = {
    "hora_normal_inicio": "07:00",
    "hora_normal_fin": "16:00",
    "hora_nocturna_inicio": "19:00",   # turno de noche: recargo del 25%
    "hora_nocturna_fin": "06:00",
    "almuerzo_min": 60,               # se descuenta si NO registro RECESOS Y ALIMENTACION
    "separacion_jornada_min": 240,   # mas de 4 h sin actividad -> otra jornada
    "feriados": [{"fecha": f, "nombre": n} for f, n in (
        ("2026-01-01", "Año Nuevo"), ("2026-02-16", "Carnaval"), ("2026-02-17", "Carnaval"),
        ("2026-04-03", "Viernes Santo"), ("2026-05-01", "Día del Trabajo"), ("2026-05-25", "Batalla de Pichincha"),
        ("2026-08-10", "Primer Grito de Independencia"), ("2026-10-09", "Independencia de Guayaquil"),
        ("2026-11-02", "Día de Difuntos"), ("2026-11-03", "Independencia de Cuenca"), ("2026-12-25", "Navidad"))],
}


class FeriadoIn(BaseModel):
    fecha: date
    nombre: str = Field("", max_length=100)


class JornadaIn(BaseModel):
    hora_normal_inicio: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    hora_normal_fin: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    hora_nocturna_inicio: str = Field("19:00", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    hora_nocturna_fin: str = Field("06:00", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    almuerzo_min: int = Field(ge=0, le=240)
    separacion_jornada_min: int = Field(ge=30, le=1440)
    feriados: List[FeriadoIn] = []


def _parametro(db: Session, clave: str) -> Parametro | None:
    """None si no esta guardado o si la tabla todavia no existe (sql/01_schema.sql)."""
    try:
        return db.scalar(select(Parametro).where(Parametro.clave == clave,
                                                 Parametro.tenant_id == settings.TENANT_ID,
                                                 Parametro.numero_empresa == settings.NUMERO_EMPRESA))
    except ProgrammingError:
        db.rollback()
        logger.warning("Falta la tabla parametro: se usan los valores por defecto")
        return None


def _jornada_out(p: Parametro | None) -> dict:
    return {**JORNADA_DEFECTO, **((p.valor if p else None) or {}),
            "actualizado_por": p.actualizado_por if p else None,
            "fecha_actualizacion": p.fecha_actualizacion if p else None}


@router.get("/parametros/jornada")
def ver_parametros_jornada(db: Session = Depends(get_db),
                           _: Usuario = Depends(requiere("reportes_actividades", "revisar_actividades"))):
    return _jornada_out(_parametro(db, "jornada"))


@router.put("/parametros/jornada")
def guardar_parametros_jornada(body: JornadaIn, db: Session = Depends(get_db),
                               user: Usuario = Depends(requiere_admin)):
    if body.hora_normal_fin <= body.hora_normal_inicio:
        raise HTTPException(400, "La hora de fin del horario normal debe ser posterior a la de inicio")
    if body.hora_nocturna_fin == body.hora_nocturna_inicio:
        raise HTTPException(400, "El horario nocturno no puede empezar y terminar a la misma hora")
    valor = body.model_dump(mode="json")
    por_fecha = {f["fecha"]: {"fecha": f["fecha"], "nombre": f["nombre"].strip()} for f in valor["feriados"]}
    valor["feriados"] = [por_fecha[k] for k in sorted(por_fecha)]
    p = _parametro(db, "jornada")
    if p is None:
        p = Parametro(clave="jornada")
        db.add(p)
    p.valor, p.actualizado_por, p.fecha_actualizacion = valor, user.username, ahora_ecuador()
    try:
        db.commit()
    except ProgrammingError as e:
        db.rollback()
        raise HTTPException(503, "Falta crear la tabla parametro en la base (sql/01_schema.sql)") from e
    db.refresh(p)
    return _jornada_out(p)


# --------------------------------------- jornadas SIN almuerzo (las marca quien revisa)
# No todos los tractoristas almuerzan: en esas jornadas no se descuenta el
# almuerzo fijo. Lista "operador|AAAA-MM-DD" en parametro 'jornadas_sin_almuerzo'.
class SinAlmuerzoIn(BaseModel):
    operador: str = Field(min_length=1, max_length=150)
    dia: date
    sin_almuerzo: bool


@router.get("/parametros/sin-almuerzo")
def ver_sin_almuerzo(db: Session = Depends(get_db),
                     _: Usuario = Depends(requiere("reportes_actividades", "revisar_actividades"))):
    p = _parametro(db, "jornadas_sin_almuerzo")
    return list((p.valor or {}).get("lista", [])) if p else []


@router.put("/parametros/sin-almuerzo")
def marcar_sin_almuerzo(body: SinAlmuerzoIn, db: Session = Depends(get_db),
                        user: Usuario = Depends(requiere("revisar_actividades"))):
    clave = f"{body.operador.strip()}|{body.dia.isoformat()}"
    p = _parametro(db, "jornadas_sin_almuerzo")
    if p is None:
        p = Parametro(clave="jornadas_sin_almuerzo", valor={"lista": []})
        db.add(p)
    lista = set((p.valor or {}).get("lista", []))
    (lista.add if body.sin_almuerzo else lista.discard)(clave)
    p.valor = {"lista": sorted(lista)}
    p.actualizado_por, p.fecha_actualizacion = user.username, ahora_ecuador()
    flag_modified(p, "valor")
    db.commit()
    return sorted(lista)
