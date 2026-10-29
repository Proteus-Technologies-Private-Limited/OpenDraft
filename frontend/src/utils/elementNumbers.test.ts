import { describe, it, expect } from 'vitest';
import type { JSONContent } from '@tiptap/react';
import {
  assignElementNumbers, collectJSON, withElementNumbers, elementNumberOf,
  numberingRulesOf, numberableElementIds, resetElementIds, numberInWords, type NumberingRules,
} from './elementNumbers';
import { doc, block } from '../test/screenplaySchema';
import { rule, titlePageRules, avBlockRule, outlineRules } from '../stores/templates/_helpers';

const heading = (text: string, sceneNumber: string | null = null): JSONContent =>
  ({ type: 'sceneHeading', attrs: { sceneNumber }, content: text ? [{ type: 'text', text }] : [] });
const custom = (id: string, text: string): JSONContent =>
  ({ type: 'customElement', attrs: { customTypeId: id, customLabel: id }, content: [{ type: 'text', text }] });
const empty = (type: string): JSONContent => ({ type });
const dual = (left: JSONContent[], right: JSONContent[]): JSONContent => ({
  type: 'dualDialogue',
  content: [{ type: 'dualDialogueColumn', content: left }, { type: 'dualDialogueColumn', content: right }],
});

/** Labels of every numbered node, in reading order. */
function labels(d: JSONContent, rules: NumberingRules, sceneNumbersVisible = true): string[] {
  const found = collectJSON(d);
  return assignElementNumbers(found.map((f) => f.item), rules, { sceneNumbersVisible })
    .filter((l): l is string => l !== null);
}

const DIALOGUE: NumberingRules = { dialogue: { enabled: true, resetOn: [] } };

describe('assignElementNumbers', () => {
  it('numbers an element through the whole script when nothing restarts it', () => {
    const d = doc(heading('SCENE 1'), block('dialogue', 'a'), block('dialogue', 'b'),
      heading('SCENE 2'), block('dialogue', 'c'));
    expect(labels(d, DIALOGUE)).toEqual(['1', '2', '3']);
  });

  it('restarts at a scene heading', () => {
    const d = doc(heading('SCENE 1'), block('dialogue', 'a'), block('dialogue', 'b'),
      heading('SCENE 2'), block('dialogue', 'c'));
    expect(labels(d, { dialogue: { enabled: true, resetOn: ['sceneHeading'] } })).toEqual(['1', '2', '1']);
  });

  it('restarts at any of several elements', () => {
    const d = doc(block('dialogue', 'a'), heading('SCENE'), block('dialogue', 'b'),
      block('newAct', 'ACT TWO'), block('dialogue', 'c'), block('dialogue', 'd'));
    expect(labels(d, { dialogue: { enabled: true, resetOn: ['sceneHeading', 'newAct'] } }))
      .toEqual(['1', '1', '1', '2']);
  });

  it('keeps a separate count for each element', () => {
    const d = doc(custom('soundEffect', 'SFX: RAIN'), block('dialogue', 'a'),
      custom('soundEffect', 'SFX: THUNDER'), heading('SCENE 2'), block('dialogue', 'b'),
      custom('soundEffect', 'SFX: WIND'));
    const rules: NumberingRules = {
      dialogue: { enabled: true, resetOn: ['sceneHeading'] },
      soundEffect: { enabled: true, resetOn: [], prefix: 'SFX ' },
    };
    const found = collectJSON(d);
    const out = assignElementNumbers(found.map((f) => f.item), rules, { sceneNumbersVisible: true });
    expect(out).toEqual(['SFX 1', '1', 'SFX 2', null, '1', 'SFX 3']);
  });

  it('starts from startAt, after every restart too', () => {
    const d = doc(block('dialogue', 'a'), block('dialogue', 'b'), heading('S'), block('dialogue', 'c'));
    expect(labels(d, { dialogue: { enabled: true, resetOn: ['sceneHeading'], startAt: 0 } })).toEqual(['0', '1', '0']);
    expect(labels(d, { dialogue: { enabled: true, resetOn: [], startAt: 5 } })).toEqual(['5', '6', '7']);
  });

  it('prefixes the scene number in the scene style', () => {
    const d = doc(heading('A', '12'), block('dialogue', 'a'), block('dialogue', 'b'),
      heading('B', '12A'), block('dialogue', 'c'));
    const rules: NumberingRules = { dialogue: { enabled: true, resetOn: ['sceneHeading'], style: 'scene' } };
    expect(labels(d, rules)).toEqual(['12.1', '12.2', '12A.1']);
  });

  it('falls back to plain numbers in the scene style without scene numbers', () => {
    const rules: NumberingRules = { dialogue: { enabled: true, resetOn: [], style: 'scene' } };
    // Before the first heading.
    expect(labels(doc(block('dialogue', 'a'), heading('S', '1'), block('dialogue', 'b')), rules))
      .toEqual(['1', '1.2']);
    // Scene numbers hidden.
    expect(labels(doc(heading('S', '1'), block('dialogue', 'a')), rules, false)).toEqual(['1']);
    // A heading with no number.
    expect(labels(doc(heading('S', null), block('dialogue', 'a')), rules)).toEqual(['1']);
  });

  it('numbers dual dialogue left column first', () => {
    const d = doc(block('dialogue', 'a'),
      dual([block('character', 'L'), block('dialogue', 'left')], [block('character', 'R'), block('dialogue', 'right')]),
      block('dialogue', 'b'));
    const found = collectJSON(d);
    const out = assignElementNumbers(found.map((f) => f.item), DIALOGUE, { sceneNumbersVisible: true });
    const numbered = found.map((f, i) => [f.node.content?.[0]?.text, out[i]]).filter(([, l]) => l);
    expect(numbered).toEqual([['a', '1'], ['left', '2'], ['right', '3'], ['b', '4']]);
  });

  it('skips everything inside an AV body', () => {
    const d = doc(block('action', 'x'), {
      type: 'avBlock',
      content: [{ type: 'avRow', content: [{ type: 'avCell', content: [{ type: 'avPara', content: [{ type: 'text', text: 'v' }] }] }] }],
    }, block('action', 'y'));
    expect(labels(d, { action: { enabled: true, resetOn: [] } })).toEqual(['1', '2']);
  });

  it('does not count an element that has no text yet', () => {
    const d = doc(block('dialogue', 'a'), empty('dialogue'), block('dialogue', 'b'));
    expect(labels(d, DIALOGUE)).toEqual(['1', '2']);
  });

  it('restarts at an empty or omitted scene heading — it is still a scene', () => {
    const d = doc(block('dialogue', 'a'), heading(''), block('dialogue', 'b'),
      { type: 'sceneHeading', attrs: { sceneNumber: '2', omitted: true }, content: [{ type: 'text', text: 'OMITTED' }] },
      block('dialogue', 'c'));
    expect(labels(d, { dialogue: { enabled: true, resetOn: ['sceneHeading'] } })).toEqual(['1', '1', '1']);
  });

  it('numbers a custom element and lets one restart another count', () => {
    const d = doc(block('dialogue', 'a'), custom('segment', 'SEGMENT TWO'), block('dialogue', 'b'));
    expect(labels(d, { dialogue: { enabled: true, resetOn: ['segment'] } })).toEqual(['1', '1']);
  });

  it('ignores an element listed as restarting its own count', () => {
    const d = doc(block('dialogue', 'a'), block('dialogue', 'b'));
    expect(labels(d, { dialogue: { enabled: true, resetOn: ['dialogue'] } })).toEqual(['1', '2']);
  });

  it('numbers nothing without rules', () => {
    expect(labels(doc(block('dialogue', 'a')), {})).toEqual([]);
  });
});

