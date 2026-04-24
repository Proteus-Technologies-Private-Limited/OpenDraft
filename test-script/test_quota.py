"""Smoke test for the free-plan quota gate hook.

Run from project root:
    venv/bin/python test-script/test_quota.py
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

_tmp = Path(tempfile.mkdtemp(prefix="opendraft-quota-"))
_data_dir = _tmp / "backend_data"
_data_dir.mkdir()
_collab_dir = _tmp / "collab"
_collab_dir.mkdir()
_collab_db = _collab_dir / "collab.sqlite3"

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
    "INSERT INTO users VALUES (?,?,?,?,?,?,?,?)",
    ("alice", "alice@ex.com", 1, None, None, "Alice", _now, _now),
)
conn.commit()
conn.close()

os.environ["OPENDRAFT_DATA_DIR"] = str(_data_dir)
os.environ["COLLAB_JWT_SECRET"] = "sekret"
os.environ["COLLAB_DB_PATH"] = str(_collab_db)
os.environ["FREE_PLAN_FILE_LIMIT"] = "3"  # smaller for fast test

import jwt  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)


def _auth():
    tok = jwt.encode(
        {"sub": "alice", "email": "alice@ex.com", "type": "access", "exp": int(time.time()) + 120},
        "sekret",
        algorithm="HS256",
    )
    return {"Authorization": f"Bearer {tok}"}


def main():
    # Create a project
    r = client.post("/api/projects/", json={"name": "Test"}, headers=_auth())
    assert r.status_code == 200, r.text

    # Create 3 scripts — all should succeed
    for i in range(3):
        r = client.post(
            "/api/projects/test/scripts/",
            json={"title": f"Script {i}", "format": "json"},
            headers=_auth(),
        )
        assert r.status_code == 200, f"script {i}: {r.status_code} {r.text}"
    print(f"  ok: created {3} scripts within limit")

    # 4th should 402
    r = client.post(
        "/api/projects/test/scripts/",
        json={"title": "Script 4", "format": "json"},
        headers=_auth(),
    )
    assert r.status_code == 402, f"expected 402, got {r.status_code} {r.text}"
    body = r.json()["detail"]
    assert body["error"] == "quota_exceeded"
    assert body["limit"] == 3
    assert body["current"] == 3
    assert body["current_plan"] == "free"
    print(f"  ok: 4th script blocked with 402: {body['message']}")

    # Duplicate should also 402
    # Find a script id
    r = client.get("/api/projects/test/scripts/", headers=_auth())
    script_id = r.json()[0]["id"]
    r = client.post(
        f"/api/projects/test/scripts/{script_id}/duplicate",
        headers=_auth(),
    )
    assert r.status_code == 402, f"duplicate should 402, got {r.status_code}"
    print("  ok: duplicate also blocked")


if __name__ == "__main__":
    print("Running quota gate tests…")
    try:
        main()
        print("All tests passed.")
    finally:
        shutil.rmtree(_tmp, ignore_errors=True)
