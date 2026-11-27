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


PROJECT_ID_KEYS = ("projectId", "project_id")
MAX_RESTORE_SUFFIX = 1000


def _free_project_id(root: Path, project_id: str) -> str:
    """The first unused ``<project_id>-N`` in this account, N from 2."""
    for n in range(2, MAX_RESTORE_SUFFIX):
        candidate = f"{project_id}-{n}"
        if not (root / candidate).exists():
            return candidate
    raise TrashConflict(f"Could not find a free id for the restored project '{project_id}'")


def _swap_ids(value, old: str, new: str) -> bool:
    """Point every projectId/project_id equal to ``old`` at ``new``, in place."""
    changed = False
    if isinstance(value, dict):
        for key, item in value.items():
            if key in PROJECT_ID_KEYS and item == old:
                value[key] = new
                changed = True
            elif isinstance(item, (dict, list)):
                changed = _swap_ids(item, old, new) or changed
    elif isinstance(value, list):
        for item in value:
            if isinstance(item, (dict, list)):
                changed = _swap_ids(item, old, new) or changed
    return changed


def _write_json_atomic(path: Path, value, staging: Path) -> None:
    staging.mkdir(exist_ok=True)
    tmp = staging / f"{uuid.uuid4().hex}.json"
    try:
        tmp.write_text(json.dumps(value, indent=2), encoding="utf-8")
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def _rewrite_project_refs(project_dir: Path, old: str, new: str, staging: Path) -> int:
    """Re-point the project's own files from id ``old`` to ``new``.

    Scripts and notes carry the project id inside image and asset nodes
    (``attrs.projectId``), which the editor uses to build asset URLs; left
    alone they would load images from whatever project now owns the old id.
    project.json is handled by the caller. Returns how many files changed.
    """
    changed = 0
    needle = json.dumps(old)
    for base, dirs, names in os.walk(project_dir, followlinks=False):
        dirs[:] = [d for d in dirs if d != ".git" and not os.path.islink(os.path.join(base, d))]
        for name in names:
            path = Path(base) / name
            if not name.endswith(".json") or path.is_symlink() or path == project_dir / "project.json":
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError) as exc:
                logger.warning("Restore: could not read %s, left as it was: %s", path, exc)
                continue
            if needle not in text:
                continue
            try:
                value = json.loads(text)
            except ValueError as exc:
                logger.warning("Restore: %s is not valid JSON, left as it was: %s", path, exc)
                continue
            if _swap_ids(value, old, new):
                _write_json_atomic(path, value, staging)
                changed += 1
    return changed


def _move_script_entries(root: Path, old: str, new: str, new_name: str, before: str) -> None:
    """Scripts deleted from the project before it was itself deleted belong to
    it, so they follow it to its new id. Later ones came from the project that
    took the old id since, and stay pointed at that one."""
    try:
        cutoff = datetime.fromisoformat(before)
    except (TypeError, ValueError):
        return
    trash = root / TRASH_DIR
    for entry_dir in trash.iterdir():
        data = _read_entry(entry_dir) if entry_dir.is_dir() else None
        if not data or data.get("kind") != "script" or data.get("projectId") != old:
            continue
        try:
            if datetime.fromisoformat(data["deletedAt"]) > cutoff:
                continue
            data["projectId"] = new
            data["projectName"] = new_name
            _write_entry(entry_dir, data)
        except (KeyError, TypeError, ValueError, OSError) as exc:
            logger.warning("Restore: could not move script trash entry %s to project %s: %s", entry_dir.name, new, exc)


