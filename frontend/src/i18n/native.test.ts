/**
 * The native shells declare the same languages the app ships.
 *
 * macOS and iOS read CFBundleLocalizations (so system menus and file dialogs
 * follow the app's languages), and Android 13+ reads locales_config.xml (its
 * per-app language setting). All three are written by hand outside the
 * frontend, so a language added to languages.ts and forgotten there would
 * silently not appear in the OS.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LANGUAGES } from './languages';

const ROOT = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const shipped = LANGUAGES.map((l) => l.code).sort();

function bundleLocalizations(plist: string): string[] {
  const m = /<key>CFBundleLocalizations<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(plist);
  if (!m) return [];
  return [...m[1].matchAll(/<string>([^<]+)<\/string>/g)].map((x) => x[1]).sort();
}

describe('native language declarations', () => {
  it('macOS Info.plist lists every shipped language', () => {
    expect(bundleLocalizations(read('src-tauri/Info.plist'))).toEqual(shipped);
  });

  it('iOS Info.ios.plist lists every shipped language', () => {
    expect(bundleLocalizations(read('src-tauri/Info.ios.plist'))).toEqual(shipped);
  });

  it('declares English as the development region', () => {
    for (const f of ['src-tauri/Info.plist', 'src-tauri/Info.ios.plist']) {
      expect(read(f)).toMatch(/<key>CFBundleDevelopmentRegion<\/key>\s*<string>en<\/string>/);
    }
  });

  it('Android locales_config.xml lists every shipped language', () => {
    const xml = read('src-tauri/android-src/locales_config.xml');
    const names = [...xml.matchAll(/<locale\s+android:name="([^"]+)"/g)]
      // Android writes the Brazilian variant as pt-BR; the app's code is pt.
      .map((m) => m[1].replace(/^pt-BR$/, 'pt'))
      .sort();
    expect(names).toEqual(shipped);
  });

  it('both Android build paths install the locale config and point the manifest at it', () => {
    const ci = read('.github/workflows/release.yml');
    expect(ci).toContain('src-tauri/android-src/locales_config.xml');
    expect(ci).toContain('android:localeConfig="@xml/locales_config"');
    const local = read('test-script/patch-android-local.py');
    expect(local).toContain('locales_config.xml');
    expect(local).toContain('android:localeConfig="@xml/locales_config"');
  });
});
