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
turns it off. A plugin folder may be a symbolic link to a build elsewhere
(``backend/plugins/od-sidekick -> ../OD-Sidekick/dist``); its files are still
confined to the folder the link points at. Nothing is cached: the list is read
on every request, so a change shows on the next page load without restarting
the server.

``GET /api/plugins`` lists the valid plugins; their files are served from
``/plugins/<id>/…`` — only for a plugin that list includes, never a hidden
file or folder (``.git``, ``.env``) and never anything outside the plugin's
folder. A folder that is not a valid plugin is skipped and logged, never
served half-way. The plugin's script runs in the page with the app's own
rights — install only plugins you trust.

Each listed plugin carries ``defaultEnabled``: the admin console's choice
(saved in the data directory) if there is one, else the manifest's
``defaultEnabled`` if it is a boolean, else null — the plugin's own kind then
decides (a plain plugin starts on, an opt-in add-on off). A writer's saved
choice in their browser outranks all of these, and a default never turns on an
add-on that declares what leaves the device or has settings to ask for
(frontend/src/plugins/registry.ts).

The desktop and mobile apps have no backend; they include plugins at build
time instead (frontend/vite.plugins.ts).
"""

from __future__ import annotations

import json
import logging
import os
import re
import mimetypes
import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import FileResponse

from app.config import BASE_DIR, PROJECTS_DIR_BASE

logger = logging.getLogger("frontend_plugins")

PLUGINS_DIR = Path(os.environ.get("OPENDRAFT_PLUGINS_DIR") or BASE_DIR / "plugins").resolve()
PLUGIN_DEFAULTS_DIR = PROJECTS_DIR_BASE.parent / "plugin-defaults"

#: The runtime plugin API the frontend offers (frontend/src/plugins/runtimeHost.ts).
SUPPORTED_API_VERSION = 1

_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
_MAX_MANIFEST_BYTES = 64 * 1024


def ensure_plugins_dir() -> None:
    """Create the plugins directory, so a plugin can be added by copying a folder in."""
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


def _admin_default(plugin_id: str) -> bool | None:
    """The default an admin saved in the console, or None if there is none."""
    try:
        value = (PLUGIN_DEFAULTS_DIR / plugin_id).read_text(encoding="utf-8")
        if value in ("true", "false"):
            return value == "true"
        logger.warning("Ignoring the saved default for plugin %s: %r is not true or false", plugin_id, value[:20])
    except FileNotFoundError:
        pass
    except (OSError, UnicodeError) as exc:
        logger.warning("Could not read the default for plugin %s: %s", plugin_id, exc)
    return None


def _manifest_default(plugin_id: str, manifest: dict, *, quiet: bool = False) -> bool | None:
    """The manifest's ``defaultEnabled`` if it is a boolean, else None."""
    value = manifest.get("defaultEnabled")
    if value is None or isinstance(value, bool):
        return value
    (logger.debug if quiet else logger.warning)(
        "Plugin %s: defaultEnabled in plugin.json must be true or false; ignoring %r", plugin_id, value)
    return None


def set_plugin_default(plugin_id: str, enabled: bool | None) -> bool:
    """Save the admin's default for an installed plugin, independently of its deployed files.

    ``None`` removes the admin's choice, so the manifest's default (or the
    plugin's own kind) decides again. False if the plugin is not installed.
    """
    if not _ID.fullmatch(plugin_id) or not _read_plugin(PLUGINS_DIR / plugin_id, quiet=True):
        return False

    target = PLUGIN_DEFAULTS_DIR / plugin_id
    if enabled is None:
        target.unlink(missing_ok=True)
        return True

    PLUGIN_DEFAULTS_DIR.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=PLUGIN_DEFAULTS_DIR, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write("true" if enabled else "false")
        temporary.replace(target)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return True


