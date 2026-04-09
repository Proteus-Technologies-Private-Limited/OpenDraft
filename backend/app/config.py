import os
import sys
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
PROJECTS_DIR = _get_data_dir()
DEFAULT_PROJECT = "Default Project"

# Demo mode — when True, the server shows a warning banner to users
DEMO_MODE = os.environ.get("DEMO_MODE", "").lower() in ("1", "true", "yes")
