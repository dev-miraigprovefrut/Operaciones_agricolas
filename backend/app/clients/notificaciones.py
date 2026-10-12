"""Avisos al servicio de Notificaciones (campana del HUB)."""
import logging
import threading

import httpx

from ..config import settings
from . import servicio   # token de servicio: Notificaciones solo acepta avisos de backends

logger = logging.getLogger(__name__)
SOURCE_APP = "operagricola"


def _enviar(destinatarios: list[str], titulo: str, mensaje: str, tipo: str, metadata: dict | None):
    url = f"{settings.NOTIFY_URL.rstrip('/')}/notifications/"
    with httpx.Client(timeout=5.0) as c:
        for user_id in destinatarios:
            body = {"user_id": user_id, "title": titulo, "message": mensaje, "type": tipo, "source_app": SOURCE_APP}
            if metadata:
                body["metadata"] = metadata
            try:
                r = c.post(url, json=body, headers={"Authorization": f"Bearer {servicio.token()}"})
                logger.info("[NOTIFY] %s: %s", user_id, r.status_code)
            except httpx.HTTPError as e:
                logger.error("[NOTIFY] %s: %s", user_id, e)


def notificar_en_segundo_plano(destinatarios: list[str], titulo: str, mensaje: str,
                               tipo: str = "warning", metadata: dict | None = None) -> None:
    """No bloquea la respuesta ni lanza excepciones."""
    if destinatarios:
        threading.Thread(target=_enviar, args=(destinatarios, titulo, mensaje, tipo, metadata), daemon=True).start()
