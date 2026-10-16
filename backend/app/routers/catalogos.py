"""Catalogos del modulo: actividades, camiones, proyectos, supervisores y
tractoristas (estos ultimos: personas del maestro Personas + su credencial)."""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import Integer, cast, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth import Usuario, get_current_user, requiere, sesion_o_kiosko
from ..clients import personas
from ..comun import estado_api, estado_db
from ..config import settings
from ..database import get_db
import secrets
from datetime import datetime, timedelta

import bcrypt

from ..models import Actividad, Camion, Proyecto, Supervisor, Tractorista, TractoristaDispositivo

router = APIRouter(prefix="/api")


def _guardar(db: Session, msg_duplicado: str):
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, msg_duplicado)


# ---------------------------------------------------------------- actividades
class ActividadIn(BaseModel):
    actividad: str
    subactividades: List[str] = []
    equipo: str = "Tractores"
    tipo: str = "Actividades Culturales"
    cantidad: int = 0


def _actividad(a: Actividad) -> dict:
    return {"id": a.id, "codigo_act": a.codigo_act, "actividad": a.actividad, "subactividades": a.subactividades or [],
            "equipo": a.equipo, "tipo": a.tipo, "cantidad": a.cantidad or 0}


EQUIPOS = {"Tractores", "Drones"}


@router.get("/actividades")
def listar_actividades(equipo: Optional[str] = None, db: Session = Depends(get_db),
                       user: Usuario = Depends(sesion_o_kiosko("catalogos_actividades", "bitacora_dron"))):
    # Los kioskos de los tractores (Raspberry) no filtran por equipo: solo ven
    # las de Tractores, para que no les aparezcan las actividades de drones.
    if equipo is None and user.tipo == "kiosko":
        equipo = "Tractores"
    q = select(Actividad).where(Actividad.estado == "ACTIVO")
    if equipo:
        q = q.where(Actividad.equipo == equipo)
    return [_actividad(a) for a in db.scalars(q.order_by(Actividad.id))]


@router.get("/actividades/{actividad_id}")
def ver_actividad(actividad_id: int, db: Session = Depends(get_db), _: Usuario = Depends(sesion_o_kiosko("catalogos_actividades"))):
    a = db.get(Actividad, actividad_id)
    if not a:
        raise HTTPException(404, "Actividad no encontrada")
    return _actividad(a)


@router.post("/actividades")
def crear_actividad(data: ActividadIn, db: Session = Depends(get_db),
                    _: Usuario = Depends(requiere("catalogos_actividades"))):
    if data.equipo not in EQUIPOS:
        raise HTTPException(400, f"Equipo inválido: {data.equipo}")
    # Siguiente numero de CODIGO (no de id: el generador viejo repitio codigos)
    ultimo = db.scalar(select(func.max(cast(func.substring(Actividad.codigo_act, r"(\d+)$"), Integer)))
                       .where(Actividad.codigo_act.op("~")(r"^ACT-\d+$"))) or 0
    a = Actividad(codigo_act=f"ACT-{ultimo + 1:03d}", actividad=data.actividad.upper(),
                  subactividades=data.subactividades, equipo=data.equipo, tipo=data.tipo,
                  cantidad=len(data.subactividades))
    db.add(a)
    _guardar(db, "Ya existe una actividad con ese código")
    db.refresh(a)
    return _actividad(a)


@router.put("/actividades/{actividad_id}")
def editar_actividad(actividad_id: int, data: ActividadIn, db: Session = Depends(get_db),
                     _: Usuario = Depends(requiere("catalogos_actividades"))):
    a = db.get(Actividad, actividad_id)
    if not a:
        raise HTTPException(404, "Actividad no encontrada")
    if data.equipo not in EQUIPOS:
        raise HTTPException(400, f"Equipo inválido: {data.equipo}")
    a.actividad, a.subactividades = data.actividad.upper(), data.subactividades
    a.equipo, a.tipo, a.cantidad = data.equipo, data.tipo, len(data.subactividades)
    db.commit()
    db.refresh(a)
    return _actividad(a)


@router.delete("/actividades/{actividad_id}")
def eliminar_actividad(actividad_id: int, db: Session = Depends(get_db),
                       _: Usuario = Depends(requiere("catalogos_actividades"))):
    """Se INACTIVA (antes se borraba fisicamente y los registros quedaban sin actividad)."""
    a = db.get(Actividad, actividad_id)
    if not a:
        raise HTTPException(404, "Actividad no encontrada")
    a.estado = "INACTIVO"
    db.commit()
    return {"message": "Actividad eliminada"}


# ------------------------------------------------------------------- camiones
class CamionIn(BaseModel):
    nombre: str
    cedula: str
    placa: Optional[str] = None
    correo: Optional[str] = None
    empresa: Optional[str] = None
    estado: str = "Activo"


