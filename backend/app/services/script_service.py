import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.config import PROJECTS_DIR


def _scripts_dir(project_id: str) -> Path:
    """Return the scripts directory for a project, ensuring it exists."""
    scripts_path = PROJECTS_DIR / project_id / "scripts"
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


def list_scripts(project_id: str) -> list[dict]:
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

    meta["updated_at"] = datetime.now(timezone.utc).isoformat()

    meta_file.write_text(json.dumps(meta, indent=2), encoding="utf-8")

    if content is not None:
        content_file.write_text(json.dumps(content, indent=2), encoding="utf-8")

    current_content = json.loads(content_file.read_text(encoding="utf-8")) if content_file.exists() else {}

    return {"meta": meta, "content": current_content}


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
