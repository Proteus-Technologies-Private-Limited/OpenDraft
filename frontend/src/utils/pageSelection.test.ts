/**
 * What the Sides dialog builds from a choice — the one selection that both
 * Export and Print hand to the PDF exporter.
 */
import { describe, it, expect } from 'vitest';
import type { JSONContent } from '@tiptap/react';
import { buildPageSelection } from './pageSelection';

const el = (type: string, text: string, attrs?: Record<string, unknown>, marks?: JSONContent['marks']): JSONContent => ({
  type, content: [{ type: 'text', text, ...(marks ? { marks } : {}) }], ...(attrs ? { attrs } : {}),
});

const script: JSONContent = {
  type: 'doc',
  content: [
    el('sceneHeading', 'INT. KITCHEN - NIGHT', { sceneNumber: '4' }),
    el('character', 'MAYA'),
    el('dialogue', 'Hi.'),
    el('sceneHeading', 'EXT. ROOF - DAY', { sceneNumber: '7A' }),
    el('action', 'A prop.', undefined, [{ type: 'productionTag', attrs: { tagId: 'tag-1' } }]),
    el('sceneHeading', 'INT. KITCHEN - LATER'),
    el('character', 'DEV'),
    el('dialogue', 'Bye.'),
  ],
};
const indices = (keep: (i: number) => boolean) => (script.content ?? []).map((_, i) => i).filter(keep);

describe('buildPageSelection', () => {
  it('builds sides from the ticked scenes, named by their numbers', () => {
    const built = buildPageSelection(script, { mode: 'sides', scenes: new Set([1, 0]), crossOut: true })!;
    expect(built.suffix).toBe('Sides (Sc. 4, 7A)');
    expect(built.selection.crossOutOthers).toBe(true);
    expect(built.selection.twoUp).toBeUndefined();
    expect(indices(built.selection.keep)).toEqual([0, 1, 2, 3, 4]);
  });

  it('is not ready until something is chosen', () => {
    expect(buildPageSelection(script, { mode: 'sides', scenes: new Set(), crossOut: true })).toBeNull();
    expect(buildPageSelection(script, { mode: 'sides', scenes: new Set([9]), crossOut: true })).toBeNull();
    expect(buildPageSelection(script, { mode: 'character', character: '' })).toBeNull();
    expect(buildPageSelection(script, { mode: 'location', location: '' })).toBeNull();
    expect(buildPageSelection(script, { mode: 'tag', label: 'Props: Gun', tagIds: [] })).toBeNull();
  });

  it('keeps a character, a location or a tag, with a message for when nothing matches', () => {
    const maya = buildPageSelection(script, { mode: 'character', character: 'MAYA' })!;
    expect(indices(maya.selection.keep)).toEqual([1, 2]);
    expect(maya.suffix).toBe('Pages with MAYA');
    expect(maya.selection.emptyMessage).toBe('MAYA has no lines in this script.');

    const kitchen = buildPageSelection(script, { mode: 'location', location: 'KITCHEN' })!;
    expect(indices(kitchen.selection.keep)).toEqual([0, 1, 2, 5, 6, 7]);
    expect(kitchen.suffix).toBe('Pages at KITCHEN');

    const prop = buildPageSelection(script, { mode: 'tag', label: 'Props: Gun', tagIds: ['tag-1'] })!;
    expect(indices(prop.selection.keep)).toEqual([4]);
    // A colon cannot go in a file name.
    expect(prop.suffix).toBe('Pages with Props - Gun');
  });

  it('marks a two-up selection, and says so in the file name', () => {
    const built = buildPageSelection(script, { mode: 'character', character: 'DEV' }, { twoUp: true })!;
    expect(built.selection.twoUp).toBe(true);
    expect(built.suffix).toBe('Pages with DEV 2-up');
    expect(indices(built.selection.keep)).toEqual([6, 7]);
  });
});
