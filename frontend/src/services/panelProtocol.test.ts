import { describe, expect, it } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { isSnapshot, navigationPosition, sameSceneSummary, sceneSummary, type NavigatorSnapshot } from './panelProtocol';
const schema = new Schema({ nodes: {
  doc: { content: 'block*' }, text: { group: 'inline' }, action: { group: 'block', content: 'inline*' },
  sceneHeading: { group: 'block', content: 'inline*', attrs: { synopsis: { default: '' }, sceneColor: { default: '' }, sceneNumber: { default: null } } },
} });
const doc = schema.node('doc', null, [
  schema.node('sceneHeading', { synopsis: 'Waiting', sceneColor: '#123456' }, schema.text('INT. ROOM - DAY')),
  schema.node('action', null, schema.text('Private action text is not sent')),
  schema.node('sceneHeading', { sceneNumber: '12A', sceneColor: 'url(bad)' }, schema.text('EXT. STREET - NIGHT')),
]);
const snapshot = (): NavigatorSnapshot => ({ session: 'one', revision: 2, sequence: 4, sceneRevision: 1, title: 'A script', windowTitle: 'Navigator — A script', ...sceneSummary(doc, doc.content.size - 1), appearance: 'dark', language: 'en' });
describe('read-only panel protocol', () => {
  it('extracts headings/synopses without adding IDs or changing the document', () => {
    const before = doc.toJSON(), s = sceneSummary(doc, doc.content.size - 1);
    expect(s.scenes).toHaveLength(2); expect(s.active).toBe(1);
    expect(s.scenes[1]).toEqual({ heading: 'EXT. STREET - NIGHT', synopsis: '', number: '12A', color: '' });
    expect(JSON.stringify(s)).not.toContain('Private action'); expect(doc.toJSON()).toEqual(before); expect(isSnapshot(snapshot())).toBe(true);
  });
  it('detects summary changes without comparing document positions', () => {
    const { scenes } = sceneSummary(doc, 1);
    expect(sameSceneSummary(scenes, scenes.map(scene => ({ ...scene })))).toBe(true);
    expect(sameSceneSummary(scenes, scenes.slice(1))).toBe(false);
    expect(sameSceneSummary(scenes, [{ ...scenes[0], synopsis: 'Changed' }, scenes[1]])).toBe(false);
  });
  it('rejects old sessions/revisions and invalid scene indexes', () => {
    const action = { kind: 'navigate' as const, revision: 2, index: 1 }, positions = sceneSummary(doc, 1).positions;
    expect(navigationPosition({ session: 'one', action }, 'one', 2, positions)).toBe(positions[1]);
    expect(navigationPosition({ session: 'old', action }, 'one', 2, positions)).toBeNull();
    expect(navigationPosition({ session: 'one', action }, 'one', 3, positions)).toBeNull();
    for (const index of [-1, 2, 0.5, NaN]) expect(navigationPosition({ session: 'one', action: { ...action, index } }, 'one', 2, positions)).toBeNull();
  });
  it('rejects malformed snapshots and supports empty scripts', () => {
    for (const patch of [{ active: 99 }, { revision: -1 }, { sequence: NaN }, { appearance: 'invalid' }, { language: 'xx' }, { scenes: [null] }]) expect(isSnapshot({ ...snapshot(), ...patch })).toBe(false);
    expect(isSnapshot({ ...snapshot(), scenes: [], active: -1 })).toBe(true); expect(isSnapshot(null)).toBe(false);
  });
});
