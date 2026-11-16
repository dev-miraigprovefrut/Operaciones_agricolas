"""Tablets fijas en los tractores (APK "Tractor Nintanga", reemplaza a la Raspberry).

- La PRIMERA vez que se abre la app, en la tablet se elige el tractor del
  catalogo (como el tractor.txt de la Raspberry): queda atada a ese tractor con
  una llave que solo vive en ella (aqui su SHA-256). Una tablet activa por
  tractor: si ya hay una, no se registra otra hasta darla de baja en
  Catalogos > Tractoristas > Tablets (asi nadie le quita el tractor a la que
  funciona).
- La tablet se identifica con la cabecera X-Equipo (la llave): telemetria (GPS
  + horas de motor) sin sesion de tractorista, y los tractoristas entran en
  ella con su codigo SIN la regla de "un telefono por tractorista".
- Dar de baja: deja de funcionar al instante.

SIN TABLA NUEVA: los datos (actividades, checklists, telemetria) se guardan
donde siempre; el registro de tablets es una lista en `parametro` (clave
'tablets'), como la configuracion de la jornada.
"""
import hashlib
import hmac
from types import SimpleNamespace

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ..auth import Usuario, requiere
from ..comun import ahora_ecuador
from ..database import get_db
from ..models import Parametro

router = APIRouter(prefix="/api/tablets", tags=["tablets"])
CATALOGO = requiere("catalogos_tractoristas")
CABECERA = "X-Equipo"
CLAVE = "tablets"


def hash_llave(llave: str) -> str:
    return hashlib.sha256((llave or "").encode()).hexdigest()


def _fila(db: Session, para_escribir: bool = False) -> Parametro:
    q = select(Parametro).where(Parametro.clave == CLAVE)
    if para_escribir:
        q = q.with_for_update()
    p = db.scalar(q)
    if p is None:
        p = Parametro(clave=CLAVE, valor={"lista": []})
        db.add(p)
        db.flush()
    return p


def _lista(db: Session, para_escribir: bool = False) -> tuple[Parametro, list[dict]]:
    p = _fila(db, para_escribir)
    return p, list((p.valor or {}).get("lista", []))


def _guardar(db: Session, p: Parametro, lista: list[dict], usuario: str) -> None:
    p.valor = {**(p.valor or {}), "lista": lista}      # conserva el codigo de ajuste
    p.actualizado_por = usuario
    flag_modified(p, "valor")
    db.commit()


def _ns(d: dict | None):
    return SimpleNamespace(**d) if d else None


def tablet_por_llave(db: Session, llave: str | None):
    """Tablet ACTIVA con esa llave (o None)."""
    if not llave or len(llave) < 32:
        return None
    h = hash_llave(llave)
    _, lista = _lista(db)
    return _ns(next((t for t in lista if t.get("activo") and t.get("llave_hash") == h), None))


def tablet_activa(db: Session, id_tablet: int):
    _, lista = _lista(db)
    return _ns(next((t for t in lista if t.get("id") == id_tablet and t.get("activo")), None))


def marcar_uso(db: Session, id_tablet: int) -> None:
    p, lista = _lista(db, para_escribir=True)
    for t in lista:
        if t.get("id") == id_tablet:
            t["ultimo_uso"] = ahora_ecuador().isoformat(timespec="seconds")
    _guardar(db, p, lista, p.actualizado_por or "tablet")


def tablet_de(request: Request, db: Session = Depends(get_db)):
    """Dependencia: la tablet que llama (cabecera X-Equipo) o 401."""
    t = tablet_por_llave(db, request.headers.get(CABECERA))
    if not t:
        raise HTTPException(401, "Tablet no vinculada o dada de baja")
    return t


def _salida(t: dict) -> dict:
    return {k: t.get(k) for k in ("id", "tractor", "descripcion", "activo", "fecha_alta", "ultimo_uso")}


# ------------------------------------------------------------- catalogo
@router.get("")
def listar(db: Session = Depends(get_db), _: Usuario = Depends(CATALOGO)):
    _, lista = _lista(db)
    return sorted((_salida(t) for t in lista if t.get("activo")), key=lambda t: t["tractor"] or "")


