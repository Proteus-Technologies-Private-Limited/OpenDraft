import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.api import scripts, auth, export, projects, versions, assets
from app.config import PROJECTS_DIR, BASE_DIR

STATIC_DIR = BASE_DIR / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: ensure projects data directory exists
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(
    title="OpenDraft API",
    description="Backend API for OpenDraft screenwriting application",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",       # Vite dev server
        "http://localhost:3000",       # Alt dev server
        "tauri://localhost",           # Tauri desktop (macOS/Linux)
        "https://tauri.localhost",     # Tauri desktop (Windows)
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(scripts.router, prefix="/api/scripts", tags=["scripts"])
app.include_router(export.router, prefix="/api/export", tags=["export"])
app.include_router(projects.router, prefix="/api/projects", tags=["projects"])
app.include_router(versions.router, prefix="/api/projects", tags=["versions"])
app.include_router(assets.router, prefix="/api/projects", tags=["assets"])


@app.get("/health")
async def health():
    return {"status": "ok"}


# Serve the built frontend as static files
if STATIC_DIR.is_dir():
    # Serve JS/CSS/assets from /assets
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    # Catch-all: serve index.html for any non-API route (SPA routing)
    @app.get("/{full_path:path}")
    async def serve_spa(request: Request, full_path: str):
        # Don't intercept /api or /health
        if full_path.startswith("api/") or full_path == "health":
            return {"detail": "Not found"}
        index = STATIC_DIR / "index.html"
        if index.exists():
            return FileResponse(index)
        return {"app": "OpenDraft", "version": "0.1.0"}
else:
    @app.get("/")
    async def root():
        return {"app": "OpenDraft", "version": "0.1.0", "note": "Run build.sh to deploy frontend"}
