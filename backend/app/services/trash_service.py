"""Per-account trash for deleted projects and scripts.

Deleting a project or a script used to remove it from disk at once, so a
writer who deleted the wrong thing had no way back. Now the files are moved
into ``users/<id>/.trash/<entry>/`` and kept for TRASH_RETENTION_DAYS (30 by
default), after which ``purge_expired`` removes them for good. Support can
list and restore entries from the admin console.

Layout of one entry::

    .trash/<entry-id>/entry.json      what it was, when it was deleted
    .trash/<entry-id>/payload/        the project directory, or the script's
                                      <id>.json and <id>.meta.json

The trash lives inside the account's directory, so deleting the account
removes it along with everything else. Directories starting with "." are not
projects, so the project list, the quota count and the admin inventory skip it.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.config import PROJECTS_DIR_BASE, TRASH_RETENTION_DAYS, _safe_user_id, get_projects_dir

logger = logging.getLogger(__name__)

TRASH_DIR = ".trash"
ENTRY_FILE = "entry.json"
PAYLOAD_DIR = "payload"
MAX_LISTED = 500


class TrashConflict(Exception):
    """Restoring would overwrite something that exists now."""


def enabled() -> bool:
    return TRASH_RETENTION_DAYS > 0


def _check_part(value: str, what: str) -> str:
    """A project or script id used as a single path component."""
    if not value or value in (".", "..") or value.startswith(".") or "/" in value or "\\" in value or "\0" in value:
        raise ValueError(f"Invalid {what}")
    return value


def _new_entry_dir(root: Path, kind: str) -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = root / TRASH_DIR / f"{stamp}-{kind}-{uuid.uuid4().hex[:8]}"
    (path / PAYLOAD_DIR).mkdir(parents=True)
    return path


def _dir_size(path: Path) -> int:
    total = 0
    for base, dirs, names in os.walk(path, followlinks=False):
        dirs[:] = [d for d in dirs if not os.path.islink(os.path.join(base, d))]
        for name in names:
            try:
                total += os.lstat(os.path.join(base, name)).st_size
            except OSError:
                pass
    return total


def _write_entry(entry_dir: Path, data: dict) -> None:
    (entry_dir / ENTRY_FILE).write_text(json.dumps(data, indent=2), encoding="utf-8")


def _expires(deleted_at: datetime) -> str:
    return (deleted_at + timedelta(days=TRASH_RETENTION_DAYS)).isoformat()


def trash_project(project_id: str) -> dict:
    """Move a project directory into the current account's trash."""
    _check_part(project_id, "project id")
    root = get_projects_dir()
    project_dir = root / project_id
    if not project_dir.is_dir():
        raise FileNotFoundError(f"Project '{project_id}' not found")
    try:
        meta = json.loads((project_dir / "project.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        meta = {}
    scripts = sorted((project_dir / "scripts").glob("*.meta.json")) if (project_dir / "scripts").is_dir() else []
    now = datetime.now(timezone.utc)
    entry_dir = _new_entry_dir(root, "project")
    data = {
        "id": entry_dir.name,
        "kind": "project",
        "projectId": project_id,
        "projectName": meta.get("name") or project_id,
        "scriptCount": len(scripts),
        "sizeBytes": _dir_size(project_dir),
        "deletedAt": now.isoformat(),
        "expiresAt": _expires(now),
    }
    try:
        os.replace(project_dir, entry_dir / PAYLOAD_DIR / project_id)
    except OSError:
        shutil.rmtree(entry_dir, ignore_errors=True)
        raise
    _write_entry(entry_dir, data)
    logger.info("Project %s moved to trash %s", project_id, entry_dir)
    return data


def trash_script(project_id: str, script_id: str, scripts_path: Path) -> dict:
    """Move a script's two files into the current account's trash.

    The caller holds the script lock and has checked the script exists.
    """
    _check_part(project_id, "project id")
    _check_part(script_id, "script id")
    root = get_projects_dir()
    meta_file = scripts_path / f"{script_id}.meta.json"
    content_file = scripts_path / f"{script_id}.json"
    try:
        meta = json.loads(meta_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        meta = {}
    try:
        project = json.loads((root / project_id / "project.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        project = {}
    now = datetime.now(timezone.utc)
    entry_dir = _new_entry_dir(root, "script")
    payload = entry_dir / PAYLOAD_DIR
    data = {
        "id": entry_dir.name,
        "kind": "script",
        "projectId": project_id,
        "projectName": project.get("name") or project_id,
        "scriptId": script_id,
        "scriptTitle": meta.get("title") or "Untitled",
        "sizeBytes": content_file.stat().st_size if content_file.exists() else 0,
        "deletedAt": now.isoformat(),
        "expiresAt": _expires(now),
    }
    try:
        if content_file.exists():
            os.replace(content_file, payload / content_file.name)
        os.replace(meta_file, payload / meta_file.name)
    except OSError:
        # Put back whatever moved so the script is never left half deleted.
        if (payload / content_file.name).exists() and not content_file.exists():
            os.replace(payload / content_file.name, content_file)
        shutil.rmtree(entry_dir, ignore_errors=True)
        raise
    _write_entry(entry_dir, data)
    logger.info("Script %s/%s moved to trash %s", project_id, script_id, entry_dir)
    return data


def _account_root(user_id: str) -> Path:
    return PROJECTS_DIR_BASE / "users" / _safe_user_id(user_id)


def _read_entry(entry_dir: Path) -> dict | None:
    try:
        data = json.loads((entry_dir / ENTRY_FILE).read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def list_trash(user_id: str) -> list[dict]:
    """Every trash entry of one account, newest first (metadata only)."""
    trash = _account_root(user_id) / TRASH_DIR
    if not trash.is_dir():
        return []
    out = []
    for entry_dir in sorted(trash.iterdir(), reverse=True):
        if not entry_dir.is_dir() or entry_dir.is_symlink():
            continue
        data = _read_entry(entry_dir)
        if data is None:
            out.append({"id": entry_dir.name, "kind": "unknown", "error": "entry.json unreadable"})
        else:
            data["id"] = entry_dir.name
            out.append(data)
        if len(out) >= MAX_LISTED:
            break
    return out


def restore(user_id: str, entry_id: str) -> dict:
    """Put a trashed project or script back where it was."""
    _check_part(entry_id, "trash entry")
    root = _account_root(user_id)
    entry_dir = root / TRASH_DIR / entry_id
    data = _read_entry(entry_dir) if entry_dir.is_dir() else None
    if data is None:
        raise FileNotFoundError("That item is no longer in the trash")
    payload = entry_dir / PAYLOAD_DIR
    project_id = _check_part(str(data.get("projectId") or ""), "project id")

    if data.get("kind") == "project":
        target = root / project_id
        if target.exists():
            raise TrashConflict(
                f"A project with the id '{project_id}' exists again. Rename or delete it first, then restore."
            )
        os.replace(payload / project_id, target)
    elif data.get("kind") == "script":
        script_id = _check_part(str(data.get("scriptId") or ""), "script id")
        scripts_path = root / project_id / "scripts"
        if not scripts_path.is_dir():
            raise TrashConflict(
                f"The project '{data.get('projectName') or project_id}' is not there any more. Restore the project first."
            )
        meta_target = scripts_path / f"{script_id}.meta.json"
        if meta_target.exists():
            raise TrashConflict("That script exists in the project again; nothing was changed.")
        content = payload / f"{script_id}.json"
        if content.exists():
            os.replace(content, scripts_path / content.name)
        os.replace(payload / meta_target.name, meta_target)
    else:
        raise ValueError("Unknown trash entry")
    shutil.rmtree(entry_dir, ignore_errors=True)
    logger.info("Restored trash entry %s for account %s", entry_id, user_id)
    return data


def purge_expired(now: datetime | None = None) -> int:
    """Remove trash entries older than the retention period, for every account."""
    if not enabled():
        return 0
    users = PROJECTS_DIR_BASE / "users"
    if not users.is_dir():
        return 0
    cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=TRASH_RETENTION_DAYS)
    removed = 0
    for account in users.iterdir():
        trash = account / TRASH_DIR
        if not trash.is_dir():
            continue
        for entry_dir in trash.iterdir():
            if not entry_dir.is_dir():
                continue
            data = _read_entry(entry_dir)
            try:
                deleted_at = datetime.fromisoformat(data["deletedAt"]) if data else None
            except (KeyError, TypeError, ValueError):
                deleted_at = None
            if deleted_at is None:
                # Unreadable entry: fall back to the directory's age.
                try:
                    deleted_at = datetime.fromtimestamp(entry_dir.stat().st_mtime, tz=timezone.utc)
                except OSError:
                    continue
            if deleted_at < cutoff:
                shutil.rmtree(entry_dir, ignore_errors=True)
                removed += 1
    if removed:
        logger.info("Purged %d trash entr%s older than %d days", removed, "y" if removed == 1 else "ies", TRASH_RETENTION_DAYS)
    return removed
