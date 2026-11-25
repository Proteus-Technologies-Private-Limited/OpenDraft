#!/usr/bin/env bash
# End-to-end check of the admin console's account summary (activity + projects
# and files). Starts its OWN throwaway backend and collab server on spare ports
# with scratch data, so it never touches the dev servers or their data.
#
#   ./test-script/admin_account_summary.sh          # run checks, stop servers
#   KEEP=1 ./test-script/admin_account_summary.sh   # leave servers up to look at
#                                                   # http://localhost:4199/admin
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/test-script/output/admin-account-summary"
COLLAB=4199 BACK=8199 SECRET="test-secret-$(date +%s)"
# Servers left over from an earlier KEEP=1 run hold the scratch database open.
for port in $COLLAB $BACK; do
  for pid in $(lsof -nP -tiTCP:$port -sTCP:LISTEN 2>/dev/null); do kill "$pid" 2>/dev/null; done
done
sleep 1
rm -rf "$OUT" && mkdir -p "$OUT/collab" "$OUT/backend"
ADMIN=admin@example.test USER_EMAIL=writer@example.test PW='Correct-Horse-9'
FAIL=0
pass() { echo "  PASS  $1"; }
fail() { echo "  FAIL  $1"; FAIL=1; }

cleanup() {
  if [[ "${KEEP:-}" == "1" ]]; then
    echo "Servers left running (collab pid $CPID, backend pid $BPID). Admin: $ADMIN / $PW"
    return
  fi
  kill "$CPID" "$BPID" 2>/dev/null; wait 2>/dev/null
}
trap cleanup EXIT

echo "Backend address rule"
check_rule() {
  (cd "$ROOT/collab-server" && env -u BACKEND_URL ${1:+BACKEND_URL=$1} JWT_SECRET=x DATA_DIR="$OUT/collab" node_modules/.bin/ts-node -T -e "
    const { backendCandidates } = require('./src/routes/admin');
    const cases = JSON.parse(process.argv[1]); let bad = 0;
    for (const [host, proto, want] of cases) {
      const got = backendCandidates(host, proto)[0];
      const ok = got === want; if (!ok) bad++;
      console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + JSON.stringify(host) + ' (' + proto + ') -> ' + got + (ok ? '' : '  wanted ' + want));
    }
    process.exit(bad ? 1 : 0);" "$2") || FAIL=1
}
check_rule "" '[["collab.open-draft.com","https","https://open-draft.com/api"],
  ["Collab.Example.com:8443","https","https://example.com:8443/api"],
  ["collab.example.com","http","http://example.com/api"],
  ["localhost:4000","http","http://localhost:8008/api"],
  ["mycollab.example.com","https","http://localhost:8008/api"],
  ["collab.evil.com/x","https","http://localhost:8008/api"],
  [null,"https","http://localhost:8008/api"]]'
check_rule "http://backend.internal:8080/api" '[["collab.open-draft.com","https","http://backend.internal:8080/api"]]'

echo "Starting collab on $COLLAB and backend on $BACK (logs in $OUT)"
(cd "$ROOT/collab-server" && exec env -u BACKEND_URL PORT=$COLLAB HOST=127.0.0.1 DATA_DIR="$OUT/collab" JWT_SECRET="$SECRET" \
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
curl -s "http://127.0.0.1:$COLLAB/admin/" -o /dev/null -w '%{http_code}' | grep -q 200 || { echo "collab did not start"; tail -30 "$OUT/collab.log"; exit 1; }

export COLLAB BACK SECRET ADMIN USER_EMAIL PW OUT
node --input-type=module - <<'EOF' || FAIL=1
import { createRequire } from 'module';
const require = createRequire(process.env.PWD + '/collab-server/package.json');
const jwt = require('jsonwebtoken');
const { COLLAB, BACK, SECRET, ADMIN, USER_EMAIL, PW, OUT } = process.env;
const C = `http://127.0.0.1:${COLLAB}`, B = `http://127.0.0.1:${BACK}`;
let failed = 0;
const check = (ok, what) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };
async function call(url, { method = 'GET', body, token } = {}) {
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}
const device = (n) => ({ deviceId: `test-device-${n}-0001`, deviceName: `Test browser ${n}`, platform: 'web' });
// BACKEND_URL is unset, so the collab server must find the backend by taking
// "collab." off the address the console is opened on. fetch() cannot set Host,
// hence plain http.request.
const http = require('http');
const summary = (id, token) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: Number(COLLAB), path: `/admin/api/users/${id}/summary`,
    headers: { host: `collab.127.0.0.1:${BACK}`, authorization: `Bearer ${token}` } }, (res) => {
    let text = ''; res.on('data', (c) => { text += c; });
    res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, json, text }); });
  });
  req.on('error', reject); req.end();
});
const login = async (email, password) => (await call(`${C}/auth/login`, { method: 'POST', body: { email, password, device: device(email.split('@')[0]) } })).json;

