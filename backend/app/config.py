import os
import re
import sys
from contextvars import ContextVar
from pathlib import Path


def _get_base_dir() -> Path:
    """Return the backend root directory, handling PyInstaller frozen mode."""
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parent.parent


def _get_data_dir() -> Path:
    """Return the user data directory for project storage.

    In desktop mode the OPENDRAFT_DATA_DIR env var is set by the Tauri shell
    to a platform-appropriate location.  Otherwise fall back to the local
    ``data/projects`` directory used during development.
    """
    env_dir = os.environ.get("OPENDRAFT_DATA_DIR")
    if env_dir:
        p = Path(env_dir) / "projects"
        p.mkdir(parents=True, exist_ok=True)
        return p
    return _get_base_dir() / "data" / "projects"


BASE_DIR = _get_base_dir()

# Root data directory — shared files (e.g. formatting templates) live directly
# under this. Per-user project files live under PROJECTS_DIR_BASE / "users" / <id>.
PROJECTS_DIR_BASE = _get_data_dir()

# Legacy name — kept so existing imports work. Equals the base; call
# get_projects_dir() to get the per-request, per-user scoped directory.
PROJECTS_DIR = PROJECTS_DIR_BASE

DEFAULT_PROJECT = "Default Project"

# ── Per-request user context ──
# FastAPI dependencies set this before handling a request; services resolve
# per-user paths through get_projects_dir(). Unset (None) means "unscoped"
# which maps to a shared "legacy" namespace — used only for migration/legacy
# endpoints. Authenticated endpoints must always set this.
current_user_id: ContextVar[str | None] = ContextVar("current_user_id", default=None)

_USER_ID_SAFE = re.compile(r"[^a-zA-Z0-9_-]")


def _safe_user_id(user_id: str) -> str:
    """Sanitize a user ID for safe filesystem use."""
    return _USER_ID_SAFE.sub("_", user_id)[:128]


def get_projects_dir() -> Path:
    """Return the per-user projects directory for the active request.

    Resolves to <PROJECTS_DIR_BASE>/users/<user_id>. If no user is set on the
    request context, returns the legacy shared directory (pre-auth behavior)
    — but auth-required endpoints should never reach this branch.
    """
    user_id = current_user_id.get()
    if user_id is None:
        # No authenticated user on this request — serve legacy files. Useful
        # for the one-time migration window and for tests that don't exercise
        # auth. Production endpoints gate on require_verified_user upstream.
        return PROJECTS_DIR_BASE / "users" / "legacy"
    return PROJECTS_DIR_BASE / "users" / _safe_user_id(user_id)

# Demo mode — when True, the server shows a warning banner to users
DEMO_MODE = os.environ.get("DEMO_MODE", "").lower() in ("1", "true", "yes")

# ── Auth / collab integration ──
# Collab server is the identity provider. Backend validates collab-issued JWTs
# locally using the shared HS256 secret, and (when co-located) reads the user
# record from the collab SQLite file. When not co-located, /api/auth/* proxies
# to the collab server over HTTPS.
COLLAB_JWT_SECRET = os.environ.get("COLLAB_JWT_SECRET") or os.environ.get("JWT_SECRET") or ""
COLLAB_DB_PATH = os.environ.get("COLLAB_DB_PATH") or ""  # e.g. /data/collab/collab.sqlite3
COLLAB_SERVER_URL = (os.environ.get("COLLAB_SERVER_URL") or "http://localhost:4000").rstrip("/")

# Free-plan quota (per user)
try:
    FREE_PLAN_FILE_LIMIT = int(os.environ.get("FREE_PLAN_FILE_LIMIT", "5"))
except ValueError:
    FREE_PLAN_FILE_LIMIT = 5
