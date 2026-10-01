"""Conexion a Informix (ERP) por JDBC (JPype). Solo LECTURA.

Las credenciales vienen de la configuracion (DB_INFORMIX_*; en ECS de Secrets
Manager), nunca escritas en el codigo.
"""
import os
import shutil
import threading
import urllib.request

from ..config import settings

_JARS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "drivers")
_JARS = [
    ("jdbc-4.50.10.1.jar", "https://repo1.maven.org/maven2/com/ibm/informix/jdbc/4.50.10.1/jdbc-4.50.10.1.jar"),
    ("bson-3.8.0.jar", "https://repo1.maven.org/maven2/org/mongodb/bson/3.8.0/bson-3.8.0.jar"),
]
_lock = threading.Lock()


def _java_home() -> str:
    for cand in (os.path.join(os.environ.get("LOCALAPPDATA", ""), "DBeaver", "jre"), os.environ.get("JAVA_HOME", "")):
        if cand and os.path.exists(os.path.join(cand, "bin")):
            return cand
    java = shutil.which("java")
    return os.path.dirname(os.path.dirname(os.path.realpath(java))) if java else ""


def _jars() -> list[str]:
    os.makedirs(_JARS_DIR, exist_ok=True)
    rutas = []
    for nombre, url in _JARS:
        ruta = os.path.join(_JARS_DIR, nombre)
        if not os.path.exists(ruta):
            urllib.request.urlretrieve(url, ruta)
        rutas.append(ruta)
    return rutas


def _jvm():
    import jpype
    with _lock:
        if not jpype.isJVMStarted():
            home = _java_home()
            if home:
                os.environ["JAVA_HOME"] = home
                os.environ["PATH"] = os.path.join(home, "bin") + os.pathsep + os.environ.get("PATH", "")
            jpype.startJVM(jpype.getDefaultJVMPath(), f"-Djava.class.path={os.pathsep.join(_jars())}",
                           convertStrings=True)
    return jpype


def ejecutar_query(sql: str, params: list | None = None) -> list[list[str]]:
    """Ejecuta un SELECT en Informix y devuelve las filas como listas de texto."""
    if not settings.DB_INFORMIX_PASSWORD:
        raise RuntimeError("DB_INFORMIX_PASSWORD no configurada")
    jpype = _jvm()
    url = (f"jdbc:informix-sqli://{settings.DB_INFORMIX_HOST}:{settings.DB_INFORMIX_PORT}/"
           f"{settings.DB_INFORMIX_NAME}:INFORMIXSERVER={settings.DB_INFORMIX_SERVER}")
    dm = jpype.JClass("java.sql.DriverManager")
    # Si la VPN a la planta esta caida, sin limite cada conexion espera ~2 min
    # (el boton 'Sincronizar' terminaba en 504 del ALB). Se corta a los 10 s.
    dm.setLoginTimeout(10)
    conn = dm.getConnection(url, settings.DB_INFORMIX_USER, settings.DB_INFORMIX_PASSWORD)
    try:
        if params:
            st = conn.prepareStatement(sql)
            for i, p in enumerate(params, 1):
                st.setString(i, str(p))
            rs = st.executeQuery()
        else:
            st = conn.createStatement()
            st.execute("SET ISOLATION TO DIRTY READ")
            rs = st.executeQuery(sql)
        n = rs.getMetaData().getColumnCount()
        filas = []
        while rs.next():
            filas.append([(str(v).strip() if v else "") for v in (rs.getString(i) for i in range(1, n + 1))])
        rs.close()
        return filas
    finally:
        conn.close()
