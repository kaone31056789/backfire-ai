from __future__ import annotations

import logging
import time

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api import assistant, auth, investigations, meta, public, settings as settings_api
from .core.config import BASE_DIR, get_settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("backfire")
s = get_settings()


def run_migrations() -> None:
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(BASE_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BASE_DIR / "migrations"))
    cfg.set_main_option("sqlalchemy.url", s.database_url)
    command.upgrade(cfg, "head")


app = FastAPI(title="BACKFIRE AI API", version="1.0.0",
              description="Adversarial Climate Intervention Falsification Laboratory",
              docs_url="/api/docs" if not s.is_production else None, openapi_url="/api/openapi.json")

app.add_middleware(CORSMiddleware, allow_origins=s.origins, allow_credentials=True,
                   allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
                   allow_headers=["Authorization", "Content-Type", "X-Requested-With"])


@app.middleware("http")
async def security_headers(request: Request, call_next):
    t0 = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    if not request.url.path.startswith("/api/docs"):
        response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
    if s.is_production:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["Cache-Control"] = response.headers.get("Cache-Control", "no-store")
    log.debug("%s %s %s %.1fms", request.method, request.url.path, response.status_code, (time.perf_counter() - t0) * 1000)
    return response


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    errors = [{"field": ".".join(str(p) for p in e["loc"][1:]), "message": e["msg"]} for e in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": "Validation failed", "errors": errors})


@app.on_event("startup")
def startup() -> None:
    if s.run_migrations_on_start:
        run_migrations()
    from .services.demo import ensure_demo

    ensure_demo()
    log.info("BACKFIRE API ready (env=%s, db=%s)", s.environment, s.database_url.split(":")[0])


app.include_router(auth.router)
app.include_router(investigations.router)
app.include_router(settings_api.router)
app.include_router(meta.router)
app.include_router(public.router)
app.include_router(assistant.router)