def _camion(c: Camion) -> dict:
    return {"id": c.id, "nombre": c.nombre, "cedula": c.cedula, "placa": c.placa, "correo": c.correo,
            "empresa": c.empresa, "estado": estado_api(c.estado)}


@router.get("/camiones")
def listar_camiones(db: Session = Depends(get_db),
                    _: Usuario = Depends(requiere("catalogos_camiones", "registrar_cosecha", "reportes_cosecha"))):
    return [_camion(c) for c in db.scalars(select(Camion).order_by(Camion.nombre))]


@router.post("/camiones")
def crear_camion(data: CamionIn, db: Session = Depends(get_db), _: Usuario = Depends(requiere("catalogos_camiones"))):
    c = Camion(nombre=data.nombre.strip(), cedula=data.cedula.strip(), placa=data.placa, correo=data.correo,
               empresa=data.empresa, estado=estado_db(data.estado))
    db.add(c)
    _guardar(db, "Ya existe un camión con esa cédula")
    return {"id": c.id, "message": "Camion creado"}


@router.put("/camiones/{camion_id}")
def editar_camion(camion_id: int, data: dict, db: Session = Depends(get_db),
                  _: Usuario = Depends(requiere("catalogos_camiones"))):
    c = db.get(Camion, camion_id)
    if not c:
        raise HTTPException(404, "Camion no encontrado")
    for campo in ("nombre", "cedula", "placa", "correo", "empresa"):
        if campo in data:
            setattr(c, campo, data[campo])
    if "estado" in data:
        c.estado = estado_db(data["estado"])
    _guardar(db, "Ya existe un camión con esa cédula")
    return {"message": "Camion actualizado"}


# ------------------------------------------------------------------ proyectos
class ProyectoIn(BaseModel):
    nombre: str
    direccion: Optional[str] = None
    tipo: Optional[str] = None
    estado: str = "Activo"


_CAT_PROYECTOS = ("catalogos_supervisores",)


def _proyecto(p: Proyecto) -> dict:
    return {"id": p.id, "nombre": p.nombre, "direccion": p.direccion, "tipo": p.tipo, "estado": estado_api(p.estado)}


@router.get("/proyectos")
def listar_proyectos(db: Session = Depends(get_db), _: Usuario = Depends(get_current_user)):
    return [_proyecto(p) for p in db.scalars(select(Proyecto).order_by(Proyecto.nombre))]


@router.post("/proyectos")
def crear_proyecto(data: ProyectoIn, db: Session = Depends(get_db), _: Usuario = Depends(requiere(*_CAT_PROYECTOS))):
    p = Proyecto(nombre=data.nombre.strip(), direccion=data.direccion, tipo=data.tipo, estado=estado_db(data.estado))
    db.add(p)
    _guardar(db, "Ya existe un proyecto con ese nombre")
    return {"id": p.id, "message": "Proyecto creado"}


@router.put("/proyectos/{proyecto_id}")
def editar_proyecto(proyecto_id: int, data: dict, db: Session = Depends(get_db),
                    _: Usuario = Depends(requiere(*_CAT_PROYECTOS))):
    p = db.get(Proyecto, proyecto_id)
    if not p:
        raise HTTPException(404, "Proyecto no encontrado")
    for campo in ("nombre", "direccion", "tipo"):
        if campo in data:
            setattr(p, campo, data[campo])
    if "estado" in data:
        p.estado = estado_db(data["estado"])
    _guardar(db, "Ya existe un proyecto con ese nombre")
    return {"message": "Proyecto actualizado"}


@router.delete("/proyectos/{proyecto_id}")
def eliminar_proyecto(proyecto_id: int, db: Session = Depends(get_db),
                      _: Usuario = Depends(requiere(*_CAT_PROYECTOS))):
    p = db.get(Proyecto, proyecto_id)
    if not p:
        raise HTTPException(404, "Proyecto no encontrado")
    db.delete(p)
    db.commit()
    return {"message": "Proyecto eliminado"}


# --------------------------------------------------------------- supervisores
class SupervisorIn(BaseModel):
    cedula: str
    nombre: str
    id_proyecto: Optional[int] = None
    estado: str = "Activo"


def _supervisor(s: Supervisor) -> dict:
    pr = s.proyecto_rel
    return {"id": s.id, "cedula": s.cedula, "nombre": s.nombre, "id_proyecto": s.id_proyecto,
            "proyecto": pr.nombre if pr else s.proyecto, "proyecto_direccion": pr.direccion if pr else None,
            "proyecto_tipo": pr.tipo if pr else None, "estado": estado_api(s.estado)}


