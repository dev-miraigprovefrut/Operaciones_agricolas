"""PESAJE de cosecha para el sistema de bascula OT.

El responsable de bascula entra con SU usuario de MirAI (login del HUB) y
necesita la pestana `pesaje_cosecha`, que SOLO abre estas rutas: ver las fichas
para pesar y subir / editar / eliminar el peso de cada producto (ficha COS-...),
y marcar el camion como Recibido.

La ficha de cosecha NO se modifica: los pesos viven en sus propias tablas
(pesaje + pesaje_historial). Lo unico que OT cambia de la ficha es el ESTADO del
camion a Recibido (pesaje_recepcion guarda el estado anterior para poder
deshacerlo si luego se elimina un peso). Los reportes muestran el peso de OT
(COALESCE con el de Informix) y la sincronizacion con Informix no toca los
productos ni camiones pesados por OT.
"""
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..auth import Usuario, requiere
from ..database import get_db
from .tractores import _fecha_evento

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/pesaje", tags=["pesaje"])
PESAJE = requiere("pesaje_cosecha")

_SELECT = """
    SELECT c.id_cosecha, c.numeracion, c.lote, c.orden_cultivo, c.producto, c.variedad, c.ubicacion AS hacienda,
           c.centro_costos, c.cantidad AS bines,
           t.id_cosecha_transporte AS id_camion, t.placa, t.nombre_chofer, t.propietario, t.fecha_salida,
           t.estado AS estado_camion,
           pz.id_pesaje, pz.num_ficha, pz.peso_bruto, pz.tara, pz.peso_neto, pz.fecha_hora AS fecha_pesaje,
           pz.pesado_por_nombre
    FROM cosecha c
    JOIN cosecha_transporte t ON t.id_cosecha_transporte = c.id_cosecha_transporte
    LEFT JOIN pesaje pz ON pz.id_cosecha = c.id_cosecha AND pz.estado = 'ACTIVO'
"""


def _f(v):
    return float(v) if v is not None else None


def _salida(r) -> dict:
    return {
        "numero": r["numeracion"], "id_camion": r["id_camion"], "placa": r["placa"], "chofer": r["nombre_chofer"],
        "empresa_destino": r["propietario"], "fecha_salida": r["fecha_salida"], "estado_camion": r["estado_camion"],
        "lote": r["lote"], "orden_cultivo": r["orden_cultivo"], "producto": r["producto"], "variedad": r["variedad"],
        "hacienda": r["hacienda"], "centro_costos": r["centro_costos"], "bines": r["bines"],
        "pesado": r["id_pesaje"] is not None,
        "pesaje": None if r["id_pesaje"] is None else {
            "num_ficha": r["num_ficha"], "peso_bruto": _f(r["peso_bruto"]), "tara": _f(r["tara"]),
            "peso_neto": _f(r["peso_neto"]), "fecha_hora": r["fecha_pesaje"], "pesado_por": r["pesado_por_nombre"]},
    }


@router.get("/fichas")
def listar(placa: Optional[str] = None, numero: Optional[str] = None, fecha: Optional[str] = None,
           pendientes: bool = True, db: Session = Depends(get_db), _: Usuario = Depends(PESAJE)):
    """Fichas (un producto = una ficha COS) de camiones enviados. Por defecto
    solo las pendientes (camion Enviado/Corregida). Filtros: placa, numero
    (COS-...), fecha de salida AAAA-MM-DD. Maximo 300."""
    filtros, p = ["c.numeracion LIKE 'COS-%'"], {}
    filtros.append("t.estado IN ('Enviado', 'Corregida')" if pendientes else "t.estado IN ('Enviado', 'Corregida', 'Recibido')")
    if placa:
        filtros.append("REPLACE(UPPER(t.placa), '-', '') = REPLACE(UPPER(:placa), '-', '')"); p["placa"] = placa.strip()
    if numero:
        filtros.append("c.numeracion = :numero"); p["numero"] = numero.strip().upper()
    if fecha:
        try:
            p["fecha"] = datetime.strptime(fecha, "%Y-%m-%d").date()
        except ValueError as e:
            raise HTTPException(400, "fecha debe ser AAAA-MM-DD") from e
        filtros.append("COALESCE(t.fecha_salida, t.fecha_creacion)::date = :fecha")
    filas = db.execute(text(f"""{_SELECT} WHERE {' AND '.join(filtros)}
        ORDER BY t.fecha_salida DESC NULLS LAST, t.id_cosecha_transporte, c.id_cosecha LIMIT 300"""), p).mappings()
    return [_salida(r) for r in filas]


def _una(db: Session, numero: str, bloquear: bool = False):
    r = db.execute(text(f"{_SELECT} WHERE c.numeracion = :n {'FOR UPDATE OF c' if bloquear else ''}"),
                   {"n": numero.strip().upper()}).mappings().first()
    if not r:
        raise HTTPException(404, f"No existe la ficha {numero}")
    return r


@router.get("/fichas/{numero}")
def ver(numero: str, db: Session = Depends(get_db), _: Usuario = Depends(PESAJE)):
    return _salida(_una(db, numero))


