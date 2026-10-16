"""Fichas de cosecha (transporte + productos), fotos de seguridad y sync con
Informix. Las respuestas conservan los nombres de campo de antes (id,
id_transporte, correccion_id...) aunque las columnas sigan la convencion nueva.
"""
import base64
import binascii
import io
import json
import logging
import os
import uuid
from datetime import datetime
from typing import List, Optional

import boto3
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth import Usuario, cedula_de, requiere, usuario_efectivo
from ..comun import ahora_ecuador
from .tractores import _fecha_evento
from ..config import settings
from ..database import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")
_s3 = boto3.client("s3", **settings.aws_kwargs())
S3_CARPETA = "reportesseguridadcamiones"

LEER = requiere("registrar_cosecha", "reportes_cosecha", "reportes_seguridad")
GESTOR = "reportes_cosecha"     # corrige/elimina fichas de todos (los admins tambien)
ESCRIBIR = requiere("registrar_cosecha", "reportes_cosecha")
SEGURIDAD = requiere("registrar_cosecha", "reportes_cosecha", "reportes_seguridad")

# Columnas de producto con el nombre que espera la app
_PRODUCTO_SQL = """id_cosecha AS id, id_cosecha_transporte AS id_transporte, producto, lote, centro_costos,
    orden_cultivo, variedad, num_ficha_org, num_ficha, peso, cantidad, fecha_creacion, estado, ubicacion,
    responsable, recibido_por, peso_neto, numeracion"""


# ------------------------------------------------------------------ fotos
@router.post("/cosecha-transp/foto-seguridad")
async def subir_foto(request: Request, file: UploadFile = File(...), _: Usuario = Depends(SEGURIDAD)):
    """Sube la foto de evidencia a S3 (bucket privado) y devuelve una URL
    servida por este backend."""
    ext = os.path.splitext(file.filename or "")[1].lower() or ".jpg"
    if ext not in (".jpg", ".jpeg", ".png", ".webp"):
        raise HTTPException(400, "Formato de imagen no soportado")
    key = f"{S3_CARPETA}/{uuid.uuid4().hex}{ext}"
    try:
        _s3.upload_fileobj(file.file, settings.S3_BUCKET, key,
                           ExtraArgs={"ContentType": file.content_type or "image/jpeg"})
    except Exception as e:  # noqa: BLE001
        logger.exception("S3 upload")
        raise HTTPException(502, "Error subiendo imagen") from e
    return {"url": f"{str(request.base_url).rstrip('/')}/api/media/foto-seguridad/{key}"}


class FotoPendienteIn(BaseModel):
    id_transporte: Optional[int] = None
    cliente_transporte: Optional[str] = None
    imagen: str = Field(max_length=6_000_000)      # data URL base64 (jpeg comprimido en el celular)


@router.post("/cosecha-transp/foto-pendiente")
def subir_foto_pendiente(data: FotoPendienteIn, request: Request, db: Session = Depends(get_db),
                         user: Usuario = Depends(SEGURIDAD)):
    """Foto de seguridad tomada SIN INTERNET: llega despues por la cola del
    celular (en base64), se sube a S3 y se agrega a seg_foto_url de la ficha."""
    id_t = _resolver_transporte(db, data.id_transporte, data.cliente_transporte)
    if not user.puede("reportes_seguridad"):
        _ficha_propia(db, user, id_t)
    cab, _, datos = data.imagen.partition(",")
    tipo = "image/png" if "png" in cab else "image/webp" if "webp" in cab else "image/jpeg"
    try:
        binario = base64.b64decode(datos or cab, validate=True)
    except (binascii.Error, ValueError) as e:
        raise HTTPException(400, "Imagen invalida") from e
    key = f"{S3_CARPETA}/{uuid.uuid4().hex}.{tipo.split('/')[1].replace('jpeg', 'jpg')}"
    try:
        _s3.upload_fileobj(io.BytesIO(binario), settings.S3_BUCKET, key, ExtraArgs={"ContentType": tipo})
    except Exception as e:  # noqa: BLE001
        logger.exception("S3 upload (foto pendiente)")
        raise HTTPException(502, "Error subiendo imagen") from e
    url = f"{str(request.base_url).rstrip('/')}/api/media/foto-seguridad/{key}"
    actual = db.execute(text("SELECT seg_foto_url FROM cosecha_transporte WHERE id_cosecha_transporte = :id"),
                        {"id": id_t}).scalar() or ""
    try:
        fotos = json.loads(actual) if actual.strip().startswith("[") else ([actual] if actual.startswith("http") else [])
    except ValueError:
        fotos = []
    fotos.append(url)
    db.execute(text("UPDATE cosecha_transporte SET seg_foto_url = :f WHERE id_cosecha_transporte = :id"),
               {"f": json.dumps(fotos), "id": id_t})
    db.commit()
    return {"url": url}


@router.get("/media/foto-seguridad/{key:path}")
def ver_foto(key: str, _: Usuario = Depends(SEGURIDAD)):
    if not key.startswith(f"{S3_CARPETA}/") or ".." in key:
        raise HTTPException(400, "Ruta invalida")
    try:
        obj = _s3.get_object(Bucket=settings.S3_BUCKET, Key=key)
    except Exception:  # noqa: BLE001
        raise HTTPException(404, "Foto no encontrada")
    return StreamingResponse(obj["Body"], media_type=obj.get("ContentType") or "image/jpeg",
                             headers={"Cache-Control": "private, max-age=86400"})


