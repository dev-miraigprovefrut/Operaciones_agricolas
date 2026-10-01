"""Configuracion del backend de Operaciones Agricolas.

Se lee del .env por ruta ABSOLUTA (carpeta backend/), asi funciona igual sin
importar desde donde se arranque el proceso (scripts incluidos). En ECS las
variables vienen de la task definition (y los secretos de Secrets Manager).
"""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_ENV_FILE = str(Path(__file__).resolve().parent.parent / ".env")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ENV_FILE, extra="ignore")

    # Base: mirai_core, esquema operaciones_agricolas
    DB_HOST: str = "localhost"
    DB_PORT: int = 5432
    DB_NAME: str = "mirai_core"
    DB_USER: str = "adminmirai"
    DB_PASSWORD: str = ""
    DB_SCHEMA: str = "operaciones_agricolas"
    DB_SSLMODE: str = "require"

    # Empresa del modulo (Nintanga) y tenant
    NUMERO_EMPRESA: str = "222"
    TENANT_ID: int = 1

    # JWT del HUB (misma SECRET_KEY, HS256). La sesion llega en la cookie
    # HttpOnly del HUB (mirai_access) o, para scripts/servicios, en Bearer.
    SECRET_KEY: str = ""
    JWT_ALGORITHM: str = "HS256"
    COOKIE_ACCESS_NAME: str = "mirai_access"

    # Sesion propia de los TRACTORISTAS (cedula + PIN, no son usuarios del
    # HUB). Se firma con una clave PROPIA del modulo: un token de tractorista
    # nunca sirve en el HUB ni en otro servicio.
    TRACTORISTA_SECRET_KEY: str = ""
    COOKIE_TRACTORISTA_NAME: str = "oa_tractorista"
    TRACTORISTA_HORAS_SESION: int = 12
    COOKIE_DOMAIN: str = ""            # .miraigprovefrut.com en produccion; vacio en local
    COOKIE_SECURE: bool = False
    # Los kioskos de los tractores (Raspberry) aun no reenvian la sesion: con
    # esto en True, los endpoints de registrar actividades aceptan llamadas sin
    # credenciales (como antes). Apagar cuando los kioskos se actualicen.
    KIOSKO_SIN_SESION: bool = True
    PIN_MAX_INTENTOS: int = 5
    PIN_MINUTOS_BLOQUEO: int = 15

    # Servicios del ecosistema (por API, nunca por su base)
    HUB_API_URL: str = "https://hubbk.miraigprovefrut.com/api"
    API_PERSONAS_URL: str = "https://personasbk.miraigprovefrut.com"
    API_EMPRESAS_URL: str = "https://empresasbk.miraigprovefrut.com"
    NOTIFY_URL: str = "https://notify.miraigprovefrut.com"
    MANTENIMIENTO_API_URL: str = "https://manntgbk.miraigprovefrut.com"
    MODULO_CLAVE: str = "operagricola"
    TIMEOUT_SERVICIOS: float = 8.0
    # Quienes reciben el aviso de fallas del checklist (logins del HUB, coma)
    AVISO_FALLAS_USUARIOS: str = "alfredo.burneo,carlos.burbano,pamela.toaquiza,janneth.yugcha"

    # AWS: DynamoDB (catalogo de tractores/aperos, hasta que exista Activos) y
    # S3 (fotos de seguridad). Sin llaves se usa la cadena por defecto de boto3.
    AWS_REGION: str = "us-east-1"
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    S3_BUCKET: str = "operacionesagricolas"
    DDB_CATALOGO_TRACTORES: str = "CatalogoTractores"
    DDB_CATALOGO_APEROS: str = "CatalogoAperos"

    # Base de Mantenimiento: SOLO lectura de ot_equipo_horas (horometro) hasta
    # que el catalogo de Activos/Mantenimiento lo exponga por API.
    POSTGRES_HOST: str = ""
    POSTGRES_PORT: int = 5432
    POSTGRES_DB: str = ""
    POSTGRES_USER: str = ""
    POSTGRES_PASSWORD: str = ""
    POSTGRES_SSLMODE: str = "require"

    # Sync con Informix (fichas de cosecha y lotes) dentro del proceso web.
    # APAGADO por defecto: solo una instancia debe correrlo (el sistema viejo
    # sigue haciendolo hasta el dia del cambio).
    SYNC_INFORMIX: bool = False
    DB_INFORMIX_HOST: str = "172.20.4.51"
    DB_INFORMIX_PORT: int = 1526
    DB_INFORMIX_SERVER: str = "ol_planta"
    DB_INFORMIX_NAME: str = "lassod"
    DB_INFORMIX_USER: str = ""
    DB_INFORMIX_PASSWORD: str = ""

    # CORS: origenes del frontend (coma). Con cookies no se puede usar "*".
    CORS_ORIGINS: str = "http://localhost:5007,http://127.0.0.1:5007"

    DEBUG: bool = False

    @property
    def database_url(self) -> str:
        return (f"postgresql+psycopg://{self.DB_USER}:{self.DB_PASSWORD}"
                f"@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}?sslmode={self.DB_SSLMODE}")

    @property
    def mantenimiento_url(self) -> str | None:
        if not self.POSTGRES_HOST:
            return None
        return (f"postgresql+psycopg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
                f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}?sslmode={self.POSTGRES_SSLMODE}")

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def aviso_fallas(self) -> list[str]:
        return [u.strip() for u in self.AVISO_FALLAS_USUARIOS.split(",") if u.strip()]

    def aws_kwargs(self) -> dict:
        kw = {"region_name": self.AWS_REGION}
        if self.AWS_ACCESS_KEY_ID and self.AWS_SECRET_ACCESS_KEY:
            kw.update(aws_access_key_id=self.AWS_ACCESS_KEY_ID, aws_secret_access_key=self.AWS_SECRET_ACCESS_KEY)
        return kw


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
