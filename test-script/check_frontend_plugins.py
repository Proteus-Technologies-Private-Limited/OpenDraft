"""Checks the runtime frontend plugin folders: listing, serving, and refusing bad ones.

Serving: only a listed plugin's own files — never a folder that is turned off
(``_name``) or broken (no plugin.json), never a hidden file or folder
(``.git``, ``.env``), never anything resolving outside the plugin's folder.

In-process (FastAPI TestClient) — no server is started. Run from the project root:

    venv/bin/python test-script/check_frontend_plugins.py
"""
import json
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone
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


import jwt  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from app.config import COLLAB_JWT_SECRET  # noqa: E402
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
plugin("no-style", {**good, "id": "no-style", "style": "missing.css", "defaultEnabled": True}, {"index.js": "/* js */"})
plugin("bad-default", {**good, "id": "bad-default", "defaultEnabled": "yes"}, {"index.js": "/* js */"})

# Files a valid plugin has that must never be served, and ones it may serve.
(plugins / "good-one" / ".env").write_text("SECRET=hidden-env")
(plugins / "good-one" / ".hidden").mkdir()
(plugins / "good-one" / ".hidden" / "x.js").write_text("/* hidden */")
(plugins / "good-one" / "assets").mkdir()
(plugins / "good-one" / "assets" / "logo.svg").write_text("<svg/>")
(plugins / "good-one" / "assets" / "font.woff2").write_bytes(b"wOF2")
(work / "secret.txt").write_text("outside-secret")
(plugins / "good-one" / "leak.js").symlink_to(work / "secret.txt")
# A folder without plugin.json, a turned-off folder's script, and a .git folder.
(plugins / "broken").mkdir()
(plugins / "broken" / "index.js").write_text("/* broken */")
(plugins / "_disabled" / "index.js").write_text("/* disabled */")
(plugins / ".git").mkdir()
(plugins / ".git" / "config").write_text("[remote] url=secret")
# A plugin installed as a symbolic link to its build elsewhere.
linked_build = work / "linked-build" / "dist"
linked_build.mkdir(parents=True)
(linked_build / "plugin.json").write_text(json.dumps({**good, "id": "linked", "defaultEnabled": False}))
(linked_build / "index.js").write_text("/* linked */")
(linked_build / "index.css").write_text("/* linked css */")
(work / "linked-build" / "outside.js").write_text("/* outside the linked folder */")
(plugins / "linked").symlink_to(linked_build, target_is_directory=True)


def admin_headers(token_type: str) -> dict[str, str]:
    now = datetime.now(timezone.utc)
    token = jwt.encode({
        "sub": "plugin-admin", "admin": "admin@example.invalid", "type": token_type,
        "aud": "opendraft-backend-admin", "iat": now, "exp": now + timedelta(seconds=60),
    }, COLLAB_JWT_SECRET, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}

