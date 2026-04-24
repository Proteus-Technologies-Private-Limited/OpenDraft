"""Smoke test for backend auth JWT verification.

Run from project root:
    venv/bin/python test-script/test_backend_auth.py
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

# Ensure backend/ is importable
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

# Configure the shared secret BEFORE importing app modules.
os.environ["COLLAB_JWT_SECRET"] = "test-secret-0123456789"
# Point at a non-existent DB so auth_service falls back to payload-only.
os.environ["COLLAB_DB_PATH"] = ""

import jwt  # noqa: E402

from app.services.auth_service import (  # noqa: E402
    auth_user_from_payload,
    verify_access_token,
)


def _make_token(payload: dict) -> str:
    return jwt.encode(payload, "test-secret-0123456789", algorithm="HS256")


def test_valid_token():
    token = _make_token({
        "sub": "user-1",
        "email": "alice@example.com",
        "type": "access",
        "exp": int(time.time()) + 60,
    })
    payload = verify_access_token(token)
    assert payload is not None, "valid token should verify"
    assert payload["sub"] == "user-1"
    user = auth_user_from_payload(payload)
    assert user.id == "user-1"
    assert user.email == "alice@example.com"
    assert user.email_verified is False  # no DB ⇒ defaults to False
    print("  ok: valid token")


def test_expired_token():
    token = _make_token({
        "sub": "user-1",
        "email": "alice@example.com",
        "type": "access",
        "exp": int(time.time()) - 10,
    })
    assert verify_access_token(token) is None, "expired token should reject"
    print("  ok: expired token rejected")


def test_wrong_secret():
    token = jwt.encode(
        {"sub": "u", "email": "e", "type": "access", "exp": int(time.time()) + 60},
        "wrong-secret",
        algorithm="HS256",
    )
    assert verify_access_token(token) is None, "wrong-secret token should reject"
    print("  ok: wrong-secret token rejected")


def test_wrong_type():
    token = _make_token({
        "sub": "u",
        "email": "e",
        "type": "refresh",  # only 'access' is accepted
        "exp": int(time.time()) + 60,
    })
    assert verify_access_token(token) is None, "refresh-typed token should reject"
    print("  ok: non-access token rejected")


def test_missing_fields():
    token = _make_token({
        "type": "access",
        "exp": int(time.time()) + 60,
    })
    assert verify_access_token(token) is None, "token missing sub/email should reject"
    print("  ok: malformed token rejected")


if __name__ == "__main__":
    print("Running backend auth JWT tests…")
    test_valid_token()
    test_expired_token()
    test_wrong_secret()
    test_wrong_type()
    test_missing_fields()
    print("All tests passed.")
