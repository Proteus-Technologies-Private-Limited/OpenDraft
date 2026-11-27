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

describe('regions where paragraphs were added or removed', () => {
  const lines = (...words: string[]) => doc(words.map(word => p('action', word)));

  it('takes a deletion, an edit to the next paragraph and an addition after it from their own sides', () => {
    // Removed A and added N on the device; edited B in the cloud.
    const result = mergeScripts(lines('A', 'B'), lines('B', 'N'), lines('A', 'B2'));
    expect(result.conflicts).toHaveLength(0);
    expect(texts(applyMerge(result, {}))).toEqual(['B2', 'N']);
  });

  it('still asks when both sides changed the same paragraph', () => {
    const result = mergeScripts(lines('A', 'B', 'C'), lines('B', 'Cd'), lines('A', 'B', 'Cc'));
    expect(result.conflicts).toHaveLength(1);
    const conflict = result.conflicts[0];
    expect(conflict.kind === 'text' && [conflict.device.length, conflict.cloud.length]).toEqual([1, 1]);
    expect(texts(applyMerge(result, { [conflict.id]: 'device' }))).toEqual(['B', 'Cd']);
    expect(texts(applyMerge(result, { [conflict.id]: 'cloud' }))).toEqual(['B', 'Cc']);
  });

  /**
   * Every pair of edits to a three-paragraph script: each side keeps, edits or
   * removes each paragraph, may add one of its own, and may move paragraphs.
   * Checked for every way of settling the conflicts:
   * - nothing either side wrote is lost without being asked about;
   * - a paragraph both sides kept appears exactly once;
   * - unless a side moved paragraphs, no paragraph appears in two versions.
   */
  it('never loses or duplicates a paragraph in any pair of edits to a short script', () => {
    const baseWords = ['A', 'B', 'C'];
    const variants = (side: 'd' | 'c') => {
      const pool = [...baseWords, ...baseWords.map(word => word + side), 'N' + side];
      const out: string[][] = [];
      const grow = (current: string[]) => {
        out.push(current);
        if (current.length === 4) return;
        for (const word of pool) {
          if (current.some(other => other[0] === word[0])) continue; // one version of each paragraph
          grow([...current, word]);
        }
      };
      grow([]);
      return out;
    };
    // Versions of one base paragraph share a family; each added paragraph is its own.
    const family = (word: string) => (word[0] === 'N' ? word : word[0]);
    const moved = (words: string[]) => {
      const order = words.map(family).filter(f => baseWords.includes(f));
      return order.some((f, i) => i > 0 && order[i - 1] > f);
    };
    const failures: string[] = [];
    const devices = variants('d'), clouds = variants('c');
    for (const device of devices) {
      for (const cloud of clouds) {
        const result = mergeScripts(lines(...baseWords), lines(...device), lines(...cloud));
        const settle = (choice: 'device' | 'cloud' | 'both') => {
          const out = texts(applyMerge(result, Object.fromEntries(result.conflicts.map(c => [c.id, choice]))));
          return out.length === 1 && out[0] === '' ? [] : out;
        };
        const label = `${device.join('')}|${cloud.join('')}`;
        const both = settle('both');
        for (const word of [...device, ...cloud]) {
          if (!baseWords.includes(word) && !both.includes(word)) failures.push(`${label}: lost ${word}`);
        }
        for (const choice of ['device', 'cloud', 'both'] as const) {
          const out = choice === 'both' ? both : settle(choice);
          for (const word of baseWords) {
            if (device.includes(word) && cloud.includes(word) && !moved(device) && !moved(cloud)
              && out.filter(w => w === word).length !== 1) {
              failures.push(`${label}: ${word} kept by both appears ${out.filter(w => w === word).length} times (${choice})`);
            }
          }
          if (choice !== 'both' && !moved(device) && !moved(cloud)) {
            const families = out.map(family);
            if (new Set(families).size !== families.length) failures.push(`${label}: duplicated in ${out.join('')} (${choice})`);
          }
        }
      }
    }
    expect(devices.length * clouds.length).toBeGreaterThan(10_000);
    expect(failures.slice(0, 20)).toEqual([]);
  }, 120_000);
});

describe('plugin data', () => {
  it('merges each plugin\'s data on its own', () => {
    const merged = autoMerge(
      doc([], { _pluginData: { a: { n: 1 }, b: { n: 1 } } }),
      doc([], { _pluginData: { a: { n: 2 }, b: { n: 1 } } }),
      doc([], { _pluginData: { a: { n: 1 }, b: { n: 3 }, c: { n: 1 } } }),
    );
    expect(merged?._pluginData).toEqual({ a: { n: 2 }, b: { n: 3 }, c: { n: 1 } });
  });

  it('asks only about a plugin both sides changed', () => {
    const result = mergeScripts(
      doc([], { _pluginData: { a: { n: 1 }, b: { n: 1 } } }),
      doc([], { _pluginData: { a: { n: 2 }, b: { n: 2 } } }),
      doc([], { _pluginData: { a: { n: 3 }, b: { n: 1 } } }),
    );
    expect(result.conflicts).toMatchObject([{ kind: 'item', key: '_pluginData', itemId: 'a' }]);
    const conflict = result.conflicts[0];
    expect(applyMerge(result, { [conflict.id]: 'cloud' })._pluginData).toEqual({ a: { n: 3 }, b: { n: 2 } });
    expect(applyMerge(result, { [conflict.id]: 'device' })._pluginData).toEqual({ a: { n: 2 }, b: { n: 2 } });
  });
});