# ------------------------------------------------------- ficha de transporte
class TransporteIn(BaseModel):
    id_camion: Optional[int] = None
    id_supervisor: Optional[int] = None
    propietario: Optional[str] = None
    placa: Optional[str] = None
    nombre_chofer: Optional[str] = None
    seg_chaleco: bool = False
    seg_cofia: bool = False
    seg_casco: bool = False
    seg_calzado_adecuado: bool = False
    seg_limpieza_bines: bool = False
    seg_materiales_extranos: bool = False
    seg_saran: bool = False
    seg_comentario: Optional[str] = None
    seg_observaciones: Optional[str] = None
    seg_foto_url: Optional[str] = None
    estado: str = "Activo"
    # Trabajo SIN INTERNET: id que genera el celular (reintentos idempotentes) y hora real
    cliente_id: Optional[str] = Field(None, max_length=40)
    fecha: Optional[datetime] = None


_SEG = ["seg_chaleco", "seg_cofia", "seg_casco", "seg_calzado_adecuado", "seg_limpieza_bines",
        "seg_materiales_extranos", "seg_saran"]


@router.post("/cosecha-transp")
def crear_transporte(data: TransporteIn, db: Session = Depends(get_db),
                     user: Usuario = Depends(requiere("registrar_cosecha"))):
    if data.estado not in ("Activo", "Enviado"):
        raise HTTPException(400, f"Estado inválido: {data.estado}")
    if data.cliente_id:      # reintento de la cola offline: ya llego
        ya = db.execute(text("SELECT id_cosecha_transporte FROM cosecha_transporte WHERE cliente_id = :c"),
                        {"c": data.cliente_id}).scalar()
        if ya:
            return {"id": ya, "message": "Transporte creado"}
    cols = ["id_camion", "id_supervisor", "propietario", "placa", "nombre_chofer", *_SEG, "seg_comentario",
            "seg_observaciones", "seg_foto_url", "estado", "cliente_id"]
    valores = {c: getattr(data, c) for c in cols}
    try:
        row = db.execute(text(f"""
            INSERT INTO cosecha_transporte ({', '.join(cols)}, fecha_creacion, creado_por)
            VALUES ({', '.join(':' + c for c in cols)}, :fecha_creacion, :creado_por)
            RETURNING id_cosecha_transporte"""),
            {**valores, "fecha_creacion": _fecha_evento(data.fecha), "creado_por": user.username}).fetchone()
        db.commit()
    except IntegrityError:      # dos envios del mismo cliente_id a la vez
        db.rollback()
        ya = db.execute(text("SELECT id_cosecha_transporte FROM cosecha_transporte WHERE cliente_id = :c"),
                        {"c": data.cliente_id}).scalar()
        if not ya:
            raise
        return {"id": ya, "message": "Transporte creado"}
    return {"id": row[0], "message": "Transporte creado"}


def _resolver_transporte(db: Session, id_transporte: Optional[int], cliente: Optional[str]) -> int:
    """Id de la ficha por su id o por el id que genero el celular (ficha creada
    sin internet que aun no conoce su id del servidor)."""
    if id_transporte:
        return id_transporte
    if cliente:
        r = db.execute(text("SELECT id_cosecha_transporte FROM cosecha_transporte WHERE cliente_id = :c"),
                       {"c": cliente}).scalar()
        if r:
            return r
    raise HTTPException(404, "Ficha no encontrada")


def _auditar(db: Session, id_t: int | None, accion: str, user: Usuario, antes=None, despues=None) -> None:
    """Quien cambio que en una ficha (estado, eliminar, corregir, peso, recibir)."""
    db.execute(text("""INSERT INTO cosecha_auditoria (id_cosecha_transporte, accion, antes, despues, usuario, usuario_nombre)
        VALUES (:t, :a, CAST(:antes AS JSONB), CAST(:despues AS JSONB), :u, :n)"""),
        {"t": id_t, "a": accion, "antes": json.dumps(antes, default=str) if antes is not None else None,
         "despues": json.dumps(despues, default=str) if despues is not None else None,
         "u": user.username, "n": user.nombre})


def _ficha(db: Session, id_t: int) -> dict:
    f = db.execute(text("""SELECT id_cosecha_transporte AS id, estado, creado_por, id_supervisor
        FROM cosecha_transporte WHERE id_cosecha_transporte = :id"""), {"id": id_t}).mappings().first()
    if not f:
        raise HTTPException(404, "Ficha no encontrada")
    return dict(f)


def _es_gestor(user: Usuario) -> bool:
    return user.puede(GESTOR)


def _ficha_propia(db: Session, user: Usuario, id_t: int, estados: tuple[str, ...] | None = None) -> dict:
    """La ficha existe y el usuario puede tocarla: un gestor (reportes de
    cosecha / admin) todas; un supervisor solo las suyas (creadas por el o de su
    registro de supervisor) y, si se indica, solo en esos estados."""
    f = _ficha(db, id_t)
    if _es_gestor(user):
        return f
    if f["creado_por"] != user.username and not (f["id_supervisor"] and f["id_supervisor"] == _id_supervisor_de(db, user)):
        raise HTTPException(403, "La ficha no es suya")
    if estados and (f["estado"] or "Activo") not in estados:
        raise HTTPException(409, f"La ficha está {f['estado']}: ya no se puede modificar")
    return f


