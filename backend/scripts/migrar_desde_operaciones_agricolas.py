"""COPIA operaciones-agricolas-db (esquema operaciones_agricolas) -> mirai_core,
esquema operaciones_agricolas.

El origen NO se modifica (conexion de solo lectura). El destino queda como
ESPEJO del origen: se puede correr las veces que haga falta (hoy para probar;
el dia del cambio, una ultima vez para traer lo registrado mientras tanto en el
sistema viejo).

Freno de seguridad: si el destino ya tiene registros creados por el sistema
NUEVO (ids mayores que los del origen) en las tablas de movimiento, no se borra
nada y se aborta (salvo --forzar).

Tractoristas: se enlazan con el maestro Personas por cedula (id_persona). Los
que no estan en Personas no se copian (se listan) y sus movimientos quedan con
id_tractorista NULL (el nombre del operador se conserva en `usuario`).

Uso (desde OperacionesAgricolas/backend):
    python scripts/migrar_desde_operaciones_agricolas.py --origen-env "<.env del modulo viejo>"
    python scripts/migrar_desde_operaciones_agricolas.py --origen-env ... --verificar
Destino: DB_* del .env de este backend (mirai_core).
"""
import argparse
from pathlib import Path

import psycopg
from dotenv import dotenv_values
from psycopg.types.json import Jsonb

RAIZ = Path(__file__).resolve().parent.parent
ESQ = "operaciones_agricolas"
ORIGEN_ENV = Path(r"C:\Nube\OneDrive - PROVEFRUT S.A\Documentos\ModuloAgricola\backend\.env")


def conectar_origen(ruta_env):
    e = dotenv_values(ruta_env)
    url = (e.get("DATABASE_URL") or "").replace("postgresql+psycopg://", "postgresql://")
    return psycopg.connect(url, connect_timeout=15, options="-c default_transaction_read_only=on")


def conectar_destino():
    e = dotenv_values(RAIZ / ".env")
    return psycopg.connect(host=e["DB_HOST"], port=e.get("DB_PORT", "5432"), dbname=e.get("DB_NAME", "mirai_core"),
                           user=e["DB_USER"], password=e["DB_PASSWORD"], sslmode="require", connect_timeout=15)


def estado_catalogo(v) -> str:
    if isinstance(v, bool):
        return "ACTIVO" if v else "INACTIVO"
    return "ACTIVO" if (v or "").strip().upper() == "ACTIVO" else "INACTIVO"


def j(v):
    return Jsonb(v if v is not None else [])


def vacio(v):
    return v if (v is not None and str(v).strip() != "") else None


def upsert(cur, tabla, pk, cols, filas):
    """INSERT ... ON CONFLICT (pk) DO UPDATE de todas las columnas."""
    if not filas:
        return
    sets = ", ".join(f"{c} = EXCLUDED.{c}" for c in cols if c != pk)
    cur.executemany(
        f"INSERT INTO {ESQ}.{tabla} ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))}) "
        f"ON CONFLICT ({pk}) DO UPDATE SET {sets}", filas)


def espejo(cur, tabla, pk, ids):
    """Borra del destino lo que ya no existe en el origen."""
    cur.execute(f"DELETE FROM {ESQ}.{tabla} WHERE NOT ({pk} = ANY(%s))", (list(ids),))
    return cur.rowcount


# (tabla origen, tabla destino, pk destino) en orden de dependencias
TABLAS = [
    ("operaciones_proyectos", "proyecto", "id_proyecto"),
    ("operaciones_supervisores", "supervisor", "id_supervisor"),
    ("operaciones_camiones", "camion", "id_camion"),
    ("operacionesa_actividades", "actividad", "id_actividad"),
    ("operaciones_tractoristas_in", "tractorista", "id_tractorista"),
    ("operaciones_lotes_infx", "lote_informix", "id_lote_informix"),
    ("operacionesa_checks", "checklist", "id_checklist"),
    ("operacionesa_registro", "registro", "id_registro"),
    ("operaciones_tractores_fallas", "falla_tractor", "id_falla_tractor"),
    ("operaciones_cosecha_transp", "cosecha_transporte", "id_cosecha_transporte"),
    ("operaciones_cosecha", "cosecha", "id_cosecha"),
]
# Tablas donde el sistema nuevo escribe a diario: el freno mira estas.
MOVIMIENTO = {"checklist", "registro", "falla_tractor", "cosecha_transporte", "cosecha"}

