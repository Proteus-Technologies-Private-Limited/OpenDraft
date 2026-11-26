"""Checks that core fires the app:startup and app:shutdown plugin hooks.

Run from the project root:  venv/bin/python test-script/check_plugin_app_hooks.py
"""
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

import os  # noqa: E402

os.environ.setdefault("PROJECTS_DIR", tempfile.mkdtemp(prefix="opendraft-hooks-"))

from app.plugins import register_hook  # noqa: E402

seen: list[str] = []
register_hook("app:startup", lambda app: seen.append(f"startup:{app.title}"))


async def on_shutdown(app):
    seen.append("shutdown")


register_hook("app:shutdown", on_shutdown)
# A failing hook must be logged, not stop the app from starting.
register_hook("app:startup", lambda app: 1 / 0)

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402

try:
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200, "app did not serve after startup hooks"
        assert seen == ["startup:OpenDraft API"], seen
    assert seen == ["startup:OpenDraft API", "shutdown"], seen
except AssertionError as exc:
    print(f"FAIL: {exc}")
    sys.exit(1)
print("OK: app:startup and app:shutdown fired; a failing hook did not stop startup")
