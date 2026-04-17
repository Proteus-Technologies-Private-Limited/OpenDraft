"""Location Database service — persistent per-project location metadata.

Stored at {project_dir}/locations.json. Each location has a canonical name
(matching scene-heading parsing, case-insensitive) plus production metadata
(address, contact, photos, notes, availability, tags, aliases).
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from app.config import PROJECTS_DIR

logger = logging.getLogger(__name__)

TIME_WORDS_RE = re.compile(
    r"(?:\s+-\s+|\.\s*)(DAY|NIGHT|DAWN|DUSK|MORNING|AFTERNOON|EVENING|SUNSET|SUNRISE|LATER|CONTINUOUS|SAME TIME|MOMENTS LATER|SAME|MAGIC HOUR)\.?$",
    re.IGNORECASE,
)
PREFIX_RE = re.compile(r"^(INT\.?\/?EXT\.?|EXT\.?\/?INT\.?|INT\.?|EXT\.?|I\/E\.?)\s+", re.IGNORECASE)


def _locations_file(project_id: str) -> Path:
    project_dir = PROJECTS_DIR / project_id
    if not project_dir.exists():
        raise FileNotFoundError(f"Project '{project_id}' not found")
    return project_dir / "locations.json"


def _read(project_id: str) -> dict[str, Any]:
    path = _locations_file(project_id)
    if not path.exists():
        return {"locations": []}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Failed to read locations.json for %s: %s", project_id, exc)
        return {"locations": []}


def _write(project_id: str, data: dict[str, Any]) -> None:
    path = _locations_file(project_id)
    try:
        path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    except OSError as exc:
        logger.error("Failed to write locations.json for %s: %s", project_id, exc)
        raise


def _normalize_name(name: str) -> str:
    return re.sub(r"\s+", " ", name.strip()).upper()


def _parse_location_from_heading(heading: str) -> tuple[str, str]:
    """Return (location_name, type) where type is 'interior' | 'exterior' | 'both'."""
    text = heading.strip()
    prefix = ""
    m = PREFIX_RE.match(text)
    if m:
        prefix_raw = m.group(1).upper().rstrip(".")
        if "/" in prefix_raw:
            prefix = "both"
        elif prefix_raw.startswith("INT"):
            prefix = "interior"
        elif prefix_raw.startswith("EXT"):
            prefix = "exterior"
        else:
            prefix = ""
        text = text[m.end():]
    # Strip trailing time-of-day
    text = TIME_WORDS_RE.sub("", text)
    location = re.sub(r"^[\s.]+|[\s.]+$", "", text).strip()
    return location, prefix or "interior"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Public API ─────────────────────────────────────────────────────────────


def list_locations(project_id: str) -> list[dict[str, Any]]:
    return _read(project_id).get("locations", [])


def get_location(project_id: str, loc_id: str) -> dict[str, Any]:
    data = _read(project_id)
    for loc in data.get("locations", []):
        if loc.get("id") == loc_id:
            return loc
    raise FileNotFoundError(f"Location '{loc_id}' not found")


def create_location(project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    if not payload.get("name"):
        raise ValueError("Location name is required")
    data = _read(project_id)
    locations = data.setdefault("locations", [])
    now = _now()
    loc = {
        "id": f"loc-{uuid4().hex[:12]}",
        "name": _normalize_name(payload["name"]),
        "fullName": payload.get("fullName", ""),
        "type": payload.get("type", "interior"),
        "address": payload.get("address", ""),
        "notes": payload.get("notes", ""),
        "contact": payload.get("contact", ""),
        "availability": payload.get("availability", ""),
        "tags": list(payload.get("tags", [])),
        "imageAssetIds": list(payload.get("imageAssetIds", [])),
        "aliases": [_normalize_name(a) for a in payload.get("aliases", [])],
        "created_at": now,
        "updated_at": now,
    }
    locations.append(loc)
    _write(project_id, data)
    return loc


def update_location(project_id: str, loc_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    data = _read(project_id)
    for loc in data.get("locations", []):
        if loc.get("id") == loc_id:
            # Whitelist updatable fields
            for key in ("fullName", "type", "address", "notes", "contact",
                        "availability", "tags", "imageAssetIds"):
                if key in payload:
                    loc[key] = payload[key]
            if "name" in payload and payload["name"]:
                loc["name"] = _normalize_name(payload["name"])
            if "aliases" in payload:
                loc["aliases"] = [_normalize_name(a) for a in payload["aliases"]]
            loc["updated_at"] = _now()
            _write(project_id, data)
            return loc
    raise FileNotFoundError(f"Location '{loc_id}' not found")


def delete_location(project_id: str, loc_id: str) -> None:
    data = _read(project_id)
    before = len(data.get("locations", []))
    data["locations"] = [l for l in data.get("locations", []) if l.get("id") != loc_id]
    if len(data["locations"]) == before:
        raise FileNotFoundError(f"Location '{loc_id}' not found")
    _write(project_id, data)


def _iter_scene_headings(script_content: dict[str, Any]):
    """Yield (heading_text) for each sceneHeading node in a TipTap doc."""
    def walk(node):
        if not isinstance(node, dict):
            return
        if node.get("type") == "sceneHeading":
            text_parts = []
            for child in node.get("content", []) or []:
                if isinstance(child, dict) and child.get("type") == "text":
                    text_parts.append(child.get("text", ""))
            yield "".join(text_parts)
        for child in node.get("content", []) or []:
            yield from walk(child)

    yield from walk(script_content)


def discover_locations(project_id: str, script_contents: list[dict[str, Any]]) -> dict[str, Any]:
    """Scan all provided script contents and auto-create entries for unknown locations.

    Returns {"discovered": N, "locations": [full list]}.
    """
    data = _read(project_id)
    locations = data.setdefault("locations", [])

    # Build existing name set (including aliases)
    existing: set[str] = set()
    for loc in locations:
        existing.add(loc["name"])
        for alias in loc.get("aliases", []):
            existing.add(alias)

    # Collect all distinct location names from scene headings
    discovered_names: dict[str, str] = {}  # name → type
    for script in script_contents:
        content = script.get("content") if isinstance(script, dict) else None
        if not content:
            continue
        for heading in _iter_scene_headings(content):
            name, kind = _parse_location_from_heading(heading)
            if not name:
                continue
            canonical = _normalize_name(name)
            if canonical in existing:
                continue
            # Upgrade type if both INT and EXT seen
            prev = discovered_names.get(canonical)
            if prev and prev != kind:
                discovered_names[canonical] = "both"
            else:
                discovered_names[canonical] = kind

    # Create new entries
    now = _now()
    created = 0
    for name, kind in discovered_names.items():
        locations.append({
            "id": f"loc-{uuid4().hex[:12]}",
            "name": name,
            "fullName": "",
            "type": kind,
            "address": "",
            "notes": "",
            "contact": "",
            "availability": "",
            "tags": [],
            "imageAssetIds": [],
            "aliases": [],
            "created_at": now,
            "updated_at": now,
        })
        created += 1

    if created:
        _write(project_id, data)

    return {"discovered": created, "locations": locations}
