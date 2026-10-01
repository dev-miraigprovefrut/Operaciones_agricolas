"""Utilidades comunes."""
from datetime import datetime, timedelta, timezone

TZ_ECUADOR = timezone(timedelta(hours=-5))


def ahora_ecuador() -> datetime:
    """Hora actual de Ecuador (UTC-5) sin tzinfo, como se guarda en la base."""
    return datetime.now(TZ_ECUADOR).replace(tzinfo=None)


def estado_db(valor: str | None, defecto: str = "ACTIVO") -> str:
    """Estado de catalogo que llega de la app ('Activo'/'Inactivo') -> base."""
    if valor is None or str(valor).strip() == "":
        return defecto
    return "ACTIVO" if str(valor).strip().upper() == "ACTIVO" else "INACTIVO"


def estado_api(valor: str | None) -> str:
    """Estado de catalogo de la base -> como lo muestra la app ('Activo')."""
    return "Activo" if (valor or "").upper() == "ACTIVO" else "Inactivo"
