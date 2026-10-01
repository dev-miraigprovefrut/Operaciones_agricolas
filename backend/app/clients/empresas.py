"""Cliente del maestro Empresas: nombre, colores y logo (tema) de Nintanga."""
import logging
import time

import httpx

from ..config import settings
from . import servicio

logger = logging.getLogger(__name__)
_client = httpx.Client(timeout=settings.TIMEOUT_SERVICIOS)
_TTL = 300
_cache: dict = {"ts": 0.0, "empresas": []}


def temas() -> list[dict]:
    """Empresas activas con su tema. Cache 5 min; si el maestro no responde se
    devuelve la ultima copia buena. Dato comun: va con el token de servicio."""
    if _cache["empresas"] and time.monotonic() - _cache["ts"] < _TTL:
        return _cache["empresas"]
    try:
        r = _client.get(f"{settings.API_EMPRESAS_URL.rstrip('/')}/empresas-temas",
                        headers={"Authorization": f"Bearer {servicio.token()}"})
        r.raise_for_status()
        _cache.update(ts=time.monotonic(), empresas=r.json().get("empresas", []))
    except (httpx.HTTPError, ValueError) as e:
        logger.warning("Maestro Empresas no responde: %s", e)
    return _cache["empresas"]