def _sin_peso_ot(db: Session, id_t: int | None = None, id_producto: int | None = None) -> None:
    """Lo pesado por el sistema OT no se borra desde aqui (se maneja en /api/pesaje)."""
    q = """SELECT 1 FROM pesaje pz JOIN cosecha c ON c.id_cosecha = pz.id_cosecha WHERE pz.estado = 'ACTIVO' AND """
    if id_producto is not None:
        hay = db.execute(text(q + "c.id_cosecha = :x LIMIT 1"), {"x": id_producto}).first()
    else:
        hay = db.execute(text(q + "c.id_cosecha_transporte = :x LIMIT 1"), {"x": id_t}).first()
    if hay:
        raise HTTPException(409, "Tiene pesos del sistema OT: no se puede modificar aquí")


def _id_supervisor_de(db: Session, user: Usuario) -> int | None:
    """Registro de supervisor del usuario: por cedula (maestro Personas); si no
    hay, por nombre (como antes)."""
    ced = cedula_de(user)
    if ced:
        r = db.execute(text("SELECT id_supervisor FROM supervisor WHERE estado = 'ACTIVO' AND cedula = :c"),
                       {"c": ced}).fetchone()
        if r:
            return r[0]
    nombre = (user.nombre or "").upper().strip()
    if not nombre:
        return None
    r = db.execute(text("""SELECT id_supervisor FROM supervisor WHERE estado = 'ACTIVO'
        AND (:n LIKE '%' || UPPER(TRIM(nombre)) || '%' OR UPPER(TRIM(nombre)) LIKE '%' || :n || '%') LIMIT 1"""),
        {"n": nombre}).fetchone()
    return r[0] if r else None


@router.get("/cosecha-transp")
def listar_transportes(request: Request, db: Session = Depends(get_db), user: Usuario = Depends(LEER)):
    """Fichas con sus productos. Un SUPERVISOR solo ve las suyas (creadas por el
    o asignadas a su registro de supervisor); el resto ve todas."""
    efectivo = usuario_efectivo(request, user)
    filtro, params = "", {}
    if "SUPERVISOR" in (efectivo.rol or "").upper():
        id_sup = _id_supervisor_de(db, efectivo)
        if id_sup:
            filtro, params = "AND (t.creado_por = :sub OR t.id_supervisor = :sup)", {"sub": efectivo.username, "sup": id_sup}
        else:
            filtro, params = "AND t.creado_por = :sub", {"sub": efectivo.username}

    rows = db.execute(text(f"""
        SELECT t.id_cosecha_transporte AS transp_id, t.fecha_creacion, t.fecha_salida, t.propietario, t.placa,
               t.nombre_chofer, t.estado, t.id_correccion AS correccion_id, t.observacion_falla, t.id_supervisor,
               t.recibido_por, t.hora_ingreso, t.creado_por, t.cliente_id, s.nombre AS supervisor_nombre,
               COALESCE(pr.nombre, NULLIF(TRIM(c.centro_costos), ''), NULLIF(TRIM(li.proyecto), ''), li.hacienda)
                   AS proyecto_nombre,
               c.id_cosecha AS producto_id, c.producto, c.lote, c.variedad, c.cantidad, c.orden_cultivo,
               c.centro_costos, c.ubicacion, c.responsable,
               COALESCE(pz.peso_neto, c.peso) AS peso, COALESCE(pz.num_ficha, c.num_ficha) AS num_ficha,
               c.estado AS estado_producto,
               c.numeracion AS prod_numeracion,
               t.seg_chaleco, t.seg_cofia, t.seg_casco, t.seg_calzado_adecuado, t.seg_limpieza_bines,
               t.seg_materiales_extranos, t.seg_saran, t.seg_comentario, t.seg_observaciones, t.seg_foto_url
        FROM cosecha_transporte t
        LEFT JOIN supervisor s ON s.id_supervisor = t.id_supervisor
        LEFT JOIN proyecto pr ON pr.id_proyecto = s.id_proyecto
        LEFT JOIN cosecha c ON c.id_cosecha_transporte = t.id_cosecha_transporte
        LEFT JOIN pesaje pz ON pz.id_cosecha = c.id_cosecha AND pz.estado = 'ACTIVO'   -- peso del sistema OT
        LEFT JOIN (SELECT DISTINCT ON (ocult_cod_ocult) ocult_cod_ocult, proyecto, hacienda
                   FROM lote_informix ORDER BY ocult_cod_ocult) li ON li.ocult_cod_ocult = c.orden_cultivo
        WHERE 1=1 {filtro}
        ORDER BY t.id_cosecha_transporte DESC, c.id_cosecha"""), params).mappings().all()

    fichas: dict[int, dict] = {}
    for r in rows:
        f = fichas.get(r["transp_id"])
        if f is None:
            f = fichas[r["transp_id"]] = {
                "id": r["transp_id"], "cliente_id": r["cliente_id"], "fecha_creacion": r["fecha_creacion"],
                "fecha_salida": r["fecha_salida"],
                "propietario": r["propietario"], "placa": r["placa"], "nombre_chofer": r["nombre_chofer"],
                "estado": r["estado"] or "Activo", "correccion_id": r["correccion_id"],
                "observacion_falla": r["observacion_falla"], "id_supervisor": r["id_supervisor"],
                "supervisor_nombre": r["supervisor_nombre"] or "", "proyecto_nombre": r["proyecto_nombre"] or "",
                "recibido_por": r["recibido_por"] or "", "hora_ingreso": r["hora_ingreso"] or "",
                "numeracion": "", **{k: r[k] for k in _SEG},
                "seg_comentario": r["seg_comentario"] or "", "seg_observaciones": r["seg_observaciones"] or "",
                "seg_foto_url": r["seg_foto_url"] or "", "productos": []}
        if r["responsable"] and not f["supervisor_nombre"]:
            f["supervisor_nombre"] = r["responsable"]
        if r["producto_id"]:
            f["productos"].append({
                "id": r["producto_id"], "producto": r["producto"], "lote": r["lote"], "variedad": r["variedad"],
                "cantidad": r["cantidad"], "orden_cultivo": r["orden_cultivo"], "centro_costos": r["centro_costos"],
                "ubicacion": r["ubicacion"], "responsable": r["responsable"], "peso": r["peso"] or 0,
                "num_ficha": r["num_ficha"] or "", "estado": r["estado_producto"] or "",
                "numeracion": r["prod_numeracion"] or ""})
            if r["prod_numeracion"] and not f["numeracion"]:
                f["numeracion"] = r["prod_numeracion"]
    return list(fichas.values())


