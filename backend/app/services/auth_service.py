"""Auth service — validates collab-issued JWTs and reads the shared user store.

The collab server (collab-server/) is the identity provider. Backend verifies
access tokens using the shared HS256 secret (COLLAB_JWT_SECRET) and, when
co-located, reads the user row from the collab SQLite file (COLLAB_DB_PATH).
"""

from __future__ import annotations

import logging
import sqlite3
from dataclasses import dataclass
from typing import Optional

import jwt

from app.config import COLLAB_DB_PATH, COLLAB_JWT_SECRET

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AuthUser:
    id: str
    email: str
    display_name: str
    email_verified: bool


_missing_secret_warned = False


def verify_access_token(token: str) -> Optional[dict]:
    """Verify a collab-issued HS256 JWT. Returns the payload on success."""
    global _missing_secret_warned
    if not COLLAB_JWT_SECRET:
        if not _missing_secret_warned:
            logger.error(
                "COLLAB_JWT_SECRET is not configured — every authenticated request "
                "will return 401. Set it in backend/.env to the same value as the "
                "collab server's JWT_SECRET (run ./setup_auth_env.sh to generate both)."
            )
            _missing_secret_warned = True
        return None
    try:
        payload = jwt.decode(token, COLLAB_JWT_SECRET, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError as exc:
        logger.debug("Rejected invalid token: %s", exc)
        return None
    if payload.get("type") != "access":
        return None
    if not payload.get("sub") or not payload.get("email"):
        return None
    return payload


def _open_collab_db() -> Optional[sqlite3.Connection]:
    """Open a read-only connection to the collab SQLite file, if configured."""
    if not COLLAB_DB_PATH:
        return None
    try:
        # Open in read-only, immutable URI form so we never write to the
        # collab database from the backend process.
        conn = sqlite3.connect(
            f"file:{COLLAB_DB_PATH}?mode=ro",
            uri=True,
            detect_types=0,
            check_same_thread=False,
        )
        conn.row_factory = sqlite3.Row
        return conn
    except sqlite3.Error as exc:
        logger.warning("Cannot open collab DB at %s: %s", COLLAB_DB_PATH, exc)
        return None


def get_user_by_id(user_id: str) -> Optional[AuthUser]:
    """Load a user row from the shared collab SQLite. Returns None if not found
    or if the collab DB is not reachable locally (caller should fall back to
    proxying /auth/me to the collab server in that case)."""
    conn = _open_collab_db()
    if conn is None:
        return None
    try:
        row = conn.execute(
            "SELECT id, email, email_verified, display_name FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
    except sqlite3.Error as exc:
        logger.warning("Failed to read user %s from collab DB: %s", user_id, exc)
        return None
    finally:
        conn.close()
    if row is None:
        return None
    return AuthUser(
        id=row["id"],
        email=row["email"],
        display_name=row["display_name"],
        email_verified=bool(row["email_verified"]),
    )


def auth_user_from_payload(payload: dict) -> AuthUser:
    """Construct an AuthUser from just the JWT payload, for the case when the
    backend cannot read the collab DB directly. email_verified defaults to False
    — callers that need to enforce verification must call get_user_by_id or
    proxy to /auth/me."""
    return AuthUser(
        id=str(payload["sub"]),
        email=str(payload["email"]),
        display_name=str(payload.get("email", "")),
        email_verified=False,
    )