try {
  for (const [email, name] of [[ADMIN, 'Admin Person'], [USER_EMAIL, 'Wendy Writer']]) {
    const r = await call(`${C}/auth/register`, { method: 'POST', body: { email, password: PW, displayName: name, name } });
    check(r.status < 300, `register ${email} (${r.status} ${r.json?.error || ''})`);
  }
  await call(`${C}/auth/login`, { method: 'POST', body: { email: USER_EMAIL.toUpperCase(), password: 'wrong-password' } });
  const writer = await login(USER_EMAIL, PW);
  check(!!writer?.accessToken, 'writer signs in');
  const wt = writer.accessToken;

  // Two projects, three scripts, through the real backend API.
  const p1 = await call(`${B}/api/projects/`, { method: 'POST', token: wt, body: { name: 'Night Shift' } });
  check(p1.status === 200, `create project (${p1.status} ${p1.text.slice(0, 120)})`);
  const p2 = await call(`${B}/api/projects/`, { method: 'POST', token: wt, body: { name: 'Short Films' } });
  const content = { type: 'doc', content: [{ type: 'sceneHeading', content: [{ type: 'text', text: 'INT. SECRET LAB - NIGHT' }] }] };
  for (const [pid, title] of [[p1.json.id, 'Pilot'], [p1.json.id, 'Episode Two'], [p2.json?.id, 'The Wait']]) {
    const s = await call(`${B}/api/projects/${pid}/scripts/`, { method: 'POST', token: wt, body: { title, content, format: 'json' } });
    check(s.status === 200, `create script "${title}" (${s.status} ${s.status === 200 ? '' : s.text.slice(0, 120)})`);
  }

  // Not an admin: the summary is refused.
  const notAdmin = await call(`${C}/admin/api/users/${writer.user?.id || 'x'}/summary`, { token: wt });
  check(notAdmin.status === 403, `non-admin refused (${notAdmin.status})`);

  const admin = await login(ADMIN, PW);
  check(!!admin?.accessToken, 'admin signs in');
  const at = admin.accessToken;
  const users = await call(`${C}/admin/api/users?q=wendy`, { token: at });
  const target = users.json?.users?.[0];
  check(target?.email === USER_EMAIL, 'admin finds the writer in the users list');

  const sum = await summary(target.id, at);
  check(sum.status === 200, `summary loads (${sum.status} ${sum.json?.error || ''})`);
  const d = sum.json;
  require('fs').writeFileSync(`${OUT}/summary.json`, JSON.stringify(d, null, 2));
  check(d.user.email === USER_EMAIL && d.user.verified, 'profile is the writer, verified');
  check(d.activity.last30Days.login >= 1, `logins counted (${d.activity.last30Days.login})`);
  check(d.activity.last30Days.login_failed === 1, `failed sign-in matched case-insensitively (${d.activity.last30Days.login_failed})`);
  check(d.activity.daily.length === 30 && d.activity.daily.at(-1).count >= 2, 'daily chart has today\'s events');
  check(d.devices.length >= 1, `devices listed (${d.devices.length})`);
  check(d.storage.available === true, `storage reachable (${d.storage.error || 'ok'})`);
  check(d.storage.source === `http://127.0.0.1:${BACK}/api`, `backend found at the collab address minus "collab." (${d.storage.source})`);
  check(d.storage.totals?.projects === 2 && d.storage.totals?.scripts === 3, `2 projects / 3 scripts (${JSON.stringify(d.storage.totals)})`);
  const night = d.storage.projects?.find(p => p.name === 'Night Shift');
  check(night?.scripts?.map(s => s.title).sort().join(',') === 'Episode Two,Pilot', 'script titles listed per project');
  check(night?.scripts?.every(s => s.sizeBytes > 0), 'script sizes present');
  check(!sum.text.includes('SECRET LAB'), 'screenplay text is never sent');

  // Backend authorisation.
  const inv = `${B}/api/admin/accounts/${target.id}/inventory`;
  check((await call(inv)).status === 401, 'inventory without a token: 401');
  check((await call(inv, { token: wt })).status === 401, 'inventory with an ordinary sign-in token: 401');
  check((await call(inv, { token: at })).status === 401, 'inventory with the admin\'s own sign-in token: 401');
  const mint = (sub, opts = {}) => jwt.sign({ sub, type: 'admin_inventory', admin: ADMIN }, opts.secret || SECRET, { expiresIn: opts.exp || 60, audience: 'opendraft-backend-admin' });
  check((await call(inv, { token: mint(target.id) })).status === 200, 'inventory with a minted admin token: 200');
  check((await call(inv, { token: mint('someone-else') })).status === 403, 'admin token for another account: 403');
  check((await call(inv, { token: mint(target.id, { secret: 'wrong' }) })).status === 401, 'admin token signed with the wrong secret: 401');
  check((await call(inv, { token: mint(target.id, { exp: 3600 }) })).status === 401, 'admin token that lives an hour: 401');
  const asUser = await call(`${B}/api/projects/`, { token: mint(target.id) });
  check(asUser.status === 401, `admin token refused as a sign-in on /api/projects (${asUser.status})`);

  // The view itself is audited.
  const again = await summary(target.id, at);
  check(!again.json.activity.allTime.admin_view_account, 'admin viewing is not counted as the writer\'s activity');
  const adminRow = (await call(`${C}/admin/api/users?q=admin`, { token: at })).json.users.find(u => u.email === ADMIN);
  const adminSum = await summary(adminRow.id, at);
  const viewed = adminSum.json.activity.recent.find(e => e.action === 'admin_view_account');
  check(viewed && JSON.parse(viewed.detail).targetId === target.id, 'admin view is audited under the admin, naming the account');
} catch (err) {
  console.error('  FAIL  test crashed:', err);
  failed++;
}
process.exit(failed ? 1 : 0);
EOF

