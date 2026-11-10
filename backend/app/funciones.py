"""Funcion de cada persona del catalogo de Tractoristas: TRACTOR, DRON o AMBOS.

- TRACTOR (por defecto): entra en tractoristas.miraigprovefrut.com (Bitacora Tractor).
- DRON: piloto de dron, entra en dron.miraigprovefrut.com (Bitacora Dron).
- AMBOS: entra en los dos.
Sin tabla nueva: es un mapa {id_tractorista: funcion} en `parametro`
(clave 'funciones_tractorista'); quien no esta en el mapa es TRACTOR.
"""
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from .models import Parametro

CLAVE = "funciones_tractorista"
FUNCIONES = ("TRACTOR", "DRON", "AMBOS")
PESTANAS_POR_FUNCION = {
    "TRACTOR": ["registrar_actividades"],
    "DRON": ["bitacora_dron"],
    "AMBOS": ["registrar_actividades", "bitacora_dron"],
}


def todas(db: Session) -> dict[int, str]:
    p = db.scalar(select(Parametro).where(Parametro.clave == CLAVE))
    return {int(k): v for k, v in ((p.valor or {}) if p else {}).items() if v in FUNCIONES}


def de(db: Session, id_tractorista: int) -> str:
    return todas(db).get(id_tractorista, "TRACTOR")


def guardar(db: Session, id_tractorista: int, funcion: str, usuario: str) -> None:
    funcion = (funcion or "TRACTOR").upper()
    if funcion not in FUNCIONES:
        raise ValueError("Función no válida (TRACTOR, DRON o AMBOS)")
    p = db.scalar(select(Parametro).where(Parametro.clave == CLAVE).with_for_update())
    if p is None:
        p = Parametro(clave=CLAVE, valor={})
        db.add(p)
    valor = dict(p.valor or {})
    if funcion == "TRACTOR":
        valor.pop(str(id_tractorista), None)
    else:
        valor[str(id_tractorista)] = funcion
    p.valor = valor
    p.actualizado_por = usuario
    flag_modified(p, "valor")


def puede_entrar(funcion: str, equipo: str | None) -> bool:
    if (equipo or "Tractores") == "Drones":
        return funcion in ("DRON", "AMBOS")
    return funcion in ("TRACTOR", "AMBOS")