describe('comic numbering: inline headings, per-page counts, shared lettering', () => {
  const emptyCustom = (id: string): JSONContent => ({ type: 'customElement', attrs: { customTypeId: id, customLabel: id } });
  const COMIC: NumberingRules = {
    page: { enabled: true, resetOn: [], prefix: 'PAGE ', style: 'words', placement: 'inline' },
    panel: { enabled: true, resetOn: ['page'], prefix: 'PANEL ', placement: 'inline' },
    dialogue: { enabled: true, resetOn: ['page'] },
    caption: { enabled: true, resetOn: [], countWith: 'dialogue' },
  };
  const script = doc(
    emptyCustom('page'), emptyCustom('panel'), block('action', 'Wide.'),
    custom('caption', 'CAPTION: 1953.'), block('character', 'MARA'), block('dialogue', 'a'),
    emptyCustom('panel'), block('character', 'MARA'), block('dialogue', 'b'), custom('caption', 'CAPTION: Later.'),
    custom('page', '(SPLASH)'), emptyCustom('panel'), block('dialogue', 'c'),
  );

  it('numbers pages through the script, panels and lettering again on every page', () => {
    expect(labels(script, COMIC)).toEqual([
      'PAGE ONE', 'PANEL 1', '1', '2', 'PANEL 2', '3', '4',
      'PAGE TWO', 'PANEL 1', '1',
    ]);
  });

  it('counts an empty inline heading, but still not an empty margin-numbered line', () => {
    const d = doc(emptyCustom('panel'), empty('dialogue'), emptyCustom('panel'), block('dialogue', 'a'));
    expect(labels(d, COMIC)).toEqual(['PANEL 1', 'PANEL 2', '1']);
  });

  it('a shared count follows its owner\'s restarts and start, not its own', () => {
    const rules: NumberingRules = {
      dialogue: { enabled: true, resetOn: ['page'], startAt: 10 },
      caption: { enabled: true, resetOn: [], startAt: 99, prefix: 'C', countWith: 'dialogue' },
    };
    const d = doc(custom('caption', 'x'), block('dialogue', 'a'), custom('page', 'P'), custom('caption', 'y'));
    expect(labels(d, rules)).toEqual(['C10', '11', 'C10']);
  });

  it('keeps its own count when the element it counts with is not numbered, or counts with another', () => {
    const d = doc(custom('caption', 'x'), block('dialogue', 'a'), custom('caption', 'y'));
    expect(labels(d, { caption: { enabled: true, resetOn: [], countWith: 'dialogue' } })).toEqual(['1', '2']);
    // A loop: each falls back to a count of its own.
    expect(labels(d, {
      caption: { enabled: true, resetOn: [], countWith: 'dialogue' },
      dialogue: { enabled: true, resetOn: [], countWith: 'caption' },
    })).toEqual(['1', '1', '2']);
  });

  it('spells numbers out in capitals, digits from a thousand', () => {
    expect([0, 1, 13, 20, 22, 99, 100, 104, 342, 999, 1000].map(numberInWords)).toEqual([
      'ZERO', 'ONE', 'THIRTEEN', 'TWENTY', 'TWENTY-TWO', 'NINETY-NINE', 'ONE HUNDRED',
      'ONE HUNDRED FOUR', 'THREE HUNDRED FORTY-TWO', 'NINE HUNDRED NINETY-NINE', '1000',
    ]);
  });

  it('writes inline labels into the text only when asked to', () => {
    const asAttr = withElementNumbers(script, { visible: true, sceneNumbersVisible: true, rules: COMIC });
    expect(elementNumberOf(asAttr.content?.[0])).toBe('PAGE ONE');
    expect(asAttr.content?.[0].content).toBeUndefined();

    const asText = withElementNumbers(script, { visible: true, sceneNumbersVisible: true, rules: COMIC, inlineAsText: true });
    const text = (n: JSONContent | undefined) => (n?.content ?? []).map((c) => c.text).join('');
    expect(text(asText.content?.[0])).toBe('PAGE ONE');
    expect(elementNumberOf(asText.content?.[0])).toBeNull();
    expect(text(asText.content?.[10])).toBe('PAGE TWO (SPLASH)');
    // Margin numbers are still attributes, for the exporter to hang.
    expect(elementNumberOf(asText.content?.[3])).toBe('1');
    expect(text(asText.content?.[3])).toBe('CAPTION: 1953.');
    // The original is untouched.
    expect(script.content?.[0].content).toBeUndefined();
  });
});