def _restore_project(root: Path, entry_dir: Path, data: dict, project_id: str) -> dict:
    source = entry_dir / PAYLOAD_DIR / project_id
    if not source.is_dir():
        raise FileNotFoundError("The trashed project's files are missing")
    target_id = project_id
    if (root / project_id).exists():
        # Project ids are slugs fixed when a project is created and survive a
        # rename, so the usual cause is the writer creating the project again
        # under the same name. Restore alongside it instead of refusing.
        target_id = _free_project_id(root, project_id)
    if target_id == project_id:
        os.rename(source, root / target_id)
        return {**data, "restoredProjectId": target_id, "restoredProjectName": data.get("projectName") or project_id}

    meta_file = source / "project.json"
    try:
        original_meta = meta_file.read_text(encoding="utf-8")
        meta = json.loads(original_meta)
        if not isinstance(meta, dict):
            raise ValueError("project.json is not an object")
    except (OSError, ValueError) as exc:
        raise ValueError(f"The trashed project's project.json is unreadable: {exc}") from exc
    new_name = f"{meta.get('name') or data.get('projectName') or project_id} (restored)"
    staging = entry_dir / ".restore-staging"
    try:
        _rewrite_project_refs(source, project_id, target_id, staging)
        meta["id"] = target_id
        meta["name"] = new_name
        meta["updated_at"] = datetime.now(timezone.utc).isoformat()
        _write_json_atomic(meta_file, meta, staging)
        os.rename(source, root / target_id)
    except Exception:
        # Leave the trash entry as it was, so the restore can be tried again.
        logger.exception("Restore of project %s as %s failed; undoing", project_id, target_id)
        try:
            if source.is_dir():
                _rewrite_project_refs(source, target_id, project_id, staging)
                meta_file.write_text(original_meta, encoding="utf-8")
        except Exception:
            logger.exception("Could not undo the partial restore of %s in %s", project_id, entry_dir)
        raise
    _move_script_entries(root, project_id, target_id, new_name, str(data.get("deletedAt") or ""))
    logger.info("Project %s restored as %s (%r): the old id is in use", project_id, target_id, new_name)
    return {**data, "restoredProjectId": target_id, "restoredProjectName": new_name, "renamed": True}


def restore(user_id: str, entry_id: str) -> dict:
    """Put a trashed project or script back where it was.

    A project whose id has been taken again in the meantime comes back under
    the next free id (``night-shift-2``) and the name "<name> (restored)", so
    nothing is overwritten. The result's ``restoredProjectId`` and
    ``restoredProjectName`` say where it went.
    """
    _check_part(entry_id, "trash entry")
    root = _account_root(user_id)
    entry_dir = root / TRASH_DIR / entry_id
    data = _read_entry(entry_dir) if entry_dir.is_dir() else None
    if data is None:
        raise FileNotFoundError("That item is no longer in the trash")
    payload = entry_dir / PAYLOAD_DIR
    project_id = _check_part(str(data.get("projectId") or ""), "project id")

    if data.get("kind") == "project":
        result = _restore_project(root, entry_dir, data, project_id)
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
        result = {**data, "restoredProjectId": project_id, "restoredProjectName": data.get("projectName") or project_id}
    else:
        raise ValueError("Unknown trash entry")
    shutil.rmtree(entry_dir, ignore_errors=True)
    logger.info("Restored trash entry %s for account %s", entry_id, user_id)
    return result


def has_entries() -> bool:
    """Whether any account has something in its trash.

    With TRASH_RETENTION_DAYS=0 nothing new is trashed, but entries made
    before the switch are still on disk and must be purged.
    """
    users = PROJECTS_DIR_BASE / "users"
    try:
        for account in users.iterdir():
            trash = account / TRASH_DIR
            if trash.is_dir() and any(trash.iterdir()):
                return True
    except FileNotFoundError:
        return False
    except OSError as exc:
        # Can't tell: say yes, so the purger runs and logs the real problem.
        logger.warning("Could not check the accounts' trash: %s", exc)
        return True
    return False


def purge_expired(now: datetime | None = None) -> int:
    """Remove trash entries older than the retention period, for every account.

    With TRASH_RETENTION_DAYS=0 every existing entry is removed: the trash is
    off, and anything left from before it was switched off goes now.
    """
    users = PROJECTS_DIR_BASE / "users"
    if not users.is_dir():
        return 0
    purge_all = not enabled()
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
            if deleted_at is not None and deleted_at.tzinfo is None:
                deleted_at = deleted_at.replace(tzinfo=timezone.utc)
            if deleted_at is None and not purge_all:
                # Unreadable entry: fall back to the directory's age.
                try:
                    deleted_at = datetime.fromtimestamp(entry_dir.stat().st_mtime, tz=timezone.utc)
                except OSError:
                    continue
            if purge_all or deleted_at < cutoff:
                shutil.rmtree(entry_dir, ignore_errors=True)
                removed += 1
    if removed:
        if purge_all:
            logger.info("Purged %d trash entr%s: the trash is off (TRASH_RETENTION_DAYS=0)", removed, "y" if removed == 1 else "ies")
        else:
            logger.info("Purged %d trash entr%s older than %d days", removed, "y" if removed == 1 else "ies", TRASH_RETENTION_DAYS)
    return removed