def _id_persona(cedula: str, user: Usuario) -> int | None:
    try:
        p = personas.por_cedula(cedula, user.token)
    except personas.PersonasError:
        return None
    return (p or {}).get("id_persona")


@router.get("/supervisores")
def listar_supervisores(db: Session = Depends(get_db),
                        _: Usuario = Depends(requiere("catalogos_supervisores", "registrar_cosecha", "reportes_cosecha"))):
    return [_supervisor(s) for s in db.scalars(select(Supervisor).order_by(Supervisor.nombre))]


@router.post("/supervisores")
def crear_supervisor(data: SupervisorIn, db: Session = Depends(get_db),
                     user: Usuario = Depends(requiere("catalogos_supervisores"))):
    s = Supervisor(cedula=data.cedula.strip(), nombre=data.nombre.strip(), id_proyecto=data.id_proyecto,
                   estado=estado_db(data.estado), id_persona=_id_persona(data.cedula, user))
    db.add(s)
    _guardar(db, "Ya existe un supervisor con esa cédula")
    return {"id": s.id, "message": "Supervisor creado"}


@router.put("/supervisores/{supervisor_id}")
def editar_supervisor(supervisor_id: int, data: dict, db: Session = Depends(get_db),
                      user: Usuario = Depends(requiere("catalogos_supervisores"))):
    s = db.get(Supervisor, supervisor_id)
    if not s:
        raise HTTPException(404, "Supervisor no encontrado")
    for campo in ("nombre", "id_proyecto"):
        if campo in data:
            setattr(s, campo, data[campo] or None if campo == "id_proyecto" else data[campo])
    if "cedula" in data and data["cedula"] and data["cedula"].strip() != s.cedula:
        s.cedula = data["cedula"].strip()
        s.id_persona = _id_persona(s.cedula, user)
    if "estado" in data:
        s.estado = estado_db(data["estado"])
    _guardar(db, "Ya existe un supervisor con esa cédula")
    return {"message": "Supervisor actualizado"}


@router.delete("/supervisores/{supervisor_id}")
def eliminar_supervisor(supervisor_id: int, db: Session = Depends(get_db),
                        _: Usuario = Depends(requiere("catalogos_supervisores"))):
    s = db.get(Supervisor, supervisor_id)
    if not s:
        raise HTTPException(404, "Supervisor no encontrado")
    db.delete(s)
    db.commit()
    return {"message": "Supervisor eliminado"}


# --------------------------------------------------------------- tractoristas
# Antes se leian/escribian en la base de Mantenimiento (ot_personal). Ahora la
# persona viene del maestro Personas (por cedula) y aqui solo esta su
# credencial (tractorista). La forma de la respuesta no cambia para la pantalla:
# codigo = cedula, nombre = APELLIDOS NOMBRES.
def _tractorista(t: Tractorista, p: dict | None, d: TractoristaDispositivo | None = None) -> dict:
    return {"id": t.id, "codigo": t.cedula, "nombre": personas.nombre_legal(p) or t.cedula, "cargo": "Tractorista",
            "estado": estado_api(t.estado), "creado_en": str(t.fecha_creacion) if t.fecha_creacion else None,
            "actualizado_en": None, "username": t.username, "id_persona": t.id_persona,
            "tiene_pin": bool(t.pin_hash) and not t.pin_temporal,
            "codigo_temporal_vence": str(t.pin_expira) if t.pin_temporal and t.pin_expira else None,
            "dispositivo": {"id": d.id, "descripcion": d.descripcion,
                            "fecha_alta": str(d.fecha_alta) if d.fecha_alta else None,
                            "ultimo_uso": str(d.ultimo_uso) if d.ultimo_uso else None} if d else None}


@router.get("/tractoristas")
def listar_tractoristas(db: Session = Depends(get_db), user: Usuario = Depends(requiere("catalogos_tractoristas"))):
    filas = list(db.scalars(select(Tractorista)))
    gente = personas.lote([t.id_persona for t in filas], user.token)
    disp = {d.id_tractorista: d for d in db.scalars(
        select(TractoristaDispositivo).where(TractoristaDispositivo.activo.is_(True)))}
    out = [_tractorista(t, gente.get(t.id_persona), disp.get(t.id)) for t in filas]
    return sorted(out, key=lambda r: r["nombre"])