@router.post("/{id_tablet}/baja")
def baja(id_tablet: int, db: Session = Depends(get_db), user: Usuario = Depends(CATALOGO)):
    p, lista = _lista(db, para_escribir=True)
    t = next((x for x in lista if x.get("id") == id_tablet), None)
    if not t:
        raise HTTPException(404, "Tablet no encontrada")
    t.update(activo=False, fecha_baja=ahora_ecuador().isoformat(timespec="seconds"), baja_por=user.username)
    _guardar(db, p, lista, user.username)
    return {"resultado": "dada_de_baja"}


# --------------------------------------------------------------- tablet
def _fijar_horometro(tractor: str, horometro: float | None) -> dict:
    """Deja el horometro del equipo en Mantenimiento (y Activos) con lo que marca el
    tablero; la telemetria de la tablet suma desde ese valor. No frena el registro."""
    if horometro is None:
        return {}
    from . import tractores as tr
    tractor_id, _ = tr._equipo_mant(tractor)       # el id tal como lo escribe Mantenimiento
    try:
        tr._mant("POST", "/equipo-horas/registrar-actividad",
                 {"tractor_id": tractor_id, "operador": "Ajuste al montar tablet", "horometro_inicial": round(horometro, 2)})
        tr._sesiones_horometro.pop(tractor_id, None)    # la proxima jornada parte del valor nuevo
        tr._anotar_horas(tractor_id, round(horometro, 2))
        return {"horometro": round(horometro, 2)}
    except Exception as e:  # noqa: BLE001
        tr.logger.warning("No se pudo fijar el horometro de %s: %s", tractor_id, e)
        return {"horometro_error": "La tablet quedó registrada, pero no se pudo guardar el horómetro. Ingréselo en Mantenimiento."}


class RegistrarIn(BaseModel):
    tractor: str = Field(min_length=3, max_length=150)
    llave: str = Field(min_length=32, max_length=200)
    descripcion: str | None = Field(None, max_length=200)
    # Horas que marca el horometro del equipo al montar la tablet: desde ahi se van sumando
    horometro: float | None = Field(None, ge=0, le=200000)


@router.post("/registrar")
def registrar(body: RegistrarIn, db: Session = Depends(get_db)):
    """Primera apertura de la app: la tablet elige su tractor del catalogo."""
    from ..clients import equipos
    tractor = body.tractor.strip()
    try:
        nombres = {t["nombre"] for t in equipos.tractores()}
    except Exception:  # noqa: BLE001
        raise HTTPException(502, "No se pudo leer el catálogo de tractores. Intente de nuevo.")
    if tractor not in nombres:
        raise HTTPException(404, "Ese tractor no está en el catálogo")
    t = _asignar(db, tractor, hash_llave(body.llave), body.descripcion or "Tablet", "tablet")
    return {"tractor": t["tractor"], "id": t["id"], **_fijar_horometro(tractor, body.horometro)}


def _asignar(db: Session, tractor: str, llave: str, descripcion: str, usuario: str) -> dict:
    """Ata la tablet (hash de su llave) al tractor. Si el tractor ya tiene OTRA tablet
    activa -> 409 (nadie le quita el tractor a la que funciona); si esta tablet estaba en
    otro tractor, esa vinculacion se da de baja."""
    p, lista = _lista(db, para_escribir=True)
    ya = next((t for t in lista if t.get("activo") and t.get("tractor") == tractor), None)
    if ya and ya.get("llave_hash") == llave:            # reintento de la misma tablet
        return ya
    if ya:
        raise HTTPException(409, f"El tractor {tractor} ya tiene una tablet registrada ({ya.get('descripcion')}). "
                                 "Para cambiarla, désela de baja en Catálogos › Operadores › Tablets.")
    ahora = ahora_ecuador().isoformat(timespec="seconds")
    for t in lista:                                     # esta tablet estaba en otro tractor
        if t.get("activo") and t.get("llave_hash") == llave:
            t.update(activo=False, fecha_baja=ahora, baja_por="cambio de tractor")
    nuevo = {"id": max((t.get("id", 0) for t in lista), default=0) + 1, "tractor": tractor, "llave_hash": llave,
             "descripcion": (descripcion or "Tablet")[:200], "activo": True, "fecha_alta": ahora, "ultimo_uso": ahora}
    lista.append(nuevo)
    _guardar(db, p, lista, usuario)
    return nuevo


@router.get("/yo")
def yo(db: Session = Depends(get_db), t=Depends(tablet_de)):
    marcar_uso(db, t.id)
    from . import tractores as tr
    _, horas = tr._equipo_mant(t.tractor)           # horometro actual en Mantenimiento (None si no aparece)
    return {"tractor": t.tractor, "id": t.id, "horometro": horas}