# ------------------------------------------------------------------ productos
class ProductoItem(BaseModel):
    id_transporte: Optional[int] = None
    producto: Optional[str] = None
    lote: Optional[str] = None
    centro_costos: Optional[str] = None
    orden_cultivo: Optional[str] = None
    variedad: Optional[str] = None
    ubicacion: Optional[str] = None
    responsable: Optional[str] = None
    cantidad: int = 0


class ProductosIn(BaseModel):
    id_transporte: Optional[int] = None
    cliente_transporte: Optional[str] = None     # ficha creada sin internet
    productos: List[ProductoItem] = []


@router.post("/cosecha-productos")
def guardar_productos(data: ProductosIn, db: Session = Depends(get_db), user: Usuario = Depends(ESCRIBIR)):
    if data.cliente_transporte and not data.id_transporte:
        data.id_transporte = _resolver_transporte(db, None, data.cliente_transporte)
    if data.id_transporte:
        f = _ficha_propia(db, user, data.id_transporte)
        if (f["estado"] or "Activo") not in ("Activo", "Eliminado"):
            ya = {r[0] for r in db.execute(text(
                "SELECT orden_cultivo FROM cosecha WHERE id_cosecha_transporte = :id"), {"id": data.id_transporte})}
            if all(p.orden_cultivo in ya for p in data.productos):   # reintento de la cola: ya estaban
                return {"message": "0 nuevos, 0 actualizados"}
            raise HTTPException(409, f"La ficha está {f['estado']}: ya no se pueden agregar productos")
    existentes = {}
    if data.id_transporte:
        existentes = {r[1]: r[0] for r in db.execute(text(
            "SELECT id_cosecha, orden_cultivo FROM cosecha WHERE id_cosecha_transporte = :id"),
            {"id": data.id_transporte})}
    nuevos = actualizados = 0
    for p in data.productos:
        valores = {"producto": p.producto, "lote": p.lote, "centro_costos": p.centro_costos, "variedad": p.variedad,
                   "ubicacion": p.ubicacion, "cantidad": p.cantidad, "responsable": p.responsable}
        if p.orden_cultivo and p.orden_cultivo in existentes:
            db.execute(text("""UPDATE cosecha SET producto = :producto, lote = :lote, centro_costos = :centro_costos,
                variedad = :variedad, ubicacion = :ubicacion, cantidad = :cantidad,
                responsable = COALESCE(:responsable, responsable) WHERE id_cosecha = :id"""),
                {**valores, "id": existentes[p.orden_cultivo]})
            actualizados += 1
        else:
            db.execute(text("""INSERT INTO cosecha (id_cosecha_transporte, producto, lote, centro_costos, orden_cultivo,
                variedad, ubicacion, cantidad, responsable, estado) VALUES (:id_transporte, :producto, :lote,
                :centro_costos, :orden_cultivo, :variedad, :ubicacion, :cantidad, :responsable, 'Cargado')"""),
                {**valores, "id_transporte": data.id_transporte, "orden_cultivo": p.orden_cultivo})
            nuevos += 1
    # Camion vacio eliminado por la limpieza nocturna al que le llegan productos
    # tarde (celular sin senal): vuelve a Activo para no perderlos.
    if nuevos and data.id_transporte:
        db.execute(text("""UPDATE cosecha_transporte SET estado = 'Activo'
            WHERE id_cosecha_transporte = :id AND estado = 'Eliminado'"""), {"id": data.id_transporte})
    db.commit()
    return {"message": f"{nuevos} nuevos, {actualizados} actualizados"}


@router.get("/cosecha-productos/{id_transporte}")
def ver_productos(id_transporte: int, db: Session = Depends(get_db), user: Usuario = Depends(LEER)):
    if not user.puede("reportes_cosecha", "reportes_seguridad"):
        _ficha_propia(db, user, id_transporte)
    filas = [dict(r) for r in db.execute(text(
        f"SELECT {_PRODUCTO_SQL} FROM cosecha WHERE id_cosecha_transporte = :id ORDER BY id_cosecha"),
        {"id": id_transporte}).mappings()]
    # Peso del sistema OT (tabla pesaje): manda sobre el de la ficha, que no se toca
    ot = {r[0]: r for r in db.execute(text("""SELECT pz.id_cosecha, pz.peso_neto, pz.num_ficha FROM pesaje pz
        JOIN cosecha c ON c.id_cosecha = pz.id_cosecha WHERE c.id_cosecha_transporte = :id AND pz.estado = 'ACTIVO'"""),
        {"id": id_transporte})}
    for f in filas:
        if f["id"] in ot:
            f["peso"] = f["peso_neto"] = float(ot[f["id"]][1])
            f["num_ficha"] = ot[f["id"]][2]
    return filas


