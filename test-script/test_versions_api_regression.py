"""End-to-end regression for version history through the real FastAPI app.

Drives every version endpoint the web app calls — check in, list, compare,
open a version, restore, delete — plus normal script saving, against a
throwaway data dir, to confirm that erasing deleted versions (discussion #183)
did not disturb anything else. No server is started: it uses TestClient.

Run from project root:
    venv/bin/python test-script/test_versions_api_regression.py
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

_tmp = Path(tempfile.mkdtemp(prefix="opendraft-versions-"))
_data_dir = _tmp / "backend_data"
_data_dir.mkdir(parents=True)
_collab_db = _tmp / "collab.sqlite3"
_now = time.strftime("%Y-%m-%dT%H:%M:%S")
_conn = sqlite3.connect(_collab_db)
_conn.executescript(
    """
    CREATE TABLE users (
        id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, email_verified INTEGER DEFAULT 0,
        password_hash TEXT, google_id TEXT UNIQUE, display_name TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    """
)
_conn.execute(
    "INSERT INTO users (id,email,email_verified,display_name,created_at,updated_at) VALUES (?,?,?,?,?,?)",
    ("writer-id", "writer@example.com", 1, "Writer", _now, _now),
)
_conn.commit()
_conn.close()

os.environ["OPENDRAFT_DATA_DIR"] = str(_data_dir)
os.environ["COLLAB_JWT_SECRET"] = "test-secret-versions"
os.environ["COLLAB_DB_PATH"] = str(_collab_db)

import jwt  # noqa: E402
from dulwich.repo import Repo  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)
H = {
    "Authorization": "Bearer "
    + jwt.encode(
        {"sub": "writer-id", "email": "writer@example.com", "type": "access", "exp": int(time.time()) + 600},
        "test-secret-versions",
        algorithm="HS256",
    )
}

failures = 0


def check(cond: bool, label: str, detail: object = "") -> None:
    global failures
    print(("PASS " if cond else "FAIL ") + label + (f"  -> {detail}" if not cond and detail != "" else ""))
    if not cond:
        failures += 1


def doc(text: str) -> dict:
    return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]}


def text_of(content: dict) -> str:
    return content["content"][0]["content"][0]["text"]


def ok(r, label: str):
    check(r.status_code == 200, f"{label} (HTTP {r.status_code})", r.text[:300])
    return r.json() if r.status_code == 200 else None


def main() -> int:
    proj = ok(client.post("/api/projects/", json={"name": "Regression Film"}, headers=H), "create project")
    pid = proj["id"]
    script = ok(client.post(f"/api/projects/{pid}/scripts/", json={"title": "Act One", "content": doc("draft zero")}, headers=H), "create script")
    sid = script["meta"]["id"]
    base = f"/api/projects/{pid}/versions"

    def save(text: str) -> None:
        ok(client.put(f"/api/projects/{pid}/scripts/{sid}", json={"content": doc(text)}, headers=H), f"save '{text[:20]}'")

    def checkin(msg: str) -> dict:
        return ok(client.post(f"{base}/checkin", json={"message": msg}, headers=H), f"check in '{msg}'")

    def versions() -> list[dict]:
        return ok(client.get(f"{base}/?script_id={sid}", headers=H), "list versions") or []

    def at(h: str) -> str:
        return text_of(ok(client.get(f"{base}/{h}/scripts/{sid}", headers=H), f"open version {h[:7]}")["content"])

    # Build history: draft one, a secret draft, draft three.
    save("draft one"); checkin("Draft one")
    save("SECRET-SCENE-TEXT"); checkin("SECRET-LABEL")
    save("draft three"); checkin("Draft three")
    nothing = checkin("No change")
    check(nothing.get("message") == "No changes to commit", "check-in with no changes is a no-op", nothing)

    vs = versions()
    msgs = [v["message"] for v in vs]
    check(msgs[:3] == ["Draft three", "SECRET-LABEL", "Draft one"], "history lists newest first", msgs)
    by = {v["message"]: v for v in vs}

    diff = ok(client.get(f"{base}/diff", params={"from_hash": by["Draft one"]["hash"], "to_hash": by["Draft three"]["hash"]}, headers=H), "compare two versions")
    check("draft three" in diff["diff"], "diff shows the change")

    # Delete the secret version.
    r = ok(client.delete(f"{base}/{by['SECRET-LABEL']['hash']}", headers=H), "delete secret version")
    check(r and r["message"].startswith("Deleted version"), "delete returns a message", r)

    vs2 = versions()
    msgs2 = [v["message"] for v in vs2]
    check("SECRET-LABEL" not in msgs2, "deleted version gone from list", msgs2)
    check(msgs2[:2] == ["Draft three", "Draft one"], "other versions still listed in order", msgs2)
    by2 = {v["message"]: v for v in vs2}
    check(at(by2["Draft three"]["hash"]) == "draft three", "later version still opens with right text")
    check(at(by2["Draft one"]["hash"]) == "draft one", "earlier version still opens with right text")
    check(by2["Draft three"]["date"] == by["Draft three"]["date"], "later version keeps its date")

    r = client.get(f"{base}/{by['SECRET-LABEL']['hash']}/scripts/{sid}", headers=H)
    check(r.status_code in (400, 404), f"deleted version can't be opened (HTTP {r.status_code})")
    r = client.delete(f"{base}/{by['SECRET-LABEL']['hash']}", headers=H)
    check(r.status_code == 404, f"deleting it again is a 404 (HTTP {r.status_code})")

    # The current script is untouched by deleting history.
    cur = ok(client.get(f"/api/projects/{pid}/scripts/{sid}", headers=H), "open current script")
    check(text_of(cur["content"]) == "draft three", "current script untouched by delete")

    # Erased from disk, and the repository is still healthy.
    proj_dirs = [p for p in _data_dir.rglob(".git") if p.is_dir()]
    check(len(proj_dirs) == 1, "found the project's git repo", proj_dirs)
    repo_dir = proj_dirs[0].parent
    store = Repo(str(repo_dir)).object_store
    raw = [store[s].as_raw_string() for s in store]
    check(not any(b"SECRET-SCENE-TEXT" in o for o in raw), "secret text erased from .git")
    check(not any(b"SECRET-LABEL" in o for o in raw), "secret label erased from .git")
    logs = repo_dir / ".git" / "logs"
    check(not any(b"SECRET-LABEL" in f.read_bytes() for f in logs.rglob("*") if f.is_file()), "secret label erased from reflog")
    if shutil.which("git"):
        import subprocess
        fsck = subprocess.run(["git", "fsck", "--full"], cwd=repo_dir, capture_output=True, text=True)
        check(fsck.returncode == 0, "git fsck --full passes", fsck.stderr)

    # Restore still works, and so does editing + checking in afterwards.
    restored = ok(client.post(f"{base}/restore/{by2['Draft one']['hash']}", headers=H), "restore an older version")
    cur = ok(client.get(f"/api/projects/{pid}/scripts/{sid}", headers=H), "open script after restore")
    check(text_of(cur["content"]) == "draft one", "restore put the old text back", restored)
    save("draft four"); checkin("Draft four")
    vs3 = versions()
    check(vs3[0]["message"] == "Draft four" and at(vs3[0]["hash"]) == "draft four", "check-in after delete + restore works")

    # Delete the newest, then every remaining version; history restarts cleanly.
    for v in versions():
        ok(client.delete(f"{base}/{v['hash']}", headers=H), f"delete '{v['message']}'")
    check(versions() == [] or all(v["message"] == "Initial project setup" for v in versions()), "history empty after deleting all", versions())
    save("draft five"); checkin("Fresh start")
    vs4 = versions()
    check(vs4 and vs4[0]["message"] == "Fresh start" and at(vs4[0]["hash"]) == "draft five", "fresh check-in after deleting everything")

    # Other script operations unaffected.
    dup = ok(client.post(f"/api/projects/{pid}/scripts/{sid}/duplicate", headers=H), "duplicate script")
    check(dup is not None and dup["meta"]["id"] != sid, "duplicate creates a new script")
    lst = ok(client.get(f"/api/projects/{pid}/scripts/", headers=H), "list scripts")
    check(lst is not None and len(lst) == 2, "two scripts listed", lst and len(lst))

    print("\nALL PASSED" if not failures else f"\n{failures} FAILED")
    return 1 if failures else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    finally:
        shutil.rmtree(_tmp, ignore_errors=True)