describe('withElementNumbers', () => {
  const d = doc(heading('S', '1'), block('character', 'MARA'), block('dialogue', 'a'));

  it('returns the very same document when nothing is numbered', () => {
    expect(withElementNumbers(d, { visible: true, sceneNumbersVisible: true, rules: {} })).toBe(d);
  });

  it('returns the very same document when numbers are hidden', () => {
    expect(withElementNumbers(d, { visible: false, sceneNumbersVisible: true, rules: DIALOGUE })).toBe(d);
  });

  it('labels a copy and leaves the original untouched', () => {
    const before = JSON.stringify(d);
    const out = withElementNumbers(d, { visible: true, sceneNumbersVisible: true, rules: DIALOGUE });
    expect(out).not.toBe(d);
    expect(JSON.stringify(d)).toBe(before);
    expect(out.content?.map((n) => elementNumberOf(n))).toEqual([null, null, '1']);
    // Nodes off the numbered path are shared, not copied.
    expect(out.content?.[0]).toBe(d.content?.[0]);
  });

  it('labels inside dual dialogue', () => {
    const dd = doc(dual([block('dialogue', 'l')], [block('dialogue', 'r')]));
    const out = withElementNumbers(dd, { visible: true, sceneNumbersVisible: true, rules: DIALOGUE });
    const cols = out.content?.[0].content ?? [];
    expect(cols.map((c) => elementNumberOf(c.content?.[0]))).toEqual(['1', '2']);
  });
});

describe('which elements can be numbered', () => {
  const rules = {
    sceneHeading: rule('sceneHeading', 'Scene Heading', true, {}),
    dialogue: rule('dialogue', 'Dialogue', true, {}),
    shot: { ...rule('shot', 'Shot', true, {}), enabled: false },
    soundEffect: rule('soundEffect', 'Sound Effect', false, {}),
    ...outlineRules(),
    ...titlePageRules(),
    ...avBlockRule(true),
  };

  it('never offers scene headings, outline elements, the title page or the AV body', () => {
    expect(numberableElementIds(rules)).toEqual(['dialogue', 'soundEffect']);
  });

  it('lets a scene heading or a section restart a count, but not a note or the title page', () => {
    expect(resetElementIds(rules)).toEqual(['sceneHeading', 'dialogue', 'soundEffect', 'section']);
  });

  it('reads only enabled numbering on enabled, numberable elements', () => {
    const on = { enabled: true, resetOn: [] };
    expect(Object.keys(numberingRulesOf({
      ...rules,
      dialogue: { ...rules.dialogue, numbering: on },
      soundEffect: { ...rules.soundEffect, numbering: { ...on, enabled: false } },
      shot: { ...rules.shot, numbering: on },
      sceneHeading: { ...rules.sceneHeading, numbering: on },
    }))).toEqual(['dialogue']);
    expect(numberingRulesOf(undefined)).toEqual({});
  });
});
