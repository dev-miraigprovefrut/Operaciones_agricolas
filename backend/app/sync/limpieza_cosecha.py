"""Limpieza nocturna de camiones de cosecha VACIOS.

Un camion en estado Activo sin ningun producto (toque de mas al crear, o
ficha abandonada) que lleva mas de 24 horas creado pasa a Eliminado. No se
borra de la base. Si despues le llegan productos (celular que estaba sin
senal), guardar_productos lo reactiva.
"""
import logging

from sqlalchemy import text

from ..database import SessionLocal

logger = logging.getLogger(__name__)


def main() -> int:
    db = SessionLocal()
    try:
        n = db.execute(text("""
            UPDATE cosecha_transporte t SET estado = 'Eliminado'
            WHERE t.estado = 'Activo'
              AND t.fecha_creacion < (now() AT TIME ZONE 'America/Guayaquil') - INTERVAL '24 hours'
              AND NOT EXISTS (SELECT 1 FROM cosecha c WHERE c.id_cosecha_transporte = t.id_cosecha_transporte)
        """)).rowcount
        db.commit()
        logger.info("Limpieza de cosecha: %s camiones vacios eliminados", n)
        return n
    finally:
        db.close()
