"""Cliente del HUB: permisos del modulo y datos de usuarios.

Siempre se reenvia el token DEL USUARIO (el de su cookie): el HUB decide con
sus propios permisos que puede ver/hacer (p.ej. solo un gestor del modulo
puede listar usuarios o cambiar pestanas).
"""
import logging
import time

import httpx

from ..config import settings

logger = logging.getLogger(__name__)
_client = httpx.Client(timeout=settings.TIMEOUT_SERVICIOS)
MODULO = settings.MODULO_CLAVE

_PERMISOS_TTL = 15      # una pantalla dispara varias llamadas a la vez
_permisos_cache: dict[str, tuple[float, dict]] = {}
_NOMBRES_TTL = 600
_nombres_cache: dict[str, tuple[float, dict]] = {}


class HubError(Exception):
    def __init__(self, status: int, detalle: str):
        super().__init__(detalle)
        self.status, self.detalle = status, detalle


def _req(metodo: str, ruta: str, token: str, **kw):
    try:
        r = _client.request(metodo, f"{settings.HUB_API_URL.rstrip('/')}{ruta}",
                            headers={"Authorization": f"Bearer {token}"}, **kw)
    except httpx.HTTPError as e:
        logger.warning("HUB no responde (%s %s): %s", metodo, ruta, e)
        raise HubError(503, "El HUB no responde") from e
    if r.status_code >= 400:
        try:
            detalle = r.json().get("detail", r.text)
        except ValueError:
            detalle = r.text
        raise HubError(r.status_code, str(detalle))
    return r.json()


def mis_permisos(usuario: str, token: str) -> dict | None:
    """{tiene_acceso, es_admin, pestanas}; None si el HUB no responde (el
    usuario queda sin privilegios, nunca con mas)."""
    c = _permisos_cache.get(usuario)
    if c and time.monotonic() - c[0] < _PERMISOS_TTL:
        return c[1]
    try:
        data = _req("GET", f"/modulos/{MODULO}/mis-permisos", token)
    except HubError as e:
        logger.warning("No se pudieron leer permisos de %s: %s", usuario, e.detalle)
        return None
    _permisos_cache[usuario] = (time.monotonic(), data)
    return data


def invalidar_permisos(usuario: str) -> None:
    _permisos_cache.pop(usuario.lower(), None)


def usuarios_del_modulo(token: str, solo_con_acceso: bool = False) -> list[dict]:
    """Usuarios activos del HUB con sus permisos en el modulo (solo gestores)."""
    return _req("GET", f"/modulos/{MODULO}/usuarios", token,
                params={"solo_con_acceso": str(solo_con_acceso).lower()})["usuarios"]


def poner_pestanas(usuario: str, pestanas: list[str], token: str) -> dict:
    data = _req("PUT", f"/modulos/{MODULO}/usuarios/{usuario}/pestanas", token, json={"pestanas": pestanas})
    invalidar_permisos(usuario)
    return data


def usuarios_lote(usuarios: list[str], token: str, incluir_cargo: bool = False) -> dict[str, dict]:
    """{usuario: {nombre, apellido, correo, id_persona, cargo?...}}. Tolerante a
    fallo: si el HUB no responde devuelve lo que haya en cache."""
    pedidos = sorted({u.strip().lower() for u in usuarios if u and u.strip()})
    ahora = time.monotonic()
    out, faltan = {}, []
    for u in pedidos:
        c = _nombres_cache.get(f"{u}|{incluir_cargo}")
        if c and ahora - c[0] < _NOMBRES_TTL:
            out[u] = c[1]
        else:
            faltan.append(u)
    for i in range(0, len(faltan), 500):
        try:
            data = _req("POST", "/usuarios/lote", token,
                        json={"usuarios": faltan[i:i + 500], "incluir_cargo": incluir_cargo})
        except HubError as e:
            logger.warning("No se pudo leer el lote de usuarios: %s", e.detalle)
            break
        for d in data.get("usuarios", []):
            out[d["usuario"]] = d
            _nombres_cache[f"{d['usuario']}|{incluir_cargo}"] = (ahora, d)
    return out


def nombre_de_trato(datos: dict | None, respaldo: str) -> str:
    """'Nombre Apellido' de hub.usuario (no los nombres completos de Personas)."""
    if not datos:
        return respaldo
    return f"{datos.get('nombre') or ''} {datos.get('apellido') or ''}".strip() or respaldo
