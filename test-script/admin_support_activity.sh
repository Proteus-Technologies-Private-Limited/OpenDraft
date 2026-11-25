#!/usr/bin/env bash
# End-to-end check of the support activity log: project/script/file/version
# events reported by the backend, the per-account trash and restore, logout
# and password-reset logging, the email lookup, and audit/trash retention.
# Starts its OWN throwaway backend and collab server on spare ports with
# scratch data, so it never touches the dev servers or their data.
#
#   ./test-script/admin_support_activity.sh          # run checks, stop servers
#   KEEP=1 ./test-script/admin_support_activity.sh   # leave servers up to look at
#                                                    # http://localhost:4198/admin
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/test-script/output/admin-support-activity"
COLLAB=4198 BACK=8198 SECRET="test-secret-$(date +%s)"
for port in $COLLAB $BACK; do
  for pid in $(lsof -nP -tiTCP:$port -sTCP:LISTEN 2>/dev/null); do kill "$pid" 2>/dev/null; done
done
sleep 1
rm -rf "$OUT" && mkdir -p "$OUT/collab" "$OUT/backend"
ADMIN=admin@example.test USER_EMAIL=writer@example.test PW='Correct-Horse-9'
FAIL=0
CPID="" BPID=""

cleanup() {
  if [[ "${KEEP:-}" == "1" ]]; then
    echo "Servers left running (collab pid $CPID, backend pid $BPID). Admin: $ADMIN / $PW at http://localhost:$COLLAB/admin"
    return
  fi
  kill $CPID $BPID 2>/dev/null; wait 2>/dev/null
}
trap cleanup EXIT

echo "Starting collab on $COLLAB and backend on $BACK (logs in $OUT)"
(cd "$ROOT/collab-server" && exec env BACKEND_URL="http://127.0.0.1:$BACK/api" PORT=$COLLAB HOST=127.0.0.1 DATA_DIR="$OUT/collab" JWT_SECRET="$SECRET" \
  ADMIN_EMAILS=$ADMIN SMTP_HOST= GOOGLE_CLIENT_ID= NODE_ENV=development \
  node_modules/.bin/ts-node src/server.ts >"$OUT/collab.log" 2>&1) & CPID=$!
(cd "$ROOT/backend" && exec env OPENDRAFT_DATA_DIR="$OUT/backend" COLLAB_JWT_SECRET="$SECRET" \
  COLLAB_DB_PATH="$OUT/collab/collab.sqlite3" COLLAB_SERVER_URL="http://127.0.0.1:$COLLAB" \
  "$ROOT/venv/bin/python" -m uvicorn app.main:app --host 127.0.0.1 --port $BACK >"$OUT/backend.log" 2>&1) & BPID=$!

for i in $(seq 1 60); do
  curl -sf "http://127.0.0.1:$COLLAB/health" >/dev/null 2>&1 && curl -sf "http://127.0.0.1:$BACK/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -sf "http://127.0.0.1:$BACK/health" >/dev/null || { echo "backend did not start"; tail -30 "$OUT/backend.log"; exit 1; }
curl -sf "http://127.0.0.1:$COLLAB/health" >/dev/null || { echo "collab did not start"; tail -30 "$OUT/collab.log"; exit 1; }