@router.post("/tractoristas/{id_tractorista}/codigo-temporal")
def codigo_temporal(id_tractorista: int, db: Session = Depends(get_db),
                    user: Usuario = Depends(requiere("catalogos_tractoristas"))):
    """Codigo de 6 digitos (vence en CODIGO_TEMPORAL_HORAS) para que el
    tractorista cree su codigo propio: primera vez o si lo olvido. Se muestra
    UNA vez; reemplaza al codigo anterior."""
    t = db.get(Tractorista, id_tractorista)
    if not t:
        raise HTTPException(404, "Tractorista no encontrado")
    codigo = f"{secrets.randbelow(10**6):06d}"
    t.pin_hash = bcrypt.hashpw(codigo.encode(), bcrypt.gensalt()).decode()
    t.pin_temporal = True
    t.pin_expira = datetime.now() + timedelta(hours=settings.CODIGO_TEMPORAL_HORAS)
    t.intentos_fallidos, t.bloqueado_hasta = 0, None
    db.commit()
    return {"codigo": codigo, "vence": str(t.pin_expira), "generado_por": user.nombre}


@router.post("/tractoristas/{id_tractorista}/dispositivo/baja")
def baja_dispositivo(id_tractorista: int, db: Session = Depends(get_db),
                     user: Usuario = Depends(requiere("catalogos_tractoristas"))):
    """Telefono perdido o cambio de celular: deja de funcionar al instante (sus
    datos locales se borran al volver a tener señal) y el tractorista puede
    registrar otro."""
    d = db.scalar(select(TractoristaDispositivo).where(TractoristaDispositivo.id_tractorista == id_tractorista,
                                                       TractoristaDispositivo.activo.is_(True)))
    if not d:
        return {"resultado": "sin_dispositivo"}
    d.activo, d.fecha_baja, d.baja_por = False, datetime.now(), user.username
    db.commit()
    return {"resultado": "dado_de_baja"}


@router.get("/tractoristas/personal")
def personal_tractorista(db: Session = Depends(get_db), user: Usuario = Depends(requiere("catalogos_tractoristas"))):
    """Personal de la empresa con cargo de tractorista en Personas que aun no
    tiene credencial en el modulo (para agregarlos)."""
    ya = set(db.scalars(select(Tractorista.cedula)))
    return [{"cedula": e["cedula"], "nombre": e["nombre_completo"], "cargo": e.get("cargo_nombre")}
            for e in personas.catalogo_empresa(user.token)
            if e.get("activo") and "TRACTOR" in (e.get("cargo_nombre") or "").upper() and e["cedula"] not in ya]


def _datos_tractorista(data: dict, user: Usuario) -> tuple[str, dict, str | None]:
    cedula = (data.get("codigo") or data.get("cedula") or "").strip()
    if not cedula:
        raise HTTPException(400, "La cédula es obligatoria")
    try:
        p = personas.por_cedula(cedula, user.token)
    except personas.PersonasError as e:
        raise HTTPException(502, e.detalle)
    if not p:
        raise HTTPException(404, "La cédula no está registrada en el maestro de Personas")
    username = (data.get("username") or "").strip().lower() or None
    return cedula, p, username


@router.post("/tractoristas")
def crear_tractorista(data: dict, db: Session = Depends(get_db),
                      user: Usuario = Depends(requiere("catalogos_tractoristas"))):
    cedula, p, username = _datos_tractorista(data, user)
    t = Tractorista(id_persona=p["id_persona"], cedula=cedula, username=username,
                    estado=estado_db(data.get("estado")))
    db.add(t)
    _guardar(db, "Ese tractorista (cédula o usuario) ya existe")
    return {"id": t.id, "message": "Tractorista creado"}


@router.put("/tractoristas/{id_tractorista}")
def editar_tractorista(id_tractorista: int, data: dict, db: Session = Depends(get_db),
                       user: Usuario = Depends(requiere("catalogos_tractoristas"))):
    t = db.get(Tractorista, id_tractorista)
    if not t:
        raise HTTPException(404, "Tractorista no encontrado")
    cedula, p, username = _datos_tractorista({**data, "codigo": data.get("codigo") or t.cedula}, user)
    if cedula != t.cedula:     # otra persona: su PIN anterior ya no vale
        t.cedula, t.id_persona, t.pin_hash, t.pin_expira = cedula, p["id_persona"], None, None
    if "username" in data:
        t.username = username
    if "estado" in data:
        t.estado = estado_db(data["estado"])
    _guardar(db, "Ese tractorista (cédula o usuario) ya existe")
    return {"message": "Tractorista actualizado"}


@router.delete("/tractoristas/{id_tractorista}")
def eliminar_tractorista(id_tractorista: int, db: Session = Depends(get_db),
                         _: Usuario = Depends(requiere("catalogos_tractoristas"))):
    """Se INACTIVA (sus registros historicos lo siguen referenciando)."""
    t = db.get(Tractorista, id_tractorista)
    if not t:
        raise HTTPException(404, "Tractorista no encontrado")
    t.estado = "INACTIVO"
    db.commit()
    return {"message": "Tractorista eliminado"}
