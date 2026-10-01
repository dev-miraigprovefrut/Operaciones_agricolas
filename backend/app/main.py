"""API de Operaciones Agricolas (Nintanga).

Sesion por la cookie del HUB (o la de tractorista), datos en mirai_core
(esquema operaciones_agricolas), permisos y usuarios por API del HUB, personas
por API del maestro Personas. Ver auth.py.
"""
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .routers import admin, catalogos, cosecha, empresas, lotes, sesion, tractores

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("operagricola")

app = FastAPI(title="Operaciones Agrícolas API", version="2.0.0",
              docs_url="/docs" if settings.DEBUG else None, redoc_url=None,
              openapi_url="/openapi.json" if settings.DEBUG else None)

app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(Exception)
async def error_generico(request: Request, exc: Exception):
    """500 sin detalles internos (se registran en el log) y con CORS, para que
    el frontend pueda leer el error."""
    logger.exception("[500] %s %s", request.method, request.url.path)
    origin = request.headers.get("origin", "")
    headers = ({"access-control-allow-origin": origin, "access-control-allow-credentials": "true"}
               if origin in settings.cors_origins else {})
    return JSONResponse(status_code=500, content={"detail": "Error interno del servidor"}, headers=headers)


@app.get("/")
def raiz():
    return {"message": "API de Operaciones Agrícolas"}


@app.get("/health")
def health():
    return {"status": "ok"}


for r in (sesion, admin, catalogos, tractores, cosecha, lotes, empresas):
    app.include_router(r.router)


@app.on_event("startup")
def iniciar_sync_informix():
    """Sync con Informix dentro del proceso web: fichas de cosecha cada 2 horas
    (en punto, desde las 6am Ecuador) y lotes viernes y lunes. Solo si
    SYNC_INFORMIX esta activo (una sola instancia debe correrlo)."""
    if not settings.SYNC_INFORMIX:
        logger.info("Sync Informix APAGADO (SYNC_INFORMIX=false)")
        return
    from apscheduler.schedulers.background import BackgroundScheduler

    from .sync import cosecha_recibido, lotes as sync_lotes

    def _cosecha():
        try:
            cosecha_recibido.main(incluir_activo_abandonado=True)
        except Exception:  # noqa: BLE001
            logger.exception("Error en sync de cosecha")

    def _lotes():
        try:
            sync_lotes.main()
        except Exception:  # noqa: BLE001
            logger.exception("Error en sync de lotes")

    sched = BackgroundScheduler(timezone="UTC")
    sched.add_job(_cosecha, "cron", hour="1/2", minute=0, coalesce=True, max_instances=1, misfire_grace_time=600)
    sched.add_job(_lotes, "cron", day_of_week="fri,mon", minute=15, coalesce=True, max_instances=1,
                  misfire_grace_time=600)
    sched.start()
    logger.info("Sync Informix ACTIVO")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=8007, reload=False)
