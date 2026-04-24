"""Smoke test for per-user file isolation.

Verifies:
- Unauthenticated requests to protected routes return 401
- Valid token but unverified email → 403
- Valid verified-email token → project/script CRUD works, isolated per user
- Two users can create same-slug projects without clashing

Run from project root:
    venv/bin/python test-script/test_per_user_files.py
"""

from __future__ import annotations

import os
import shutil
import sqlite3
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

# Build a throwaway data dir + collab DB before importing app modules.
_tmp = Path(tempfile.mkdtemp(prefix="opendraft-test-"))
_data_dir = _tmp / "backend_data"
_data_dir.mkdir(parents=True)
_collab_dir = _tmp / "collab"
_collab_dir.mkdir(parents=True)
_collab_db = _collab_dir / "collab.sqlite3"

# Create a minimal collab users schema and two test users (one verified, one not)
_now = time.strftime("%Y-%m-%dT%H:%M:%S")
conn = sqlite3.connect(_collab_db)
conn.executescript(
    """
    CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        email_verified INTEGER DEFAULT 0,
        password_hash TEXT,
        google_id TEXT UNIQUE,
        display_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    """
)
conn.execute(
    "INSERT INTO users (id,email,email_verified,display_name,created_at,updated_at) VALUES (?,?,?,?,?,?)",
    ("alice-id", "alice@example.com", 1, "Alice", _now, _now),
)
conn.execute(
    "INSERT INTO users (id,email,email_verified,display_name,created_at,updated_at) VALUES (?,?,?,?,?,?)",
    ("bob-id", "bob@example.com", 1, "Bob", _now, _now),
)
conn.execute(
    "INSERT INTO users (id,email,email_verified,display_name,created_at,updated_at) VALUES (?,?,?,?,?,?)",
    ("eve-id", "eve@example.com", 0, "Eve", _now, _now),  # NOT verified
)
conn.commit()
conn.close()

os.environ["OPENDRAFT_DATA_DIR"] = str(_data_dir)
os.environ["COLLAB_JWT_SECRET"] = "test-secret-xyz"
os.environ["COLLAB_DB_PATH"] = str(_collab_db)

import jwt  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)


def _token(user_id: str, email: str, ttl_sec: int = 120) -> str:
    return jwt.encode(
        {"sub": user_id, "email": email, "type": "access", "exp": int(time.time()) + ttl_sec},
        "test-secret-xyz",
        algorithm="HS256",
    )


def _auth(user_id: str, email: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {_token(user_id, email)}"}


def test_anonymous_blocked():
    r = client.get("/api/projects/")
    assert r.status_code == 401, r.text
    r = client.post("/api/projects/", json={"name": "My Film"})
    assert r.status_code == 401, r.text
    print("  ok: anonymous blocked from projects")


def test_unverified_blocked():
    r = client.get("/api/projects/", headers=_auth("eve-id", "eve@example.com"))
    assert r.status_code == 403, r.text
    body = r.json()
    assert "email_not_verified" in str(body).lower()
    print("  ok: unverified user blocked")


def test_alice_creates_project():
    r = client.post(
        "/api/projects/",
        json={"name": "Alice Movie"},
        headers=_auth("alice-id", "alice@example.com"),
    )
    assert r.status_code == 200, r.text
    assert r.json()["id"] == "alice-movie"

    # List returns only Alice's
    r = client.get("/api/projects/", headers=_auth("alice-id", "alice@example.com"))
    assert r.status_code == 200
    ids = [p["id"] for p in r.json()["projects"]]
    assert "alice-movie" in ids
    print("  ok: Alice created and sees her project")


def test_bob_cannot_see_alice():
    r = client.get("/api/projects/", headers=_auth("bob-id", "bob@example.com"))
    assert r.status_code == 200
    ids = [p["id"] for p in r.json()["projects"]]
    assert "alice-movie" not in ids, f"Bob should NOT see Alice's files, got {ids}"
    print("  ok: Bob cannot see Alice's project")


def test_same_slug_different_users():
    # Both Alice and Bob can have a project called "My Film" without clashing.
    ra = client.post(
        "/api/projects/",
        json={"name": "My Film"},
        headers=_auth("alice-id", "alice@example.com"),
    )
    rb = client.post(
        "/api/projects/",
        json={"name": "My Film"},
        headers=_auth("bob-id", "bob@example.com"),
    )
    assert ra.status_code == 200 and rb.status_code == 200, (ra.text, rb.text)
    assert ra.json()["id"] == "my-film" and rb.json()["id"] == "my-film"

    # Each user sees only their own
    la = client.get("/api/projects/", headers=_auth("alice-id", "alice@example.com")).json()["projects"]
    lb = client.get("/api/projects/", headers=_auth("bob-id", "bob@example.com")).json()["projects"]
    assert sorted(p["id"] for p in la) == ["alice-movie", "my-film"]
    assert [p["id"] for p in lb] == ["my-film"]
    print("  ok: same slug across users isolated")


def test_directory_layout():
    users_dir = _data_dir / "projects" / "users"
    assert (users_dir / "alice-id" / "alice-movie" / "project.json").exists()
    assert (users_dir / "alice-id" / "my-film" / "project.json").exists()
    assert (users_dir / "bob-id" / "my-film" / "project.json").exists()
    # Bob should NOT have an alice-movie dir
    assert not (users_dir / "bob-id" / "alice-movie").exists()
    print("  ok: directory layout is users/<id>/<slug>/...")


if __name__ == "__main__":
    print("Running per-user file isolation tests…")
    try:
        test_anonymous_blocked()
        test_unverified_blocked()
        test_alice_creates_project()
        test_bob_cannot_see_alice()
        test_same_slug_different_users()
        test_directory_layout()
        print("All tests passed.")
    finally:
        shutil.rmtree(_tmp, ignore_errors=True)
