/**
 * The admin console's add-on defaults (collab-server/src/routes/admin.ts and
 * collab-server/src/admin/page.ts).
 *
 * A default is tri-state: true, false, or null to clear the admin's choice so
 * the add-on's own default decides. Anything else is refused before the
 * backend is asked. The page's script must still parse, and the add-on row it
 * renders must escape every string it shows.
 *
 *   cd collab-server && NODE_PATH=$PWD/node_modules JWT_SECRET=test ADMIN_EMAILS=a@example.com \
 *     npx ts-node -P tsconfig.json --transpile-only ../test-script/collab-admin-plugin-defaults.ts
 */
import * as assert from 'assert';
import * as vm from 'vm';
import { parsePluginDefaultUpdate } from '../collab-server/src/routes/admin';
import { ADMIN_PAGE_HTML } from '../collab-server/src/admin/page';

let failures = 0;
function check(what: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok  ${what}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${what}: ${(err as Error).message}`);
  }
}

// ── Validation ──
for (const value of [true, false, null]) {
  check(`defaultEnabled ${JSON.stringify(value)} is accepted`, () => {
    assert.deepStrictEqual(parsePluginDefaultUpdate('od-sidekick', { defaultEnabled: value }),
      { ok: true, pluginId: 'od-sidekick', defaultEnabled: value });
  });
}
for (const value of ['true', 'false', 'null', 1, 0, '', [], {}, undefined]) {
  check(`defaultEnabled ${JSON.stringify(value) ?? 'undefined'} is refused`, () => {
    assert.strictEqual(parsePluginDefaultUpdate('od-sidekick', { defaultEnabled: value }).ok, false);
  });
}
check('a body without defaultEnabled is refused, not read as null', () => {
  assert.strictEqual(parsePluginDefaultUpdate('od-sidekick', {}).ok, false);
});
check('a body that is not an object is refused', () => {
  for (const body of [null, undefined, 'x', [true], true]) {
    assert.strictEqual(parsePluginDefaultUpdate('od-sidekick', body).ok, false, JSON.stringify(body));
  }
});
check('unexpected fields are refused and named', () => {
  const r = parsePluginDefaultUpdate('od-sidekick', { defaultEnabled: null, extra: 1 });
  assert.strictEqual(r.ok, false);
  assert.match((r as { error: string }).error, /extra/);
});
check('plugin ids are lower-case letters, digits and hyphens', () => {
  for (const id of ['Od-Sidekick', '-x', '../x', 'a/b', '', undefined, 'a'.repeat(65)]) {
    assert.strictEqual(parsePluginDefaultUpdate(id, { defaultEnabled: true }).ok, false, String(id));
  }
});

// ── The page ──
const scripts = [...ADMIN_PAGE_HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
check('the page has its inline script', () => assert.ok(scripts.length > 0));
check('the page script parses', () => {
  for (const s of scripts) new vm.Script(s);
});
check('the page offers Enabled, Disabled and the add-on’s own default', () => {
  assert.match(ADMIN_PAGE_HTML, /opt\('true','Enabled'\)/);
  assert.match(ADMIN_PAGE_HTML, /opt\('false','Disabled'\)/);
  assert.match(ADMIN_PAGE_HTML, /opt\('default','Add-on\\u2019s own default/);
});
check('the page says a default never switches on an add-on that sends data or needs settings', () => {
  assert.match(ADMIN_PAGE_HTML, /never switches on an add-on that sends data off/);
});

// Run the row renderer on its own, with the page's esc().
const source = scripts.join('\n');
function extract(name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} is defined`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${name} has no end`);
}
const sandbox: Record<string, any> = {};
check('the add-on row helpers run on their own', () => {
  vm.runInNewContext(
    ['esc', 'pluginChoice', 'pluginOwnDefault', 'pluginInEffect', 'pluginRow'].map(extract).join('\n') +
      '\nthis.pluginRow=pluginRow;this.pluginChoice=pluginChoice;',
    sandbox,
  );
  assert.strictEqual(typeof sandbox.pluginRow, 'function');
});
function selected(html: string): string | undefined {
  return /<option value="([a-z]+)" selected>/.exec(html)?.[1];
}
check('no admin choice selects the add-on’s own default, with what that is', () => {
  const on = sandbox.pluginRow({ id: 'a', name: 'A', version: '1', defaultEnabled: true, adminDefault: null, manifestDefault: true });
  assert.strictEqual(selected(on), 'default');
  assert.match(on, /own default \(on\)/);
  const none = sandbox.pluginRow({ id: 'a', name: 'A', version: '1', defaultEnabled: null, adminDefault: null, manifestDefault: null });
  assert.strictEqual(selected(none), 'default', 'null is not shown as Disabled');
  assert.match(none, /own default \(none set\)/);
  assert.match(none, /plain add-on starts on/);
});
check('an admin choice selects Enabled or Disabled', () => {
  assert.strictEqual(selected(sandbox.pluginRow({ id: 'a', name: 'A', version: '1', defaultEnabled: true, adminDefault: true, manifestDefault: false })), 'true');
  assert.strictEqual(selected(sandbox.pluginRow({ id: 'a', name: 'A', version: '1', defaultEnabled: false, adminDefault: false, manifestDefault: true })), 'false');
});
check('an older backend without adminDefault falls back to the default in effect', () => {
  assert.strictEqual(selected(sandbox.pluginRow({ id: 'a', name: 'A', version: '1', defaultEnabled: false })), 'false');
});
check('every string in the row is escaped', () => {
  const html = sandbox.pluginRow({ id: 'x"><img src=x>', name: '<script>alert(1)</script>', version: '"1"', defaultEnabled: null, adminDefault: null, manifestDefault: null });
  assert.ok(!html.includes('<script>') && !html.includes('<img'), html);
  assert.ok(html.includes('&lt;script&gt;') && html.includes('&quot;1&quot;'), html);
});

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll admin add-on default checks passed');
