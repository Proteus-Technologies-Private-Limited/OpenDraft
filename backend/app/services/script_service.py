import hashlib
import json
import os
import tempfile
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from filelock import FileLock

from app.config import get_projects_dir

logger = logging.getLogger(__name__)


class EmptyOverwriteError(Exception):
    """Raised when a save would blank a script that currently has content.

    The blank-document data-loss guard. Routes map this to HTTP 409.
    """


class ScriptRevisionConflict(Exception):
    """The cloud script changed after the device downloaded it."""


def _revision(content: dict) -> str:
    body = json.dumps(content, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def _write_json(path: Path, value: dict) -> None:
    """Publish the complete file at once, including for unlocked readers."""
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=path.parent, delete=False,
        ) as stream:
            temporary = Path(stream.name)
            json.dump(value, stream, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _script_lock(project_id: str, script_id: str) -> FileLock:
    # The lock lives outside the project, so deletion and version snapshots
    # do not remove or commit it. Hash the IDs to keep it a single path part.
    key = hashlib.sha256(f"{project_id}/{script_id}".encode()).hexdigest()
    directory = get_projects_dir() / ".locks"
    directory.mkdir(exist_ok=True)
    return FileLock(str(directory / key), timeout=10)


def _scripts_dir(project_id: str) -> Path:
    """Return the scripts directory for the active user's project."""
    scripts_path = get_projects_dir() / project_id / "scripts"
    if not scripts_path.exists():
        raise FileNotFoundError(f"Project '{project_id}' not found")
    return scripts_path


def create_script(
    project_id: str,
    title: str,
    content: dict | None = None,
    format: str = "json",
) -> dict:
    """Create a new script with a UUID, saving content and metadata files."""
    scripts_path = _scripts_dir(project_id)

    script_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    meta = {
        "id": script_id,
        "title": title,
        "author": "",
        "format": format,
        "created_at": now,
        "updated_at": now,
    }

    script_content = content if content is not None else {}

    (scripts_path / f"{script_id}.meta.json").write_text(
        json.dumps(meta, indent=2), encoding="utf-8"
    )
    (scripts_path / f"{script_id}.json").write_text(
        json.dumps(script_content, indent=2), encoding="utf-8"
    )

    return {"meta": meta, "content": script_content}


def _extract_preview(content: dict, max_chars: int = 200) -> str:
    """Extract plain text preview from TipTap JSON content."""
    if not content or "content" not in content:
        return ""
    texts: list[str] = []
    char_count = 0
    for node in content.get("content", []):
        if char_count >= max_chars:
            break
        line_parts: list[str] = []
        for child in node.get("content", []):
            if child.get("type") == "text":
                t = child.get("text", "")
                line_parts.append(t)
                char_count += len(t)
                if char_count >= max_chars:
                    break
        if line_parts:
            texts.append("".join(line_parts))
    result = "\n".join(texts)
    return result[:max_chars]


def list_scripts(project_id: str, include_preview: bool = False) -> list[dict]:
    """List all script metadata in a project, enriched with file size."""
    scripts_path = _scripts_dir(project_id)

    metas = []
    for meta_file in sorted(scripts_path.glob("*.meta.json")):
        data = json.loads(meta_file.read_text(encoding="utf-8"))
        # Add file size from the content file
        script_id = data.get("id", "")
        content_file = scripts_path / f"{script_id}.json"
        data["size_bytes"] = content_file.stat().st_size if content_file.exists() else 0
        data.setdefault("page_count", 0)
        data.setdefault("color", "")
        data.setdefault("pinned", False)
        data.setdefault("sort_order", 0)
        data.setdefault("preview", "")
        if include_preview and content_file.exists():
            try:
                content = json.loads(content_file.read_text(encoding="utf-8"))
                data["preview"] = _extract_preview(content)
            except Exception as exc:
                logger.warning(
                    "Failed to build preview for script %s in project %s: %s",
                    script_id,
                    project_id,
                    exc,
                )
                data["preview"] = ""
        metas.append(data)
    return metas


def get_script(project_id: str, script_id: str) -> dict:
    """Read a script's metadata and content."""
    scripts_path = _scripts_dir(project_id)

    meta_file = scripts_path / f"{script_id}.meta.json"
    content_file = scripts_path / f"{script_id}.json"

    if not meta_file.exists():
        raise FileNotFoundError(f"Script '{script_id}' not found")

    meta = json.loads(meta_file.read_text(encoding="utf-8"))
    content = json.loads(content_file.read_text(encoding="utf-8")) if content_file.exists() else {}

    return {"meta": meta, "content": content, "content_revision": _revision(content)}


def _has_body_text(content: dict | None) -> bool:
    """True when a TipTap/ProseMirror doc has any non-whitespace text in its body.

    Only ``content`` arrays are walked, so app-metadata keys (e.g. ``_notes``)
    don't count as body text. Mirrors ``docHasAnyText`` on the frontend.
    """
    if not isinstance(content, dict):
        return False
    if content.get("type") == "text":
        text = content.get("text")
        if isinstance(text, str) and text.strip():
            return True
    children = content.get("content")
    if isinstance(children, list):
        for child in children:
            if _has_body_text(child):
                return True
    return False


def update_script(
    project_id: str,
    script_id: str,
    title: str | None = None,
    content: dict | None = None,
    color: str | None = None,
    pinned: bool | None = None,
    sort_order: int | None = None,
    allow_empty_body: bool = False,
    expected_content_revision: str | None = None,
) -> dict:
    """Update a script's title and/or content."""
    with _script_lock(project_id, script_id):
        scripts_path = _scripts_dir(project_id)

        meta_file = scripts_path / f"{script_id}.meta.json"
        content_file = scripts_path / f"{script_id}.json"

        if not meta_file.exists():
            raise FileNotFoundError(f"Script '{script_id}' not found")

        meta = json.loads(meta_file.read_text(encoding="utf-8"))
        existing = None
        if expected_content_revision is not None or (
            content is not None and not allow_empty_body and not _has_body_text(content)
        ):
            existing = json.loads(content_file.read_text(encoding="utf-8")) if content_file.exists() else {}
        if expected_content_revision is not None:
            current_revision = _revision(existing)
            if current_revision != expected_content_revision:
                # A retry following a lost response is already applied if the
                # authoritative content exactly matches the queued copy.
                if content == existing:
                    return {"meta": meta, "content": existing, "content_revision": current_revision}
                raise ScriptRevisionConflict()
        if content is not None and not allow_empty_body and not _has_body_text(content) and _has_body_text(existing):
            raise EmptyOverwriteError(
                f"Refusing to overwrite script '{script_id}' with an empty document — "
                "the saved script has content but the incoming one has none. This "
                "guards against accidental data loss. If you really meant to clear it, "
                "delete the script instead."
            )

        if title is not None:
            meta["title"] = title
        if color is not None:
            meta["color"] = color
        if pinned is not None:
            meta["pinned"] = pinned
        if sort_order is not None:
            meta["sort_order"] = sort_order

        meta["updated_at"] = datetime.now(timezone.utc).isoformat()

        if content is not None:
            _write_json(content_file, content)
        _write_json(meta_file, meta)

        current_content = content if content is not None else (
            existing if existing is not None else (
                json.loads(content_file.read_text(encoding="utf-8")) if content_file.exists() else {}
            )
        )

        meta.setdefault("color", "")
        meta.setdefault("pinned", False)
        meta.setdefault("sort_order", 0)

        result = {"meta": meta, "content": current_content}
        if expected_content_revision is not None:
            result["content_revision"] = _revision(current_content)
        return result


def duplicate_script(project_id: str, script_id: str) -> dict:
    """Duplicate a script with a new UUID and '(Copy)' title suffix."""
    original = get_script(project_id, script_id)
    scripts_path = _scripts_dir(project_id)

    new_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    # Determine next sort_order
    existing = list_scripts(project_id)
    max_order = max((s.get("sort_order", 0) for s in existing), default=0)

    meta = {
        "id": new_id,
        "title": f"{original['meta'].get('title', 'Untitled')} (Copy)",
        "author": original["meta"].get("author", ""),
        "format": original["meta"].get("format", "json"),
        "created_at": now,
        "updated_at": now,
        "color": original["meta"].get("color", ""),
        "pinned": False,
        "sort_order": max_order + 1,
    }

    content = original.get("content", {})

    (scripts_path / f"{new_id}.meta.json").write_text(
        json.dumps(meta, indent=2), encoding="utf-8"
    )
    (scripts_path / f"{new_id}.json").write_text(
        json.dumps(content, indent=2), encoding="utf-8"
    )

    return {"meta": meta, "content": content}


def delete_script(project_id: str, script_id: str) -> None:
    """Delete a script's content and metadata files."""
    with _script_lock(project_id, script_id):
        scripts_path = _scripts_dir(project_id)

        meta_file = scripts_path / f"{script_id}.meta.json"
        content_file = scripts_path / f"{script_id}.json"

        if not meta_file.exists():
            raise FileNotFoundError(f"Script '{script_id}' not found")

        meta_file.unlink()
        if content_file.exists():
            content_file.unlink()
