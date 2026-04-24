import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

from dulwich.repo import Repo as DulwichRepo

from app.config import get_projects_dir


def _slugify(name: str) -> str:
    """Convert a project name to a filesystem-safe slug."""
    slug = name.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_]+", "-", slug)
    slug = re.sub(r"-+", "-", slug)
    return slug.strip("-")


def _ensure_projects_dir() -> None:
    """Create the top-level projects directory if it doesn't exist."""
    get_projects_dir().mkdir(parents=True, exist_ok=True)


def create_project(name: str) -> dict:
    """Create a new project directory with subdirectories and git init."""
    _ensure_projects_dir()

    project_id = _slugify(name)
    if not project_id:
        raise ValueError("Project name produces an empty slug")

    project_dir = get_projects_dir() / project_id
    if project_dir.exists():
        raise FileExistsError(f"Project '{project_id}' already exists")

    # Create directory structure
    project_dir.mkdir(parents=True)
    (project_dir / "scripts").mkdir()
    (project_dir / "assets").mkdir()
    (project_dir / "notes").mkdir()

    now = datetime.now(timezone.utc).isoformat()
    project_data = {
        "id": project_id,
        "name": name,
        "created_at": now,
        "updated_at": now,
        "properties": {},
    }

    (project_dir / "project.json").write_text(
        json.dumps(project_data, indent=2), encoding="utf-8"
    )

    # Initialize git repository
    DulwichRepo.init(str(project_dir))

    return project_data


def list_projects() -> list[dict]:
    """List all projects by reading their project.json files."""
    _ensure_projects_dir()

    projects = []
    for entry in sorted(get_projects_dir().iterdir()):
        if entry.is_dir():
            project_file = entry / "project.json"
            if project_file.exists():
                data = json.loads(project_file.read_text(encoding="utf-8"))
                data.setdefault("properties", {})
                data.setdefault("color", "")
                data.setdefault("pinned", False)
                data.setdefault("sort_order", 0)
                projects.append(data)
    return projects


def get_project(project_id: str) -> dict:
    """Read a single project's metadata."""
    project_file = get_projects_dir() / project_id / "project.json"
    if not project_file.exists():
        raise FileNotFoundError(f"Project '{project_id}' not found")
    data = json.loads(project_file.read_text(encoding="utf-8"))
    data.setdefault("properties", {})
    data.setdefault("color", "")
    data.setdefault("pinned", False)
    data.setdefault("sort_order", 0)
    return data


def update_project(
    project_id: str,
    name: str | None = None,
    properties: dict | None = None,
    color: str | None = None,
    pinned: bool | None = None,
    sort_order: int | None = None,
) -> dict:
    """Update a project's name, properties, and updated_at timestamp."""
    project_file = get_projects_dir() / project_id / "project.json"
    if not project_file.exists():
        raise FileNotFoundError(f"Project '{project_id}' not found")

    data = json.loads(project_file.read_text(encoding="utf-8"))
    if name is not None:
        data["name"] = name
    if properties is not None:
        data["properties"] = properties
    if color is not None:
        data["color"] = color
    if pinned is not None:
        data["pinned"] = pinned
    if sort_order is not None:
        data["sort_order"] = sort_order
    data["updated_at"] = datetime.now(timezone.utc).isoformat()

    project_file.write_text(json.dumps(data, indent=2), encoding="utf-8")
    data.setdefault("color", "")
    data.setdefault("pinned", False)
    data.setdefault("sort_order", 0)
    return data


def delete_project(project_id: str) -> None:
    """Delete an entire project directory."""
    project_dir = get_projects_dir() / project_id
    if not project_dir.exists():
        raise FileNotFoundError(f"Project '{project_id}' not found")
    shutil.rmtree(project_dir)


def ensure_default_project(default_name: str) -> dict:
    """Create the default project if it doesn't already exist, return its data."""
    project_id = _slugify(default_name)
    project_file = get_projects_dir() / project_id / "project.json"
    if project_file.exists():
        return json.loads(project_file.read_text(encoding="utf-8"))
    return create_project(default_name)
