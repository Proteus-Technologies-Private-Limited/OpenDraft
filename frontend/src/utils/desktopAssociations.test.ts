import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
const read = (name: string) =>
  readFileSync(new URL(`../../../src-tauri/${name}`, import.meta.url), 'utf8');
const config = JSON.parse(read('tauri.conf.json'));
const windows = JSON.parse(read('tauri.windows.conf.json'));
const linux = JSON.parse(read('tauri.linux.conf.json'));
const external = [
  'fdx',
  'fadein',
  'fountain',
  'osf',
  'highland',
  'wdz',
  'celtx',
];
describe('installer association ownership', () => {
  it('claims native ownership and only alternate status for external screenplay formats', () => {
    const entries = config.bundle.fileAssociations as Array<{
      ext: string[];
      rank: string;
    }>;
    expect(entries.flatMap((e) => e.ext)).not.toContain('txt');
    expect(entries.find((e) => e.ext.includes('odraft'))?.rank).toBe('Owner');
    for (const ext of external)
      expect(entries.find((e) => e.ext.includes(ext))?.rank).toBe('Alternate');
  });
  it('keeps external formats out of Tauri’s automatic Windows default registration', () => {
    expect(
      windows.bundle.fileAssociations.flatMap((e: { ext: string[] }) => e.ext),
    ).toEqual(['odraft']);
  });
  it('restricts MSI registry entries to owned ProgIDs and named Open With values', () => {
    const xml = new DOMParser().parseFromString(
      read('open-with.wxs'),
      'application/xml',
    );
    const entries = Array.from(xml.getElementsByTagName('RegistryValue'));
    expect(entries).toHaveLength(external.length * 3);
    for (const entry of entries) {
      const key = entry.getAttribute('Key')!;
      expect(key).not.toContain('UserChoice');
      expect(key).not.toContain('.txt');
      if (key.includes('\\.')) {
        expect(key).toMatch(
          /\\\.(fdx|fadein|fountain|osf|highland|wdz|celtx)\\OpenWithProgids$/,
        );
        expect(entry.getAttribute('Name')).toMatch(/^OpenDraft\.Alternative\./);
      } else
        expect(key).toMatch(/^Software\\Classes\\OpenDraft\.Alternative\./);
    }
    // These components sit in Tauri's "External" feature, the exe in
    // "MainProgram". A [#Path] reference across features is ICE69 error, which
    // fails light.exe and the whole MSI (v2.8.1's first build). [!Path] is what
    // Tauri's own template uses for the same command.
    for (const entry of entries) {
      const value = entry.getAttribute('Value') ?? '';
      expect(value).not.toContain('[#Path]');
      if (entry.getAttribute('Key')!.endsWith('\\shell\\open\\command'))
        expect(value).toBe('"[!Path]" "%1"');
    }
    const refs = windows.bundle.windows.wix.componentRefs;
    const components = Array.from(xml.getElementsByTagName('Component')).map(
      (e) => e.getAttribute('Id'),
    );
    expect(components.sort()).toEqual([...refs].sort());
  });
  it('keeps NSIS registrations to its own named entries, outside the 2.8.0 cleanup', () => {
    const hooks = read('nsis-hooks.nsh');
    expect(hooks).not.toMatch(/UserChoice/);
    // Everything after the legacy cleanup macro is the current installer's own.
    const own = hooks.slice(hooks.indexOf('!macro OpenDraftRemoveLegacyAssociations'));
    for (const line of own
      .split('\n')
      .filter((l) => /WriteRegStr|DeleteReg/.test(l))) {
      expect(line).toMatch(/OpenDraft\.Alternative|OpenWithProgids/);
    }
  });
  it('undoes 2.8.0\'s associations only where they are still its own, and never sets OpenDraft as a default', () => {
    const hooks = read('nsis-hooks.nsh');
    const start = hooks.indexOf('!macro OpenDraftRemoveLegacyAssociation ');
    const legacy = hooks.slice(start, hooks.indexOf('!macroend', start));
    // Guarded by the exact open command 2.8.0's installer wrote for this copy.
    expect(legacy).toContain("${If} $R0 == '$INSTDIR\\${MAINBINARYNAME}.exe $\\\"%1$\\\"'");
    // The only default it writes is the one it restores ($R2: the backup or Windows' own).
    const writes = legacy.split('\n').filter((l) => /WriteRegStr/.test(l));
    expect(writes).toEqual([expect.stringContaining('"Software\\Classes\\.${EXT}" "" "$R2"')]);
    // Every extension 2.8.0 registered is cleaned up, on update and on uninstall.
    for (const ext of [...external, 'txt'])
      expect(hooks).toMatch(new RegExp(`OpenDraftRemoveLegacyAssociation ${ext} `));
    expect(hooks).toMatch(/OpenDraftRemoveLegacyAssociation txt "txtfile"/);
    for (const hook of ['NSIS_HOOK_POSTINSTALL', 'NSIS_HOOK_PREUNINSTALL']) {
      const body = hooks.slice(hooks.indexOf(`!macro ${hook}`));
      expect(body.slice(0, body.indexOf('!macroend'))).toContain('OpenDraftRemoveLegacyAssociations');
    }
  });
});

describe('Linux file types', () => {
  const entries = linux.bundle.fileAssociations as Array<{ ext: string[]; mimeType: string }>;
  const mime = new DOMParser().parseFromString(read('linux/opendraft-mime.xml'), 'application/xml');
  const types = Array.from(mime.getElementsByTagName('mime-type'));
  it('never claims generic text, XML, ZIP or JSON files', () => {
    for (const { mimeType } of entries)
      expect(['text/plain', 'application/xml', 'application/zip', 'application/json']).not.toContain(mimeType);
    expect(entries.flatMap((e) => e.ext)).not.toContain('txt');
  });
  it('defines its own type for every extension it lists', () => {
    expect(entries.flatMap((e) => e.ext).sort()).toEqual(['odraft', ...external].sort());
    for (const { ext, mimeType } of entries) {
      const def = types.find((t) => t.getAttribute('type') === mimeType);
      expect(def, mimeType).toBeDefined();
      const globs = Array.from(def!.getElementsByTagName('glob')).map((g) => g.getAttribute('pattern'));
      expect(globs).toEqual(ext.map((e) => `*.${e}`));
      expect(def!.getElementsByTagName('sub-class-of')).toHaveLength(1);
    }
  });
  it('installs the types with every Linux package and passes the opened file', () => {
    const { deb, rpm, appimage } = linux.bundle.linux;
    for (const pkg of [deb, rpm, appimage])
      expect(pkg.files['/usr/share/mime/packages/opendraft.xml']).toBe('linux/opendraft-mime.xml');
    expect(deb.desktopTemplate).toBe('linux/opendraft.desktop');
    expect(rpm.desktopTemplate).toBe('linux/opendraft.desktop');
    expect(read('linux/opendraft.desktop')).toMatch(/^Exec=\{\{exec\}\} %F$/m);
  });
});