class PesoIn(BaseModel):
    peso_neto: Optional[float] = Field(None, gt=0, lt=100000, description="kg; si no viene: peso_bruto - tara")
    peso_bruto: Optional[float] = Field(None, gt=0, lt=100000)
    tara: Optional[float] = Field(None, ge=0, lt=100000)
    num_ficha: str = Field(min_length=1, max_length=50, description="numero de ficha/ticket del sistema OT")
    fecha_hora: Optional[datetime] = Field(None, description="hora de la pesada (si no viene, la del servidor)")

    @model_validator(mode="after")
    def _neto(self):
        if self.peso_bruto is not None and self.tara is not None:
            calc = round(self.peso_bruto - self.tara, 2)
            if calc <= 0:
                raise ValueError("peso_bruto debe ser mayor que tara")
            if self.peso_neto is not None and abs(self.peso_neto - calc) > 0.5:
                raise ValueError(f"peso_neto ({self.peso_neto}) no coincide con bruto - tara ({calc})")
            self.peso_neto = self.peso_neto or calc
        if self.peso_neto is None:
            raise ValueError("Envie peso_neto, o peso_bruto y tara")
        return self


def _historial(db: Session, id_pesaje: int, accion: str, antes: dict | None, despues: dict | None, user: Usuario):
    import json
    db.execute(text("""INSERT INTO pesaje_historial (id_pesaje, accion, antes, despues, usuario, usuario_nombre)
        VALUES (:id, :a, CAST(:antes AS jsonb), CAST(:despues AS jsonb), :u, :n)"""),
               {"id": id_pesaje, "a": accion, "antes": json.dumps(antes, default=str) if antes else None,
                "despues": json.dumps(despues, default=str) if despues else None, "u": user.username, "n": user.nombre})


def _num_ficha_libre(db: Session, num_ficha: str, id_cosecha: int):
    usado = db.execute(text("""SELECT c.numeracion FROM pesaje pz JOIN cosecha c ON c.id_cosecha = pz.id_cosecha
        WHERE pz.estado = 'ACTIVO' AND pz.num_ficha = :nf AND pz.id_cosecha <> :id LIMIT 1"""),
                       {"nf": num_ficha, "id": id_cosecha}).scalar()
    if usado:
        raise HTTPException(409, f"El num_ficha {num_ficha} ya esta en la ficha {usado}")


def _valores(body: PesoIn) -> dict:
    return {"num_ficha": body.num_ficha.strip(), "peso_bruto": body.peso_bruto, "tara": body.tara,
            "peso_neto": round(body.peso_neto, 2), "fecha_hora": _fecha_evento(body.fecha_hora)}


@router.post("/fichas/{numero}")
def subir(numero: str, body: PesoIn, db: Session = Depends(get_db), user: Usuario = Depends(PESAJE)):
    """Sube el peso de UNA ficha (producto). Reenviar el mismo peso y num_ficha no duplica."""
    r = _una(db, numero, bloquear=True)
    if r["estado_camion"] not in ("Enviado", "Corregida"):
        raise HTTPException(409, f"El camion {r['placa']} esta en estado {r['estado_camion']}: no se puede pesar")
    v = _valores(body)
    if r["id_pesaje"]:
        if r["num_ficha"] == v["num_ficha"] and abs(float(r["peso_neto"]) - v["peso_neto"]) < 0.01:
            return {**_salida(r), "resultado": "ya_registrado"}
        raise HTTPException(409, f"La ficha {r['numeracion']} ya tiene peso ({float(r['peso_neto'])} kg). Use PUT para editarlo.")
    _num_ficha_libre(db, v["num_ficha"], r["id_cosecha"])
    id_p = db.execute(text("""INSERT INTO pesaje (id_cosecha, numeracion, num_ficha, peso_bruto, tara, peso_neto, fecha_hora,
            pesado_por, pesado_por_nombre) VALUES (:c, :n, :num_ficha, :peso_bruto, :tara, :peso_neto, :fecha_hora, :u, :un)
        RETURNING id_pesaje"""), {"c": r["id_cosecha"], "n": r["numeracion"], **v, "u": user.username, "un": user.nombre}).scalar()
    _historial(db, id_p, "CREADO", None, v, user)
    db.commit()
    logger.info("pesaje %s: %s kg (%s) por %s", r["numeracion"], v["peso_neto"], v["num_ficha"], user.username)
    return {**_salida(_una(db, numero)), "resultado": "registrado"}


