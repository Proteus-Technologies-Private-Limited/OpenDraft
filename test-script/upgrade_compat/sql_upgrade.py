#!/usr/bin/env python3
"""Upgrade check for the app database, driven through the app's own SQLite plugin.

    sql_upgrade.py populate   # on the OLD app: a project with two screenplays
    sql_upgrade.py verify     # on the NEW app, installed over it

`populate` writes rows exactly as the old app's schema has them (columns are
read from PRAGMA table_info, not assumed). `verify` checks that every row and
body survived, that this release's migrations ran (device-sync tables, their
added columns, the import trigger), and that the screenplay opens in the
editor. Uses the simulator in $OD_SIM_UDID, like ios_upgrade.py.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ios_upgrade import App, PersistentIOS, udid  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "output" / "upgrade_compat" / "sql_upgrade.json"

SQL = """
  const inv = window.__TAURI_INTERNALS__.invoke;
  const db = await inv('plugin:sql|load', { db: 'sqlite:opendraft.db' });
  const select = (query, values = []) => inv('plugin:sql|select', { db, query, values });
  const execute = (query, values = []) => inv('plugin:sql|execute', { db, query, values });
"""


def doc(*lines: str) -> dict:
    return {"type": "doc", "content": [{"type": "sceneHeading", "content": [{"type": "text", "text": lines[0]}]}]
            + [{"type": "action", "content": [{"type": "text", "text": t}]} for t in lines[1:]]}


def populate(app: App) -> dict:
    stamp = "2026-11-20T10:00:00.000Z"
    data = {
        "project": "upgrade-project-0001",
        "scripts": {
            "upgrade-script-0001": ("Pilot", doc("INT. KITCHEN - DAY", "Written before the upgrade.")),
            "upgrade-script-0002": ("Second", doc("EXT. ROOF - NIGHT", "Another one, with ünïcödé.")),
        },
    }
    result = app.js_async(SQL + f"""
      const data = {json.dumps(data)};
      const cols = async t => (await select(`PRAGMA table_info(${{t}})`)).map(c => c.name);
      const projectCols = await cols('projects'), scriptCols = await cols('scripts');
      await execute('INSERT INTO projects (id, name, properties, created_at, updated_at) VALUES ($1,$2,$3,$4,$5)',
        [data.project, 'Upgrade Check', '{{}}', {json.dumps(stamp)}, {json.dumps(stamp)}]);
      for (const [id, [title, content]] of Object.entries(data.scripts)) {{
        const row = {{ id, project_id: data.project, title, created_at: {json.dumps(stamp)}, updated_at: {json.dumps(stamp)} }};
        if (scriptCols.includes('format')) row.format = 'screenplay';
        const keys = Object.keys(row);
        await execute(`INSERT INTO scripts (${{keys.join(',')}}) VALUES (${{keys.map((_, i) => '$' + (i + 1)).join(',')}})`,
          keys.map(k => row[k]));
        await execute('INSERT INTO script_content (script_id, content) VALUES ($1,$2)', [id, JSON.stringify(content)]);
      }}
      const tables = (await select("SELECT name FROM sqlite_master WHERE type='table'")).map(r => r.name).sort();
      return {{ projectCols, scriptCols, tables }};
    """, "populate")
    data["before"] = result
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, indent=1, ensure_ascii=False))
    return {"tables_before": result["tables"]}


def verify(app: App) -> int:
    data = json.loads(OUT.read_text())
    failures: list[str] = []
    state = app.js_async(SQL + """
      const cols = async t => (await select(`PRAGMA table_info(${t})`)).map(c => c.name);
      const tables = (await select("SELECT name FROM sqlite_master WHERE type='table'")).map(r => r.name);
      const triggers = (await select("SELECT name FROM sqlite_master WHERE type='trigger'")).map(r => r.name);
      const projects = await select('SELECT id, name FROM projects');
      const scripts = await select('SELECT s.id, s.title, c.content FROM scripts s LEFT JOIN script_content c ON c.script_id = s.id');
      return { tables, triggers, projects, scripts, baseCols: tables.includes('device_script_sync') ? await cols('device_script_sync') : [] };
    """, "verify")
    for table in ("device_project_sync", "device_script_sync", "device_script_import"):
        if table not in state["tables"]:
            failures.append(f"migration did not create {table}")
    for column in ("deleted", "sending_hash"):
        if column not in state["baseCols"]:
            failures.append(f"device_script_sync has no {column} column")
    if "import_device_script" not in state["triggers"]:
        failures.append("import_device_script trigger missing")
    if not any(p["id"] == data["project"] and p["name"] == "Upgrade Check" for p in state["projects"]):
        failures.append("the project did not survive")
    stored = {s["id"]: s for s in state["scripts"]}
    for sid, (title, content) in data["scripts"].items():
        row = stored.get(sid)
        if not row:
            failures.append(f"{title} did not survive")
        elif row["title"] != title or json.loads(row["content"]) != content:
            failures.append(f"{title} changed in the upgrade")
    # And it opens in the editor.
    app.js(f"history.pushState(null, '', '/project/{data['project']}/edit/upgrade-script-0002'); dispatchEvent(new PopStateEvent('popstate')); return true;")
    opened = app.wait_for("document.querySelector('.ProseMirror')?.innerText.includes('ünïcödé')", 20)
    if not opened:
        failures.append("the upgraded screenplay did not open in the editor")
    print(json.dumps({"tables": sorted(state["tables"]), "failures": failures, "opened": opened}, indent=1, ensure_ascii=False))
    return 1 if failures else 0


def main() -> int:
    app = App(PersistentIOS(udid()))
    if sys.argv[1:2] == ["populate"]:
        print(json.dumps(populate(app), indent=1))
        return 0
    if sys.argv[1:2] == ["verify"]:
        time.sleep(2)
        return verify(app)
    print(__doc__)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