with TestClient(app) as client:
    res = client.get("/api/plugins")
    listed = res.json() if res.status_code == 200 else None
    check(res.status_code == 200 and isinstance(listed, list), "GET /api/plugins answers a list without signing in")
    ids = [p["id"] for p in listed or []]
    check(ids == ["bad-default", "good-one", "linked", "no-style"], f"only valid folders are listed, in name order ({ids})")
    by_id = {p["id"]: p for p in listed or []}
    first = by_id.get("good-one", {})
    check(first.get("script", "").startswith("/plugins/good-one/index.js?v="), "the script URL is under /plugins/<id>/ with a version stamp")
    check(by_id.get("no-style", {}).get("style", "") is None, "a missing style sheet is left out, the plugin still listed")
    linked = by_id.get("linked", {})
    check(linked.get("script", "").startswith("/plugins/linked/index.js?v=") and linked.get("style", "").startswith("/plugins/linked/index.css?v="),
          "a plugin folder that is a symbolic link is listed with its files")
    defaults = [p["defaultEnabled"] for p in listed]
    check(defaults == [None, None, False, True],
          f"defaults come from the manifests; none (or not a boolean) is null, left to the plugin ({defaults})")

    admin_url = "/api/admin/plugins"
    headers = admin_headers("admin_plugins")
    admin_listed = client.get(admin_url, headers=headers).json()
    check([{k: v for k, v in p.items() if k not in ("adminDefault", "manifestDefault")} for p in admin_listed] == listed,
          "admins see all currently deployed plugins")
    sources = {p["id"]: (p.get("adminDefault"), p.get("manifestDefault")) for p in admin_listed}
    check(sources == {"bad-default": (None, None), "good-one": (None, None), "linked": (None, False), "no-style": (None, True)},
          f"admins see where each default comes from: no admin choice yet, the manifest's ({sources})")
    check(all("adminDefault" not in p and "manifestDefault" not in p for p in listed), "the public listing does not carry the admin's detail")
    check(client.post(f"{admin_url}/good-one", json={"defaultEnabled": True}).status_code == 401, "unauthenticated users cannot change defaults")
    check(client.post(f"{admin_url}/good-one", headers=admin_headers("admin_inventory"), json={"defaultEnabled": True}).status_code == 401, "account inventory tokens cannot change defaults")
    check(client.post(f"{admin_url}/missing", headers=headers, json={"defaultEnabled": True}).status_code == 404, "admins can only configure installed plugins")
    check(client.post(f"{admin_url}/good-one", headers=headers, json={"defaultEnabled": "true"}).status_code == 422, "default settings must be booleans")
    check(client.post(f"{admin_url}/good-one", headers=headers, json={"defaultEnabled": True}).status_code == 200, "admins can set a plugin default to on")
    check(client.post(f"{admin_url}/no-style", headers=headers, json={"defaultEnabled": False}).status_code == 200, "admins can set a plugin default to off")
    check(client.post(f"{admin_url}/linked", headers=headers, json={"defaultEnabled": True}).status_code == 200, "admins can set a symlinked plugin's default")
    saved = {p["id"]: p["defaultEnabled"] for p in client.get("/api/plugins").json()}
    check(saved == {"bad-default": None, "good-one": True, "linked": True, "no-style": False}, f"saved admin choices override deployment defaults ({saved})")
    check((work / "data" / "plugin-defaults" / "good-one").read_text() == "true", "admin settings are saved outside the deployed plugin files")

    # Tri-state: true, false, or null to clear the admin's choice. Nothing else.
    for bad in ("true", 1, 0, "null", "", [], {}):
        r = client.post(f"{admin_url}/good-one", headers=headers, json={"defaultEnabled": bad})
        check(r.status_code == 422, f"defaultEnabled {bad!r} is refused ({r.status_code})")
    r = client.post(f"{admin_url}/good-one", headers=headers, json={})
    check(r.status_code == 422, f"a body without defaultEnabled is refused, not read as null ({r.status_code})")
    r = client.post(f"{admin_url}/good-one", headers=headers, json={"defaultEnabled": None, "extra": 1})
    check(r.status_code == 422, f"unexpected fields are refused ({r.status_code})")
    check((work / "data" / "plugin-defaults" / "good-one").read_text() == "true", "a refused request leaves the saved default alone")

    r = client.post(f"{admin_url}/no-style", headers=headers, json={"defaultEnabled": None})
    body = r.json() if r.status_code == 200 else {}
    check(r.status_code == 200 and body.get("adminDefault") is None and body.get("manifestDefault") is True
          and body.get("defaultEnabled") is True,
          f"null clears the admin's choice and the manifest's default applies again ({r.status_code} {body})")
    check(not (work / "data" / "plugin-defaults" / "no-style").exists(), "clearing removes the saved file")
    r = client.post(f"{admin_url}/bad-default", headers=headers, json={"defaultEnabled": None})
    check(r.status_code == 200 and r.json().get("defaultEnabled") is None,
          "clearing when nothing was saved is fine, and with no manifest default the default is null")
    r = client.post(f"{admin_url}/good-one", headers=headers, json={"defaultEnabled": False})
    check(r.status_code == 200 and r.json().get("adminDefault") is False and r.json().get("defaultEnabled") is False,
          "the answer to a save is the plugin as the admin listing shows it")
    check(client.post(f"{admin_url}/missing", headers=headers, json={"defaultEnabled": None}).status_code == 404,
          "clearing a plugin that is not installed is a 404")
    check(client.post(f"{admin_url}/good-one", json={"defaultEnabled": None}).status_code == 401,
          "unauthenticated users cannot clear defaults")
    saved = {p["id"]: p["defaultEnabled"] for p in client.get("/api/plugins").json()}
    check(saved == {"bad-default": None, "good-one": False, "linked": True, "no-style": True},
          f"the public listing shows the defaults in effect after clearing ({saved})")
    (work / "data" / "plugin-defaults" / "bad-default").write_text("maybe")
    check({p["id"]: p["defaultEnabled"] for p in client.get("/api/plugins").json()}.get("bad-default") is None,
          "a saved default that is not true or false is ignored")
    (work / "data" / "plugin-defaults" / "bad-default").unlink()

    js = client.get("/plugins/good-one/index.js")
    check(js.status_code == 200 and js.text == "/* js */", "the plugin's script is served")
    check(js.headers.get("content-type", "").startswith("text/javascript"), f"as JavaScript ({js.headers.get('content-type')})")
    check(js.headers.get("x-content-type-options") == "nosniff", "with nosniff")
    css = client.get("/plugins/good-one/index.css")
    check(css.status_code == 200 and css.headers.get("content-type", "").startswith("text/css"), "its style sheet is served as CSS")
    svg = client.get("/plugins/good-one/assets/logo.svg")
    check(svg.status_code == 200 and svg.headers.get("content-type", "").startswith("image/svg+xml"), "its assets are served, in sub-folders too")
    font = client.get("/plugins/good-one/assets/font.woff2")
    check(font.status_code == 200 and font.headers.get("content-type") == "font/woff2", "fonts get a font content type")
    check(client.get("/plugins/good-one/plugin.json").status_code == 200, "its manifest is served")
    linked_js = client.get("/plugins/linked/index.js")
    check(linked_js.status_code == 200 and linked_js.text == "/* linked */", "a symlinked plugin's script is served")

    refused = {
        "/plugins/_disabled/index.js": "a turned-off (_) folder",
        "/plugins/broken/index.js": "a folder without plugin.json",
        "/plugins/.git/config": "the plugins directory's .git",
        "/plugins/good-one/.env": "a valid plugin's .env",
        "/plugins/good-one/.hidden/x.js": "a file in a hidden folder",
        "/plugins/good-one/leak.js": "a symlink pointing out of the plugin's folder",
        "/plugins/linked/%2e%2e/outside.js": "a file beside a symlinked plugin's folder",
        "/plugins/good-one/missing.js": "a file that does not exist",
        "/plugins/good-one/assets": "a folder",
        "/plugins/good-one/": "the plugin folder itself",
        "/plugins/wrong-id/index.js": "a plugin whose id is not its folder's name",
        "/plugins/too-new/index.js": "a plugin needing a newer API",
        "/plugins/Good-One/index.js": "an id that is not lower case",
    }
    for url, what in refused.items():
        r = client.get(url)
        check(r.status_code == 404 and not any(x in r.text for x in ("hidden-env", "outside-secret", "secret", "/* ")),
              f"404 for {what} ({url} -> {r.status_code})")
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
