"""Dashboard: resumen de cosecha y de actividades de tractores/drones en un rango de fechas.

Una sola llamada (GET /api/dashboard) con consultas FIJAS (sin SQL armado con texto del usuario).
Cada parte sale solo si el usuario tiene el permiso de su reporte:
  * cosecha  -> reportes_cosecha
  * tractores/operadores/actividades -> reportes_actividades
Los admins del modulo ven todo.

Horas: solo actividades Finalizadas (tiempo_real esta en MINUTOS). Las de mas de HORAS_MAX horas casi
siempre son actividades que se olvidaron cerrar: NO suman en totales ni rankings (inflaban un tractor
con miles de horas) y salen aparte en "para revisar".
Fechas: la base guarda hora de Ecuador sin zona; el rango es [desde, hasta + 1 dia).
"""
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..auth import Usuario, requiere_usuario_hub
from ..comun import ahora_ecuador
from ..database import get_db

router = APIRouter(prefix="/api")

HORAS_MAX = 12
_MIN_MAX = HORAS_MAX * 60
_RANGO_MAX_DIAS = 400
_EQUIPOS = ("Tractores", "Drones")

# --------------------------------------------------------------- tractores
# :equipo NULL = todos. Validas = finalizadas de hasta HORAS_MAX horas.
_REG = """FROM registro r
          WHERE r.estado = 'Finalizado' AND r.fecha_creacion >= :desde AND r.fecha_creacion < :hasta
            AND (CAST(:equipo AS text) IS NULL OR r.equipo = :equipo)"""
_VALIDA = f"r.tiempo_real <= {_MIN_MAX}"

_SQL_KPI_TRAC = text(f"""SELECT
        count(*) FILTER (WHERE {_VALIDA})                                   AS actividades,
        coalesce(sum(r.tiempo_real) FILTER (WHERE {_VALIDA}), 0) / 60.0     AS horas,
        coalesce(sum(r.tiempo_paro) FILTER (WHERE {_VALIDA}), 0) / 60.0     AS horas_paro,
        count(DISTINCT r.usuario) FILTER (WHERE {_VALIDA})                  AS operadores,
        count(DISTINCT r.tractor) FILTER (WHERE {_VALIDA})                  AS tractores,
        count(*) FILTER (WHERE NOT {_VALIDA})                               AS largas,
        count(*) FILTER (WHERE r.revision_estado = 'NO_REVISADO')           AS sin_revisar
    {_REG}""")

_SQL_TOP_ACT = text(f"""SELECT r.actividad AS nombre, count(*) AS veces, sum(r.tiempo_real) / 60.0 AS horas
    {_REG} AND {_VALIDA} GROUP BY r.actividad ORDER BY veces DESC, horas DESC LIMIT 10""")

# Equipo + quienes lo manejaron (con sus horas): en la practica cada operador anda en su equipo,
# por eso el dashboard muestra UN ranking de equipos con sus operadores, no dos casi iguales.
_SQL_TOP_TRAC = text(f"""WITH base AS (
        SELECT coalesce(nullif(trim(r.tractor), ''), 'Sin tractor') AS tractor,
               coalesce(nullif(trim(r.usuario), ''), 'Sin operador') AS usuario,
               sum(r.tiempo_real) / 60.0 AS h, sum(r.tiempo_paro) / 60.0 AS p, count(*) AS n,
               count(DISTINCT r.fecha_creacion::date) AS dias
        {_REG} AND {_VALIDA} GROUP BY 1, 2)
    SELECT tractor AS nombre, sum(h) AS horas, sum(p) AS paro, sum(n) AS actividades, count(*) AS operadores,
           json_agg(json_build_object('nombre', usuario, 'horas', round(h::numeric, 1), 'dias', dias)
                    ORDER BY h DESC) AS lista
    FROM base GROUP BY tractor ORDER BY horas DESC LIMIT 10""")

_SQL_LARGAS = text(f"""SELECT r.id_registro AS id, r.fecha_creacion AS fecha, r.usuario, r.tractor, r.actividad,
        r.tiempo_real / 60.0 AS horas, r.revision_estado
    {_REG} AND NOT {_VALIDA} ORDER BY r.tiempo_real DESC LIMIT 15""")