@router.delete("/cosecha-productos/item/{item_id}")
def eliminar_producto(item_id: int, db: Session = Depends(get_db), user: Usuario = Depends(ESCRIBIR)):
    p = db.execute(text(f"SELECT {_PRODUCTO_SQL} FROM cosecha WHERE id_cosecha = :id"), {"id": item_id}).mappings().first()
    if not p:
        return {"message": "Producto eliminado"}      # ya no estaba (reintento)
    _ficha_propia(db, user, p["id_transporte"], ("Activo",))
    _sin_peso_ot(db, id_producto=item_id)
    db.execute(text("DELETE FROM cosecha WHERE id_cosecha = :id"), {"id": item_id})
    _auditar(db, p["id_transporte"], "PRODUCTO_ELIMINADO", user, antes=dict(p))
    db.commit()
    return {"message": "Producto eliminado"}


@router.delete("/cosecha-productos/orden/{orden_cultivo}")
def eliminar_producto_por_orden(orden_cultivo: str, id_transporte: Optional[int] = None,
                                cliente_transporte: Optional[str] = None, db: Session = Depends(get_db),
                                user: Usuario = Depends(ESCRIBIR)):
    """Quita un producto (orden de cultivo) de una ficha aun no enviada; sirve
    para productos agregados sin internet (no tienen id todavia)."""
    id_t = _resolver_transporte(db, id_transporte, cliente_transporte)
    _ficha_propia(db, user, id_t, ("Activo",))
    db.execute(text("""DELETE FROM cosecha WHERE id_cosecha_transporte = :t AND orden_cultivo = :o
        AND COALESCE(estado, 'Cargado') = 'Cargado'"""), {"t": id_t, "o": orden_cultivo})
    db.commit()
    return {"message": "Producto eliminado"}


@router.put("/cosecha-productos/item/{item_id}/peso")
def poner_peso(item_id: int, data: dict, db: Session = Depends(get_db), user: Usuario = Depends(ESCRIBIR)):
    try:
        peso = float(data.get("peso_neto", 0) or 0)
    except (TypeError, ValueError):
        raise HTTPException(422, "Peso inválido")
    if not 0 <= peso < 100000:
        raise HTTPException(422, "Peso fuera de rango")
    num_ficha = data.get("num_ficha")
    if num_ficha is not None:
        num_ficha = str(num_ficha).strip()[:50]
    p = db.execute(text("SELECT id_cosecha_transporte, peso, num_ficha FROM cosecha WHERE id_cosecha = :id"),
                   {"id": item_id}).first()
    if not p:
        raise HTTPException(404, "Producto no encontrado")
    _ficha_propia(db, user, p[0], ("Enviado", "Corregida", "Recibido"))
    _sin_peso_ot(db, id_producto=item_id)
    _auditar(db, p[0], "PESO", user, antes={"id_cosecha": item_id, "peso": p[1], "num_ficha": p[2]},
             despues={"id_cosecha": item_id, "peso": peso, "num_ficha": num_ficha})
    if num_ficha is not None:
        db.execute(text("UPDATE cosecha SET peso = :p, num_ficha = :n WHERE id_cosecha = :id"),
                   {"p": peso, "n": num_ficha, "id": item_id})
    else:
        db.execute(text("UPDATE cosecha SET peso = :p WHERE id_cosecha = :id"), {"p": peso, "id": item_id})
    db.commit()
    return {"message": "Peso actualizado"}


# ------------------------------------------------------------ flujo de ficha
def _existe(result) -> None:
    if result.rowcount == 0:
        raise HTTPException(404, "Ficha no encontrada")


@router.put("/cosecha-transp/cliente/{cliente_id}/enviar")
def enviar_camion_cliente(cliente_id: str, data: dict, db: Session = Depends(get_db), user: Usuario = Depends(ESCRIBIR)):
    """Enviar una ficha creada SIN INTERNET (por el id del celular)."""
    return enviar_camion(_resolver_transporte(db, None, cliente_id), data, db, user)


