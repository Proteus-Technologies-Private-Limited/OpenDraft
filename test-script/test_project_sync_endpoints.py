"""Backend support for syncing a whole device project with the cloud.

Checks the two service calls device project sync relies on:

  * the location list as one document with a revision: read it, replace it
    only from the revision it was read at (a stale revision is refused), and
    the first upload into an empty list without a revision;
  * an asset stored under the id the device chose, so documents that refer to
    a picture by id resolve in the cloud: idempotent, and an id that could
    name a path is refused.

Run from project root:
    venv/bin/python test-script/test_project_sync_endpoints.py
"""

from __future__ import annotations

import asyncio
import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

_tmp = Path(tempfile.mkdtemp(prefix="opendraft-project-sync-"))
os.environ["OPENDRAFT_DATA_DIR"] = str(_tmp)

from app.config import get_projects_dir  # noqa: E402
from app.services import asset_service, location_service  # noqa: E402

PROJECT = "sync-11111111-1111-1111-1111-111111111111"
_failures: list[str] = []


def check(label: str, condition: bool, detail: object = "") -> None:
    print(f"  {'ok  ' if condition else 'FAIL'}  {label}  {'' if condition else detail}")
    if not condition:
        _failures.append(label)


def locations() -> None:
    print("location list")
    empty = location_service.read_location_list(PROJECT)
    check("empty list reads with a revision", empty["locations"] == [] and bool(empty["revision"]), empty)

    first = location_service.replace_location_list(PROJECT, [{"id": "loc-a", "name": "Kitchen"}], None)
    check("first upload into an empty list", [l["id"] for l in first["locations"]] == ["loc-a"], first)
    check("the location is stored as sent", first["locations"][0]["name"] == "Kitchen", first)

    try:
        location_service.replace_location_list(PROJECT, [{"id": "loc-b", "name": "Street"}], None)
        check("a second upload without a revision is refused", False)
    except location_service.LocationRevisionConflict:
        check("a second upload without a revision is refused", True)

    nxt = location_service.replace_location_list(
        PROJECT, [*first["locations"], {"id": "loc-b", "name": "Street"}], first["revision"])
    check("replace from the current revision", len(nxt["locations"]) == 2, nxt)
    try:
        location_service.replace_location_list(PROJECT, [], first["revision"])
        check("a stale revision is refused", False)
    except location_service.LocationRevisionConflict:
        check("a stale revision is refused", True)
    try:
        location_service.replace_location_list(PROJECT, [{"name": "No id"}], nxt["revision"])
        check("a location without an id is refused", False)
    except ValueError:
        check("a location without an id is refused", True)


async def assets() -> None:
    print("assets under a chosen id")
    entry = await asset_service.put_asset_with_id(PROJECT, "a1b2c3", b"png-bytes", "photo.png", "image/png")
    check("stored under the given id", entry["id"] == "a1b2c3" and entry["filename"] == "a1b2c3.png", entry)
    path = asset_service.get_asset_path(PROJECT, "a1b2c3")
    check("bytes on disk", path.read_bytes() == b"png-bytes")
    again = await asset_service.put_asset_with_id(PROJECT, "a1b2c3", b"other", "photo.png", "image/png")
    check("a repeated upload is a no-op", again == entry and path.read_bytes() == b"png-bytes", again)
    check("listed once", [a["id"] for a in asset_service.list_assets(PROJECT)].count("a1b2c3") == 1)
    for bad in ["../escape", "a/b", "", ".hidden"]:
        try:
            await asset_service.put_asset_with_id(PROJECT, bad, b"x", "x.png")
            check(f"id {bad!r} refused", False)
        except ValueError:
            check(f"id {bad!r} refused", True)
    odd = await asset_service.put_asset_with_id(PROJECT, "odd1", b"x", "name.p/ng", None)
    check("an unsafe extension is dropped", odd["filename"] == "odd1", odd)


def main() -> int:
    try:
        (get_projects_dir() / PROJECT).mkdir(parents=True, exist_ok=True)
        locations()
        asyncio.run(assets())
    finally:
        shutil.rmtree(_tmp, ignore_errors=True)
    print(f"\n{'FAILED: ' + ', '.join(_failures) if _failures else 'all passed'}")
    return 1 if _failures else 0


if __name__ == "__main__":
    sys.exit(main())
