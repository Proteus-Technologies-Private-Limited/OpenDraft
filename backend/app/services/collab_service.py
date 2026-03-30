import json
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.config import PROJECTS_DIR


def _sessions_file() -> Path:
    """Return path to the collab sessions JSON file."""
    path = PROJECTS_DIR.parent / "collab_sessions.json"
    if not path.exists():
        path.write_text("{}", encoding="utf-8")
    return path


def _read_sessions() -> dict:
    return json.loads(_sessions_file().read_text(encoding="utf-8"))


def _write_sessions(sessions: dict) -> None:
    _sessions_file().write_text(json.dumps(sessions, indent=2), encoding="utf-8")


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
            pass
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
