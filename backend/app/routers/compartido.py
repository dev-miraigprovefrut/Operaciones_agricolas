"""Lecturas que Operaciones Agricolas comparte con otros modulos de MirAI.

Mantenimiento (servicio multiempresa) toma de aqui, para Nintanga, los
OPERADORES de equipo (tractoristas) y las UBICACIONES (proyectos/fincas): son
datos de esta area operativa. En otras empresas esa fuente sera Produccion.

Solo lectura y solo con sesion valida del HUB (no exige acceso a este modulo).
El nombre de cada persona sale del maestro Personas, no se guarda aqui.
"""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import Usuario, sesion_mirai
from ..clients import personas
from ..comun import estado_api
from ..config import settings
from ..database import get_db
from ..models import Proyecto, Tractorista

router = APIRouter(prefix="/api/compartido", tags=["compartido"])


def _nombre(p: dict | None) -> str:
    """NOMBRES APELLIDOS (como se muestran en Mantenimiento)."""
    if not p:
        return ""
    partes = [p.get("primer_nombre"), p.get("segundo_nombre"), p.get("apellido_paterno"), p.get("apellido_materno")]
    return " ".join(x.strip() for x in partes if x and x.strip()).upper()


@router.get("/operadores")
def operadores(db: Session = Depends(get_db), user: Usuario = Depends(sesion_mirai)):
    """Tractoristas activos de la empresa del modulo (Nintanga)."""
    filas = list(db.scalars(select(Tractorista).where(Tractorista.estado == "ACTIVO")))
    gente = personas.lote([t.id_persona for t in filas], user.token)
    out = [{"cedula": t.cedula, "id_persona": t.id_persona, "nombre": _nombre(gente.get(t.id_persona)) or t.cedula,
            "funcion": "TRACTORISTA", "estado": "ACTIVO", "numero_empresa": settings.NUMERO_EMPRESA}
           for t in filas]
    return sorted(out, key=lambda r: r["nombre"])


@router.get("/ubicaciones")
def ubicaciones(db: Session = Depends(get_db), _: Usuario = Depends(sesion_mirai)):
    """Proyectos (fincas) de la empresa del modulo."""
    return [{"id": p.id, "nombre": p.nombre, "tipo": p.tipo, "estado": estado_api(p.estado),
             "numero_empresa": settings.NUMERO_EMPRESA}
            for p in db.scalars(select(Proyecto).order_by(Proyecto.nombre))]