CHECK_BOOLS = ["insp_motor", "insp_refrigerante", "insp_aceite_motor", "insp_aceite_hidraulico",
               "insp_fugas_hidraulico", "insp_bomba_hidraulica", "insp_transmisiones",
               "insp_indicadores_tablero", "insp_neumaticos", "insp_frenos", "insp_fisuras",
               "insp_fallo_electrico", "limp_radiador", "limp_motor_filtros", "limp_cabina",
               "limp_frenos", "lub_articulaciones", "lub_pines_bocines"]
SEG_BOOLS = ["seg_chaleco", "seg_cofia", "seg_casco", "seg_calzado_adecuado", "seg_limpieza_bines",
             "seg_materiales_extranos", "seg_saran"]


def leer(s, sql):
    s.execute(sql)
    cols = [c.name for c in s.description]
    return [dict(zip(cols, r)) for r in s.fetchall()]


def migrar(s, d):
    o = lambda t: f"operaciones_agricolas.{t}"  # noqa: E731
    resumen = {}

    # ---- proyecto ----
    rows = leer(s, f"SELECT * FROM {o('operaciones_proyectos')}")
    upsert(d, "proyecto", "id_proyecto",
           ["id_proyecto", "nombre", "direccion", "tipo", "estado", "fecha_creacion"],
           [(r["id"], r["nombre"].strip(), r["direccion"], r["tipo"], estado_catalogo(r["estado"]),
             r["creado_en"] or r.get("creado_en")) for r in rows])
    ids_proyecto = {r["id"] for r in rows}
    resumen["proyecto"] = rows

    # ---- personas (maestro, mismo mirai_core) por cedula: solo lectura ----
    d.execute("SELECT identificacion, id_persona FROM personas.personas WHERE tenant_id = 1")
    persona_por_cedula = {k.strip(): v for k, v in d.fetchall() if k}

    # ---- supervisor ----
    rows = leer(s, f"SELECT * FROM {o('operaciones_supervisores')}")
    upsert(d, "supervisor", "id_supervisor",
           ["id_supervisor", "id_persona", "cedula", "nombre", "id_proyecto", "proyecto", "estado", "fecha_creacion"],
           [(r["id"], persona_por_cedula.get((r["cedula"] or "").strip()), r["cedula"].strip(), r["nombre"].strip(),
             r["id_proyecto"] if r["id_proyecto"] in ids_proyecto else None, r["proyecto"],
             estado_catalogo(r["estado"]), r["creado_en"]) for r in rows])
    ids_supervisor = {r["id"] for r in rows}
    resumen["supervisor"] = rows

    # ---- camion ----
    rows = leer(s, f"SELECT * FROM {o('operaciones_camiones')}")
    upsert(d, "camion", "id_camion",
           ["id_camion", "nombre", "cedula", "placa", "correo", "empresa", "estado", "fecha_creacion"],
           [(r["id"], r["nombre"].strip(), r["cedula"].strip(), r["placa"], r["correo"], r["empresa"],
             estado_catalogo(r["estado"]), r["creado_en"]) for r in rows])
    ids_camion = {r["id"] for r in rows}
    resumen["camion"] = rows

    # ---- actividad ----
    rows = leer(s, f"SELECT * FROM {o('operacionesa_actividades')} ORDER BY id")
    # El generador viejo repitio codigos (ACT-038 dos veces): el repetido toma
    # el siguiente codigo libre. Determinista (por id) para que el espejo no cambie.
    usados, codigos = set(), {}
    for r in rows:
        cod = r["codigo_act"] or f"ACT-{r['id']:03d}"
        if cod in usados:
            n = int(cod.split("-")[-1]) if cod.split("-")[-1].isdigit() else r["id"]
            while f"ACT-{n:03d}" in usados or f"ACT-{n:03d}" in {x["codigo_act"] for x in rows}:
                n += 1
            cod = f"ACT-{n:03d}"
        usados.add(cod)
        codigos[r["id"]] = cod
    d.execute(f"DELETE FROM {ESQ}.actividad WHERE NOT (id_actividad = ANY(%s))", ([r["id"] for r in rows],))
    upsert(d, "actividad", "id_actividad",
           ["id_actividad", "codigo", "actividad", "subactividades", "equipo", "tipo", "cantidad", "estado",
            "fecha_creacion", "fecha_actualizacion"],
           [(r["id"], codigos[r["id"]], r["actividad"], j(r["subactividades"]),
             r["equipo"] or "Tractores", r["tipo"], r["cantidad"] or 0, estado_catalogo(bool(r["activo"])),
             r["created_at"], r["updated_at"]) for r in rows])
    ids_actividad = {r["id"] for r in rows}
    resumen["actividad"] = rows

    # ---- tractorista (credencial; persona por cedula) ----
    rows = leer(s, f"SELECT * FROM {o('operaciones_tractoristas_in')}")
    tract, sin_persona = [], []
    for r in rows:
        ced = (r["cedula"] or "").strip()
        idp = persona_por_cedula.get(ced)
        if not idp:
            sin_persona.append(f"{r['username']} (cedula {ced!r})")
            continue
        tract.append((r["id"], idp, ced, (r["username"] or "").strip().lower() or None, vacio(r["pin_hash"]),
                      r["pin_expira"], r["ultimo_acceso"], estado_catalogo(r["estado"]), r["creado_en"]))
    upsert(d, "tractorista", "id_tractorista",
           ["id_tractorista", "id_persona", "cedula", "username", "pin_hash", "pin_expira", "ultimo_acceso",
            "estado", "fecha_creacion"], tract)
    ids_tractorista = {t[0] for t in tract}
    resumen["tractorista"] = tract
    tr = lambda v: v if v in ids_tractorista else None  # noqa: E731

    # ---- lote_informix ----
    rows = leer(s, f"SELECT * FROM {o('operaciones_lotes_infx')}")
    cols = ["ocult_cod_ocult", "ocult_cod_proda", "variedad", "lote", "lote_obs", "empresa", "hacienda",
            "proyecto", "edad_sem", "dimension", "fecha_siembra", "anio", "semana", "fecha_sincronizacion"]
    upsert(d, "lote_informix", "id_lote_informix", ["id_lote_informix"] + cols,
           [(r["id"], *[r[c] for c in cols]) for r in rows])
    resumen["lote_informix"] = rows

    # ---- checklist ----
    rows = leer(s, f"SELECT * FROM {o('operacionesa_checks')}")
    cols = ["usuario", "fecha", "tractor", "apero"] + CHECK_BOOLS + ["horometro_inicial", "horometro_final", "estado"]
    upsert(d, "checklist", "id_checklist", ["id_checklist", "id_tractorista"] + cols,
           [(r["id"], tr(r["id_tractorista"]), *[(bool(r[c]) if c in CHECK_BOOLS else r[c]) for c in cols])
            for r in rows])
    ids_check = {r["id"] for r in rows}
    resumen["checklist"] = rows
    ck = lambda v: v if v in ids_check else None  # noqa: E731

    # ---- registro ----
    rows = leer(s, f"SELECT * FROM {o('operacionesa_registro')}")
    cols = ["fecha_creacion", "fecha_fin", "tiempo_inicio", "actividad", "subactividad", "tractor", "apero",
            "lote", "hacienda", "orden_cultivo", "tipo", "usuario", "ubicacion"]
    upsert(d, "registro", "id_registro",
           ["id_registro", "id_actividad", "id_checklist", "id_tractorista", "fecha_historial", "tiempo_paro",
            "tiempo_real", "estado"] + cols,
           [(r["id"], r["id_actividad"] if r["id_actividad"] in ids_actividad else None, ck(r["id_check"]),
             tr(r["id_tractorista"]), j(r["fecha_historial"]), r["tiempo_paro"] or 0, r["tiempo_real"] or 0,
             r["estado"] or "Pendiente", *[r[c] for c in cols]) for r in rows])
    resumen["registro"] = rows

    # ---- falla_tractor ----
    rows = leer(s, f"SELECT * FROM {o('operaciones_tractores_fallas')}")
    upsert(d, "falla_tractor", "id_falla_tractor",
           ["id_falla_tractor", "id_checklist", "id_tractorista", "usuario", "tractor", "detalle", "ubicacion",
            "estado", "fecha", "fecha_creacion"],
           [(r["id"], ck(r["id_check"]), tr(r["id_tractorista"]), r["usuario"], r["tractor"], r["detalle"],
             r["ubicacion"], r["estado"] or "pendiente", r["fecha"], r["creado_en"]) for r in rows])
    resumen["falla_tractor"] = rows

    # ---- cosecha_transporte (id_correccion es FK a la misma tabla: 2 pasos) ----
    rows = leer(s, f"SELECT * FROM {o('operaciones_cosecha_transp')}")
    ids_transp = {r["id"] for r in rows}
    cols = ["propietario", "placa", "nombre_chofer", "numeracion", "num_ficha"] + SEG_BOOLS + [
        "seg_comentario", "seg_observaciones", "seg_foto_url", "fecha_despacho", "fecha_salida", "planta",
        "usuario", "observacion_falla", "recibido_por", "hora_ingreso", "creado_por"]
    upsert(d, "cosecha_transporte", "id_cosecha_transporte",
           ["id_cosecha_transporte", "id_camion", "id_supervisor", "id_correccion", "fecha_creacion", "estado"] + cols,
           [(r["id"], r["id_camion"] if r["id_camion"] in ids_camion else None,
             r["id_supervisor"] if r["id_supervisor"] in ids_supervisor else None, None,
             r["fecha_creacion"], r["estado"] or "Activo",
             *[(bool(r[c]) if c in SEG_BOOLS else r[c]) for c in cols]) for r in rows])
    d.executemany(f"UPDATE {ESQ}.cosecha_transporte SET id_correccion = %s WHERE id_cosecha_transporte = %s",
                  [(r["correccion_id"], r["id"]) for r in rows if r["correccion_id"] in ids_transp])
    resumen["cosecha_transporte"] = rows

    # ---- cosecha (productos) ----
    rows = leer(s, f"SELECT * FROM {o('operaciones_cosecha')}")
    cols = ["producto", "lote", "centro_costos", "orden_cultivo", "variedad", "num_ficha_org", "num_ficha",
            "ubicacion", "responsable", "recibido_por", "numeracion", "fecha_creacion"]
    upsert(d, "cosecha", "id_cosecha",
           ["id_cosecha", "id_cosecha_transporte", "peso", "peso_neto", "cantidad", "estado"] + cols,
           [(r["id"], r["id_transporte"] if r["id_transporte"] in ids_transp else None, r["peso"] or 0,
             r["peso_neto"] or 0, r["cantidad"] or 0, r["estado"] or "Activo", *[r[c] for c in cols])
            for r in rows])
    resumen["cosecha"] = rows

    # ---- espejo (hijos primero) + secuencias ----
    borrados = {}
    for _, tabla, pk in reversed(TABLAS):
        ids = [t[0] for t in resumen[tabla]] if tabla == "tractorista" else [r["id"] for r in resumen[tabla]]
        borrados[tabla] = espejo(d, tabla, pk, ids)
    for _, tabla, pk in TABLAS:
        d.execute(f"SELECT setval(pg_get_serial_sequence('{ESQ}.{tabla}', '{pk}'), "
                  f"greatest((SELECT coalesce(max({pk}), 0) FROM {ESQ}.{tabla}), 1))")
    return resumen, borrados, sin_persona


