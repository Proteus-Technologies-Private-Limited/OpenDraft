import json
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.config import PROJECTS_DIR_BASE

logger = logging.getLogger(__name__)


def _sessions_file() -> Path:
    """Return path to the collab sessions JSON file."""
    p = PROJECTS_DIR_BASE.parent / "collab_sessions.json"
    if not p.exists():
        fd = os.open(str(p), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write("{}")
    return p


def _read_sessions() -> dict:
    return json.loads(_sessions_file().read_text(encoding="utf-8"))


def _write_sessions(sessions: dict) -> None:
    p = _sessions_file()
    fd = os.open(str(p), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(sessions, f, indent=2)


def create_session(
    project_id: str,
    script_id: str,
    collaborator_name: str,
    role: str = "editor",
    expires_in_hours: float = 1,
    session_nonce: str = "",
) -> dict:
    """Create a collab invite session. Returns the session dict with token."""
    sessions = _read_sessions()
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    expires_at = (now + timedelta(hours=expires_in_hours)).isoformat()

    # session_nonce ties all invites for the same collab session to the same
    # Yjs room.  The first invite generates it; subsequent invites reuse it.
    nonce = session_nonce or secrets.token_urlsafe(8)

    session = {
        "token": token,
        "project_id": project_id,
        "script_id": script_id,
        "collaborator_name": collaborator_name,
        "role": role,
        "created_at": now.isoformat(),
        "expires_at": expires_at,
        "active": True,
        "session_nonce": nonce,
    }
    sessions[token] = session
    _write_sessions(sessions)
    return session


def validate_session(token: str) -> dict | None:
    """Validate a collab token. Returns session info or None if invalid/expired."""
    sessions = _read_sessions()
    session = sessions.get(token)
    if not session or not session.get("active", False):
        return None
    # Check expiration
    expires_at = session.get("expires_at")
    if expires_at:
        try:
            expiry = datetime.fromisoformat(expires_at)
            if datetime.now(timezone.utc) > expiry:
                session["active"] = False
                _write_sessions(sessions)
                return None
        except (ValueError, TypeError):
            logger.warning(
                "Invalid collab session expiry for token %s: %r",
                token,
                expires_at,
            )
    return session


def list_sessions(project_id: str, script_id: str) -> list[dict]:
    """List all active sessions for a project/script."""
    sessions = _read_sessions()
    return [
        s for s in sessions.values()
        if s.get("project_id") == project_id
        and s.get("script_id") == script_id
        and s.get("active", False)
    ]


def revoke_session(token: str) -> bool:
    """Revoke a collab session. Returns True if found and revoked."""
    sessions = _read_sessions()
    if token in sessions:
        sessions[token]["active"] = False
        _write_sessions(sessions)
        return True
    return False


def revoke_all_sessions(project_id: str, script_id: str) -> int:
    """Revoke all sessions for a project/script. Returns count revoked."""
    sessions = _read_sessions()
    count = 0
    for s in sessions.values():
        if (
            s.get("project_id") == project_id
            and s.get("script_id") == script_id
            and s.get("active", False)
        ):
            s["active"] = False
            count += 1
    if count > 0:
        _write_sessions(sessions)
    return count