@router.put("/cosecha-transp/{id_transp}/enviar")
def enviar_camion(id_transp: int, data: dict, db: Session = Depends(get_db), user: Usuario = Depends(ESCRIBIR)):
    """Marca la ficha como Enviada (hora de salida = la real, aunque llegue tarde
    por la cola) y numera sus productos si aun no tienen numero."""
    fecha = None
    if data.get("fecha"):
        try:
            fecha = datetime.fromisoformat(str(data["fecha"]))
        except ValueError:
            fecha = None
    estado = db.execute(text("SELECT estado FROM cosecha_transporte WHERE id_cosecha_transporte = :id"),
                        {"id": id_transp}).scalar()
    if estado is None:
        raise HTTPException(404, "Ficha no encontrada")
    if estado in ("Enviado", "Recibido"):       # reintento de la cola offline
        return {"message": "Camión enviado", "numeracion": _numerar(db, id_transp)}
    _ficha_propia(db, user, id_transp, ("Activo",))
    _existe(db.execute(text("""UPDATE cosecha_transporte SET fecha_salida = :f, estado = 'Enviado', planta = :planta
        WHERE id_cosecha_transporte = :id"""), {"id": id_transp, "planta": data.get("planta", ""), "f": _fecha_evento(fecha)}))
    # Responsable = quien envia (sesion); antes lo ponia el cliente
    usuario = user.nombre or data.get("usuario", "")
    if usuario:
        db.execute(text("UPDATE cosecha SET responsable = :u, estado = 'Enviado' WHERE id_cosecha_transporte = :id"),
                   {"u": usuario, "id": id_transp})
    else:
        db.execute(text("UPDATE cosecha SET estado = 'Enviado' WHERE id_cosecha_transporte = :id"), {"id": id_transp})
    db.commit()
    return {"message": "Camión enviado", "numeracion": _numerar(db, id_transp)}


@router.put("/cosecha-transp/{id_transp}/finalizar")
def finalizar(id_transp: int, data: dict, db: Session = Depends(get_db), user: Usuario = Depends(ESCRIBIR)):
    f = _ficha(db, id_transp)
    if f["estado"] == "Recibido":                  # reintento
        return {"message": "Ficha finalizada"}
    _ficha_propia(db, user, id_transp, ("Enviado", "Corregida"))
    if f["estado"] not in ("Enviado", "Corregida"):
        raise HTTPException(409, f"La ficha está {f['estado']}: no se puede recibir")
    _existe(db.execute(text("""UPDATE cosecha_transporte SET estado = 'Recibido', recibido_por = :r
        WHERE id_cosecha_transporte = :id"""), {"id": id_transp, "r": user.nombre or data.get("recibido_por", "")}))
    _auditar(db, id_transp, "RECIBIDO", user, antes={"estado": f["estado"]}, despues={"estado": "Recibido"})
    db.commit()
    return {"message": "Ficha finalizada"}


@router.post("/cosecha-numeracion/{id_transporte}")
def generar_numeracion(id_transporte: int, db: Session = Depends(get_db), _: Usuario = Depends(ESCRIBIR)):
    """COS-aaaamm-NNNNNN unica y secuencial POR PRODUCTO. Con candado de
    transaccion: dos camiones a la vez ya no pueden sacar el mismo numero."""
    return {"numeracion": _numerar(db, id_transporte)}


def _numerar(db: Session, id_transporte: int) -> str | None:
    """Numera SOLO los productos que aun no tienen numero (antes se volvian a
    numerar en cada llamada: un reintento cambiaba los numeros ya impresos).
    Devuelve el primer numero de la ficha."""
    prefijo = f"COS-{ahora_ecuador().strftime('%Y%m')}-"
    db.execute(text("SELECT pg_advisory_xact_lock(hashtext('operaciones_agricolas.cosecha.numeracion'))"))
    ultimo = db.execute(text("SELECT max(numeracion) FROM cosecha WHERE numeracion LIKE :p"),
                        {"p": prefijo + "%"}).scalar()
    seq = int(ultimo.split("-")[-1]) if ultimo else 0
    for (pid,) in db.execute(text("""SELECT id_cosecha FROM cosecha WHERE id_cosecha_transporte = :id
            AND (numeracion IS NULL OR numeracion = '') ORDER BY id_cosecha"""), {"id": id_transporte}).fetchall():
        seq += 1
        db.execute(text("UPDATE cosecha SET numeracion = :n WHERE id_cosecha = :id"), {"n": f"{prefijo}{seq:06d}", "id": pid})
    db.commit()
    return db.execute(text("""SELECT numeracion FROM cosecha WHERE id_cosecha_transporte = :id
        AND numeracion IS NOT NULL AND numeracion != '' ORDER BY id_cosecha LIMIT 1"""), {"id": id_transporte}).scalar()


@router.get("/cosecha-numeracion/{id_transporte}")
def ver_numeracion(id_transporte: int, db: Session = Depends(get_db), _: Usuario = Depends(LEER)):
    n = db.execute(text("""SELECT numeracion FROM cosecha WHERE id_cosecha_transporte = :id
        AND numeracion IS NOT NULL AND numeracion != '' ORDER BY id_cosecha LIMIT 1"""), {"id": id_transporte}).scalar()
    return {"numeracion": n}


def _cambios(orig: dict, camion: dict, prods: list[dict], editados: list | None) -> list[str]:
    cambios = []
    for campo, etiqueta, plantilla in (("placa", "Placa", "Placa: {o} se cambia por Placa {n}"),
                                       ("nombre_chofer", "Resp. Transporte", "Resp. Transporte: {o} se cambia por {n}"),
                                       ("propietario", "Propietario", "Propietario: {o} se cambia por {n}")):
        nuevo = camion.get(campo) or orig.get(campo) or ""
        if nuevo != (orig.get(campo) or ""):
            cambios.append(plantilla.format(o=orig.get(campo) or "", n=nuevo))
    for i, p in enumerate(prods):
        e = editados[i] if editados and i < len(editados) else {}
        pref = f"Producto {i + 1}"
        pares = [
            ("Producto", e.get("producto") or p.get("producto") or "", p.get("producto") or ""),
            ("Lote", e.get("lote") or p.get("lote") or "", p.get("lote") or ""),
            ("Variedad", e.get("variedad") or p.get("variedad") or "", p.get("variedad") or ""),
            ("Bines", str(int(e.get("cantidad", p.get("cantidad", 0)) or 0)), str(p.get("cantidad", 0) or 0)),
            ("Peso", str(float(e.get("peso", p.get("peso", 0)) or 0)), str(float(p.get("peso", 0) or 0))),
            ("N°Ficha", str(e.get("num_ficha", p.get("num_ficha", "")) or ""), str(p.get("num_ficha", "") or "")),
        ]
        for etiqueta, nuevo, viejo in pares:
            if nuevo != viejo:
                cambios.append(f"{pref} - {etiqueta}: {viejo} se cambia por {etiqueta} {nuevo}")
    return cambios