def verificar(s, d):
    print("\nVerificacion (origen -> destino):")
    ok = True
    for t_o, t_d, _ in TABLAS:
        s.execute(f"SELECT count(*) FROM operaciones_agricolas.{t_o}")
        n_o = s.fetchone()[0]
        d.execute(f"SELECT count(*) FROM {ESQ}.{t_d}")
        n_d = d.fetchone()[0]
        marca = "OK" if n_o == n_d else "DIFERENTE"
        ok &= n_o == n_d or t_d == "tractorista"
        print(f"  {t_o:32s} {n_o:6d} -> {t_d:20s} {n_d:6d}  {marca}")
    # muestreo de campos
    s.execute("SELECT id, estado, tiempo_real, usuario, tractor FROM operaciones_agricolas.operacionesa_registro ORDER BY id DESC LIMIT 200")
    origen = {r[0]: r[1:] for r in s.fetchall()}
    d.execute(f"SELECT id_registro, estado, tiempo_real, usuario, tractor FROM {ESQ}.registro WHERE id_registro = ANY(%s)",
              (list(origen),))
    dif = [i for i, *v in d.fetchall() if tuple(v) != tuple(origen[i])]
    print(f"  registro: muestreo 200 ultimos, diferencias = {len(dif)}")
    s.execute("SELECT id, estado, placa, num_ficha, recibido_por FROM operaciones_agricolas.operaciones_cosecha_transp ORDER BY id DESC LIMIT 200")
    origen = {r[0]: r[1:] for r in s.fetchall()}
    d.execute(f"SELECT id_cosecha_transporte, estado, placa, num_ficha, recibido_por FROM {ESQ}.cosecha_transporte "
              "WHERE id_cosecha_transporte = ANY(%s)", (list(origen),))
    dif2 = [i for i, *v in d.fetchall() if tuple(v) != tuple(origen[i])]
    print(f"  cosecha_transporte: muestreo 200 ultimos, diferencias = {len(dif2)}")
    return ok and not dif and not dif2


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--origen-env", default=str(ORIGEN_ENV))
    ap.add_argument("--verificar", action="store_true")
    ap.add_argument("--forzar", action="store_true")
    a = ap.parse_args()

    with conectar_origen(a.origen_env) as src, conectar_destino() as dst:
        s, d = src.cursor(), dst.cursor()
        if not a.verificar:
            d.execute((RAIZ / "sql" / "01_schema.sql").read_text(encoding="utf-8"))
            # ---- freno: el destino ya tiene movimientos propios del sistema nuevo? ----
            for t_o, t_d, pk in TABLAS:
                if t_d not in MOVIMIENTO:
                    continue
                s.execute(f"SELECT coalesce(max(id), 0) FROM operaciones_agricolas.{t_o}")
                max_o = s.fetchone()[0]
                d.execute(f"SELECT count(*) FROM {ESQ}.{t_d} WHERE {pk} > %s", (max_o,))
                nuevos = d.fetchone()[0]
                if nuevos and not a.forzar:
                    raise SystemExit(f"ABORTADO: {ESQ}.{t_d} tiene {nuevos} registros creados por el sistema nuevo; "
                                     "el espejo los borraria. (--forzar solo si sabes lo que haces)")
            resumen, borrados, sin_persona = migrar(s, d)
            dst.commit()
            print("Copiado:")
            for _, t, _pk in TABLAS:
                print(f"  {t:20s} {len(resumen[t]):6d}  (borrados por espejo: {borrados[t]})")
            if sin_persona:
                print(f"Tractoristas NO copiados (su cedula no esta en Personas): {', '.join(sin_persona)}")
        ok = verificar(s, d)
        print("\nRESULTADO:", "OK" if ok else "REVISAR")


if __name__ == "__main__":
    main()
