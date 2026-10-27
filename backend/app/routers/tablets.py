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
    p.valor = {"lista": lista}
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
class RegistrarIn(BaseModel):
    tractor: str = Field(min_length=3, max_length=150)
    llave: str = Field(min_length=32, max_length=200)
    descripcion: str | None = Field(None, max_length=200)


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
    llave = hash_llave(body.llave)
    p, lista = _lista(db, para_escribir=True)
    ya = next((t for t in lista if t.get("activo") and t.get("tractor") == tractor), None)
    if ya and ya.get("llave_hash") == llave:            # reintento de la misma tablet
        return {"tractor": ya["tractor"], "id": ya["id"]}
    if ya:
        raise HTTPException(409, f"El tractor {tractor} ya tiene una tablet registrada ({ya.get('descripcion')}). "
                                 "Para cambiarla, désela de baja en Catálogos › Tractoristas › Tablets.")
    ahora = ahora_ecuador().isoformat(timespec="seconds")
    for t in lista:                                     # esta tablet estaba en otro tractor
        if t.get("activo") and t.get("llave_hash") == llave:
            t.update(activo=False, fecha_baja=ahora, baja_por="cambio de tractor")
    nuevo = {"id": max((t.get("id", 0) for t in lista), default=0) + 1, "tractor": tractor, "llave_hash": llave,
             "descripcion": (body.descripcion or "Tablet")[:200], "activo": True, "fecha_alta": ahora, "ultimo_uso": ahora}
    lista.append(nuevo)
    _guardar(db, p, lista, "tablet")
    return {"tractor": tractor, "id": nuevo["id"]}


@router.get("/yo")
def yo(db: Session = Depends(get_db), t=Depends(tablet_de)):
    marcar_uso(db, t.id)
    return {"tractor": t.tractor, "id": t.id}