# ------------------------------------------------- ajustes en la tablet (engranaje)
# Cambiar el equipo o corregir el horometro DESDE la tablet pide un codigo de ajuste que
# define el administrador en Catalogos > Tablets (asi un tractorista no lo cambia solo).
# Se guarda solo su hash en el mismo parametro 'tablets'. 5 intentos fallidos -> 15 min.
_INTENTOS: dict[int, list] = {}
_MAX_INTENTOS, _BLOQUEO_MIN = 5, 15


def _hash_codigo(codigo: str) -> str:
    return hashlib.sha256(f"oa-ajuste-tablet:{codigo}".encode()).hexdigest()


class CodigoAjusteIn(BaseModel):
    codigo: str = Field(pattern=r"^\d{4,8}$")


@router.get("/codigo-ajuste")
def ver_codigo_ajuste(db: Session = Depends(get_db), _: Usuario = Depends(CATALOGO)):
    p = _fila(db)
    v = p.valor or {}
    return {"configurado": bool(v.get("codigo_ajuste_hash")), "actualizado_por": v.get("codigo_ajuste_por"),
            "fecha": v.get("codigo_ajuste_fecha")}


@router.put("/codigo-ajuste")
def poner_codigo_ajuste(body: CodigoAjusteIn, db: Session = Depends(get_db), user: Usuario = Depends(CATALOGO)):
    p = _fila(db, para_escribir=True)
    p.valor = {**(p.valor or {}), "codigo_ajuste_hash": _hash_codigo(body.codigo), "codigo_ajuste_por": user.username,
               "codigo_ajuste_fecha": ahora_ecuador().isoformat(timespec="seconds")}
    p.actualizado_por = user.username
    flag_modified(p, "valor")
    db.commit()
    _INTENTOS.clear()
    return {"configurado": True}


class AjustarIn(BaseModel):
    codigo: str = Field(pattern=r"^\d{4,8}$")
    tractor: str | None = Field(None, min_length=3, max_length=150)     # cambiar de equipo
    horometro: float | None = Field(None, ge=0, le=200000)            # corregir el horometro


def _verificar_codigo(db: Session, id_tablet: int, codigo: str) -> None:
    import time
    ahora = time.time()
    fallos = [f for f in _INTENTOS.get(id_tablet, []) if ahora - f < _BLOQUEO_MIN * 60]
    if len(fallos) >= _MAX_INTENTOS:
        raise HTTPException(429, f"Demasiados intentos. Espere {_BLOQUEO_MIN} minutos.")
    guardado = (_fila(db).valor or {}).get("codigo_ajuste_hash")
    if not guardado:
        raise HTTPException(409, "Aún no hay código de ajuste. Pídale al administrador que lo cree en Catálogos › Tablets.")
    if not hmac.compare_digest(guardado, _hash_codigo(codigo)):
        _INTENTOS[id_tablet] = fallos + [ahora]
        raise HTTPException(403, "Código incorrecto")
    _INTENTOS.pop(id_tablet, None)


@router.post("/ajustar")
def ajustar(body: AjustarIn, request: Request, db: Session = Depends(get_db), t=Depends(tablet_de)):
    """Engranaje de la tablet: con el codigo de ajuste, cambia su equipo y/o fija el horometro."""
    _verificar_codigo(db, t.id, body.codigo)
    if not body.tractor and body.horometro is None:     # solo validar el codigo (abrir el panel)
        return {"tractor": t.tractor, "id": t.id}
    tractor, id_tablet = t.tractor, t.id
    nuevo = (body.tractor or "").strip()
    if nuevo and nuevo != t.tractor:
        from ..clients import equipos
        try:
            nombres = {x["nombre"] for x in equipos.tractores()}
        except Exception:  # noqa: BLE001
            raise HTTPException(502, "No se pudo leer el catálogo de tractores. Intente de nuevo.")
        if nuevo not in nombres:
            raise HTTPException(404, "Ese tractor no está en el catálogo")
        a = _asignar(db, nuevo, hash_llave(request.headers.get(CABECERA)), t.descripcion or "Tablet", "tablet (ajuste)")
        tractor, id_tablet = a["tractor"], a["id"]
    return {"tractor": tractor, "id": id_tablet, **_fijar_horometro(tractor, body.horometro)}