# En curso: no depende del rango (es "ahora mismo")
_SQL_AHORA = text("""SELECT r.id_registro AS id, r.usuario, r.tractor, r.actividad, r.subactividad, r.lote,
        r.hacienda, r.estado, r.equipo, coalesce(r.tiempo_inicio, r.fecha_creacion) AS desde
    FROM registro r
    WHERE r.estado IN ('Ejecutándose', 'Pausado') AND r.fecha_creacion >= :hace
      AND (CAST(:equipo AS text) IS NULL OR r.equipo = :equipo)
    ORDER BY r.estado, desde LIMIT 60""")

_SQL_FALLAS = text("""SELECT count(*) AS pendientes,
        count(DISTINCT tractor) AS tractores,
        max(fecha) AS ultima
    FROM falla_tractor WHERE lower(estado) = 'pendiente'""")

_SQL_FALLAS_TRAC = text("""SELECT tractor AS nombre, count(*) AS fallas, max(fecha) AS ultima
    FROM falla_tractor WHERE lower(estado) = 'pendiente'
    GROUP BY tractor ORDER BY fallas DESC, ultima DESC LIMIT 5""")

# ----------------------------------------------------------------- cosecha
# Proyecto = centro de costos de la ficha (es el proyecto); si falta, el de la orden en Informix.
_COS = """FROM cosecha_transporte t
          JOIN cosecha c ON c.id_cosecha_transporte = t.id_cosecha_transporte
          LEFT JOIN LATERAL (SELECT li.proyecto FROM lote_informix li WHERE li.ocult_cod_ocult = c.orden_cultivo
                             ORDER BY li.id_lote_informix DESC LIMIT 1) li ON true
          WHERE t.estado NOT IN ('Eliminado', 'Desactivado')
            AND t.fecha_creacion >= :desde AND t.fecha_creacion < :hasta"""
_PROY = "coalesce(nullif(trim(c.centro_costos), ''), li.proyecto, 'Sin proyecto')"
_FILTRO_PROY = f"(CAST(:proyecto AS text) IS NULL OR {_PROY} = :proyecto)"

_SQL_KPI_COS = text(f"""SELECT count(DISTINCT t.id_cosecha_transporte) AS fichas,
        count(*) AS productos,
        coalesce(sum(c.peso), 0) AS peso,
        count(DISTINCT t.id_cosecha_transporte) FILTER (WHERE t.estado = 'Recibido') AS recibidas,
        count(DISTINCT t.id_cosecha_transporte) FILTER (WHERE t.estado IN ('Activo', 'Enviado')) AS en_camino,
        count(DISTINCT t.id_cosecha_transporte) FILTER (WHERE t.estado IN ('Falla', 'Corregida')) AS con_falla,
        count(DISTINCT {_PROY}) AS proyectos
    {_COS} AND {_FILTRO_PROY}""")

_SQL_COS_PROY = text(f"""SELECT {_PROY} AS proyecto,
        count(DISTINCT t.id_cosecha_transporte) AS fichas,
        count(DISTINCT t.id_cosecha_transporte) FILTER (WHERE t.estado = 'Recibido') AS recibidas,
        count(DISTINCT t.id_cosecha_transporte) FILTER (WHERE t.estado IN ('Activo', 'Enviado')) AS en_camino,
        count(DISTINCT t.id_cosecha_transporte) FILTER (WHERE t.estado IN ('Falla', 'Corregida')) AS con_falla,
        count(*) AS productos, coalesce(sum(c.peso), 0) AS peso
    {_COS} GROUP BY 1 ORDER BY fichas DESC""")

_SQL_COS_PRODUCTO = text(f"""SELECT coalesce(nullif(trim(c.producto), ''), 'Sin producto') AS nombre,
        count(*) AS productos, coalesce(sum(c.peso), 0) AS peso
    {_COS} AND {_FILTRO_PROY} GROUP BY 1 ORDER BY peso DESC LIMIT 8""")

