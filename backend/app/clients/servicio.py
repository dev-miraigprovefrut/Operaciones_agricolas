"""Token de SERVICIO del modulo para llamar a los maestros cuando no hay un
usuario del HUB de por medio (tractoristas, tema de empresas). Mismo patron
que el HUB: JWT firmado con la SECRET_KEY compartida, vida de 1 hora."""
import threading
import time

import jwt

from ..config import settings

_cache = {"token": None, "exp": 0.0}
_lock = threading.Lock()


def token() -> str:
    with _lock:
        if not _cache["token"] or time.time() > _cache["exp"] - 60:
            exp = int(time.time()) + 3600
            _cache.update(exp=exp, token=jwt.encode(
                {"sub": "operagricola-servicio", "username": "operagricola-servicio", "tipo": "servicio",
                 "tenant_id": settings.TENANT_ID, "exp": exp},
                settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM))
        return _cache["token"]