# Backend down: the rest of the summary still loads and says why storage is missing.
kill "$BPID" 2>/dev/null; wait "$BPID" 2>/dev/null
for i in $(seq 1 20); do curl -sf "http://127.0.0.1:$BACK/health" >/dev/null 2>&1 || break; sleep 0.5; done
node --input-type=module - <<'EOF' || FAIL=1
const { COLLAB, ADMIN, USER_EMAIL, PW } = process.env;
const C = `http://127.0.0.1:${COLLAB}`;
const j = async (u, o = {}) => (await fetch(C + u, { ...o, headers: { 'content-type': 'application/json', ...(o.headers || {}) } })).json();
const { accessToken } = await j('/auth/login', { method: 'POST', body: JSON.stringify({ email: ADMIN, password: PW }) });
const auth = { authorization: `Bearer ${accessToken}` };
const u = (await j('/admin/api/users?q=wendy', { headers: auth })).users[0];
const d = await (await fetch(`${C}/admin/api/users/${u.id}/summary`, { headers: auth })).json();
const ok = d.user?.email === USER_EMAIL && d.storage?.available === false && /unreachable|answered/.test(d.storage.error);
console.log(`  ${ok ? 'PASS' : 'FAIL'}  backend down: summary still loads, storage reports "${d.storage?.error}"`);
if (!ok) console.log('    response:', JSON.stringify(d).slice(0, 400), 'users:', u && u.email);
process.exit(ok ? 0 : 1);
EOF
if [[ "${KEEP:-}" == "1" ]]; then
  (cd "$ROOT/backend" && exec env OPENDRAFT_DATA_DIR="$OUT/backend" COLLAB_JWT_SECRET="$SECRET" \
    COLLAB_DB_PATH="$OUT/collab/collab.sqlite3" "$ROOT/venv/bin/python" -m uvicorn app.main:app \
    --host 127.0.0.1 --port $BACK >>"$OUT/backend.log" 2>&1) & BPID=$!
fi

[[ $FAIL == 0 ]] && echo "ALL CHECKS PASSED" || { echo "SOME CHECKS FAILED (logs in $OUT)"; exit 1; }
