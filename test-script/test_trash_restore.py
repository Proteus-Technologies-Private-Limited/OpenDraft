"""Trash restore and purge (backend/app/services/trash_service.py).

Covers:
  * restoring a project whose id was taken again (the writer recreated it under
    the same name) brings it back beside the new one under the next free id,
    with every projectId inside its scripts re-pointed, instead of refusing;
  * the admin restore endpoint reports where the project went;
  * TRASH_RETENTION_DAYS=0 purges whatever the trash already held, both in
    purge_expired() and at startup.

Run from project root (works with or without pytest):
    venv/bin/python test-script/test_trash_restore.py
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

_tmp = Path(tempfile.mkdtemp(prefix="opendraft-trash-"))
os.environ["OPENDRAFT_DATA_DIR"] = str(_tmp / "data")
os.environ["COLLAB_JWT_SECRET"] = "trash-test-secret"
os.environ["TRASH_RETENTION_DAYS"] = "30"
os.environ["AUDIT_TO_COLLAB"] = "0"

import jwt  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.config import PROJECTS_DIR_BASE, current_user_id  # noqa: E402
from app.main import app  # noqa: E402
from app.services import project_service, script_service, trash_service  # noqa: E402

USER = "alice"


def _as_user(user_id: str = USER):
    return current_user_id.set(user_id)


def _account() -> Path:
    return PROJECTS_DIR_BASE / "users" / USER


def _reset() -> None:
    shutil.rmtree(PROJECTS_DIR_BASE / "users", ignore_errors=True)
    trash_service.TRASH_RETENTION_DAYS = 30


def _image_doc(project_id: str) -> dict:
    return {
        "type": "doc",
        "content": [
            {"type": "action", "content": [{"type": "text", "text": f"The {project_id} office at night."}]},
            {"type": "screenplayImage", "attrs": {"assetId": "a1", "projectId": project_id, "filename": "a1.png"}},
            {"type": "avImage", "attrs": {"assetId": "a2", "projectId": "some-other-project"}},
        ],
    }


def _restore_token(entry_id: str) -> str:
    now = int(time.time())
    return jwt.encode(
        {"sub": USER, "type": "admin_restore", "admin": "support@example.com", "entry": entry_id,
         "aud": "opendraft-backend-admin", "iat": now, "exp": now + 60},
        "trash-test-secret", algorithm="HS256",
    )


def _trash_entry_ids(kind: str) -> list[str]:
    return [e["id"] for e in trash_service.list_trash(USER) if e.get("kind") == kind]


def test_restore_without_clash_keeps_id():
    _reset()
    token = _as_user()
    try:
        project_service.create_project("Night Shift")
        project_service.delete_project("night-shift")
        [entry] = _trash_entry_ids("project")
        result = trash_service.restore(USER, entry)
        assert result["restoredProjectId"] == "night-shift"
        assert result["restoredProjectName"] == "Night Shift"
        assert not result.get("renamed")
        assert project_service.get_project("night-shift")["name"] == "Night Shift"
        assert trash_service.list_trash(USER) == []
    finally:
        current_user_id.reset(token)


def test_restore_with_id_clash_restores_beside_it():
    _reset()
    token = _as_user()
    try:
        project_service.create_project("Night Shift")
        old_script = script_service.create_script("night-shift", "Pilot", _image_doc("night-shift"))
        project_service.delete_project("night-shift")
        # The writer recreates the vanished project under the same name.
        project_service.create_project("Night Shift")
        new_script = script_service.create_script("night-shift", "New draft", _image_doc("night-shift"))
        # Taken too, so the restore has to skip past it.
        project_service.create_project("Night Shift 2")

        [entry] = _trash_entry_ids("project")
        result = trash_service.restore(USER, entry)

        assert result["renamed"] is True
        assert result["restoredProjectId"] == "night-shift-3", result
        assert result["restoredProjectName"] == "Night Shift (restored)"
        restored = project_service.get_project("night-shift-3")
        assert restored["id"] == "night-shift-3"
        assert restored["name"] == "Night Shift (restored)"
        # The recreated project is untouched.
        assert project_service.get_project("night-shift")["name"] == "Night Shift"
        assert [s["id"] for s in script_service.list_scripts("night-shift")] == [new_script["meta"]["id"]]
        # The restored script's image nodes now point at the restored project;
        # references to other projects are left alone.
        content = script_service.get_script("night-shift-3", old_script["meta"]["id"])["content"]
        attrs = [n["attrs"] for n in content["content"] if "attrs" in n]
        assert attrs[0]["projectId"] == "night-shift-3"
        assert attrs[1]["projectId"] == "some-other-project"
        assert "night-shift office" in json.dumps(content), "text mentioning the id must not change"
        # Both appear in the project list, with their own ids.
        ids = sorted(p["id"] for p in project_service.list_projects())
        assert ids == ["night-shift", "night-shift-2", "night-shift-3"], ids
        assert trash_service.list_trash(USER) == []
        assert not list((_account()).glob("**/.restore-staging"))
    finally:
        current_user_id.reset(token)


def test_script_trashed_before_its_project_follows_it_to_the_new_id():
    _reset()
    token = _as_user()
    try:
        project_service.create_project("Night Shift")
        early = script_service.create_script("night-shift", "Cut scene")
        script_service.create_script("night-shift", "Pilot")
        script_service.delete_script("night-shift", early["meta"]["id"])
        project_service.delete_project("night-shift")
        project_service.create_project("Night Shift")
        later = script_service.create_script("night-shift", "Scratch")
        script_service.delete_script("night-shift", later["meta"]["id"])

        [project_entry] = _trash_entry_ids("project")
        trash_service.restore(USER, project_entry)
        by_script = {e["scriptId"]: e for e in trash_service.list_trash(USER) if e.get("kind") == "script"}
        assert by_script[early["meta"]["id"]]["projectId"] == "night-shift-2"
        assert by_script[later["meta"]["id"]]["projectId"] == "night-shift"

        result = trash_service.restore(USER, by_script[early["meta"]["id"]]["id"])
        assert result["restoredProjectId"] == "night-shift-2"
        assert script_service.get_script("night-shift-2", early["meta"]["id"])["meta"]["title"] == "Cut scene"
    finally:
        current_user_id.reset(token)


def test_failed_restore_leaves_the_trash_entry_as_it_was():
    _reset()
    token = _as_user()
    try:
        project_service.create_project("Night Shift")
        script = script_service.create_script("night-shift", "Pilot", _image_doc("night-shift"))
        project_service.delete_project("night-shift")
        project_service.create_project("Night Shift")
        [entry] = _trash_entry_ids("project")
        real_rename = trash_service.os.rename

        def failing_rename(*_args, **_kwargs):
            raise OSError("disk full")

        trash_service.os.rename = failing_rename
        try:
            try:
                trash_service.restore(USER, entry)
                raise AssertionError("restore should have failed")
            except OSError:
                pass
        finally:
            trash_service.os.rename = real_rename
        payload = _account() / trash_service.TRASH_DIR / entry / trash_service.PAYLOAD_DIR / "night-shift"
        meta = json.loads((payload / "project.json").read_text(encoding="utf-8"))
        assert meta["id"] == "night-shift" and meta["name"] == "Night Shift", meta
        content = json.loads((payload / "scripts" / f"{script['meta']['id']}.json").read_text(encoding="utf-8"))
        assert content["content"][1]["attrs"]["projectId"] == "night-shift"
        # And it still restores once the problem is gone.
        assert trash_service.restore(USER, entry)["restoredProjectId"] == "night-shift-2"
    finally:
        current_user_id.reset(token)


def test_admin_endpoint_reports_where_the_project_went():
    _reset()
    token = _as_user()
    try:
        project_service.create_project("Night Shift")
        project_service.delete_project("night-shift")
        project_service.create_project("Night Shift")
        [entry] = _trash_entry_ids("project")
    finally:
        current_user_id.reset(token)
    client = TestClient(app)
    r = client.post(f"/api/admin/accounts/{USER}/trash/{entry}/restore",
                    headers={"Authorization": f"Bearer {_restore_token(entry)}"})
    assert r.status_code == 200, r.text
    restored = r.json()["restored"]
    assert restored["restoredProjectId"] == "night-shift-2"
    assert restored["restoredProjectName"] == "Night Shift (restored)"
    assert restored["renamed"] is True
    # A second try finds nothing left to restore.
    r = client.post(f"/api/admin/accounts/{USER}/trash/{entry}/restore",
                    headers={"Authorization": f"Bearer {_restore_token(entry)}"})
    assert r.status_code == 404, r.text


def _old_entry(days_ago: int) -> Path:
    """A project trash entry dated `days_ago` days back."""
    token = _as_user()
    try:
        name = f"Old {days_ago} {time.time_ns()}"
        project = project_service.create_project(name)
        data = trash_service.trash_project(project["id"])
    finally:
        current_user_id.reset(token)
    entry_dir = _account() / trash_service.TRASH_DIR / data["id"]
    data["deletedAt"] = (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()
    (entry_dir / trash_service.ENTRY_FILE).write_text(json.dumps(data), encoding="utf-8")
    return entry_dir


def test_purge_keeps_recent_entries_with_retention_on():
    _reset()
    old, recent = _old_entry(40), _old_entry(1)
    assert trash_service.purge_expired() == 1
    assert not old.exists() and recent.exists()


def test_retention_zero_purges_existing_entries():
    _reset()
    recent, unreadable = _old_entry(0), _old_entry(1)
    (unreadable / trash_service.ENTRY_FILE).write_text("not json", encoding="utf-8")
    trash_service.TRASH_RETENTION_DAYS = 0
    assert trash_service.has_entries()
    assert trash_service.purge_expired() == 2
    assert not recent.exists() and not unreadable.exists()
    assert not trash_service.has_entries()


def test_has_entries_without_any_account():
    _reset()
    assert not trash_service.has_entries()


def test_startup_purges_leftover_trash_when_retention_is_zero():
    _reset()
    entry = _old_entry(0)
    trash_service.TRASH_RETENTION_DAYS = 0
    with TestClient(app):
        for _ in range(50):
            if not entry.exists():
                break
            time.sleep(0.1)
    assert not entry.exists(), "startup should purge trash left from before the trash was turned off"


if __name__ == "__main__":
    tests = [(name, fn) for name, fn in sorted(globals().items()) if name.startswith("test_") and callable(fn)]
    failed = 0
    try:
        for name, fn in tests:
            try:
                fn()
                print(f"PASS {name}")
            except Exception as exc:  # noqa: BLE001 — report every failure, then exit non-zero
                failed += 1
                print(f"FAIL {name}: {exc!r}")
                import traceback
                traceback.print_exc()
    finally:
        shutil.rmtree(_tmp, ignore_errors=True)
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)
