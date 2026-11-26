"""Checks the runtime frontend plugin folders: listing, serving, and refusing bad ones.

In-process (FastAPI TestClient) — no server is started. Run from the project root:

    venv/bin/python test-script/check_frontend_plugins.py
"""
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

work = Path(tempfile.mkdtemp(prefix="opendraft-plugins-"))
plugins = work / "plugins"
os.environ["OPENDRAFT_PLUGINS_DIR"] = str(plugins)
os.environ["OPENDRAFT_DATA_DIR"] = str(work / "data")
os.environ.setdefault("COLLAB_JWT_SECRET", "test-only")


def plugin(folder: str, manifest: dict | str, files: dict[str, str]) -> None:
    d = plugins / folder
    d.mkdir(parents=True)
    (d / "plugin.json").write_text(manifest if isinstance(manifest, str) else json.dumps(manifest))
    for name, body in files.items():
        (d / name).write_text(body)


from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402

failures: list[str] = []


def check(ok: bool, what: str) -> None:
    print(("  ok  " if ok else "  FAIL ") + what)
    if not ok:
        failures.append(what)


good = {"id": "good-one", "name": "Good", "version": "1.2.0", "apiVersion": 1, "script": "index.js", "style": "index.css"}
plugin("good-one", good, {"index.js": "/* js */", "index.css": "/* css */"})
plugin("_disabled", {**good, "id": "_disabled"}, {"index.js": ""})
plugin("wrong-id", {**good, "id": "something-else"}, {"index.js": ""})
plugin("too-new", {**good, "id": "too-new", "apiVersion": 99}, {"index.js": ""})
plugin("escapes", {**good, "id": "escapes", "script": "../good-one/index.js"}, {})
plugin("not-json", "{nope", {})
plugin("no-style", {**good, "id": "no-style", "style": "missing.css"}, {"index.js": "/* js */"})

with TestClient(app) as client:
    res = client.get("/api/plugins")
    listed = res.json() if res.status_code == 200 else None
    check(res.status_code == 200 and isinstance(listed, list), "GET /api/plugins answers a list without signing in")
    ids = [p["id"] for p in listed or []]
    check(ids == ["good-one", "no-style"], f"only valid folders are listed, in name order ({ids})")
    first = (listed or [{}])[0]
    check(first.get("script", "").startswith("/plugins/good-one/index.js?v="), "the script URL is under /plugins/<id>/ with a version stamp")
    check((listed or [{}, {}])[1].get("style") is None, "a missing style sheet is left out, the plugin still listed")

    js = client.get("/plugins/good-one/index.js")
    check(js.status_code == 200 and js.text == "/* js */", "the plugin's script is served")
    check(client.get("/plugins/good-one/plugin.json").status_code == 200, "its manifest is served")
    # Encoded, so the ".." reaches the server rather than being folded away by the client.
    escapes = [client.get(u) for u in ("/plugins/good-one/%2e%2e/%2e%2e/app/config.py", "/plugins/..%2f..%2fapp/config.py")]
    check(all(r.status_code == 404 and "COLLAB_JWT_SECRET" not in r.text for r in escapes), "nothing outside the plugins folder is served")

    # Added and removed without a restart.
    plugin("added-later", {**good, "id": "added-later"}, {"index.js": ""})
    check("added-later" in [p["id"] for p in client.get("/api/plugins").json()], "a folder added while running is listed on the next request")
    (plugins / "added-later").rename(plugins / "_added-later")
    check("added-later" not in [p["id"] for p in client.get("/api/plugins").json()], "renaming it with a leading _ turns it off")

if failures:
    print(f"\n{len(failures)} check(s) failed")
    sys.exit(1)
print("\nAll runtime plugin folder checks passed")
