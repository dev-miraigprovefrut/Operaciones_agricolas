"""Sesion y permisos.

Dos tipos de usuario:
  * Usuarios del HUB: cookie HttpOnly `mirai_access` (o Bearer para scripts).
    Se VALIDA con la SECRET_KEY del HUB; los permisos (es_admin, pestanas) se
    piden al HUB por API (/modulos/operagricola/mis-permisos).
  * Tractoristas (externos al HUB, cedula + PIN): cookie HttpOnly propia del
    modulo `oa_tractorista`, firmada con TRACTORISTA_SECRET_KEY (no sirve en
    ningun otro servicio). Solo pueden registrar actividades.

El token nunca pasa por la URL ni por localStorage.
"""
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from .clients import hub, personas
from .config import settings
from .database import get_db
from .models import Tractorista

PESTANAS = [
    "registrar_actividades", "registrar_cosecha",
    "catalogos_actividades", "catalogos_camiones", "catalogos_tractoristas", "catalogos_supervisores",
    "reportes_actividades", "reportes_cosecha", "reportes_seguridad",
    "revisar_actividades",   # revisar/aprobar las horas de los tractoristas
]
PESTANAS_TRACTORISTA = ["registrar_actividades"]
TIPO_TRACTORISTA = "tractorista"


@dataclass
class Usuario:
    username: str
    tipo: str = "hub"                    # hub | tractorista
    token: str | None = None             # token del HUB (para llamar a otros servicios)
    nombre: str = ""                     # nombre visible ("Nombre Apellido")
    rol: str = ""
    departamento: str = ""
    correo: str = ""
    empresa: str = ""
    jefe: str = ""
    exp: int | None = None
    es_admin: bool = False
    pestanas: list[str] = field(default_factory=list)
    id_tractorista: int | None = None
    id_persona: int | None = None
    claims: dict = field(default_factory=dict)

    @property
    def es_tractorista(self) -> bool:
        return self.tipo == TIPO_TRACTORISTA

    def puede(self, *pestanas: str) -> bool:
        return self.es_admin or any(p in self.pestanas for p in pestanas)


# --------------------------------------------------------------------- HUB
def _token_hub(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip() or None
    return request.cookies.get(settings.COOKIE_ACCESS_NAME)


def _validar_hub(token: str) -> dict:
    if not settings.SECRET_KEY:
        raise HTTPException(500, "SECRET_KEY no configurada")
    try:
        p = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM], leeway=30)
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Sesión expirada")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Token inválido")
    if p.get("typ") == "refresh" or p.get("tipo") in ("temporal", "servicio"):
        raise HTTPException(401, "Token no válido para esta operación")
    if not (p.get("username") or p.get("sub")):
        raise HTTPException(401, "Token sin usuario")
    return p


def _usuario_hub(token: str) -> Usuario:
    p = _validar_hub(token)
    username = (p.get("username") or p.get("sub")).strip().lower()
    permisos = hub.mis_permisos(username, token)
    if permisos is None:
        raise HTTPException(503, "No se pudieron verificar los permisos (HUB no responde)")
    if not (permisos.get("tiene_acceso") or permisos.get("es_admin")):
        raise HTTPException(403, "No tiene acceso al módulo Operaciones Agrícolas")
    datos = hub.usuarios_lote([username], token).get(username)
    respaldo = f"{p.get('nombre') or ''} {p.get('apellido') or ''}".strip() or username
    return Usuario(
        username=username, tipo="hub", token=token, claims=p,
        nombre=hub.nombre_de_trato(datos, respaldo),
        rol=p.get("rol") or "", departamento=p.get("departamento") or "",
        correo=p.get("correo") or p.get("email") or (datos or {}).get("correo") or "",
        empresa=p.get("empresa_nombre") or "", jefe=p.get("jefe") or "",
        exp=p.get("exp"), es_admin=bool(permisos.get("es_admin")),
        pestanas=[x for x in (permisos.get("pestanas") or []) if x in PESTANAS],
        id_persona=(datos or {}).get("id_persona"),
    )


# ------------------------------------------------------------- tractorista
def _clave_tractorista() -> str:
    clave = settings.TRACTORISTA_SECRET_KEY
    if not clave or clave == settings.SECRET_KEY:
        raise HTTPException(500, "TRACTORISTA_SECRET_KEY no configurada")
    return clave


def formatear_nombre_tractorista(nombre_legal: str) -> str:
    """APELLIDO1 APELLIDO2 NOMBRE1 NOMBRE2 -> 'Nombre1 Apellido1' (igual que antes:
    es el nombre con el que quedan sus registros y checklists)."""
    partes = (nombre_legal or "").strip().split()
    if len(partes) >= 3:
        return f"{partes[2].capitalize()} {partes[0].capitalize()}"
    if len(partes) == 2:
        return f"{partes[1].capitalize()} {partes[0].capitalize()}"
    return (nombre_legal or "").strip().title()


def emitir_sesion_tractorista(response: Response, t: Tractorista, nombre: str) -> str:
    """Pone la cookie de sesion y devuelve el token (el kiosko de la Raspberry
    no tiene navegador con cookies: lo reenvia como Bearer)."""
    exp = datetime.now(timezone.utc) + timedelta(hours=settings.TRACTORISTA_HORAS_SESION)
    token = jwt.encode({"sub": t.username, "id_tractorista": t.id, "nombre": nombre, "tipo": TIPO_TRACTORISTA,
                        "exp": exp}, _clave_tractorista(), algorithm="HS256")
    response.set_cookie(settings.COOKIE_TRACTORISTA_NAME, token, max_age=settings.TRACTORISTA_HORAS_SESION * 3600,
                        httponly=True, secure=settings.COOKIE_SECURE, samesite="lax", path="/",
                        domain=settings.COOKIE_DOMAIN or None)
    return token


