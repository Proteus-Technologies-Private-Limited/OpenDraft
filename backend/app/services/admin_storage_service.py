"""Read-only inventory of one account's stored projects, for the admin console.

The admin console lives on the collab server, which owns accounts but not
files. When an administrator opens an account, the collab server asks this
backend what that account has stored. Only metadata is returned — names,
titles, sizes, dates and counts. Screenplay text, notes and uploaded files are
never read or sent.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

from dulwich.repo import Repo

from app.config import PROJECTS_DIR_BASE, TRASH_RETENTION_DAYS, _safe_user_id
from app.services import trash_service

logger = logging.getLogger(__name__)

# Bounds so one unusual account cannot make the request take minutes.
MAX_PROJECTS = 500
MAX_SCRIPTS_PER_PROJECT = 1000
MAX_ASSETS_PER_PROJECT = 1000
MAX_VERSIONS_COUNTED = 1000


def _read_json(path: Path) -> dict | list | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except (OSError, ValueError) as exc:
        logger.warning("admin inventory: unreadable %s: %s", path, exc)
        return None


def _dir_stats(path: Path) -> tuple[int, int, float]:
    """Total bytes, file count and newest mtime under path (symlinks skipped)."""
    total = 0
    files = 0
    newest = 0.0
    for root, dirs, names in os.walk(path, followlinks=False):
        dirs[:] = [d for d in dirs if not os.path.islink(os.path.join(root, d))]
        for name in names:
            full = os.path.join(root, name)
            try:
                st = os.lstat(full)
            except OSError:
                continue
            total += st.st_size
            files += 1
            newest = max(newest, st.st_mtime)
    return total, files, newest


def _iso(ts: float) -> str | None:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat() if ts else None


def _version_stats(project_dir: Path) -> dict:
    """Saved versions (git commits) of a project: count and the newest date."""
    if not (project_dir / ".git").is_dir():
        return {"count": 0, "last": None, "capped": False}
    try:
        repo = Repo(str(project_dir))
        try:
            head = repo.head()
        except KeyError:
            return {"count": 0, "last": None, "capped": False}
        count = 0
        last = None
        for entry in repo.get_walker(include=[head], max_entries=MAX_VERSIONS_COUNTED):
            if last is None:
                last = _iso(entry.commit.commit_time)
            count += 1
        return {"count": count, "last": last, "capped": count >= MAX_VERSIONS_COUNTED}
    except Exception as exc:  # a damaged repo must not hide the rest of the account
        logger.warning("admin inventory: cannot read versions of %s: %s", project_dir, exc)
        return {"count": 0, "last": None, "capped": False, "error": "unreadable"}


def _scripts(project_dir: Path) -> tuple[list[dict], bool]:
    scripts_dir = project_dir / "scripts"
    if not scripts_dir.is_dir():
        return [], False
    metas = sorted(scripts_dir.glob("*.meta.json"))
    out = []
    for meta_file in metas[:MAX_SCRIPTS_PER_PROJECT]:
        meta = _read_json(meta_file)
        if not isinstance(meta, dict):
            out.append({"id": meta_file.name[: -len(".meta.json")], "title": None, "error": "unreadable"})
            continue
        script_id = str(meta.get("id") or meta_file.name[: -len(".meta.json")])
        content = scripts_dir / f"{script_id}.json"
        try:
            size = content.stat().st_size
        except OSError:
            size = 0
        out.append({
            "id": script_id,
            "title": meta.get("title") or "Untitled",
            "author": meta.get("author") or "",
            "format": meta.get("format") or "json",
            "pageCount": meta.get("page_count") or 0,
            "createdAt": meta.get("created_at"),
            "updatedAt": meta.get("updated_at"),
            "sizeBytes": size,
        })
    return out, len(metas) > MAX_SCRIPTS_PER_PROJECT


def _assets(project_dir: Path) -> tuple[list[dict], bool]:
    manifest = _read_json(project_dir / "assets" / "manifest.json")
    if not isinstance(manifest, list):
        return [], False
    out = []
    for entry in manifest[:MAX_ASSETS_PER_PROJECT]:
        if not isinstance(entry, dict):
            continue
        out.append({
            "id": entry.get("id"),
            "name": entry.get("original_name") or entry.get("filename") or "file",
            "mimeType": entry.get("mime_type") or "",
            "sizeBytes": entry.get("size_bytes") or 0,
            "createdAt": entry.get("created_at"),
        })
    return out, len(manifest) > MAX_ASSETS_PER_PROJECT


def _count_files(path: Path) -> int:
    try:
        return sum(1 for p in path.iterdir() if p.is_file())
    except OSError:
        return 0


def account_inventory(user_id: str) -> dict:
    """Everything the account has stored, as metadata only."""
    root = PROJECTS_DIR_BASE / "users" / _safe_user_id(user_id)
    result: dict = {
        "userId": user_id,
        "exists": root.is_dir(),
        "projects": [],
        "truncated": False,
        "trash": [],
        "trashRetentionDays": TRASH_RETENTION_DAYS,
        "totals": {"projects": 0, "scripts": 0, "assets": 0, "versions": 0, "sizeBytes": 0, "diskFiles": 0},
    }
    if not result["exists"]:
        return result

    try:
        result["trash"] = trash_service.list_trash(user_id)
    except Exception as exc:  # the trash must not hide the rest of the account
        logger.warning("admin inventory: cannot list trash of %s: %s", user_id, exc)
        result["trashError"] = str(exc)

    entries = sorted(
        (p for p in root.iterdir() if p.is_dir() and not p.is_symlink() and (p / "project.json").is_file()),
        key=lambda p: p.name,
    )
    if len(entries) > MAX_PROJECTS:
        result["truncated"] = True
        entries = entries[:MAX_PROJECTS]

    totals = result["totals"]
    for project_dir in entries:
        meta = _read_json(project_dir / "project.json")
        meta = meta if isinstance(meta, dict) else {}
        scripts, scripts_truncated = _scripts(project_dir)
        assets, assets_truncated = _assets(project_dir)
        size, disk_files, newest = _dir_stats(project_dir)
        versions = _version_stats(project_dir)
        project = {
            "id": project_dir.name,
            "name": meta.get("name") or project_dir.name,
            "createdAt": meta.get("created_at"),
            "updatedAt": meta.get("updated_at"),
            "lastModified": _iso(newest),
            "color": meta.get("color") or "",
            "pinned": bool(meta.get("pinned")),
            # Projects published from a device's local library carry this prefix.
            "deviceSync": project_dir.name.startswith("sync-"),
            "scripts": scripts,
            "assets": assets,
            "notes": _count_files(project_dir / "notes") if (project_dir / "notes").is_dir() else 0,
            "versions": versions,
            "sizeBytes": size,
            "diskFiles": disk_files,
            "truncated": scripts_truncated or assets_truncated,
            "metadataError": not meta,
        }
        result["projects"].append(project)
        totals["projects"] += 1
        totals["scripts"] += len(scripts)
        totals["assets"] += len(assets)
        totals["versions"] += versions["count"]
        totals["sizeBytes"] += size
        totals["diskFiles"] += disk_files

    result["projects"].sort(key=lambda p: p.get("lastModified") or "", reverse=True)
    return result
