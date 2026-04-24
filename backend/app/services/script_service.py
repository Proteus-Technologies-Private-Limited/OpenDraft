import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.config import get_projects_dir

logger = logging.getLogger(__name__)


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

    return {"meta": meta, "content": content}


def update_script(
    project_id: str,
    script_id: str,
    title: str | None = None,
    content: dict | None = None,
    color: str | None = None,
    pinned: bool | None = None,
    sort_order: int | None = None,
) -> dict:
    """Update a script's title and/or content."""
    scripts_path = _scripts_dir(project_id)

    meta_file = scripts_path / f"{script_id}.meta.json"
    content_file = scripts_path / f"{script_id}.json"

    if not meta_file.exists():
        raise FileNotFoundError(f"Script '{script_id}' not found")

    meta = json.loads(meta_file.read_text(encoding="utf-8"))

    if title is not None:
        meta["title"] = title
    if color is not None:
        meta["color"] = color
    if pinned is not None:
        meta["pinned"] = pinned
    if sort_order is not None:
        meta["sort_order"] = sort_order

    meta["updated_at"] = datetime.now(timezone.utc).isoformat()

    meta_file.write_text(json.dumps(meta, indent=2), encoding="utf-8")

    if content is not None:
        content_file.write_text(json.dumps(content, indent=2), encoding="utf-8")

    current_content = json.loads(content_file.read_text(encoding="utf-8")) if content_file.exists() else {}

    meta.setdefault("color", "")
    meta.setdefault("pinned", False)
    meta.setdefault("sort_order", 0)

    return {"meta": meta, "content": current_content}


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
    scripts_path = _scripts_dir(project_id)

    meta_file = scripts_path / f"{script_id}.meta.json"
    content_file = scripts_path / f"{script_id}.json"

    if not meta_file.exists():
        raise FileNotFoundError(f"Script '{script_id}' not found")

    meta_file.unlink()
    if content_file.exists():
        content_file.unlink()
