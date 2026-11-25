import { describe, expect, it } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import { applyMerge, autoMerge, diff3Regions, mergeComplete, mergeScripts, type ScriptContent } from './scriptMerge';

const p = (type: string, text: string): JSONContent => ({ type, content: text ? [{ type: 'text', text }] : [] });
const doc = (blocks: JSONContent[], meta: ScriptContent = {}): ScriptContent => ({ type: 'doc', content: blocks, ...meta });
const texts = (content: ScriptContent) => (content.content as JSONContent[]).map(b => b.content?.[0]?.text ?? '');

const base = doc([
  p('sceneHeading', 'INT. KITCHEN - DAY'),
  p('action', 'Anna makes coffee.'),
  p('character', 'ANNA'),
  p('dialogue', 'Morning.'),
  p('sceneHeading', 'EXT. STREET - NIGHT'),
  p('action', 'Rain.'),
]);

describe('diff3Regions', () => {
  it('finds stable runs and the regions between them', () => {
    const regions = diff3Regions(['a', 'b', 'c'], ['a', 'x', 'c'], ['a', 'b', 'c', 'd']);
    expect(regions.map(r => r.stable)).toEqual([true, false, true, false]);
  });
});

describe('mergeScripts', () => {
  it('takes edits to different scenes from both sides without asking', () => {
    const device = doc([...(base.content as JSONContent[]).slice(0, 1), p('action', 'Anna makes tea.'),
      ...(base.content as JSONContent[]).slice(2)]);
    const cloud = doc([...(base.content as JSONContent[]).slice(0, 5), p('action', 'Heavy rain.')]);
    const result = mergeScripts(base, device, cloud);
    expect(result.conflicts).toHaveLength(0);
    expect(result.autoFromDevice).toBe(1);
    expect(result.autoFromCloud).toBe(1);
    expect(texts(applyMerge(result, {}))).toEqual([
      'INT. KITCHEN - DAY', 'Anna makes tea.', 'ANNA', 'Morning.', 'EXT. STREET - NIGHT', 'Heavy rain.',
    ]);
    expect(autoMerge(base, device, cloud)).not.toBeNull();
  });

  it('reports different edits to the same paragraph as a conflict, with its scene', () => {
    const blocks = base.content as JSONContent[];
    const device = doc([...blocks.slice(0, 3), p('dialogue', 'Good morning.'), ...blocks.slice(4)]);
    const cloud = doc([...blocks.slice(0, 3), p('dialogue', 'Hey.'), ...blocks.slice(4)]);
    const result = mergeScripts(base, device, cloud);
    expect(result.conflicts).toHaveLength(1);
    const conflict = result.conflicts[0];
    expect(conflict.kind).toBe('text');
    if (conflict.kind !== 'text') return;
    expect(conflict.scene).toBe('INT. KITCHEN - DAY');
    expect(conflict.device.map(b => b.content?.[0]?.text)).toEqual(['Good morning.']);
    expect(conflict.cloud.map(b => b.content?.[0]?.text)).toEqual(['Hey.']);
    expect(autoMerge(base, device, cloud)).toBeNull();
    expect(mergeComplete(result, {})).toBe(false);

    expect(texts(applyMerge(result, { [conflict.id]: 'cloud' }))[3]).toBe('Hey.');
    expect(texts(applyMerge(result, { [conflict.id]: 'device' }))[3]).toBe('Good morning.');
    expect(texts(applyMerge(result, { [conflict.id]: 'both' })).slice(3, 5)).toEqual(['Good morning.', 'Hey.']);
  });

  it('takes an identical change once', () => {
    const blocks = base.content as JSONContent[];
    const both = doc([...blocks, p('action', 'THE END')]);
    const result = mergeScripts(base, both, both);
    expect(result.conflicts).toHaveLength(0);
    expect(result.identical).toBe(true);
    expect(texts(applyMerge(result, {})).filter(t => t === 'THE END')).toHaveLength(1);
  });

  it('keeps a deletion on one side when the other side left the paragraph alone', () => {
    const blocks = base.content as JSONContent[];
    const device = doc(blocks.filter((_, i) => i !== 1));
    const cloud = doc([...blocks, p('action', 'More rain.')]);
    const merged = autoMerge(base, device, cloud);
    expect(merged && texts(merged)).toEqual([
      'INT. KITCHEN - DAY', 'ANNA', 'Morning.', 'EXT. STREET - NIGHT', 'Rain.', 'More rain.',
    ]);
  });

  it('asks about every difference when no base is known', () => {
    const blocks = base.content as JSONContent[];
    const device = doc([...blocks.slice(0, 1), p('action', 'Anna makes tea.'), ...blocks.slice(2)]);
    const cloud = doc([...blocks.slice(0, 5), p('action', 'Heavy rain.')]);
    const result = mergeScripts(null, device, cloud);
    expect(result.twoWay).toBe(true);
    expect(result.conflicts.filter(c => c.kind === 'text')).toHaveLength(2);
    expect(autoMerge(null, device, cloud)).toBeNull();
  });

  it('keeps the parts of a conflict both sides wrote the same out of it', () => {
    const blocks = base.content as JSONContent[];
    const added = [p('character', 'BEN'), p('dialogue', 'Coffee?')];
    const device = doc([...blocks, ...added, p('dialogue', 'Yes.')]);
    const cloud = doc([...blocks, ...added, p('dialogue', 'No.')]);
    const result = mergeScripts(base, device, cloud);
    const conflict = result.conflicts[0];
    expect(conflict.kind === 'text' && conflict.device.length).toBe(1);
    expect(texts(applyMerge(result, { [conflict.id]: 'device' })).slice(-3)).toEqual(['BEN', 'Coffee?', 'Yes.']);
  });
});