def _read_plugin(folder: Path, *, quiet: bool = False, for_admin: bool = False) -> dict | None:
    """The plugin in ``folder`` as ``/api/plugins`` lists it, or None if it is not a valid one.

    ``quiet`` logs the reasons at debug level (a file request for a broken
    plugin should not repeat the warning the listing already gave).
    ``for_admin`` adds where the default comes from: ``adminDefault`` (the
    console's saved choice, or None) and ``manifestDefault`` (plugin.json's).
    """
    warn = logger.debug if quiet else logger.warning
    name = folder.name
    # A symlinked plugin folder is a legitimate install: work in the folder it
    # points at, so its files resolve inside it.
    try:
        root = folder.resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        warn("Skipping plugin folder %s: it cannot be opened (%s)", name, exc)
        return None
    if not root.is_dir():
        warn("Skipping plugin folder %s: it is not a folder", name)
        return None
    manifest_path = root / "plugin.json"
    if not manifest_path.is_file():
        warn("Skipping plugin folder %s: it has no plugin.json", name)
        return None
    if manifest_path.stat().st_size > _MAX_MANIFEST_BYTES:
        warn("Skipping plugin folder %s: plugin.json is too large", name)
        return None
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        warn("Skipping plugin folder %s: plugin.json is not readable JSON (%s)", name, exc)
        return None
    if not isinstance(manifest, dict):
        warn("Skipping plugin folder %s: plugin.json is not an object", name)
        return None

    plugin_id = manifest.get("id")
    if plugin_id != name or not isinstance(plugin_id, str) or not _ID.fullmatch(plugin_id):
        warn(
            "Skipping plugin folder %s: its id must be the folder's name, in lower-case letters, digits and hyphens",
            name,
        )
        return None
    api_version = manifest.get("apiVersion")
    if not isinstance(api_version, int) or api_version < 1 or api_version > SUPPORTED_API_VERSION:
        warn(
            "Skipping plugin %s: it needs plugin API version %r; this OpenDraft offers %d",
            plugin_id, api_version, SUPPORTED_API_VERSION,
        )
        return None
    script = _file_in(root, manifest.get("script"))
    if script is None:
        warn("Skipping plugin %s: its script %r is missing or outside its folder", plugin_id, manifest.get("script"))
        return None
    style = None
    if manifest.get("style") is not None:
        style = _file_in(root, manifest.get("style"))
        if style is None:
            warn("Plugin %s: its style sheet %r is missing or outside its folder; loading it without one",
                 plugin_id, manifest.get("style"))

    plugin = {
        "id": plugin_id,
        "name": str(manifest.get("name") or plugin_id),
        "version": str(manifest.get("version") or ""),
        "apiVersion": api_version,
        "script": _url_for(plugin_id, root, script),
        "style": _url_for(plugin_id, root, style) if style else None,
    }
    admin_default = _admin_default(plugin_id)
    manifest_default = _manifest_default(plugin_id, manifest, quiet=quiet)
    plugin["defaultEnabled"] = admin_default if admin_default is not None else manifest_default
    if for_admin:
        plugin["adminDefault"] = admin_default
        plugin["manifestDefault"] = manifest_default
    return plugin


def list_frontend_plugins(*, for_admin: bool = False) -> list[dict]:
    """Every valid plugin folder, in name order (``for_admin``: see ``_read_plugin``)."""
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
            plugin = _read_plugin(folder, for_admin=for_admin)
        except OSError as exc:
            logger.warning("Skipping plugin folder %s: %s", folder.name, exc)
            continue
        if plugin:
            plugins.append(plugin)
    return plugins


router = APIRouter()


@router.get("")
def get_frontend_plugins(response: Response) -> list[dict]:
    """The runtime plugins and their initial Add-ons settings."""
    response.headers["Cache-Control"] = "no-store"
    return list_frontend_plugins()


# ── Serving plugin files ──
#
# Only what the listing would offer: a valid, listed plugin's own files. Not a
# folder that is turned off (``_name``) or broken (no or bad plugin.json), not a
# hidden file or folder anywhere in the path (``.git``, ``.env``), and nothing
# that resolves outside the plugin's folder (``..``, a symlink pointing out).

_CONTENT_TYPES = {
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".map": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".wasm": "application/wasm",
    ".txt": "text/plain; charset=utf-8",
    ".html": "text/html; charset=utf-8",
}


def _content_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in _CONTENT_TYPES:
        return _CONTENT_TYPES[suffix]
    guessed, _ = mimetypes.guess_type(path.name)
    return guessed or "application/octet-stream"


def plugin_file(plugin_id: str, file_path: str) -> Path | None:
    """The file ``file_path`` of the listed plugin ``plugin_id``, or None if it may not be served."""
    if not _ID.fullmatch(plugin_id):
        return None
    parts = file_path.split("/")
    # Empty parts ("a//b", a trailing slash), hidden or relative parts (".git",
    # ".env", "..", "."), and anything a filesystem could read as a separator.
    if not file_path or any(not part or part.startswith(".") or "\\" in part or "\0" in part for part in parts):
        return None
    folder = PLUGINS_DIR / plugin_id
    try:
        if not folder.is_dir() or _read_plugin(folder, quiet=True) is None:
            return None
        root = folder.resolve(strict=True)
        candidate = (root / Path(*parts)).resolve()
    except (OSError, RuntimeError, ValueError) as exc:
        logger.warning("Could not look up %s in plugin %s: %s", file_path, plugin_id, exc)
        return None
    if root not in candidate.parents or not candidate.is_file():
        return None
    return candidate


files_router = APIRouter()


@files_router.get("/{plugin_id}/{file_path:path}")
def get_plugin_file(plugin_id: str, file_path: str) -> FileResponse:
    """A file of a listed runtime plugin. Public, like the listing: it serves code, not data."""
    file = plugin_file(plugin_id, file_path)
    if file is None:
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(
        file,
        media_type=_content_type(file),
        headers={"Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff"},
    )
