"""Registrar actividades de tractores: equipos, horometros, telemetria,
checklists y registros de actividad.

Estos endpoints los usa tambien el kiosko de la Raspberry (sistema aparte):
ver auth.sesion_o_kiosko.
"""
import logging
from datetime import datetime, timedelta
from typing import Any, List, Optional

import requests
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ..auth import Usuario, requiere, sesion_o_kiosko
from ..clients import equipos, notificaciones
from ..comun import TZ_ECUADOR, ahora_ecuador
from ..config import settings
from ..database import get_db, get_mant_db
from ..models import Actividad, CheckList, Registro, RegistroRevision, TractorFalla

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")
_kiosko = sesion_o_kiosko()


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
    tractor_id: str
    operador: Optional[str] = None
    horas_delta: float = 0.0
    lat: Optional[float] = None
    lon: Optional[float] = None


def _mant(method: str, ruta: str, body=None):
    resp = requests.request(method, f"{settings.MANTENIMIENTO_API_URL.rstrip('/')}{ruta}", json=body, timeout=10)
    if not resp.ok:
        raise HTTPException(resp.status_code, resp.text[:300])
    return resp.json() if resp.content else None


@router.post("/telemetria")
def telemetria(data: TelemetriaIn, _: Usuario = Depends(_kiosko)):
    """Telemetria de los kioskos: se reenvia al backend de Mantenimiento."""
    ahora = ahora_ecuador().replace(tzinfo=TZ_ECUADOR)
    tractor_id = data.tractor_id.strip()
    resultado = {}
    horas_reales = None
    try:
        r = requests.get(f"{settings.MANTENIMIENTO_API_URL.rstrip('/')}/equipo-horas", timeout=10)
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
    revision_estado: str = "NO_REVISADO"
    revisado_por: Optional[str] = None
    revisado_por_nombre: Optional[str] = None
    fecha_revision: Optional[datetime] = None

    class Config:
        from_attributes = True


def _no_revisado(r: Registro) -> None:
    """Un registro REVISADO (horas aprobadas) queda bloqueado para cambios."""
    if r.revision_estado == "REVISADO":
        quien = r.revisado_por_nombre or r.revisado_por or "un supervisor"
        cuando = r.fecha_revision.strftime("%d/%m/%Y %H:%M") if r.fecha_revision else ""
        raise HTTPException(409, f"Actividad ya revisada por {quien} {cuando}: no se puede modificar".strip())


ESTADOS_REGISTRO = {"Pendiente", "Ejecutándose", "Pausado", "Finalizado", "Eliminado"}


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
    # Evitar duplicados por reintentos de la cola offline / doble clic.
    if registro.estado == "Ejecutándose" and registro.usuario:
        existente = db.scalar(select(Registro).where(Registro.usuario == registro.usuario,
                                                     Registro.estado == "Ejecutándose")
                              .order_by(Registro.fecha_creacion.desc()))
        if existente:
            return existente
    if registro.estado == "Pendiente" and registro.usuario:
        hoy = ahora_ecuador().replace(hour=0, minute=0, second=0, microsecond=0)
        dup = db.scalar(select(Registro).where(
            Registro.usuario == registro.usuario, Registro.tractor == registro.tractor,
            Registro.actividad == registro.actividad, Registro.subactividad == registro.subactividad,
            Registro.orden_cultivo == registro.orden_cultivo, Registro.apero == registro.apero,
            Registro.estado.in_(["Pendiente", "Ejecutándose", "Pausado"]), Registro.fecha_creacion >= hoy)
            .order_by(Registro.fecha_creacion.desc()))
        if dup:
            return dup

    ahora = ahora_ecuador()
    historial = ([{"accion": "inicio", "fecha": ahora.isoformat(), "ubicacion": registro.ubicacion}]
                 if registro.estado == "Ejecutándose" else [])
    id_check = registro.id_check
    if not id_check and registro.tractor:
        activo = db.scalar(select(CheckList).where(CheckList.tractor == registro.tractor, CheckList.estado == "Activo"))
        if activo:
            id_check = activo.id
    act = db.scalar(select(Actividad).where(Actividad.actividad == registro.actividad)) if registro.actividad else None
    nuevo = Registro(
        fecha_creacion=ahora, tiempo_inicio=ahora if registro.estado == "Ejecutándose" else None,
        actividad=registro.actividad, subactividad=registro.subactividad, tractor=registro.tractor,
        apero=registro.apero, lote=registro.lote, hacienda=registro.hacienda, orden_cultivo=registro.orden_cultivo,
        tipo=registro.tipo, usuario=registro.usuario, ubicacion=registro.ubicacion, id_check=id_check,
        id_actividad=act.id if act else None, id_tractorista=user.id_tractorista,
        estado=registro.estado, fecha_historial=historial, tiempo_paro=0.0, tiempo_real=0.0)
    db.add(nuevo)
    if act:
        act.cantidad = (act.cantidad or 0) + 1
    db.commit()
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
                    _: Usuario = Depends(_kiosko)):
    r = db.get(Registro, registro_id)
    if not r:
        raise HTTPException(404, "Registro no encontrado")
    if registro.estado is not None and registro.estado not in ESTADOS_REGISTRO:
        raise HTTPException(400, f"Estado inválido: {registro.estado}")
    # Idempotencia: reintento de la cola offline de un cambio ya aplicado.
    if registro.estado is not None and registro.estado == r.estado:
        return r
    _no_revisado(r)

    ahora = ahora_ecuador()
    historial = list(r.fecha_historial or [])
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


@router.delete("/registros/{registro_id}")
def eliminar_registro(registro_id: int, db: Session = Depends(get_db), _: Usuario = Depends(_kiosko)):
    r = db.get(Registro, registro_id)
    if not r:
        raise HTTPException(404, "Registro no encontrado")
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


@router.post("/registros/{registro_id}/revisar", response_model=RegistroOut)
def revisar_registro(registro_id: int, body: RevisionIn, db: Session = Depends(get_db),
                     user: Usuario = Depends(requiere("revisar_actividades"))):
    """Revisa (aprueba) las horas de una actividad FINALIZADA. Se pueden
    corregir la fecha/hora de inicio y de fin; se recalculan los tiempos, la
    actividad queda REVISADA y BLOQUEADA, y se registra quien y que cambio."""
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
    for campo, idx, nuevo in (("inicio", i_ini, body.inicio), ("fin", i_fin, body.fin)):
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
    db.commit()
    db.refresh(r)
    return r


@router.get("/registros/{registro_id}/revisiones")
def historial_revision(registro_id: int, db: Session = Depends(get_db),
                       _: Usuario = Depends(requiere("revisar_actividades", "reportes_actividades"))):
    """Quien reviso la actividad y que cambio."""
    filas = db.scalars(select(RegistroRevision).where(RegistroRevision.id_registro == registro_id)
                       .order_by(RegistroRevision.fecha))
    return [{"accion": f.accion, "usuario": f.usuario, "usuario_nombre": f.usuario_nombre,
             "cambios": f.cambios, "fecha": f.fecha} for f in filas]
