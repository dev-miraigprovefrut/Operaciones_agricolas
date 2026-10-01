"""Conexiones: mirai_core (esquema operaciones_agricolas) y, solo lectura, la
base de Mantenimiento (horometros) mientras no exista su API."""
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from .config import settings

engine = create_engine(
    settings.database_url,
    pool_size=5, max_overflow=5, pool_pre_ping=True, pool_recycle=300,
    connect_args={"connect_timeout": 5, "options": f"-c search_path={settings.DB_SCHEMA},public"},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


_mant = {"engine": None, "Session": None}


def _sesion_mantenimiento():
    if _mant["engine"] is None:
        url = settings.mantenimiento_url
        if not url:
            return None
        _mant["engine"] = create_engine(
            url, pool_size=2, max_overflow=2, pool_pre_ping=True, pool_recycle=300,
            connect_args={"connect_timeout": 5, "options": "-c default_transaction_read_only=on"})
        _mant["Session"] = sessionmaker(autocommit=False, autoflush=False, bind=_mant["engine"])
    return _mant["Session"]()


def get_mant_db():
    """Sesion de SOLO LECTURA a la base de Mantenimiento (None si no hay config)."""
    db = _sesion_mantenimiento()
    try:
        yield db
    finally:
        if db is not None:
            db.close()
