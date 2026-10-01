"""Cliente del maestro Personas (personasbk). Los tractoristas y supervisores
son personas del maestro: aqui solo se guarda su id_persona.

Se usa el token del usuario cuando lo hay; si no (login de tractorista), el
token de servicio del modulo.
"""
import logging
import time

import httpx

from ..config import settings
from . import servicio

logger = logging.getLogger(__name__)
_client = httpx.Client(timeout=settings.TIMEOUT_SERVICIOS)
_TTL = 600
_cache: dict[int, tuple[float, dict]] = {}
_catalogo = {"ts": 0.0, "filas": []}


class PersonasError(Exception):
    def __init__(self, status: int, detalle: str):
        super().__init__(detalle)
        self.status, self.detalle = status, detalle


def _req(metodo: str, ruta: str, token: str | None = None, **kw):
    try:
        r = _client.request(metodo, f"{settings.API_PERSONAS_URL.rstrip('/')}{ruta}",
                            headers={"Authorization": f"Bearer {token or servicio.token()}"}, **kw)
    except httpx.HTTPError as e:
        logger.warning("Personas no responde (%s %s): %s", metodo, ruta, e)
        raise PersonasError(503, "El maestro de Personas no responde") from e
    if r.status_code == 404:
        return None
    if r.status_code >= 400:
        raise PersonasError(r.status_code, r.text[:300])
    return r.json()


def nombre_legal(p: dict | None) -> str:
    """APELLIDOS NOMBRES (como estaba en el catalogo viejo de tractoristas)."""
    if not p:
        return ""
    partes = [p.get("apellido_paterno"), p.get("apellido_materno"), p.get("primer_nombre"), p.get("segundo_nombre")]
    return " ".join(x.strip() for x in partes if x and x.strip())


def por_cedula(cedula: str, token: str | None = None) -> dict | None:
    cedula = (cedula or "").strip()
    if not cedula:
        return None
    return _req("GET", f"/personas/{cedula}", token)


def lote(ids: list[int], token: str | None = None) -> dict[int, dict]:
    """{id_persona: persona} con cache; tolerante a fallo (devuelve lo que haya)."""
    ahora = time.monotonic()
    out, faltan = {}, []
    for i in {int(x) for x in ids if x}:
        c = _cache.get(i)
        if c and ahora - c[0] < _TTL:
            out[i] = c[1]
        else:
            faltan.append(i)
    for k in range(0, len(faltan), 1000):
        try:
            data = _req("POST", "/personas/lote", token, json={"ids": faltan[k:k + 1000]}) or {}
        except PersonasError as e:
            logger.warning("No se pudo leer el lote de personas: %s", e.detalle)
            break
        for p in data.get("personas", []):
            out[p["id_persona"]] = p
            _cache[p["id_persona"]] = (ahora, p)
    return out


def catalogo_empresa(token: str | None = None) -> list[dict]:
    """Personal de la empresa del modulo con cargo resuelto (cache 10 min)."""
    if _catalogo["filas"] and time.monotonic() - _catalogo["ts"] < _TTL:
        return _catalogo["filas"]
    try:
        data = _req("GET", "/personas/catalogo", token, params={"numero_empresa": settings.NUMERO_EMPRESA}) or {}
        _catalogo.update(ts=time.monotonic(), filas=data.get("empleados", []))
    except PersonasError as e:
        logger.warning("No se pudo leer el catalogo de personal: %s", e.detalle)
    return _catalogo["filas"]
