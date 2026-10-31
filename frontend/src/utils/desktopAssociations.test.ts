import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
const read = (name: string) =>
  readFileSync(new URL(`../../../src-tauri/${name}`, import.meta.url), 'utf8');
const config = JSON.parse(read('tauri.conf.json'));
const windows = JSON.parse(read('tauri.windows.conf.json'));
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
    const refs = windows.bundle.windows.wix.componentRefs;
    const components = Array.from(xml.getElementsByTagName('Component')).map(
      (e) => e.getAttribute('Id'),
    );
    expect(components.sort()).toEqual([...refs].sort());
  });
  it('keeps NSIS uninstall scoped to its own named registrations', () => {
    const hooks = read('nsis-hooks.nsh');
    expect(hooks).not.toMatch(/UserChoice|\\\.txt/);
    for (const line of hooks
      .split('\n')
      .filter((l) => /WriteRegStr|DeleteReg/.test(l))) {
      expect(line).toMatch(/OpenDraft\.Alternative|OpenWithProgids/);
    }
  });
});
