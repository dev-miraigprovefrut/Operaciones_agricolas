"""Tractores y aperos (DynamoDB CatalogoTractores / CatalogoAperos).

PROVISIONAL: queda igual que en el sistema anterior hasta que el catalogo del
maestro de Activos este listo; entonces este cliente se reemplaza por su API.
"""
import boto3

from ..config import settings

_dynamo = boto3.resource("dynamodb", **settings.aws_kwargs())


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
    return out


def actualizar_horometro(tractor_id: str, horometro: float) -> None:
    _dynamo.Table(settings.DDB_CATALOGO_TRACTORES).update_item(
        Key={"id": tractor_id}, UpdateExpression="SET horometro = :h", ExpressionAttributeValues={":h": horometro})
