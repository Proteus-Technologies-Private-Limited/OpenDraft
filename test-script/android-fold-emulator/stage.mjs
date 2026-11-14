import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { bridgeKept } from './protocol.mjs';

const variant = process.argv[2];
assert(['debug', 'minified'].includes(variant), 'variant must be debug or minified');
const mode = variant === 'debug' ? 'debug' : 'release';
const outputs = resolve('src-tauri/gen/android/app/build/outputs');
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
}
const apks = walk(join(outputs, 'apk')).filter(p => p.includes(`/${mode}/`) && p.endsWith('.apk') && !p.includes('unsigned') && !p.includes('androidTest'));
assert.equal(apks.length, 1, `Expected one signed ${mode} APK: ${apks.join(', ')}`);
const apk = apks[0];
const sdk = process.env.ANDROID_HOME;
assert(sdk, 'ANDROID_HOME is required');
const analyzer = join(sdk, 'cmdline-tools/latest/bin/apkanalyzer');
const debuggable = execFileSync(analyzer, ['manifest', 'debuggable', apk], { encoding: 'utf8', timeout: 120_000 }).trim();
assert.equal(debuggable, String(variant === 'debug'), 'Minified test APK must retain the release manifest flag');
const manifest = execFileSync(analyzer, ['manifest', 'print', apk], { encoding: 'utf8', timeout: 120_000 });
for (const activity of ['MainActivity', 'WindowActivity1', 'WindowActivity2', 'WindowActivity3']) assert(manifest.includes(activity), `${activity} missing from APK manifest`);
const entries = execFileSync('unzip', ['-Z1', apk], { encoding: 'utf8', timeout: 30_000 });
assert(entries.includes('lib/x86_64/libopendraft_lib.so'), 'Expected real OpenDraft x86_64 Rust library');
const out = resolve('test-script/output/android-fold-apk', variant);
mkdirSync(out, { recursive: true });
if (variant === 'minified') {
  const maps = walk(join(outputs, 'mapping')).filter(p => p.endsWith('/mapping.txt'));
  assert.equal(maps.length, 1, 'Expected a single R8 mapping');
  assert(bridgeKept(readFileSync(maps[0], 'utf8')), 'R8 did not retain the native snapshot class/method name');
  cpSync(maps[0], join(out, 'mapping.txt'));
}
cpSync(apk, join(out, 'test-only.apk'));
const metadata = { variant, buildSha: process.env.GITHUB_SHA ?? 'local', debuggable: debuggable === 'true', minified: variant === 'minified',
  inspection: 'CI-generated WebView hook only; not a distributable APK', sha256: createHash('sha256').update(readFileSync(apk)).digest('hex') };
writeFileSync(join(out, 'build.json'), JSON.stringify(metadata, null, 2) + '\n');
console.log(JSON.stringify(metadata));