@router.post("/cosecha-transp/{id_transp}/corregir")
def corregir(id_transp: int, data: Optional[dict] = None, db: Session = Depends(get_db),
             user: Usuario = Depends(ESCRIBIR)):
    """Marca la ficha original como 'Falla' y crea una copia 'Corregida' con los
    datos editados (y la observacion de que cambio)."""
    orig = db.execute(text("SELECT * FROM cosecha_transporte WHERE id_cosecha_transporte = :id"),
                      {"id": id_transp}).mappings().first()
    if not orig:
        raise HTTPException(404, "Ficha no encontrada")
    orig = dict(orig)
    camion = (data or {}).get("camion", {}) or {}
    editados = (data or {}).get("productos")
    prods = [dict(p) for p in db.execute(text(
        "SELECT * FROM cosecha WHERE id_cosecha_transporte = :id ORDER BY id_cosecha"), {"id": id_transp}).mappings()]
    _ficha_propia(db, user, id_transp)
    if orig.get("estado") in ("Falla", "Eliminado"):
        raise HTTPException(409, f"La ficha está {orig.get('estado')}: no se puede corregir")
    try:
        obs = "; ".join(_cambios(orig, camion, prods, editados)) or "Corrección sin cambios detectados"
    except (TypeError, ValueError):
        raise HTTPException(422, "Bines o peso inválidos")
    try:
        db.execute(text("UPDATE cosecha_transporte SET estado = 'Falla', observacion_falla = :o "
                        "WHERE id_cosecha_transporte = :id"), {"id": id_transp, "o": obs})
        nuevo_id = db.execute(text(f"""
            INSERT INTO cosecha_transporte (id_camion, propietario, placa, nombre_chofer, {', '.join(_SEG)},
                seg_comentario, seg_observaciones, seg_foto_url, estado, fecha_creacion, fecha_salida, planta,
                id_correccion)
            VALUES (:id_camion, :propietario, :placa, :nombre_chofer, {', '.join(':' + s for s in _SEG)},
                :seg_comentario, :seg_observaciones, :seg_foto_url, 'Corregida', :fc, :fecha_salida, :planta,
                :correccion)
            RETURNING id_cosecha_transporte"""), {
            "id_camion": camion.get("id_camion") or orig.get("id_camion"),
            "propietario": camion.get("propietario") or orig.get("propietario") or "",
            "placa": camion.get("placa") or orig.get("placa") or "",
            "nombre_chofer": camion.get("nombre_chofer") or orig.get("nombre_chofer") or "",
            **{s: bool(orig.get(s)) for s in _SEG},
            "seg_comentario": orig.get("seg_comentario") or "", "seg_observaciones": orig.get("seg_observaciones") or "",
            "seg_foto_url": orig.get("seg_foto_url") or "", "fc": ahora_ecuador(), "fecha_salida": orig.get("fecha_salida"),
            "planta": orig.get("planta") or "", "correccion": id_transp}).scalar()
        for i, p in enumerate(prods):
            e = editados[i] if editados and i < len(editados) else {}
            db.execute(text("""INSERT INTO cosecha (id_cosecha_transporte, producto, lote, variedad, cantidad, orden_cultivo,
                    centro_costos, ubicacion, responsable, peso, num_ficha, numeracion)
                VALUES (:t, :producto, :lote, :variedad, :cantidad, :orden_cultivo, :centro_costos, :ubicacion,
                    :responsable, :peso, :num_ficha, :numeracion)"""), {
                "t": nuevo_id, "producto": e.get("producto") or p.get("producto") or "",
                "lote": e.get("lote") or p.get("lote") or "", "variedad": e.get("variedad") or p.get("variedad") or "",
                "cantidad": int(e.get("cantidad", p.get("cantidad", 0)) or 0),
                "orden_cultivo": e.get("orden_cultivo") or p.get("orden_cultivo") or "",
                "centro_costos": p.get("centro_costos") or "", "ubicacion": p.get("ubicacion") or "",
                "responsable": p.get("responsable") or "", "peso": float(e.get("peso", p.get("peso", 0)) or 0),
                "num_ficha": e.get("num_ficha", p.get("num_ficha", "")), "numeracion": p.get("numeracion") or ""})
        _auditar(db, id_transp, "CORREGIDA", user, antes={"estado": orig.get("estado")},
                 despues={"nueva_ficha": nuevo_id, "observacion": obs})
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {"id": nuevo_id, "observacion": obs, "message": "Ficha corregida creada."}


