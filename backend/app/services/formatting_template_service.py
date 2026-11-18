"""Service for CRUD operations on formatting templates (file-based, like scripts)."""

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.config import PROJECTS_DIR_BASE


def _templates_dir() -> Path:
    """Return the global formatting templates directory, creating it if needed."""
    tpl_dir = PROJECTS_DIR_BASE / "_formatting_templates"
    tpl_dir.mkdir(parents=True, exist_ok=True)
    return tpl_dir


def list_templates() -> list[dict]:
    """List all formatting templates."""
    tpl_dir = _templates_dir()
    templates = []
    for f in sorted(tpl_dir.glob("*.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            templates.append(data)
        except (json.JSONDecodeError, KeyError):
            continue
    return templates


def _line_spacing(value: object) -> float | None:
    """A template's line spacing as stored: a positive number other than the
    standard 1, or None. Anything malformed is dropped rather than refused, so
    a bad value can never stop a template from saving."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    if number != number or number <= 0 or number > 4 or number == 1:
        return None
    return number


def get_template(template_id: str) -> dict:
    """Get a single formatting template by ID."""
    path = _templates_dir() / f"{template_id}.json"
    if not path.exists():
        raise FileNotFoundError(f"Template '{template_id}' not found")
    return json.loads(path.read_text(encoding="utf-8"))


def create_template(data: dict) -> dict:
    """Create a new formatting template."""
    template_id = data.get("id") or str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    template = {
        "id": template_id,
        "name": data.get("name", "Untitled Template"),
        "description": data.get("description", ""),
        "mode": data.get("mode", "enforce"),
        "rules": data.get("rules", {}),
        "forceBreakBefore": data.get("forceBreakBefore") or [],
        "createdAt": data.get("createdAt", now),
        "updatedAt": data.get("updatedAt", now),
    }
    spacing = _line_spacing(data.get("lineSpacing"))
    if spacing is not None:
        template["lineSpacing"] = spacing
    path = _templates_dir() / f"{template_id}.json"
    path.write_text(json.dumps(template, indent=2), encoding="utf-8")
    return template


def update_template(template_id: str, data: dict) -> dict:
    """Update an existing formatting template."""
    path = _templates_dir() / f"{template_id}.json"
    if not path.exists():
        raise FileNotFoundError(f"Template '{template_id}' not found")
    existing = json.loads(path.read_text(encoding="utf-8"))
    now = datetime.now(timezone.utc).isoformat()
    existing.update({
        k: v for k, v in data.items()
        if k in ("name", "description", "mode", "rules", "forceBreakBefore")
    })
    # Line spacing: a positive number is kept, standard (1) is stored as absent.
    if "lineSpacing" in data:
        spacing = _line_spacing(data.get("lineSpacing"))
        if spacing is None:
            existing.pop("lineSpacing", None)
        else:
            existing["lineSpacing"] = spacing
    existing["updatedAt"] = now
    path.write_text(json.dumps(existing, indent=2), encoding="utf-8")
    return existing


def delete_template(template_id: str) -> None:
    """Delete a formatting template."""
    path = _templates_dir() / f"{template_id}.json"
    if path.exists():
        path.unlink()
