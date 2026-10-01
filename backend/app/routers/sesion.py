"""Sesion: quien soy (usuario del HUB o tractorista) y login de tractoristas."""
from datetime import datetime, timedelta

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import (PESTANAS, Usuario, cerrar_sesion_tractorista, emitir_sesion_tractorista,
                    formatear_nombre_tractorista, get_current_user)
from ..clients import personas
from ..config import settings
from ..database import get_db
from ..models import Tractorista

router = APIRouter()


@router.get("/api/auth/me")
def yo(user: Usuario = Depends(get_current_user)):
    """Lo que antes el frontend leia decodificando el JWT (ahora la sesion va en
    una cookie HttpOnly y el JavaScript no la puede leer)."""
    return {
        "tipo": user.tipo, "username": user.username, "nombre": user.nombre, "correo": user.correo,
        "rol": user.rol, "departamento": user.departamento, "empresa": user.empresa, "jefe": user.jefe,
        "exp": user.exp, "es_admin": user.es_admin,
        "pestanas": list(PESTANAS) if user.es_admin else user.pestanas,
    }


@router.get("/api/auth/validar")
def validar(user: Usuario = Depends(get_current_user)):
    return {"valido": True, "usuario": user.nombre, "username": user.username, "rol": user.rol, "empresa": user.empresa}


@router.get("/api/auth/permisos")
def permisos(user: Usuario = Depends(get_current_user)):
    return {"es_admin_operagricola": user.es_admin, "tiene_acceso_operagricola": True,
            "sub_permisos": user.pestanas, "activo": True}


# ------------------------------------------------------------- tractoristas
class TractoristaVerificar(BaseModel):
    cedula: str
    username: str | None = None


class TractoristaRegistro(BaseModel):
    username: str
    cedula: str
    pin: str


class TractoristaLogin(BaseModel):
    username: str
    pin: str


def _nombre(t: Tractorista) -> str:
    """'Nombre Apellido' desde el maestro Personas (con el token de servicio)."""
    try:
        p = personas.lote([t.id_persona]).get(t.id_persona)
    except personas.PersonasError:
        p = None
    return formatear_nombre_tractorista(personas.nombre_legal(p)) if p else (t.username or t.cedula)


def _activo(t: Tractorista | None) -> Tractorista:
    if not t:
        raise HTTPException(404, "Usuario no encontrado")
    if t.estado != "ACTIVO":
        raise HTTPException(403, "Usuario inactivo")
    return t


def _por_username(db: Session, username: str) -> Tractorista | None:
    return db.scalar(select(Tractorista).where(func.lower(Tractorista.username) == username.strip().lower()))


def _validar_pin(pin: str) -> None:
    if not pin or len(pin) != 4 or not pin.isdigit():
        raise HTTPException(400, "El código debe ser de 4 dígitos numéricos")


def _guardar_pin(db: Session, t: Tractorista, pin: str) -> None:
    t.pin_hash = bcrypt.hashpw(pin.encode(), bcrypt.gensalt()).decode()
    t.pin_expira = datetime.now() + timedelta(days=30)
    t.intentos_fallidos, t.bloqueado_hasta = 0, None
    db.commit()


@router.post("/api/tractoristas/verificar")
def verificar(data: TractoristaVerificar, db: Session = Depends(get_db)):
    """Por cedula: usuario, nombre y si ya tiene PIN (o si expiro)."""
    t = _activo(db.scalar(select(Tractorista).where(Tractorista.cedula == data.cedula.strip())))
    if not t.username:
        raise HTTPException(403, "El tractorista no tiene usuario asignado. Pídalo a su supervisor.")
    return {"valido": True, "username": t.username, "nombre": _nombre(t), "tiene_pin": bool(t.pin_hash),
            "pin_expirado": bool(t.pin_hash and t.pin_expira and datetime.now() > t.pin_expira)}


def _usuario_y_cedula(db: Session, data: TractoristaRegistro) -> Tractorista:
    _validar_pin(data.pin)
    t = _activo(_por_username(db, data.username))
    if (t.cedula or "").strip() != data.cedula.strip():
        raise HTTPException(400, "La cédula no coincide")
    return t


@router.post("/api/tractoristas/registro")
def registro(data: TractoristaRegistro, db: Session = Depends(get_db)):
    """Primer PIN (o uno nuevo si el anterior expiro). Para cambiar un PIN
    vigente se usa /recuperar."""
    t = _usuario_y_cedula(db, data)
    if t.pin_hash and t.pin_expira and datetime.now() <= t.pin_expira:
        raise HTTPException(409, "Ya tiene un código vigente. Use 'Olvidé mi código' para cambiarlo.")
    _guardar_pin(db, t, data.pin)
    return {"message": "Código registrado exitosamente", "nombre": _nombre(t), "username": t.username}


@router.post("/api/tractoristas/recuperar")
def recuperar(data: TractoristaRegistro, db: Session = Depends(get_db)):
    t = _usuario_y_cedula(db, data)
    _guardar_pin(db, t, data.pin)
    return {"message": "Código actualizado exitosamente", "nombre": _nombre(t), "username": t.username}


@router.post("/api/tractoristas/login")
def login(data: TractoristaLogin, response: Response, db: Session = Depends(get_db)):
    t = _por_username(db, data.username)
    if not t:
        raise HTTPException(401, "Usuario no encontrado")
    _activo(t)
    ahora = datetime.now()
    if t.bloqueado_hasta and ahora < t.bloqueado_hasta:
        minutos = int((t.bloqueado_hasta - ahora).total_seconds() // 60) + 1
        raise HTTPException(429, f"Demasiados intentos. Intente de nuevo en {minutos} min.")
    if not t.pin_hash:
        raise HTTPException(400, "No tiene código registrado. Debe registrarse primero.")
    if t.pin_expira and ahora > t.pin_expira:
        raise HTTPException(410, "Su código ha expirado. Debe generar uno nuevo.")
    if not bcrypt.checkpw(data.pin.encode(), t.pin_hash.encode()):
        t.intentos_fallidos = (t.intentos_fallidos or 0) + 1
        if t.intentos_fallidos >= settings.PIN_MAX_INTENTOS:
            t.bloqueado_hasta = ahora + timedelta(minutes=settings.PIN_MINUTOS_BLOQUEO)
            t.intentos_fallidos = 0
        db.commit()
        raise HTTPException(401, "Código incorrecto")
    t.intentos_fallidos, t.bloqueado_hasta, t.ultimo_acceso = 0, None, ahora
    db.commit()
    nombre = _nombre(t)
    token = emitir_sesion_tractorista(response, t, nombre)
    return {"token": token, "nombre": nombre, "username": t.username}


@router.post("/api/tractoristas/logout")
def logout(response: Response):
    cerrar_sesion_tractorista(response)
    return {"ok": True}
