"""Tema de la empresa (colores y logo) desde el maestro Empresas. PUBLICO como
antes: el frontend pinta los colores antes de tener sesion (solo nombre,
colores y URL del logo). Se mantiene la forma vieja (numero, activa...)."""
from fastapi import APIRouter

from ..clients import empresas

router = APIRouter(prefix="/api/v1")


@router.get("/empresas")
def listar_empresas():
    return [{**e, "id": e.get("id_empresa") or e.get("numero_empresa"), "numero": e.get("numero_empresa"),
             "nombre": e.get("nombre") or e.get("nombre_comercial"), "activa": True}
            for e in empresas.temas()]
