"""Actualizacion de la app de las tablets (APK "Tractor Nintanga").

El APK firmado lo sube aplicacion_dispositivo/publicar.ps1 al bucket del modulo:
  apk/version.json                  -> {"version_code", "version_name", "archivo", "notas", "fecha"}
  apk/TractorNintanga-<code>.apk

- La app pregunta /version al abrir (con señal); si hay una mas nueva ofrece "Actualizar".
- /descargar es la direccion fija para la PRIMERA instalacion en cada tablet.
El bucket es privado: se entrega un enlace firmado que vence en 1 hora.
"""
import json
import logging

import boto3
from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse

from ..config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/app-tablet", tags=["app-tablet"])
_s3 = boto3.client("s3", **settings.aws_kwargs())
CARPETA = "apk"


def _ultima() -> dict:
    try:
        obj = _s3.get_object(Bucket=settings.S3_BUCKET, Key=f"{CARPETA}/version.json")
        return json.loads(obj["Body"].read())
    except Exception as e:  # noqa: BLE001
        logger.warning("No se pudo leer apk/version.json: %s", e)
        raise HTTPException(404, "Aún no hay una versión publicada de la app")


def _enlace(v: dict) -> str:
    return _s3.generate_presigned_url(
        "get_object", ExpiresIn=3600,
        Params={"Bucket": settings.S3_BUCKET, "Key": f"{CARPETA}/{v['archivo']}",
                "ResponseContentType": "application/vnd.android.package-archive",
                "ResponseContentDisposition": f"attachment; filename=\"{v['archivo']}\""})


@router.get("/version")
def version():
    v = _ultima()
    return {"version_code": int(v["version_code"]), "version_name": v.get("version_name"),
            "notas": v.get("notas") or "", "fecha": v.get("fecha"), "url": _enlace(v)}


@router.get("/descargar")
def descargar():
    return RedirectResponse(_enlace(_ultima()), status_code=302)
