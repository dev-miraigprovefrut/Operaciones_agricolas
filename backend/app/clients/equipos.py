"""Tractores y aperos (DynamoDB CatalogoTractores / CatalogoAperos).

PROVISIONAL: queda igual que en el sistema anterior hasta que el catalogo del
maestro de Activos este listo; entonces este cliente se reemplaza por su API.
Las bombas de fumigacion ya salen del maestro de Activos y se suman a la
lista de aperos.
"""
import logging

import boto3
import httpx

from ..config import settings
from . import servicio

logger = logging.getLogger(__name__)
_dynamo = boto3.resource("dynamodb", **settings.aws_kwargs())
_http = httpx.Client(timeout=settings.TIMEOUT_SERVICIOS)
TIPOS_ACTIVOS_APERO = ("BOMBA DE FUMIGACION",)
TIPO_ACTIVO_DRON = "EQUIPOS DRON"


def _scan(tabla: str) -> list[dict]:
    t = _dynamo.Table(tabla)
    r = t.scan()
    items = r.get("Items", [])
    while "LastEvaluatedKey" in r:
        r = t.scan(ExclusiveStartKey=r["LastEvaluatedKey"])
        items.extend(r.get("Items", []))
    return items


def tractores() -> list[dict]:
    out = []
    for i in _scan(settings.DDB_CATALOGO_TRACTORES):
        out.append({
            "id": i.get("id", ""), "marca": i.get("marca", ""), "modelo": i.get("modelo", ""),
            "numeracion": i.get("numeracion", ""), "anio_fabricacion": i.get("anio_fabricacion", ""),
            "estado_equipo": i.get("estado_equipo", ""), "horometro": i.get("horometro", ""),
            "proyectos": i.get("proyectos", []), "tipo_cultivo": i.get("tipo_cultivo", ""),
            "observaciones": i.get("observaciones", ""),
            "nombre": f"{i.get('marca', '')} {i.get('modelo', '')} - {i.get('numeracion', '')}",
        })
    return out


def aperos() -> list[dict]:
    out = []
    for i in _scan(settings.DDB_CATALOGO_APEROS):
        out.append({
            "id": i.get("id", ""), "marca": i.get("marca", ""), "numeracion": i.get("numeracion", ""),
            "tipo_implemento": i.get("tipo_implemento", ""), "descripcion_implemento": i.get("descripcion_implemento", ""),
            "actividad": i.get("actividad", ""), "cultivo": i.get("cultivo", ""), "proyectos": i.get("proyectos", []),
            "tipo_tractor": i.get("tipo_tractor", ""), "recuperada": i.get("recuperada", False),
            "nombre": i.get("descripcion_implemento", "") or f"{i.get('tipo_implemento', '')} - {i.get('numeracion', '')}",
        })
    # Una bomba que ya esta en CatalogoAperos con la misma numeracion no se repite
    ya = {_num(a["numeracion"]) for a in out if "BOMBA" in (a["tipo_implemento"] or "").upper()}
    out.extend(b for b in _bombas_activos() if _num(b["numeracion"]) not in ya)
    return out


def _num(v) -> str:
    return (str(v or "").strip().lstrip("0")) or "0"


def _activos(tipo: str) -> list[dict]:
    """Activos vigentes de un tipo (empresa del modulo) del maestro de Activos.
    Si Activos no responde devuelve [] (no se rompe la bitacora)."""
    try:
        r = _http.get(f"{settings.API_ACTIVOS_URL.rstrip('/')}/activos",
                      params={"tipo_equipo": tipo, "numero_empresa": settings.NUMERO_EMPRESA, "limit": 500},
                      headers={"Authorization": f"Bearer {servicio.token()}"})
        r.raise_for_status()
        return [a for a in r.json() if a.get("activo", True)]
    except (httpx.HTTPError, ValueError) as e:
        logger.warning("No se pudo leer %s del maestro de Activos: %s", tipo, e)
        return []


def _proyectos(a: dict) -> list[str]:
    """Fincas del activo: lista 'proyectos' (modelo nuevo) o texto 'proyecto'
    separado por coma (modelo anterior)."""
    if isinstance(a.get("proyectos"), list):
        return [str(p).strip() for p in a["proyectos"] if str(p).strip()]
    return [p.strip() for p in (a.get("proyecto") or "").split(",") if p.strip()]


def drones() -> list[dict]:
    """Drones del maestro de Activos. 'nombre' es lo que se guarda en el
    registro (campo tractor), ej. '080 - DRON'."""
    return [{"id": a.get("codigo", ""), "numeracion": a.get("numeracion") or "",
             "descripcion": a.get("descripcion") or "", "proyecto": ", ".join(_proyectos(a)),
             "nombre": f"{a.get('numeracion') or ''} - DRON".strip(" -")}
            for a in _activos(TIPO_ACTIVO_DRON)]


def _bombas_activos() -> list[dict]:
    """Bombas de fumigacion del maestro de Activos, con la forma de un apero."""
    out = []
    for tipo in TIPOS_ACTIVOS_APERO:
        for a in _activos(tipo):
            desc = (a.get("descripcion") or "").strip()
            if "BOMBA" not in desc.upper():     # ej. "USO EXCLUSIVO GUAYTACAMA"
                desc = f"{tipo} ({desc})" if desc else tipo
            out.append({
                "id": a.get("codigo", ""), "marca": a.get("marca") or "", "numeracion": a.get("numeracion") or "",
                "tipo_implemento": desc, "descripcion_implemento": desc,
                "actividad": a.get("actividad") or "", "cultivo": a.get("cultivo") or "",
                "proyectos": _proyectos(a),
                "tipo_tractor": "", "recuperada": False, "nombre": desc,
            })
    return out


def actualizar_horometro(tractor_id: str, horometro: float) -> None:
    _dynamo.Table(settings.DDB_CATALOGO_TRACTORES).update_item(
        Key={"id": tractor_id}, UpdateExpression="SET horometro = :h", ExpressionAttributeValues={":h": horometro})