# --------------------------------------------------------------- tendencia
# :paso = 'day' | 'week' (fijo, elegido aqui, nunca del usuario)
_SQL_TEND_TRAC = {p: text(f"""SELECT date_trunc('{p}', r.fecha_creacion)::date AS periodo,
        sum(r.tiempo_real) / 60.0 AS horas, count(*) AS actividades
    {_REG} AND {_VALIDA} GROUP BY 1 ORDER BY 1""") for p in ("day", "week")}

_SQL_TEND_COS = {p: text(f"""SELECT date_trunc('{p}', t.fecha_creacion)::date AS periodo,
        count(DISTINCT t.id_cosecha_transporte) AS fichas, coalesce(sum(c.peso), 0) AS peso
    {_COS} AND {_FILTRO_PROY} GROUP BY 1 ORDER BY 1""") for p in ("day", "week")}


def _filas(db: Session, sql, params: dict) -> list[dict]:
    return [{k: (round(v, 2) if isinstance(v, float) else v) for k, v in r.items()}
            for r in db.execute(sql, params).mappings()]


def _uno(db: Session, sql, params: dict) -> dict:
    fila = _filas(db, sql, params)
    return fila[0] if fila else {}


@router.get("/dashboard")
def dashboard(desde: Optional[date] = None, hasta: Optional[date] = None,
              equipo: Optional[str] = Query(None, description="Tractores | Drones (vacio = todos)"),
              proyecto: Optional[str] = Query(None, max_length=150),
              db: Session = Depends(get_db), user: Usuario = Depends(requiere_usuario_hub)):
    ver_trac = user.puede("reportes_actividades")
    ver_cos = user.puede("reportes_cosecha")
    if not (ver_trac or ver_cos):
        raise HTTPException(403, "Sin permiso para ver el dashboard")

    hoy = ahora_ecuador().date()
    hasta = hasta or hoy
    desde = desde or (hasta - timedelta(days=6))
    if desde > hasta:
        raise HTTPException(400, "La fecha 'desde' es posterior a 'hasta'")
    if (hasta - desde).days > _RANGO_MAX_DIAS:
        raise HTTPException(400, f"El rango máximo es de {_RANGO_MAX_DIAS} días")
    if equipo and equipo not in _EQUIPOS:
        raise HTTPException(400, "Equipo no válido (Tractores o Drones)")

    dias = (hasta - desde).days + 1
    paso = "day" if dias <= 45 else "week"
    p = {"desde": desde, "hasta": hasta + timedelta(days=1), "equipo": equipo or None,
         "proyecto": (proyecto or "").strip() or None}

    res = {"desde": desde, "hasta": hasta, "dias": dias, "paso": "dia" if paso == "day" else "semana",
           "horas_max": HORAS_MAX, "generado": ahora_ecuador(), "ver_tractores": ver_trac, "ver_cosecha": ver_cos}

    if ver_trac:
        # "Ahora": lo que se abrio en las ultimas 36 h y sigue abierto (lo mas viejo ya es olvido -> largas)
        p_ahora = {"hace": ahora_ecuador() - timedelta(hours=36), "equipo": p["equipo"]}
        res["tractores"] = {
            "kpi": _uno(db, _SQL_KPI_TRAC, p),
            "top_actividades": _filas(db, _SQL_TOP_ACT, p),
            "top_tractores": _filas(db, _SQL_TOP_TRAC, p),
            "tendencia": _filas(db, _SQL_TEND_TRAC[paso], p),
            "largas": _filas(db, _SQL_LARGAS, p),
            "ahora": _filas(db, _SQL_AHORA, p_ahora),
            "fallas": _uno(db, _SQL_FALLAS, {}),
            "fallas_tractores": _filas(db, _SQL_FALLAS_TRAC, {}),
        }
    if ver_cos:
        res["cosecha"] = {
            "kpi": _uno(db, _SQL_KPI_COS, p),
            "por_proyecto": _filas(db, _SQL_COS_PROY, p),
            "por_producto": _filas(db, _SQL_COS_PRODUCTO, p),
            "tendencia": _filas(db, _SQL_TEND_COS[paso], p),
        }
    return res
