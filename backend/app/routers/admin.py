"""Administracion de usuarios del modulo: por API del HUB (el HUB exige que
quien llama sea admin del modulo o tenga su pestana 'usuarios')."""
from fastapi import APIRouter, Depends, HTTPException

from ..auth import PESTANAS, Usuario, requiere_usuario_hub
from ..clients import hub

router = APIRouter(prefix="/api/admin")


def _hub(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except hub.HubError as e:
        raise HTTPException(e.status if e.status in (400, 403, 404, 409, 422) else 502, e.detalle)


def _fila(u: dict) -> dict:
    """Misma forma que devolvia la base vieja (la pantalla no cambia)."""
    return {"usuario": u["usuario"], "nombre_completo": hub.nombre_de_trato(u, u["usuario"]),
            "correo": u.get("correo") or "", "rol": u.get("cargo") or "", "departamento": u.get("departamento") or "",
            "sub_permisos": [p for p in (u.get("pestanas") or []) if p in PESTANAS],
            "es_admin": bool(u.get("es_admin")), "activo": True}


@router.get("/usuarios")
def listar(user: Usuario = Depends(requiere_usuario_hub)):
    filas = _hub(hub.usuarios_del_modulo, user.token, solo_con_acceso=True)
    return {"usuarios": sorted((_fila(u) for u in filas), key=lambda f: f["nombre_completo"].upper()),
            "permisos_disponibles": PESTANAS}


@router.get("/usuarios/buscar")
def buscar(q: str = "", user: Usuario = Depends(requiere_usuario_hub)):
    q = q.strip().lower()
    if len(q) < 2:
        return []
    filas = [_fila(u) for u in _hub(hub.usuarios_del_modulo, user.token)]
    hits = [f for f in filas if q in f["usuario"] or q in f["nombre_completo"].lower() or q in f["correo"].lower()]
    return sorted(hits, key=lambda f: f["nombre_completo"].upper())[:15]


@router.put("/usuarios/{username}/permisos")
def poner_permisos(username: str, data: dict, user: Usuario = Depends(requiere_usuario_hub)):
    pestanas = [p for p in (data.get("sub_permisos") or []) if p in PESTANAS]
    r = _hub(hub.poner_pestanas, username, pestanas, user.token)
    return {"message": "Permisos actualizados", "sub_permisos": r.get("pestanas", pestanas)}


@router.post("/usuarios/{username}/agregar")
def agregar(username: str, user: Usuario = Depends(requiere_usuario_hub)):
    """El acceso al modulo se crea en el HUB al asignarle la primera pestana
    (Administracion abre el panel de permisos despues de agregar)."""
    if not hub.usuarios_lote([username], user.token).get(username.strip().lower()):
        raise HTTPException(404, "Usuario no encontrado")
    return {"message": "Asigne al menos una pestaña para darle acceso al módulo"}


@router.delete("/usuarios/{username}/quitar")
def quitar(username: str, user: Usuario = Depends(requiere_usuario_hub)):
    _hub(hub.poner_pestanas, username, [], user.token)
    return {"message": "Se le quitaron todas las pestañas del módulo"}