@router.put("/fichas/{numero}")
def editar(numero: str, body: PesoIn, db: Session = Depends(get_db), user: Usuario = Depends(PESAJE)):
    """Corrige el peso de una ficha (queda el antes y despues en el historial)."""
    r = _una(db, numero, bloquear=True)
    if not r["id_pesaje"]:
        raise HTTPException(404, f"La ficha {r['numeracion']} no tiene peso; use POST para subirlo")
    v = _valores(body)
    _num_ficha_libre(db, v["num_ficha"], r["id_cosecha"])
    antes = {"num_ficha": r["num_ficha"], "peso_bruto": _f(r["peso_bruto"]), "tara": _f(r["tara"]),
             "peso_neto": _f(r["peso_neto"]), "fecha_hora": r["fecha_pesaje"]}
    db.execute(text("""UPDATE pesaje SET num_ficha = :num_ficha, peso_bruto = :peso_bruto, tara = :tara, peso_neto = :peso_neto,
        fecha_hora = :fecha_hora, modificado_por = :u, fecha_modificacion = now() WHERE id_pesaje = :id"""),
               {**v, "u": user.username, "id": r["id_pesaje"]})
    _historial(db, r["id_pesaje"], "EDITADO", antes, v, user)
    db.commit()
    return {**_salida(_una(db, numero)), "resultado": "editado"}


@router.delete("/fichas/{numero}")
def eliminar(numero: str, db: Session = Depends(get_db), user: Usuario = Depends(PESAJE)):
    """Elimina el peso de una ficha. Si OT ya habia marcado el camion Recibido,
    el camion vuelve a su estado anterior (le falta un peso)."""
    r = _una(db, numero, bloquear=True)
    if not r["id_pesaje"]:
        return {**_salida(r), "resultado": "sin_peso"}
    db.execute(text("UPDATE pesaje SET estado = 'ELIMINADO', modificado_por = :u, fecha_modificacion = now() WHERE id_pesaje = :id"),
               {"u": user.username, "id": r["id_pesaje"]})
    _historial(db, r["id_pesaje"], "ELIMINADO", {"num_ficha": r["num_ficha"], "peso_neto": _f(r["peso_neto"])}, None, user)
    rec = db.execute(text("""SELECT estado_anterior FROM pesaje_recepcion WHERE id_cosecha_transporte = :t AND activo"""),
                     {"t": r["id_camion"]}).scalar()
    if rec:
        db.execute(text("""UPDATE cosecha_transporte SET estado = :e WHERE id_cosecha_transporte = :t AND estado = 'Recibido'"""),
                   {"e": rec, "t": r["id_camion"]})
        db.execute(text("UPDATE pesaje_recepcion SET activo = FALSE WHERE id_cosecha_transporte = :t"), {"t": r["id_camion"]})
    db.commit()
    return {**_salida(_una(db, numero)), "resultado": "eliminado", "camion_reabierto": bool(rec)}


class RecibidoIn(BaseModel):
    fecha_hora: Optional[datetime] = None


def _hora_ampm(f: datetime) -> str:
    h = f.hour % 12 or 12
    return f"{h:02d}:{f.minute:02d} {'a.m.' if f.hour < 12 else 'p.m.'}"


@router.post("/camiones/{id_camion}/recibido")
def marcar_recibido(id_camion: int, body: RecibidoIn = RecibidoIn(), db: Session = Depends(get_db),
                    user: Usuario = Depends(PESAJE)):
    """Marca el camion como Recibido. Solo si TODAS sus fichas tienen peso."""
    estado = db.execute(text("SELECT estado FROM cosecha_transporte WHERE id_cosecha_transporte = :t FOR UPDATE"),
                        {"t": id_camion}).scalar()
    if estado is None:
        raise HTTPException(404, "Camion no encontrado")
    if estado == "Recibido":
        return {"id_camion": id_camion, "estado_camion": "Recibido", "resultado": "ya_recibido"}
    if estado not in ("Enviado", "Corregida"):
        raise HTTPException(409, f"El camion esta en estado {estado}: no se puede recibir")
    faltan = db.execute(text("""SELECT c.numeracion FROM cosecha c
        LEFT JOIN pesaje pz ON pz.id_cosecha = c.id_cosecha AND pz.estado = 'ACTIVO'
        WHERE c.id_cosecha_transporte = :t AND pz.id_pesaje IS NULL ORDER BY c.id_cosecha"""), {"t": id_camion}).scalars().all()
    if faltan:
        raise HTTPException(409, f"Faltan pesos de: {', '.join(x or '(sin numero)' for x in faltan)}")
    fecha = _fecha_evento(body.fecha_hora)
    db.execute(text("""UPDATE cosecha_transporte SET estado = 'Recibido', recibido_por = :n, hora_ingreso = :h
        WHERE id_cosecha_transporte = :t"""), {"n": user.nombre or user.username, "h": _hora_ampm(fecha), "t": id_camion})
    db.execute(text("""INSERT INTO pesaje_recepcion (id_cosecha_transporte, estado_anterior, recibido_por, recibido_por_nombre, fecha_hora)
        VALUES (:t, :e, :u, :n, :f)
        ON CONFLICT (id_cosecha_transporte) DO UPDATE SET estado_anterior = EXCLUDED.estado_anterior, recibido_por = EXCLUDED.recibido_por,
            recibido_por_nombre = EXCLUDED.recibido_por_nombre, fecha_hora = EXCLUDED.fecha_hora, activo = TRUE"""),
               {"t": id_camion, "e": estado, "u": user.username, "n": user.nombre, "f": fecha})
    db.commit()
    return {"id_camion": id_camion, "estado_camion": "Recibido", "resultado": "recibido", "recibido_por": user.nombre}
