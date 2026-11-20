"""Location Database on the backend: reference images, and discovery.

The Locations panel now attaches reference images to a location. The backend
already had an `imageAssetIds` field, but nothing ever wrote it, so this checks
the round trip the panel relies on:

  * a location's image list is stored, in order, and survives edits to its
    other fields (the panel saves images and the edit form separately);
  * discovery keeps what the writer added to a location;
  * a location's named looks (Day, Night…) and its description are stored,
    cleaned the way the device storages clean them, and read back empty on
    records written before they existed;
  * a heading that is so far only "INT." names no place — it used to be
    recorded as a location called INT. The device storages apply the same rule
    (frontend/src/utils/locationData.ts), so the two must agree.

Run from project root:
    venv/bin/python test-script/test_location_images.py
"""

from __future__ import annotations

import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

_tmp = Path(tempfile.mkdtemp(prefix="opendraft-locations-"))
os.environ["OPENDRAFT_DATA_DIR"] = str(_tmp)

from app.config import get_projects_dir  # noqa: E402
from app.services import location_service  # noqa: E402

PROJECT = "proj-locations"

_failures: list[str] = []


def check(label: str, condition: bool, detail: object = "") -> None:
    if condition:
        print(f"  ok    {label}")
    else:
        print(f"  FAIL  {label}  {detail}")
        _failures.append(label)


def heading(text: str) -> dict:
    return {"type": "sceneHeading", "content": [{"type": "text", "text": text}]}


def script(*headings: str) -> dict:
    return {"content": {"type": "doc", "content": [heading(h) for h in headings]}}


def main() -> int:
    try:
        (get_projects_dir() / PROJECT).mkdir(parents=True)

        print("Heading parser")
        cases = {
            "INT. KITCHEN - DAY": ("KITCHEN", "interior"),
            "EXT. GARDEN - NIGHT": ("GARDEN", "exterior"),
            "INT./EXT. CAR - CONTINUOUS": ("CAR", "both"),
            "INT. POLICE STATION. NIGHT": ("POLICE STATION", "interior"),
            "INT.": ("", "interior"),
            "EXT": ("", "exterior"),
            "INTERIOR DESIGN STUDIO": ("INTERIOR DESIGN STUDIO", "interior"),
        }
        for text, expected in cases.items():
            got = location_service._parse_location_from_heading(text)
            check(f"{text!r} -> {expected}", got == expected, f"got {got}")

        print("Discovery")
        result = location_service.discover_locations(
            PROJECT,
            [script("INT. KITCHEN - DAY", "EXT. GARDEN - NIGHT", "INT."), script("EXT. KITCHEN - DAY")],
        )
        names = {loc["name"]: loc["type"] for loc in result["locations"]}
        check("two places found, none called INT", names == {"KITCHEN": "both", "GARDEN": "exterior"}, names)
        check("discovered count", result["discovered"] == 2, result["discovered"])
        check("a new location starts with no images", all(loc["imageAssetIds"] == [] for loc in result["locations"]))

        kitchen = next(loc for loc in result["locations"] if loc["name"] == "KITCHEN")

        print("Reference images")
        updated = location_service.update_location(PROJECT, kitchen["id"], {"imageAssetIds": ["a1", "a2"]})
        check("image list stored", updated["imageAssetIds"] == ["a1", "a2"], updated["imageAssetIds"])

        updated = location_service.update_location(PROJECT, kitchen["id"], {"imageAssetIds": ["a2", "a1", "a3"]})
        check("order kept (first is the main image)", updated["imageAssetIds"] == ["a2", "a1", "a3"], updated["imageAssetIds"])

        updated = location_service.update_location(
            PROJECT, kitchen["id"], {"address": "12 Mill Lane", "notes": "North light", "tags": ["studio"]}
        )
        check("editing other fields leaves the images alone", updated["imageAssetIds"] == ["a2", "a1", "a3"], updated["imageAssetIds"])
        check("and the edit itself is saved", updated["address"] == "12 Mill Lane" and updated["tags"] == ["studio"])

        reread = location_service.get_location(PROJECT, kitchen["id"])
        check("read back from disk", reread["imageAssetIds"] == ["a2", "a1", "a3"] and reread["notes"] == "North light")

        again = location_service.discover_locations(PROJECT, [script("INT. KITCHEN - DAY", "INT. ATTIC - DAY")])
        kept = next(loc for loc in again["locations"] if loc["id"] == kitchen["id"])
        check("discovering again keeps the images and notes", kept["imageAssetIds"] == ["a2", "a1", "a3"] and kept["notes"] == "North light")
        check("and adds only the new place", again["discovered"] == 1, again["discovered"])

        emptied = location_service.update_location(PROJECT, kitchen["id"], {"imageAssetIds": []})
        check("the last image can be removed", emptied["imageAssetIds"] == [], emptied["imageAssetIds"])

        print("Looks and description")
        check("a discovered location has no looks and no description", kept["looks"] == [] and kept["description"] == "")
        updated = location_service.update_location(PROJECT, kitchen["id"], {
            "description": "Steel counters, one high window",
            "looks": [
                {"id": "look-day", "name": " Day ", "imageAssetId": "a1"},
                {"id": "look-day", "name": "Again"},
                {"name": "No id"},
                {"id": "look-night", "name": "Night", "imageAssetId": 7},
                "junk",
            ],
        })
        check("well-formed looks kept, trimmed, once each",
              updated["looks"] == [{"id": "look-day", "name": "Day", "imageAssetId": "a1"},
                                   {"id": "look-night", "name": "Night", "imageAssetId": None}], updated["looks"])
        check("description saved", updated["description"] == "Steel counters, one high window")
        again = location_service.discover_locations(PROJECT, [script("INT. KITCHEN - NIGHT")])
        kept = next(loc for loc in again["locations"] if loc["id"] == kitchen["id"])
        check("discovering again keeps the looks", [l["id"] for l in kept["looks"]] == ["look-day", "look-night"], kept["looks"])

        # A record written before looks existed reads back with them empty.
        raw = location_service._read(PROJECT)
        for loc in raw["locations"]:
            loc.pop("looks", None)
            loc.pop("description", None)
        location_service._write(PROJECT, raw)
        listed = location_service.list_locations(PROJECT)
        check("older records list with empty looks and description",
              all(loc["looks"] == [] and loc["description"] == "" for loc in listed), listed)
        created = location_service.create_location(PROJECT, {"name": "rooftop", "looks": [{"id": "look-n", "name": "Night"}]})
        check("a location made by hand keeps its looks",
              created["name"] == "ROOFTOP" and created["looks"] == [{"id": "look-n", "name": "Night", "imageAssetId": None}], created)
    except Exception as exc:  # noqa: BLE001 - report anything unexpected as a failure
        print(f"  FAIL  unexpected error: {exc!r}")
        _failures.append("unexpected error")
    finally:
        shutil.rmtree(_tmp, ignore_errors=True)

    print()
    if _failures:
        print(f"{len(_failures)} check(s) failed")
        return 1
    print("All location checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