@router.delete("/cosecha-transp/cliente/{cliente_id}")
def eliminar_ficha_cliente(cliente_id: str, db: Session = Depends(get_db), user: Usuario = Depends(ESCRIBIR)):
    id_t = db.execute(text("SELECT id_cosecha_transporte FROM cosecha_transporte WHERE cliente_id = :c"),
                      {"c": cliente_id}).scalar()
    if not id_t:
        return {"ok": True}       # nunca llego o ya se borro (reintento)
    return eliminar_ficha(id_t, db, user)


@router.delete("/cosecha-transp/{id_transp}")
def eliminar_ficha(id_transp: int, db: Session = Depends(get_db), user: Usuario = Depends(ESCRIBIR)):
    """Borra una ficha SOLO si aun no tiene productos (iniciada por error)."""
    _ficha_propia(db, user, id_transp)
    if db.execute(text("SELECT count(*) FROM cosecha WHERE id_cosecha_transporte = :id"), {"id": id_transp}).scalar():
        raise HTTPException(400, "No se puede eliminar: la ficha ya tiene productos agregados.")
    _existe(db.execute(text("DELETE FROM cosecha_transporte WHERE id_cosecha_transporte = :id"), {"id": id_transp}))
    db.commit()
    return {"ok": True}


@router.patch("/cosecha-transp/{id_transp}/estado")
def cambiar_estado(id_transp: int, data: dict, db: Session = Depends(get_db), user: Usuario = Depends(ESCRIBIR)):
    """Solo ELIMINAR o DESACTIVAR (lo que usa la app): un gestor cualquier
    ficha, un supervisor solo las suyas aun Activas. Cualquier otro cambio de
    estado (p.ej. revertir un Recibido) solo un admin del modulo. Queda en la
    auditoria quien y cuando."""
    nuevo = data.get("estado", "")
    if nuevo not in ("Activo", "Enviado", "Recibido", "Desactivado", "Eliminado"):
        raise HTTPException(400, f"Estado inválido: {nuevo}")
    f = _ficha(db, id_transp)
    if f["estado"] == nuevo:
        return {"ok": True, "estado": nuevo}
    if nuevo in ("Eliminado", "Desactivado"):
        _ficha_propia(db, user, id_transp, ("Activo",))
        _sin_peso_ot(db, id_t=id_transp)
    elif not user.es_admin:
        raise HTTPException(403, "Solo un administrador del módulo puede cambiar a ese estado")
    _existe(db.execute(text("UPDATE cosecha_transporte SET estado = :e WHERE id_cosecha_transporte = :id"),
                       {"e": nuevo, "id": id_transp}))
    _auditar(db, id_transp, "ESTADO", user, antes={"estado": f["estado"]}, despues={"estado": nuevo})
    db.commit()
    return {"ok": True, "estado": nuevo}


@router.patch("/cosecha-transp/{id_transp}/fecha-salida")
def poner_fecha_salida(id_transp: int, data: dict, db: Session = Depends(get_db), user: Usuario = Depends(ESCRIBIR)):
    fecha = data.get("fecha_salida", "")
    if not fecha:
        raise HTTPException(400, "fecha_salida requerida")
    try:
        datetime.fromisoformat(str(fecha))
    except ValueError:
        raise HTTPException(422, "fecha_salida inválida (AAAA-MM-DDTHH:MM)")
    f = _ficha_propia(db, user, id_transp)
    _auditar(db, id_transp, "FECHA_SALIDA", user, antes={"estado": f["estado"]}, despues={"fecha_salida": fecha})
    _existe(db.execute(text("""UPDATE cosecha_transporte SET fecha_salida = :f,
        estado = CASE WHEN estado = 'Activo' THEN 'Enviado' ELSE estado END WHERE id_cosecha_transporte = :id"""),
        {"f": fecha, "id": id_transp}))
    db.commit()
    return {"ok": True, "fecha_salida": fecha}


@router.patch("/cosecha-transp/{id_transp}/seguridad")
def editar_seguridad(id_transp: int, data: dict, db: Session = Depends(get_db), _: Usuario = Depends(SEGURIDAD)):
    sets = {k: v for k, v in data.items() if k in (*_SEG, "seg_observaciones")}
    if not sets:
        raise HTTPException(400, "No hay campos validos para actualizar")
    _existe(db.execute(text(f"UPDATE cosecha_transporte SET {', '.join(f'{k} = :{k}' for k in sets)} "
                            "WHERE id_cosecha_transporte = :id"), {**sets, "id": id_transp}))
    db.commit()
    return {"ok": True, **sets}


@router.post("/cosecha-transp/{id_transp}/sincronizar")
def sincronizar_ficha(id_transp: int, _: Usuario = Depends(ESCRIBIR)):
    """Sync con Informix de UNA ficha (boton 'Sincronizar' del detalle)."""
    from ..sync.cosecha_recibido import main as sync_cosecha
    try:
        r = sync_cosecha(solo_transp_id=id_transp) or {}
    except Exception as e:  # noqa: BLE001
        logger.exception("Sync de ficha %s", id_transp)
        raise HTTPException(502, "No se pudo sincronizar con Informix") from e
    if r.get("recibidos"):
        msg = "Sincronizado: ya se marco como Recibido."
    elif r.get("asignados"):
        msg = "Se encontro en Informix, pero aun sin peso registrado -- se reintentara despues."
    else:
        msg = "Todavia no hay nada en Informix para esta ficha (no se ha pesado en planta). Se reintentara mas tarde."
    return {"ok": True, "message": msg, **r}
