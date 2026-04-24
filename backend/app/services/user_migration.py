"""One-time migration that moves pre-auth project dirs into users/legacy/.

Before this feature, PROJECTS_DIR contained project slugs directly (e.g.
`data/projects/default-project/`). With per-user file isolation, every
project lives at `data/projects/users/<user_id>/<slug>/`. On startup we
move any project dirs at the top level into `users/legacy/` so they are not
accidentally exposed to a new authenticated user.

The migration is idempotent: it only runs once (guarded by a marker file),
and it skips the known shared directories (`_formatting_templates`, `users`).
"""

from __future__ import annotations

import logging
import shutil
from pathlib import Path

logger = logging.getLogger(__name__)

# Subdirectories at the top level that are NOT project folders and should not
# be moved into users/legacy/.
_SHARED_DIRS = {"users", "_formatting_templates"}

_MIGRATION_MARKER = ".users_migration_done"


def migrate_legacy_projects(projects_root: Path) -> None:
    """Move pre-auth project dirs into users/legacy/. Safe to call on every boot."""
    marker = projects_root / _MIGRATION_MARKER
    if marker.exists():
        return

    users_dir = projects_root / "users"
    users_dir.mkdir(parents=True, exist_ok=True)
    legacy_dir = users_dir / "legacy"
    legacy_dir.mkdir(parents=True, exist_ok=True)

    moved = 0
    for entry in projects_root.iterdir():
        if not entry.is_dir():
            continue
        if entry.name in _SHARED_DIRS:
            continue
        if entry.name.startswith("."):
            continue

        target = legacy_dir / entry.name
        if target.exists():
            logger.warning(
                "Legacy project %s already exists in users/legacy — leaving source in place",
                entry.name,
            )
            continue
        try:
            shutil.move(str(entry), str(target))
            moved += 1
        except OSError as exc:
            logger.error("Failed to migrate legacy project %s: %s", entry.name, exc)

    if moved:
        logger.info("Migrated %d legacy project(s) into users/legacy/", moved)

    try:
        marker.write_text("", encoding="utf-8")
    except OSError as exc:
        logger.warning("Could not write migration marker %s: %s", marker, exc)
