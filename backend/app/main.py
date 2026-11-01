from __future__ import annotations

import logging
import os
import time
from contextlib import asynccontextmanager

import anyio
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from sqlalchemy import text

from . import models  # noqa: F401 - registers tables
from .broadcaster import broadcaster
from .config import settings
from .db import SessionLocal, engine, ensure_schema
from .routers import admin, alerts, auth, crowd, families, locations, missing, parking, rfid, routes, video, ws
from .seed import seed_demo
from .seed_real import seed_real
from .limits import VideoUploadLimit
from .services import cache
from .services import video_analysis as video_jobs

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("app")

_metrics = {"requests": 0, "errors": 0, "latency_sum": 0.0}


DEFAULT_ADMIN_PASSWORD = "admin12345"


def _secure_bootstrap_admin() -> None:
    """The bootstrap admin is created once with PUSHKAR_BOOTSTRAP_ADMIN_PASSWORD. If a deployment started without that
    variable, the account kept the public default password. When a real password is configured later, replace the
    default on the next start; while none is configured outside dev databases, warn on every start."""
    from sqlalchemy import select

    from .models import User
    from .security import hash_password, verify_password

    db = SessionLocal()
    try:
        admin = db.scalar(select(User).where(User.username == settings.bootstrap_admin_username))
        if not admin or not verify_password(DEFAULT_ADMIN_PASSWORD, admin.password_hash):
            return
        if settings.bootstrap_admin_password != DEFAULT_ADMIN_PASSWORD:
            admin.password_hash = hash_password(settings.bootstrap_admin_password)
            db.commit()
            log.warning("Bootstrap admin still had the default password; replaced it with PUSHKAR_BOOTSTRAP_ADMIN_PASSWORD")
        elif not settings.database_url.startswith("sqlite"):
            log.error("SECURITY: admin '%s' uses the public default password. Set PUSHKAR_BOOTSTRAP_ADMIN_PASSWORD and restart.", admin.username)
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # sync (threadpool) endpoints: allow more concurrent handlers than anyio's default of 40
    anyio.to_thread.current_default_thread_limiter().total_tokens = 80
    ensure_schema()
    os.makedirs(settings.upload_dir, exist_ok=True)
    if settings.seed_on_start and settings.seed_mode != "none":
        db = SessionLocal()
        try:
            seed_demo(db) if settings.seed_mode == "demo" else seed_real(db)
        finally:
            db.close()
    _secure_bootstrap_admin()
    # importing torch/ultralytics takes ~10 s; do it in the background so the first detector-status call is fast
    import threading
    threading.Thread(target=video_jobs.available, name="video-warmup", daemon=True).start()
    recovered = video_jobs.recover_interrupted()
    if recovered["failed"] or recovered["resubmitted"]:
        log.info("Video analysis recovery: %s", recovered)
    await broadcaster.start()
    log.info("%s started (dev_mode=%s, db=%s)", settings.app_name, settings.dev_mode, settings.database_url.split("@")[-1])
    yield
    video_jobs.shutdown()
    await broadcaster.stop()


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description="Godavari Pushkaralu Smart Crowd Management & Pilgrim Assistance Platform API",
    lifespan=lifespan,
)
app.add_middleware(VideoUploadLimit, path="/api/v1/crowd/video/analyses")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def observe(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    _metrics["requests"] += 1
    _metrics["latency_sum"] += time.perf_counter() - start
    if response.status_code >= 500:
        _metrics["errors"] += 1
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"  # OSM tile policy needs the site origin
    return response


API = "/api/v1"
for r in (auth, locations, crowd, routes, parking, families, rfid, missing, alerts, admin, video):
    app.include_router(r.router, prefix=API)
app.include_router(ws.router)


@app.get("/health", tags=["ops"])
def health():
    db_ok = True
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:  # noqa: BLE001
        db_ok = False
    return {"status": "ok" if db_ok else "degraded", "db": db_ok, "ws_connections": broadcaster.connections, "dev_mode": settings.dev_mode, "seed_mode": settings.seed_mode}


@app.get("/metrics", tags=["ops"], response_class=PlainTextResponse)
def metrics():
    avg = _metrics["latency_sum"] / _metrics["requests"] if _metrics["requests"] else 0
    return (
        f"pushkar_http_requests_total {_metrics['requests']}\n"
        f"pushkar_http_errors_total {_metrics['errors']}\n"
        f"pushkar_http_latency_avg_seconds {avg:.5f}\n"
        f"pushkar_ws_connections {broadcaster.connections}\n"
        f"pushkar_ws_messages_sent_total {broadcaster.sent}\n"
        f"pushkar_cache_hits_total {cache.stats['hits']}\n"
        f"pushkar_cache_misses_total {cache.stats['misses']}\n"
    )


# ----------------------------------------------------------------------------- single-service hosting
# When PUSHKAR_STATIC_DIR points at the built frontend, the API also serves the web app (registered last, so every
# API, WebSocket and ops route above wins). Unknown paths fall back to index.html for client-side routing.
if settings.static_dir and os.path.isdir(settings.static_dir):
    from fastapi import HTTPException
    from fastapi.responses import FileResponse

    _static_root = os.path.realpath(settings.static_dir)
    _no_cache = {"index.html", "sw.js", "registerSW.js", "manifest.webmanifest"}

    @app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    def spa(path: str):
        if path.startswith(("api/", "ws/")):
            raise HTTPException(404, "Not found")
        target = os.path.realpath(os.path.join(_static_root, path))
        if not target.startswith(_static_root + os.sep) or not os.path.isfile(target):
            target = os.path.join(_static_root, "index.html")
        name = os.path.basename(target)
        if name in _no_cache:
            headers = {"Cache-Control": "no-cache"}
        elif "/assets/" in target.replace(os.sep, "/"):
            headers = {"Cache-Control": "public, max-age=31536000, immutable"}
        else:
            headers = {"Cache-Control": "public, max-age=3600"}
        return FileResponse(target, headers=headers)
