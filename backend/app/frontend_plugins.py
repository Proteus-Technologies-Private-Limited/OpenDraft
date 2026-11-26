"""
Runtime frontend plugins: plugin folders the web app loads when it starts.

Each plugin is a folder of its own under the plugins directory —
``backend/plugins/`` by default, or ``OPENDRAFT_PLUGINS_DIR`` — kept apart from
``backend/static``, which ``build.sh`` deletes and recreates on every deploy:

    backend/plugins/
      od-sidekick/
        plugin.json     {"id": "od-sidekick", "name": "Sidekick", "version": "0.1.0",
                         "apiVersion": 1, "script": "index.js", "style": "index.css"}
        index.js
        index.css

Adding a folder installs a plugin and removing it uninstalls it; a folder whose
name starts with ``.`` or ``_`` is ignored, so renaming it to ``_od-sidekick``
turns it off. Nothing is cached: the list is read on every request, so a change
shows on the next page load without restarting the server.

``GET /api/plugins`` lists the valid plugins; their files are served from
``/plugins/<id>/…``. A folder that is not a valid plugin is skipped and logged,
never served half-way. The plugin's script runs in the page with the app's own
rights — install only plugins you trust.

The desktop and mobile apps have no backend; they include plugins at build
time instead (frontend/vite.plugins.ts).
"""

from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path

from fastapi import APIRouter

from app.config import BASE_DIR

logger = logging.getLogger("frontend_plugins")

PLUGINS_DIR = Path(os.environ.get("OPENDRAFT_PLUGINS_DIR") or BASE_DIR / "plugins").resolve()

#: The runtime plugin API the frontend offers (frontend/src/plugins/runtimeHost.ts).
SUPPORTED_API_VERSION = 1

_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
_MAX_MANIFEST_BYTES = 64 * 1024


def ensure_plugins_dir() -> None:
    """Create the plugins directory so the file mount always has a directory."""
    try:
        PLUGINS_DIR.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        logger.warning("Could not create the plugins directory %s: %s", PLUGINS_DIR, exc)


def _file_in(folder: Path, relative: object) -> Path | None:
    """``relative`` as a file inside ``folder``, or None if it is not one."""
    if not isinstance(relative, str) or not relative or relative.startswith(("/", "\\")):
        return None
    candidate = (folder / relative).resolve()
    if folder not in candidate.parents or not candidate.is_file():
        return None
    return candidate


def _url_for(plugin_id: str, folder: Path, file: Path) -> str:
    """The file's URL, with its modification time so a replaced file is fetched again."""
    rel = file.relative_to(folder).as_posix()
    return f"/plugins/{plugin_id}/{rel}?v={int(file.stat().st_mtime)}"


def _read_plugin(folder: Path) -> dict | None:
    manifest_path = folder / "plugin.json"
    if not manifest_path.is_file():
        logger.warning("Skipping plugin folder %s: it has no plugin.json", folder.name)
        return None
    if manifest_path.stat().st_size > _MAX_MANIFEST_BYTES:
        logger.warning("Skipping plugin folder %s: plugin.json is too large", folder.name)
        return None
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        logger.warning("Skipping plugin folder %s: plugin.json is not readable JSON (%s)", folder.name, exc)
        return None
    if not isinstance(manifest, dict):
        logger.warning("Skipping plugin folder %s: plugin.json is not an object", folder.name)
        return None

    plugin_id = manifest.get("id")
    if plugin_id != folder.name or not isinstance(plugin_id, str) or not _ID.match(plugin_id):
        logger.warning(
            "Skipping plugin folder %s: its id must be the folder's name, in lower-case letters, digits and hyphens",
            folder.name,
        )
        return None
    api_version = manifest.get("apiVersion")
    if not isinstance(api_version, int) or api_version < 1 or api_version > SUPPORTED_API_VERSION:
        logger.warning(
            "Skipping plugin %s: it needs plugin API version %r; this OpenDraft offers %d",
            plugin_id, api_version, SUPPORTED_API_VERSION,
        )
        return None
    script = _file_in(folder, manifest.get("script"))
    if script is None:
        logger.warning("Skipping plugin %s: its script is missing or outside its folder", plugin_id)
        return None
    style = None
    if manifest.get("style") is not None:
        style = _file_in(folder, manifest.get("style"))
        if style is None:
            logger.warning("Plugin %s: its style sheet is missing; loading it without one", plugin_id)

    return {
        "id": plugin_id,
        "name": str(manifest.get("name") or plugin_id),
        "version": str(manifest.get("version") or ""),
        "apiVersion": api_version,
        "script": _url_for(plugin_id, folder, script),
        "style": _url_for(plugin_id, folder, style) if style else None,
    }


def list_frontend_plugins() -> list[dict]:
    """Every valid plugin folder, in name order."""
    if not PLUGINS_DIR.is_dir():
        return []
    plugins: list[dict] = []
    try:
        folders = sorted(p for p in PLUGINS_DIR.iterdir() if p.is_dir() and not p.name.startswith((".", "_")))
    except OSError as exc:
        logger.warning("Could not read the plugins directory %s: %s", PLUGINS_DIR, exc)
        return []
    for folder in folders:
        try:
            plugin = _read_plugin(folder)
        except OSError as exc:
            logger.warning("Skipping plugin folder %s: %s", folder.name, exc)
            continue
        if plugin:
            plugins.append(plugin)
    return plugins


router = APIRouter()


@router.get("")
async def get_frontend_plugins() -> list[dict]:
    """The runtime plugins the web app should load. Public: it lists code, not data."""
    return list_frontend_plugins()