describe('metadata', () => {
  const note = (id: string, text: string) => ({ id, text });

  it('merges notes record by record', () => {
    const b = doc(base.content as JSONContent[], { _notes: [note('a', 'one'), note('b', 'two')] });
    const d = doc(base.content as JSONContent[], { _notes: [note('a', 'one!'), note('b', 'two'), note('c', 'new here')] });
    const c = doc(base.content as JSONContent[], { _notes: [note('b', 'two'), note('d', 'new there')] });
    // a: changed on the device, deleted in the cloud → conflict.
    const result = mergeScripts(b, d, c);
    expect(result.conflicts).toHaveLength(1);
    const conflict = result.conflicts[0];
    expect(conflict.kind === 'item' && conflict.itemId).toBe('a');
    const kept = applyMerge(result, { [conflict.id]: 'device' })._notes as Array<{ id: string }>;
    expect(kept.map(n => n.id)).toEqual(['a', 'b', 'd', 'c']);
    const dropped = applyMerge(result, { [conflict.id]: 'cloud' })._notes as Array<{ id: string }>;
    expect(dropped.map(n => n.id)).toEqual(['b', 'd', 'c']);
  });

  it('labels a conflicting character profile by its name', () => {
    const profile = (bio: string) => ({ id: 'p1', name: 'ANNA', bio });
    const result = mergeScripts(
      doc([], { _characterProfiles: [profile('')] }),
      doc([], { _characterProfiles: [profile('Chef')] }),
      doc([], { _characterProfiles: [profile('Pilot')] }),
    );
    expect(result.conflicts[0]).toMatchObject({ kind: 'item', key: '_characterProfiles', label: 'ANNA' });
  });

  it('merges word lists as sets', () => {
    const merged = autoMerge(
      doc([], { _ignoredWords: ['a', 'b'] }),
      doc([], { _ignoredWords: ['a', 'b', 'c'] }),
      doc([], { _ignoredWords: ['b', 'd'] }),
    );
    expect(merged?._ignoredWords).toEqual(['b', 'c', 'd']);
  });

  it('asks about a setting both sides changed differently', () => {
    const result = mergeScripts(
      doc([], { _pageLayout: 'a4' }), doc([], { _pageLayout: 'letter' }), doc([], { _pageLayout: 'legal' }),
    );
    expect(result.conflicts).toMatchObject([{ kind: 'item', key: '_pageLayout' }]);
    const conflict = result.conflicts[0];
    expect(applyMerge(result, { [conflict.id]: 'cloud' })._pageLayout).toBe('legal');
  });

  it('takes a setting changed on one side', () => {
    const merged = autoMerge(
      doc([], { _sceneNumbersVisible: false }), doc([], { _sceneNumbersVisible: true }), doc([], { _sceneNumbersVisible: false }),
    );
    expect(merged?._sceneNumbersVisible).toBe(true);
  });
});

describe('neighbouring edits', () => {
  it('merges edits to adjacent paragraphs made on different sides', () => {
    const blocks = base.content as JSONContent[];
    const device = doc([...blocks.slice(0, 2), p('character', 'ANNA (V.O.)'), ...blocks.slice(3)]);
    const cloud = doc([...blocks.slice(0, 3), p('dialogue', 'Good morning.'), ...blocks.slice(4)]);
    const merged = autoMerge(base, device, cloud);
    expect(merged && texts(merged).slice(2, 4)).toEqual(['ANNA (V.O.)', 'Good morning.']);
  });
});