export COLLAB BACK SECRET ADMIN USER_EMAIL PW OUT
node --input-type=module - <<'EOF' || FAIL=1
import { createRequire } from 'module';
const require = createRequire(process.env.PWD + '/collab-server/package.json');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const { COLLAB, BACK, SECRET, ADMIN, USER_EMAIL, PW, OUT } = process.env;
const C = `http://127.0.0.1:${COLLAB}`, B = `http://127.0.0.1:${BACK}`;
let failed = 0;
const check = (ok, what) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };
const DEVICE_ID = 'test-device-writer-0001';
async function call(url, { method = 'GET', body, token, headers = {} } = {}) {
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const as = (token) => ({ token, headers: { 'x-device-id': DEVICE_ID, 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130.0 Safari/537.36' } });
const detail = (e) => { try { return JSON.parse(e.detail || '{}'); } catch { return {}; } };

try {
  for (const [email, name] of [[ADMIN, 'Admin Person'], [USER_EMAIL, 'Wendy Writer']]) {
    const r = await call(`${C}/auth/register`, { method: 'POST', body: { email, password: PW, displayName: name, name } });
    check(r.status < 300, `register ${email} (${r.status} ${r.json?.error || ''})`);
  }
  const writer = (await call(`${C}/auth/login`, { method: 'POST', body: { email: USER_EMAIL, password: PW, device: { deviceId: DEVICE_ID, deviceName: 'Wendy MacBook', platform: 'web' } } })).json;
  check(!!writer?.accessToken, 'writer signs in');
  const wt = writer.accessToken;

  console.log('Writer works on projects through the backend');
  const p = await call(`${B}/api/projects/`, { method: 'POST', ...as(wt), body: { name: 'Night Shift' } });
  check(p.status === 200, `create project (${p.status})`);
  const pid = p.json.id;
  const content = { type: 'doc', content: [{ type: 'sceneHeading', content: [{ type: 'text', text: 'INT. SECRET LAB - NIGHT' }] }] };
  const s1 = await call(`${B}/api/projects/${pid}/scripts/`, { method: 'POST', ...as(wt), body: { title: 'Pilot', content, format: 'json' } });
  const s2 = await call(`${B}/api/projects/${pid}/scripts/`, { method: 'POST', ...as(wt), body: { title: 'Episode Two', content, format: 'json' } });
  check(s1.status === 200 && s2.status === 200, 'create two scripts');
  const sid = s1.json.meta.id, sid2 = s2.json.meta.id;
  await call(`${B}/api/projects/${pid}/scripts/${sid}`, { method: 'PUT', ...as(wt), body: { title: 'Pilot (final)' } });
  // Saving content with the same title must not count as a rename.
  await call(`${B}/api/projects/${pid}/scripts/${sid}`, { method: 'PUT', ...as(wt), body: { title: 'Pilot (final)', content } });
  await call(`${B}/api/projects/${pid}`, { method: 'PUT', ...as(wt), body: { name: 'Night Shift S1' } });
  const fd = new FormData(); fd.append('file', new Blob(['hello'], { type: 'text/plain' }), 'notes.txt');
  const up = await fetch(`${B}/api/projects/${pid}/assets/upload`, { method: 'POST', headers: { authorization: `Bearer ${wt}`, 'x-device-id': DEVICE_ID }, body: fd });
  const asset = await up.json();
  check(up.status === 200, `upload a file (${up.status})`);
  await call(`${B}/api/projects/${pid}/assets/${asset.id}`, { method: 'DELETE', ...as(wt) });
  const v = await call(`${B}/api/projects/${pid}/versions/checkin`, { method: 'POST', ...as(wt), body: { message: 'First draft' } });
  check(v.status === 200 && v.json.hash, 'save a version');
  const ds = await call(`${B}/api/projects/${pid}/scripts/${sid2}`, { method: 'DELETE', ...as(wt) });
  check(ds.status === 200, `delete a script (${ds.status})`);
  const dp = await call(`${B}/api/projects/${pid}`, { method: 'DELETE', ...as(wt) });
  check(dp.status === 200, `delete the project (${dp.status})`);
  const list = await call(`${B}/api/projects/`, as(wt));
  check(!list.json.projects.some(x => x.id === pid), 'deleted project is gone from the writer\'s list');
  check(!fs.existsSync(`${OUT}/backend/projects/users/${writer.user.id}/${pid}`), 'deleted project left its place on disk');

  console.log('Sign-out and password reset');
  const lo = await call(`${C}/auth/logout`, { method: 'POST', body: { refreshToken: writer.refreshToken } });
  check(lo.status === 200, 'writer signs out');
  // No SMTP on this server: the request is refused, but must still be logged.
  const fp = await call(`${C}/auth/forgot-password`, { method: 'POST', body: { email: USER_EMAIL } });
  check(fp.status === 503, `reset refused without an email service (${fp.status})`);
  await call(`${C}/auth/forgot-password`, { method: 'POST', body: { email: 'nobody@example.test' } });
  await sleep(1500); // backend events are sent in the background

  const admin = (await call(`${C}/auth/login`, { method: 'POST', body: { email: ADMIN, password: PW } })).json;
  const at = admin.accessToken;
  const target = (await call(`${C}/admin/api/users?q=wendy`, { token: at })).json.users[0];
  const sum = await call(`${C}/admin/api/users/${target.id}/summary`, { token: at });
  check(sum.status === 200, `summary loads (${sum.status})`);
  fs.writeFileSync(`${OUT}/summary.json`, JSON.stringify(sum.json, null, 2));
  const ev = sum.json.activity.recent;
  const find = (a) => ev.filter(e => e.action === a);
  for (const a of ['project_created', 'script_created', 'script_renamed', 'project_renamed', 'asset_uploaded', 'asset_deleted', 'version_saved', 'script_deleted', 'project_deleted']) {
    check(find(a).length >= 1, `event ${a} recorded`);
  }
  check(find('script_created').length === 2, `two script_created (${find('script_created').length})`);
  check(find('script_renamed').length === 1, `exactly one rename, saves with the same title not counted (${find('script_renamed').length})`);
  const ren = detail(find('script_renamed')[0] || {});
  check(ren.renamedFrom === 'Pilot' && ren.script === 'Pilot (final)', `rename names old and new title (${JSON.stringify(ren)})`);
  const pdel = detail(find('project_deleted')[0] || {});
  check(pdel.project === 'Night Shift S1' && pdel.scripts === 1 && !!pdel.trash, `project deletion names the project, its scripts and the trash entry (${JSON.stringify(pdel)})`);
  check(detail(find('script_deleted')[0] || {}).script === 'Episode Two', 'script deletion names the script');
  check(pdel.device === 'Wendy MacBook (web)', `deletion names the device (${pdel.device})`);
  check(find('project_deleted')[0]?.ip === '127.0.0.1', `deletion carries the writer's IP (${find('project_deleted')[0]?.ip})`);
  check(detail(find('asset_uploaded')[0] || {}).file === 'notes.txt', 'file upload names the file');
  check(detail(find('version_saved')[0] || {}).message === 'First draft', 'version save carries its message');
  check(!sum.text.includes('SECRET LAB'), 'screenplay text is never sent');
  const logout = find('logout')[0];
  check(!!logout && detail(logout).device === 'Wendy MacBook (web)', `logout is on the writer's timeline with the device (${logout?.detail})`);
  const reset = detail(find('password_reset_requested')[0] || {});
  check(reset.email_sent === false && reset.email_error === 'SMTP not configured', `reset request says the email was not sent, and why (${JSON.stringify(reset)})`);
  check(sum.json.activity.last30Days.project_deleted === 1, 'deletions counted in the 30-day totals');

  console.log('Trash and restore');
  const trash = sum.json.storage.trash;
  check(sum.json.storage.trashRetentionDays === 30, 'trash retention reported (30 days)');
  check(trash?.length === 2, `two items in the trash (${trash?.length})`);
  const tProject = trash.find(t => t.kind === 'project'), tScript = trash.find(t => t.kind === 'script');
  check(tProject?.projectName === 'Night Shift S1' && tScript?.scriptTitle === 'Episode Two', 'trash lists the project and the script by name');
  check(sum.json.storage.totals.projects === 0, 'trashed project not counted as stored');
  const restoreUrl = (id) => `${C}/admin/api/users/${target.id}/trash/${encodeURIComponent(id)}/restore`;
  const early = await call(restoreUrl(tScript.id), { method: 'POST', token: at });
  check(early.status === 409 && /Restore the project first/.test(early.json?.error || ''), `script cannot come back before its project (${early.status} ${early.json?.error})`);
  check((await call(restoreUrl(tProject.id), { method: 'POST', token: wt })).status === 403, 'a non-admin cannot restore');
  const rp = await call(restoreUrl(tProject.id), { method: 'POST', token: at });
  check(rp.status === 200, `admin restores the project (${rp.status} ${rp.json?.error || ''})`);
  const rs = await call(restoreUrl(tScript.id), { method: 'POST', token: at });
  check(rs.status === 200, `admin restores the script (${rs.status} ${rs.json?.error || ''})`);
  check((await call(restoreUrl(tScript.id), { method: 'POST', token: at })).status === 404, 'restoring twice: 404');
  const writer2 = (await call(`${C}/auth/login`, { method: 'POST', body: { email: USER_EMAIL, password: PW } })).json;
  const back = await call(`${B}/api/projects/${pid}/scripts/`, { token: writer2.accessToken });
  check(back.status === 200 && back.json.map(x => x.title).sort().join(',') === 'Episode Two,Pilot (final)', `project and both scripts are back (${back.text.slice(0, 120)})`);
  const got = await call(`${B}/api/projects/${pid}/scripts/${sid2}`, { token: writer2.accessToken });
  check(JSON.stringify(got.json?.content).includes('SECRET LAB'), 'restored script has its content');
  const sum2 = (await call(`${C}/admin/api/users/${target.id}/summary`, { token: at })).json;
  check(sum2.storage.trash.length === 0, 'trash empty after restoring');
  const ar = sum2.activity.recent.filter(e => e.action === 'admin_restore');
  check(ar.length === 2 && detail(ar[0]).by === ADMIN, 'restores are on the account\'s timeline, naming the admin');

  console.log('Internal audit endpoint refuses anything but the backend');
  const ep = `${C}/internal/audit`;
  const good = (o = {}) => jwt.sign({ sub: target.id, type: 'backend_audit', ...o.claims }, o.secret || SECRET, { expiresIn: o.exp || 60, audience: o.aud || 'opendraft-collab-audit' });
  const body = { action: 'project_created', detail: { project: 'Forged' } };
  check((await call(ep, { method: 'POST', body })).status === 401, 'no token: 401');
  check((await call(ep, { method: 'POST', body, token: writer2.accessToken })).status === 401, 'the writer\'s own sign-in token: 401');
  check((await call(ep, { method: 'POST', body, token: good({ secret: 'wrong' }) })).status === 401, 'wrong secret: 401');
  check((await call(ep, { method: 'POST', body, token: good({ aud: 'opendraft-backend-admin' }) })).status === 401, 'wrong audience: 401');
  check((await call(ep, { method: 'POST', body, token: good({ exp: 3600 }) })).status === 401, 'token living an hour: 401');
  check((await call(ep, { method: 'POST', body: { action: 'login' }, token: good() })).status === 400, 'a sign-in action cannot be forged through it: 400');
  check((await call(ep, { method: 'POST', body, token: good() })).status === 200, 'a correct backend token: 200');
  const asAccess = await call(`${C}/admin/api/me`, { token: good() });
  check(asAccess.status === 401, `backend audit token refused as a sign-in (${asAccess.status})`);

  console.log('Email lookup');
  const lk = await call(`${C}/admin/api/lookup?email=NOBODY@example.test`, { token: at });
  check(lk.status === 200 && lk.json.account === null, 'unknown email: no account');
  check(lk.json.events.some(e => e.action === 'password_reset_requested' && detail(e).reason === 'user_not_found'), 'unknown email: its reset request is listed');
  const lk2 = await call(`${C}/admin/api/lookup?email=${USER_EMAIL}`, { token: at });
  check(lk2.json.account?.id === target.id && lk2.json.events.some(e => e.action === 'password_reset_requested'), 'known email: account and events');
  check((await call(`${C}/admin/api/lookup?email=x`, { token: at })).status === 400, 'not an email: 400');
  check((await call(`${C}/admin/api/lookup?email=${USER_EMAIL}`, { token: writer2.accessToken })).status === 403, 'non-admin lookup refused');
} catch (err) {
  console.error('  FAIL  test crashed:', err);
  failed++;
}
process.exit(failed ? 1 : 0);
EOF

echo "Audit retention"
(cd "$ROOT/collab-server" && env JWT_SECRET=x DATA_DIR="$OUT/collab" node_modules/.bin/ts-node -T -e "
  const { initDB, getDB } = require('./src/db');
  const audit = require('./src/services/auditService');
  (async () => {
    await initDB();
    const old = new Date(Date.now() - 400 * 864e5).toISOString(), recent = new Date(Date.now() - 300 * 864e5).toISOString();
    await getDB().run('INSERT INTO audit_log (user_id, action, created_at) VALUES (?, ?, ?)', ['retention-test', 'login', old]);
    await getDB().run('INSERT INTO audit_log (user_id, action, created_at) VALUES (?, ?, ?)', ['retention-test', 'login', recent]);
    const kept0 = await audit.pruneAuditLog(0);
    const removed = await audit.pruneAuditLog(365);
    const left = await getDB().all('SELECT created_at FROM audit_log WHERE user_id = ?', ['retention-test']);
    const ok = kept0 === 0 && removed === 1 && left.length === 1 && left[0].created_at === recent;
    console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  rows older than 365 days pruned, newer kept, 0 keeps all (removed ' + removed + ', left ' + left.length + ')');
    process.exit(ok ? 0 : 1);
  })().catch(e => { console.error('  FAIL ', e); process.exit(1); });") || FAIL=1

echo "Trash purge and trash turned off"
(cd "$ROOT/backend" && env OPENDRAFT_DATA_DIR="$OUT/trash-unit" "$ROOT/venv/bin/python" - <<'EOF') || FAIL=1
import json, os
from datetime import datetime, timedelta, timezone
from app.config import PROJECTS_DIR_BASE, current_user_id
from app.services import project_service, script_service, trash_service
import app.services.trash_service as ts
failed = 0
def check(ok, what):
    global failed
    print(f"  {'PASS' if ok else 'FAIL'}  {what}")
    failed += 0 if ok else 1
current_user_id.set("unit-user")
project_service.create_project("Old Stuff")
project_service.create_project("Fresh Stuff")
gone_old = project_service.delete_project("old-stuff")
gone_new = project_service.delete_project("fresh-stuff")
entry = PROJECTS_DIR_BASE / "users" / "unit-user" / ".trash" / gone_old["id"] / "entry.json"
data = json.loads(entry.read_text())
data["deletedAt"] = (datetime.now(timezone.utc) - timedelta(days=31)).isoformat()
entry.write_text(json.dumps(data))
removed = trash_service.purge_expired()
names = [e["projectName"] for e in trash_service.list_trash("unit-user")]
check(removed == 1 and names == ["Fresh Stuff"], f"entries older than 30 days purged, newer kept ({removed}, {names})")
check(project_service.list_projects() == [], "trash is not listed as a project")
ts.TRASH_RETENTION_DAYS = 0
p = project_service.create_project("Gone For Good")
s = script_service.create_script(p["id"], "Draft")
r1 = script_service.delete_script(p["id"], s["meta"]["id"])
r2 = project_service.delete_project(p["id"])
check("id" not in r1 and "id" not in r2 and r2["projectName"] == "Gone For Good", "trash off: deletes are permanent and say what went")
check(not (PROJECTS_DIR_BASE / "users" / "unit-user" / p["id"]).exists() and len(trash_service.list_trash("unit-user")) == 1, "trash off: nothing new in the trash")
try:
    trash_service.restore("unit-user", "../x")
    check(False, "path traversal in a trash id is refused")
except ValueError:
    check(True, "path traversal in a trash id is refused")
raise SystemExit(1 if failed else 0)
EOF

[[ $FAIL == 0 ]] && echo "ALL CHECKS PASSED" || { echo "SOME CHECKS FAILED (logs in $OUT)"; exit 1; }
