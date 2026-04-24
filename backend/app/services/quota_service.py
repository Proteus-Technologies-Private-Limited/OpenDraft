"""Quota enforcement — default free-plan file limit.

This module registers a default gate hook that blocks file creation past
FREE_PLAN_FILE_LIMIT (5 by default). Commercial plugins (OpenDraft-Pro)
replace/extend this behavior to enforce paid-tier limits by registering
their own gate hook.

The hook receives `user` (AuthUser) as a keyword argument. It counts the
total number of scripts currently owned by that user across all projects
and raises HTTP 402 Payment Required when the limit would be exceeded.
"""

from __future__ import annotations

import logging

from fastapi import HTTPException, status

from app.config import FREE_PLAN_FILE_LIMIT, get_projects_dir
from app.plugins import register_hook
from app.services.auth_service import AuthUser

logger = logging.getLogger(__name__)

# Gate hook event names — other code (and Pro) can listen to or replace these.
QUOTA_CHECK_CREATE_SCRIPT = "quota:check:create_script"


def count_user_scripts() -> int:
    """Count scripts the current user owns across all their projects."""
    root = get_projects_dir()
    if not root.exists():
        return 0
    total = 0
    for project_dir in root.iterdir():
        if not project_dir.is_dir():
            continue
        scripts_dir = project_dir / "scripts"
        if not scripts_dir.is_dir():
            continue
        # Each script is backed by a <uuid>.meta.json file; count those.
        total += sum(1 for _ in scripts_dir.glob("*.meta.json"))
    return total


def _enforce_free_limit(user: AuthUser) -> None:
    """Block creation if the user already has FREE_PLAN_FILE_LIMIT scripts."""
    count = count_user_scripts()
    if count >= FREE_PLAN_FILE_LIMIT:
        logger.info(
            "Quota block for user %s: %d/%d scripts on free plan",
            user.id,
            count,
            FREE_PLAN_FILE_LIMIT,
        )
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "error": "quota_exceeded",
                "message": (
                    f"You've reached the free-plan limit of {FREE_PLAN_FILE_LIMIT} files. "
                    "Upgrade to continue."
                ),
                "current_plan": "free",
                "limit": FREE_PLAN_FILE_LIMIT,
                "current": count,
            },
        )


def register_default_quota_hooks() -> None:
    """Register the default free-plan quota hook. Called once at import time
    by app.main; Pro plugins can register additional hooks to override or
    extend behavior (e.g. look up the user's plan, skip for paid tiers)."""
    register_hook(QUOTA_CHECK_CREATE_SCRIPT, _enforce_free_limit)


# Auto-register on import.
register_default_quota_hooks()
