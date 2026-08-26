from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import CONFIG
from .db import init_db
from .discovery import DISCOVERY
from .ops import HEALTH_LOOP
from .routers import discovery as discovery_router
from .routers import inference as inference_router
from .routers import machines as machines_router
from .routers import metrics as metrics_router
from .routers import nvidia as nvidia_router
from .routers import terminal as terminal_router
from .ssh_pool import POOL, ensure_keypair

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")
logging.getLogger("asyncssh").setLevel(logging.WARNING)


@asynccontextmanager
async def lifespan(app: FastAPI):
    CONFIG.ensure_dirs()
    await init_db()
    ensure_keypair()
    await DISCOVERY.start()
    HEALTH_LOOP.start()
    yield
    await HEALTH_LOOP.stop()
    await DISCOVERY.stop()
    await POOL.close_all()


app = FastAPI(title="InferVoice Control API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CONFIG.cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(machines_router.router)
app.include_router(metrics_router.router)
app.include_router(nvidia_router.router)
app.include_router(inference_router.router)
app.include_router(discovery_router.router)
app.include_router(terminal_router.router)


@app.get("/api/health")
async def health():
    return {"ok": True, "service": "infervoice-control", "public_key_path": str(CONFIG.public_key_path)}
