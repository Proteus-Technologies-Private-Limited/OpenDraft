/**
 * Element numbers in the editor (editor/extensions/ElementNumbers).
 *
 * The labels are decorations computed from the whole document, so inserting a
 * line must renumber every line below it — the sibling-staleness bug
 * avCueDecorations.test.ts guards against for AV shots — and the format's
 * numbering, which is not in the document, must be able to ask for a recount.
 */
import { describe, it, expect } from 'vitest';
import { EditorState, type Plugin } from '@tiptap/pm/state';
import type { DecorationSet } from '@tiptap/pm/view';
import type { JSONContent } from '@tiptap/react';
import { testSchema, doc, block } from '../test/screenplaySchema';
import {
  ElementNumbers, elementNumbersPluginKey, ELEMENT_NUMBERS_REFRESH, type ElementNumbersOptions,
} from './extensions/ElementNumbers';
import type { NumberingRules } from '../utils/elementNumbers';

function stateFor(json: JSONContent, opts: ElementNumbersOptions): EditorState {
  const plugins = (ElementNumbers.config.addProseMirrorPlugins as () => Plugin[]).call(
    { name: 'elementNumbers', options: opts, storage: {}, editor: null } as never,
  );
  return EditorState.create({ doc: testSchema.nodeFromJSON(json), schema: testSchema, plugins });
}

/** [text of the numbered node, its label], in document order. */
function labelsOf(state: EditorState): Array<[string, string]> {
  const set = elementNumbersPluginKey.getState(state) as DecorationSet;
  return set.find().map((deco) => {
    const d = deco as unknown as { from: number; type: { attrs: Record<string, string> } };
    return [state.doc.nodeAt(d.from)?.textContent ?? '', d.type.attrs['data-element-number']];
  });
}

const DIALOGUE: NumberingRules = { dialogue: { enabled: true, resetOn: [] } };

describe('ElementNumbers decorations', () => {
  it('numbers the elements the format numbers', () => {
    const s = stateFor(doc(block('character', 'A'), block('dialogue', 'one'), block('character', 'B'), block('dialogue', 'two')),
      { getRules: () => DIALOGUE, getSceneNumbersVisible: () => false });
    expect(labelsOf(s)).toEqual([['one', '1'], ['two', '2']]);
  });

  it('renumbers every line below an inserted one', () => {
    const s = stateFor(doc(block('dialogue', 'one'), block('dialogue', 'two'), block('dialogue', 'three')),
      { getRules: () => DIALOGUE, getSceneNumbersVisible: () => false });
    const fresh = testSchema.nodes.dialogue.create(null, testSchema.text('new'));
    const next = s.apply(s.tr.insert(0, fresh));
    expect(labelsOf(next)).toEqual([['new', '1'], ['one', '2'], ['two', '3'], ['three', '4']]);
  });

  it('draws nothing and walks nothing when the format numbers nothing', () => {
    let walked = 0;
    const s = stateFor(doc(block('dialogue', 'one')), {
      getRules: () => { walked++; return {}; },
      getSceneNumbersVisible: () => false,
    });
    expect(labelsOf(s)).toEqual([]);
    // A cursor move is not a change: the rules are not even asked for again.
    const before = walked;
    s.apply(s.tr.setMeta('anything', true));
    expect(walked).toBe(before);
  });

  it('recounts on a refresh when the format changes, not before', () => {
    let rules: NumberingRules = {};
    const s = stateFor(doc(block('dialogue', 'one')), { getRules: () => rules, getSceneNumbersVisible: () => false });
    expect(labelsOf(s)).toEqual([]);
    rules = DIALOGUE;
    expect(labelsOf(s.apply(s.tr.setMeta('unrelated', true)))).toEqual([]);
    expect(labelsOf(s.apply(s.tr.setMeta(ELEMENT_NUMBERS_REFRESH, true)))).toEqual([['one', '1']]);
  });

  it('keeps the document itself untouched', () => {
    const json = doc(block('dialogue', 'one'));
    const s = stateFor(json, { getRules: () => DIALOGUE, getSceneNumbersVisible: () => false });
    expect(s.doc.toJSON()).toEqual(testSchema.nodeFromJSON(json).toJSON());
    expect(JSON.stringify(s.doc.toJSON())).not.toContain('elementNumber');
  });

  it('survives rules it cannot read', () => {
    const s = stateFor(doc(block('dialogue', 'one')), {
      getRules: () => { throw new Error('store not ready'); },
      getSceneNumbersVisible: () => false,
    });
    expect(labelsOf(s)).toEqual([]);
  });
});
