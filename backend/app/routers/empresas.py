"""Tema de la empresa (colores y logo) desde el maestro Empresas. PUBLICO como
antes: el frontend pinta los colores antes de tener sesion (solo nombre,
colores y logo). Se mantiene la forma vieja (numero, activa...)."""
from urllib.parse import urlparse

import boto3
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from ..clients import empresas
from ..config import settings

router = APIRouter(prefix="/api/v1")
_s3 = boto3.client("s3", **settings.aws_kwargs())


@router.get("/empresas")
def listar_empresas():
    return [{**e, "id": e.get("id_empresa") or e.get("numero_empresa"), "numero": e.get("numero_empresa"),
             "nombre": e.get("nombre") or e.get("nombre_comercial"), "activa": True}
            for e in empresas.temas()]


@router.get("/empresas/logo/{numero_empresa}")
def logo_empresa(numero_empresa: str):
    """Logo de la empresa servido por este backend: el bucket del tema es
    privado (la URL directa de S3 da 403). Solo sirve el logo registrado de esa
    empresa en el maestro, nunca otra llave del bucket."""
    e = next((x for x in empresas.temas() if str(x.get("numero_empresa")) == numero_empresa), None)
    url = urlparse((e or {}).get("logo_url") or "")
    if not url.netloc.endswith(".amazonaws.com") or ".s3." not in url.netloc:
        raise HTTPException(404, "Logo no encontrado")
    bucket, key = url.netloc.split(".s3.")[0], url.path.lstrip("/")
    try:
        obj = _s3.get_object(Bucket=bucket, Key=key)
    except Exception:  # noqa: BLE001
        raise HTTPException(404, "Logo no encontrado")
    return StreamingResponse(obj["Body"], media_type=obj.get("ContentType") or "image/png",
                             headers={"Cache-Control": "public, max-age=86400"})
