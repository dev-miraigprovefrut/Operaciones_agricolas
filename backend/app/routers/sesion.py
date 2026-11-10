"""Sesion: quien soy (usuario del HUB o tractorista) y login de tractoristas."""
from datetime import datetime, timedelta

import hashlib

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import (PESTANAS, Usuario, cerrar_sesion_tractorista, emitir_sesion_tractorista,
                    formatear_nombre_tractorista, get_current_user)
from ..models import TractoristaDispositivo
from .tablets import marcar_uso, tablet_por_llave
from ..clients import personas
from ..comun import ahora_ecuador
from ..config import settings
from ..database import get_db
from ..models import Tractorista
from .. import funciones

router = APIRouter()


@router.get("/api/auth/me")
def yo(response: Response, db: Session = Depends(get_db), user: Usuario = Depends(get_current_user)):
    """Lo que antes el frontend leia decodificando el JWT (ahora la sesion va en
    una cookie HttpOnly y el JavaScript no la puede leer)."""
    # Telefono registrado: ultimo uso y sesion renovada (no vence mientras se use)
    if user.es_tractorista and user.claims.get("disp"):
        d = db.get(TractoristaDispositivo, user.claims["disp"])
        d.ultimo_uso = ahora_ecuador()
        db.commit()
        if (user.exp or 0) - datetime.now().timestamp() < settings.TRACTORISTA_DIAS_DISPOSITIVO * 86400 / 2:
            emitir_sesion_tractorista(response, db.get(Tractorista, user.id_tractorista), user.nombre, d.id)
    return {
        "tipo": user.tipo, "username": user.username, "nombre": user.nombre, "correo": user.correo,
        "rol": user.rol, "departamento": user.departamento, "empresa": user.empresa, "jefe": user.jefe,
        "exp": user.exp, "es_admin": user.es_admin,
        # Telefono de campo (HUB): sesion de jornada, la app no se cierra por inactividad
        "campo": bool(user.claims.get("campo")),
        # Tractorista con sesion de ANTES del telefono registrado: la app lo registra
        "dispositivo": bool(user.claims.get("disp") or user.claims.get("tablet")) if user.es_tractorista else None,
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
    pin: str                       # codigo propio NUEVO (4 digitos)
    codigo_temporal: str | None = None


class TractoristaLogin(BaseModel):
    username: str
    pin: str
    dispositivo: str | None = None          # llave del telefono (solo vive en el)
    dispositivo_nombre: str | None = None   # "Android 14 · Chrome"
    equipo: str | None = None               # Drones = dron.miraigprovefrut.com; si no, Tractores


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
    # El codigo propio no vence: el acceso queda atado al telefono registrado y
    # si se olvida, el catalogo da un codigo temporal (ya no se cambia solo).
    t.pin_hash = bcrypt.hashpw(pin.encode(), bcrypt.gensalt()).decode()
    t.pin_expira, t.pin_temporal = None, False
    t.intentos_fallidos, t.bloqueado_hasta = 0, None
    db.commit()


def _bloqueado(t: Tractorista, ahora: datetime) -> None:
    if t.bloqueado_hasta and ahora < t.bloqueado_hasta:
        minutos = int((t.bloqueado_hasta - ahora).total_seconds() // 60) + 1
        raise HTTPException(429, f"Demasiados intentos. Intente de nuevo en {minutos} min.")


def _comprobar(db: Session, t: Tractorista, codigo: str, ahora: datetime) -> None:
    """Codigo correcto o suma un intento fallido (bloqueo tras PIN_MAX_INTENTOS)."""
    if not t.pin_hash or not bcrypt.checkpw((codigo or "").encode(), t.pin_hash.encode()):
        t.intentos_fallidos = (t.intentos_fallidos or 0) + 1
        if t.intentos_fallidos >= settings.PIN_MAX_INTENTOS:
            t.bloqueado_hasta = ahora + timedelta(minutes=settings.PIN_MINUTOS_BLOQUEO)
            t.intentos_fallidos = 0
        db.commit()
        raise HTTPException(401, "Código incorrecto")


@router.post("/api/tractoristas/verificar")
def verificar(data: TractoristaVerificar, db: Session = Depends(get_db)):
    """Por cedula: usuario, nombre y si ya tiene PIN (o si expiro)."""
    t = _activo(db.scalar(select(Tractorista).where(Tractorista.cedula == data.cedula.strip())))
    if not t.username:
        raise HTTPException(403, "El tractorista no tiene usuario asignado. Pídalo a su supervisor.")
    # tiene_pin: tiene un codigo PROPIO; si no, debe ingresar el temporal del catalogo
    return {"valido": True, "username": t.username, "nombre": _nombre(t),
            "tiene_pin": bool(t.pin_hash) and not t.pin_temporal, "pin_expirado": False,
            "requiere_temporal": bool(t.pin_temporal), "funcion": funciones.de(db, t.id)}


def _usuario_y_cedula(db: Session, data: TractoristaRegistro) -> Tractorista:
    _validar_pin(data.pin)
    t = _activo(_por_username(db, data.username))
    if (t.cedula or "").strip() != data.cedula.strip():
        raise HTTPException(400, "La cédula no coincide")
    return t


SIN_TEMPORAL = "Pida un código temporal a su supervisor (Catálogos › Tractoristas)."


@router.post("/api/tractoristas/registro")
def registro(data: TractoristaRegistro, db: Session = Depends(get_db)):
    """Crea el codigo PROPIO: la primera vez (aun sin codigo) con usuario +
    cedula; si ya tenia uno y lo olvido, solo con el codigo temporal que da el
    catalogo (ya no se cambia por cuenta propia)."""
    t = _usuario_y_cedula(db, data)
    ahora = datetime.now()
    _bloqueado(t, ahora)
    if not t.pin_hash:                       # primera vez: lo crea el mismo
        _guardar_pin(db, t, data.pin)
        return {"message": "Código registrado exitosamente", "nombre": _nombre(t), "username": t.username}
    # Ya tenia codigo y lo olvido: solo con el temporal del catalogo
    if not t.pin_temporal or not data.codigo_temporal:
        raise HTTPException(403, SIN_TEMPORAL)
    if t.pin_expira and ahora > t.pin_expira:
        raise HTTPException(410, "El código temporal venció. " + SIN_TEMPORAL)
    _comprobar(db, t, data.codigo_temporal, ahora)
    _guardar_pin(db, t, data.pin)
    return {"message": "Código registrado exitosamente", "nombre": _nombre(t), "username": t.username}


@router.post("/api/tractoristas/recuperar")
def recuperar():
    """Ya no existe el cambio de codigo por cuenta propia (cualquiera con el
    usuario y la cedula podia hacerlo)."""
    raise HTTPException(403, SIN_TEMPORAL)


@router.post("/api/tractoristas/login")
def login(data: TractoristaLogin, response: Response, db: Session = Depends(get_db)):
    t = _por_username(db, data.username)
    if not t:
        raise HTTPException(401, "Usuario no encontrado")
    _activo(t)
    ahora = datetime.now()
    _bloqueado(t, ahora)
    if not t.pin_hash:
        raise HTTPException(400, "No tiene código registrado. Debe registrarse primero.")
    if t.pin_temporal:
        # Con el temporal no se entra: se usa para crear el codigo propio (/registro)
        if t.pin_expira and ahora > t.pin_expira:
            raise HTTPException(410, "El código temporal venció. " + SIN_TEMPORAL)
        _comprobar(db, t, data.pin, ahora)
        raise HTTPException(409, "Código temporal correcto: cree su código propio.")
    _comprobar(db, t, data.pin, ahora)

    # Piloto de dron / tractorista: cada uno entra por su dominio
    funcion = funciones.de(db, t.id)
    if not funciones.puede_entrar(funcion, data.equipo):
        if data.equipo == "Drones":
            raise HTTPException(403, "No está registrado como piloto de dron. Pídalo a su supervisor (Catálogos › Tractoristas).")
        raise HTTPException(403, "Está registrado como piloto de dron: ingrese por dron.miraigprovefrut.com")

    # Telefono registrado: uno activo por tractorista. Otro telefono no entra
    # hasta que den de baja el anterior en Catalogos > Tractoristas.
    if not data.dispositivo or len(data.dispositivo) < 32:
        raise HTTPException(400, "Actualice la aplicación: recargue la página con internet.")
    tablet = tablet_por_llave(db, data.dispositivo)
    if tablet:
        # Tablet del tractor (compartida por varios tractoristas): su sesion va
        # atada a la tablet; se corta si la tablet se da de baja.
        marcar_uso(db, tablet.id)
        t.intentos_fallidos, t.bloqueado_hasta, t.ultimo_acceso = 0, None, ahora
        db.commit()
        nombre = _nombre(t)
        token = emitir_sesion_tractorista(response, t, nombre, id_tablet=tablet.id)
        return {"token": token, "nombre": nombre, "username": t.username, "tablet": tablet.tractor}
    llave = hashlib.sha256(data.dispositivo.encode()).hexdigest()
    d = db.scalar(select(TractoristaDispositivo).where(TractoristaDispositivo.id_tractorista == t.id,
                                                       TractoristaDispositivo.activo.is_(True)))
    if d is None:
        d = TractoristaDispositivo(id_tractorista=t.id, llave_hash=llave, fecha_alta=ahora_ecuador(),
                                   descripcion=(data.dispositivo_nombre or "Teléfono")[:200], ultimo_uso=ahora_ecuador())
        db.add(d)
    elif d.llave_hash != llave:
        db.commit()
        raise HTTPException(403, f"Su usuario ya tiene un teléfono registrado ({d.descripcion}, desde "
                                 f"{d.fecha_alta:%d/%m/%Y}). Si cambió o perdió el celular, pida que lo den de "
                                 "baja en Catálogos › Tractoristas.")
    else:
        d.ultimo_uso = ahora_ecuador()
    t.intentos_fallidos, t.bloqueado_hasta, t.ultimo_acceso = 0, None, ahora
    db.commit()
    nombre = _nombre(t)
    token = emitir_sesion_tractorista(response, t, nombre, d.id)
    return {"token": token, "nombre": nombre, "username": t.username}


class DispositivoIn(BaseModel):
    dispositivo: str
    dispositivo_nombre: str | None = None


@router.post("/api/tractoristas/dispositivo")
def registrar_dispositivo(data: DispositivoIn, response: Response, db: Session = Depends(get_db),
                          user: Usuario = Depends(get_current_user)):
    """Sesion abierta ANTES del telefono registrado (sin 'disp'): al abrir la
    app con internet el telefono se registra solo y la sesion pasa a ser la del
    telefono (30 dias), sin volver a pedir el codigo. Si ya tiene OTRO telefono
    activo no se registra (409) y sigue con su sesion vieja hasta que venza."""
    if not user.es_tractorista:
        raise HTTPException(403, "Solo tractoristas")
    if user.claims.get("disp"):
        return {"resultado": "ya_registrado"}
    if len(data.dispositivo or "") < 32:
        raise HTTPException(400, "Llave de teléfono inválida")
    t = _activo(db.get(Tractorista, user.id_tractorista))
    llave = hashlib.sha256(data.dispositivo.encode()).hexdigest()
    d = db.scalar(select(TractoristaDispositivo).where(TractoristaDispositivo.id_tractorista == t.id,
                                                       TractoristaDispositivo.activo.is_(True)))
    if d is None:
        d = TractoristaDispositivo(id_tractorista=t.id, llave_hash=llave, fecha_alta=ahora_ecuador(),
                                   descripcion=(data.dispositivo_nombre or "Teléfono")[:200], ultimo_uso=ahora_ecuador())
        db.add(d)
        db.flush()
    elif d.llave_hash != llave:
        raise HTTPException(409, f"Ya tiene otro teléfono registrado ({d.descripcion}).")
    else:
        d.ultimo_uso = ahora_ecuador()
    db.commit()
    emitir_sesion_tractorista(response, t, user.nombre, d.id)
    return {"resultado": "registrado"}


@router.post("/api/tractoristas/logout")
def logout(response: Response):
    cerrar_sesion_tractorista(response)
    return {"ok": True}
