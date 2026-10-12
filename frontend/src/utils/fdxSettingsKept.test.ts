/**
 * A Final Draft file's own settings sections, kept while the settings they were
 * read into are unchanged, and regenerated once one of them is not.
 */
import { describe, it, expect } from 'vitest';
import { exportFDX } from './fdxExporter';
import { mergeFdxRaw, settingsSignature, type FdxRaw } from './fdxPreserve';

const scene = { type: 'sceneHeading', content: [{ type: 'text', text: 'INT. HOUSE - DAY' }] };
const generated = () => exportFDX(
  { type: 'doc', content: [scene] } as Parameters<typeof exportFDX>[0],
  'T',
  [{ name: 'ANSA', description: '', color: '', highlighted: false } as never],
);

const font = { family: 'Courier Final Draft', size: 12 };
const profiles = [{ name: 'ANSA', description: '' }];
const opened = settingsSignature({ a: 1 }, font, profiles);
const raw: FdxRaw = {
  version: '6',
  sections: {},
  settings: {
    PageLayout: '<PageLayout Original="yes"><AutoCastList/></PageLayout>',
    ElementSettings: '<ElementSettings Type="General"/>\n  <ElementSettings Type="Action"/>',
    HeaderAndFooter: '<HeaderAndFooter Original="yes"/>',
    CastList: '<CastList SortOption="Alphabetical"><CustomOrder/></CastList>',
  },
  sig: opened,
};

describe('a file\'s own settings sections, on save', () => {
  it('goes back as the file had it while the settings are unchanged', () => {
    const out = mergeFdxRaw(generated(), raw, settingsSignature({ a: 1 }, font, profiles));
    expect(out).toContain('<PageLayout Original="yes"><AutoCastList/></PageLayout>');
    expect(out).toContain('<ElementSettings Type="Action"/>');
    expect(out).toContain('<HeaderAndFooter Original="yes"/>');
    expect(out).toContain('<CastList SortOption="Alphabetical"><CustomOrder/></CastList>');
    expect(out).not.toContain('<PageLayout BackgroundColor');
    expect(out).not.toContain('<ElementSettings Type="Scene Heading">');
  });

  it('is regenerated from the app once the page layout or font has been changed', () => {
    const out = mergeFdxRaw(generated(), raw, settingsSignature({ a: 2 }, font, profiles));
    expect(out).toContain('<PageLayout BackgroundColor');
    expect(out).toContain('<ElementSettings Type="Scene Heading">');
    expect(out).not.toContain('Original="yes"');
    // The cast list depends on the character descriptions, which did not change.
    expect(out).toContain('<CastList SortOption="Alphabetical">');
  });

  it('is regenerated when a character description has changed', () => {
    const out = mergeFdxRaw(generated(), raw, settingsSignature({ a: 1 }, font, [{ name: 'ANSA', description: 'Tall' }]));
    expect(out).toContain('<PageLayout Original="yes">');
    expect(out).not.toContain('SortOption');
  });

  it('leaves the generated sections alone for a file opened before this was kept', () => {
    const older: FdxRaw = { version: '6', sections: {} };
    const out = mergeFdxRaw(generated(), older, opened);
    expect(out).toContain('<PageLayout BackgroundColor');
  });
});