def cerrar_sesion_tractorista(response: Response) -> None:
    response.delete_cookie(settings.COOKIE_TRACTORISTA_NAME, path="/", domain=settings.COOKIE_DOMAIN or None)


def _usuario_tractorista(token: str, db: Session) -> Usuario:
    try:
        p = jwt.decode(token, _clave_tractorista(), algorithms=["HS256"], leeway=30)
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Sesión expirada")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Sesión inválida")
    if p.get("tipo") != TIPO_TRACTORISTA:
        raise HTTPException(401, "Sesión inválida")
    t = db.get(Tractorista, p.get("id_tractorista"))
    if not t or t.estado != "ACTIVO":
        raise HTTPException(401, "Tractorista inactivo")
    return Usuario(username=t.username or t.cedula, tipo=TIPO_TRACTORISTA, nombre=p.get("nombre") or t.username,
                   rol="Tractorista", exp=p.get("exp"), pestanas=list(PESTANAS_TRACTORISTA),
                   id_tractorista=t.id, id_persona=t.id_persona, claims=p)


# ------------------------------------------------------------ dependencias
def _es_token_tractorista(token: str) -> bool:
    """Solo mira el tipo para elegir con que clave validar (la firma se valida despues)."""
    try:
        return jwt.decode(token, options={"verify_signature": False}).get("tipo") == TIPO_TRACTORISTA
    except jwt.InvalidTokenError:
        return False


def get_current_user(request: Request, db: Session = Depends(get_db)) -> Usuario:
    # La sesion de tractorista es explicita de este modulo: si existe, manda.
    tok_t = request.cookies.get(settings.COOKIE_TRACTORISTA_NAME)
    if tok_t:
        try:
            return _usuario_tractorista(tok_t, db)
        except HTTPException:
            if not _token_hub(request):
                raise
    token = _token_hub(request)
    if not token:
        raise HTTPException(401, "Sesión no iniciada")
    if _es_token_tractorista(token):          # Bearer del kiosko
        return _usuario_tractorista(token, db)
    return _usuario_hub(token)


def _hay_credencial(request: Request) -> bool:
    return bool(request.cookies.get(settings.COOKIE_TRACTORISTA_NAME) or _token_hub(request))


KIOSKO = Usuario(username="kiosko", tipo="kiosko", nombre="Kiosko", pestanas=list(PESTANAS_TRACTORISTA))


def sesion_o_kiosko(*otras_pestanas: str):
    """Para los endpoints de REGISTRO DE ACTIVIDADES que usan los kioskos de los
    tractores (Raspberry, sistema aparte). Los kioskos todavia no mandan sesion:
    mientras KIOSKO_SIN_SESION este activo, una llamada SIN credenciales entra
    como 'kiosko' (solo registrar actividades), igual que antes. Si trae
    credenciales se validan normalmente y se exige registrar_actividades,
    reportes_actividades o alguna de `otras_pestanas`."""
    def _dep(request: Request, db: Session = Depends(get_db)) -> Usuario:
        if not _hay_credencial(request):
            if settings.KIOSKO_SIN_SESION:
                return KIOSKO
            raise HTTPException(401, "Sesión no iniciada")
        user = get_current_user(request, db)
        if not user.puede(*PESTANAS_TRACTORISTA, "reportes_actividades", *otras_pestanas):
            raise HTTPException(403, "No autorizado")
        return user
    return _dep


def requiere(*pestanas: str):
    """Exige alguna de las pestanas (los admins del modulo pasan siempre)."""
    def _dep(user: Usuario = Depends(get_current_user)) -> Usuario:
        if not user.puede(*pestanas):
            raise HTTPException(403, "No autorizado")
        return user
    return _dep


def requiere_admin(user: Usuario = Depends(get_current_user)) -> Usuario:
    if user.es_tractorista or not user.es_admin:
        raise HTTPException(403, "Solo administradores del módulo")
    return user


def requiere_usuario_hub(user: Usuario = Depends(get_current_user)) -> Usuario:
    if user.es_tractorista:
        raise HTTPException(403, "No autorizado")
    return user


def usuario_efectivo(request: Request, user: Usuario) -> Usuario:
    """'Ver como': un admin del modulo puede mandar X-Ver-Como con el login de
    otro usuario para ver las LECTURAS filtradas como el (p.ej. que fichas ve
    un supervisor). Las escrituras siempre son con su identidad real."""
    ver_como = (request.headers.get("X-Ver-Como") or "").strip().lower()
    if not ver_como or not user.es_admin or user.es_tractorista or not user.token:
        return user
    datos = hub.usuarios_lote([ver_como], user.token, incluir_cargo=True).get(ver_como)
    if not datos or not datos.get("activo", True):
        return user
    return Usuario(username=ver_como, tipo="hub", nombre=hub.nombre_de_trato(datos, ver_como),
                   rol=datos.get("cargo") or "", id_persona=datos.get("id_persona"))


def cedula_de(user: Usuario) -> str | None:
    """Cedula del usuario (maestro Personas) para casar con catalogos locales."""
    if not user.id_persona:
        return None
    p = personas.lote([user.id_persona], user.token).get(int(user.id_persona))
    return (p or {}).get("identificacion")
