/**
 * Enter inside an AV cell, once a cell can hold screenplay elements.
 *
 * `splitBlock` at the end of a block takes the cell's DEFAULT child — `avPara`
 * — which is right for the four AV paragraph types and wrong for a Character,
 * whose whole point is that Dialogue comes next. The keymap therefore applies
 * the active template's `nextOnEnter`, but only where the cell would take the
 * answer and the template offers it in THIS column: an Action after a line of
 * Dialogue belongs in the video column, not under the dialogue it followed.
 *
 * The same `nextOnEnter` field drives Enter in the ordinary script body, where
 * `avPara` is not a legal node — so a rule may never name one, and the fallback
 * has to happen here rather than in the template.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { testSchema } from '../test/screenplaySchema';
import { AvKeymap } from './extensions/AvBlock';
import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import { AV_SCRIPT_ID, AV_SCRIPT_TEMPLATE } from '../stores/templates/avScriptTemplate';
import { INDUSTRY_STANDARD_ID } from '../stores/formattingTypes';
import { useSettingsStore } from '../stores/settingsStore';

const shortcuts = (AvKeymap.config.addKeyboardShortcuts as () => Record<
  string,
  (p: { editor: unknown }) => boolean
>).call({} as never);

/**
 * A stand-in for the Tiptap editor that records the chain the keymap builds.
 *
 * Only `state`, `schema` and `chain()` are read, and the chain is used purely
 * to decide a type — so recording the calls is the whole behaviour under test,
 * with no DOM and no editor instance.
 */
function fakeEditor(state: EditorState) {
  const calls: { op: string; arg?: unknown }[] = [];
  const chain: Record<string, (...a: unknown[]) => unknown> = {
    splitBlock: () => { calls.push({ op: 'splitBlock' }); return chain; },
    setNode: (arg?: unknown) => { calls.push({ op: 'setNode', arg }); return chain; },
    focus: () => chain,
    run: () => true,
  };
  return {
    editor: { state, schema: testSchema, chain: () => chain },
    calls,
  };
}

/** A cell paragraph of `type` holding `text`, with the caret at its end. */
function caretAtEndOf(type: string, text: string, side: 'video' | 'audio'): EditorState {
  const other = side === 'video' ? 'audio' : 'video';
  const cells = [
    { type: 'avCell', attrs: { side }, content: [{ type, content: text ? [{ type: 'text', text }] : [] }] },
    { type: 'avCell', attrs: { side: other }, content: [{ type: 'avPara' }] },
  ];
  // The video cell must come first whichever side the caret is in.
  const ordered = side === 'video' ? cells : [cells[1], cells[0]];
  const doc = testSchema.nodeFromJSON({
    type: 'doc',
    content: [{ type: 'avBlock', content: [{ type: 'avRow', content: ordered }] }],
  });

  let end = -1;
  doc.descendants((node, pos) => {
    if (node.type.name === type && node.textContent === text && end < 0) end = pos + node.nodeSize - 1;
    return true;
  });
  const state = EditorState.create({ doc, schema: testSchema });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, end)));
}

/** The type the keymap asked for after the split, or null if it left it alone. */
function nextTypeAfterEnter(type: string, text: string, side: 'video' | 'audio'): string | null {
  const { editor, calls } = fakeEditor(caretAtEndOf(type, text, side));
  expect(shortcuts.Enter({ editor } as never)).toBe(true);
  expect(calls[0]?.op).toBe('splitBlock');
  const set = calls.find(c => c.op === 'setNode');
  return set ? String(set.arg) : null;
}

describe('Enter on a line with text inside an AV cell', () => {
  beforeEach(() => {
    useFormattingTemplateStore.setState({ activeTemplateId: AV_SCRIPT_ID });
  });
  afterEach(() => {
    useFormattingTemplateStore.setState({ activeTemplateId: null });
  });

  it('flows Character into Dialogue in the audio column', () => {
    expect(nextTypeAfterEnter('character', 'MARIA', 'audio')).toBe('dialogue');
  });

  it('flows Parenthetical back into Dialogue', () => {
    expect(nextTypeAfterEnter('parenthetical', '(to camera)', 'audio')).toBe('dialogue');
  });

  it('flows a Video Shot into the body paragraph', () => {
    // avShot's own nextOnEnter is avPara, which the cell takes as-is.
    expect(nextTypeAfterEnter('avShot', 'WIDE ON THE STREET.', 'video')).toBe('avPara');
  });

  it('falls back to avPara when the flow points out of this column', () => {
    // The AV template sends Dialogue to Action, which it places in the VIDEO
    // column. Continuing a dialogue block into the video column would be
    // nonsense, so the audio column gets its own neutral paragraph instead.
    expect(AV_SCRIPT_TEMPLATE.rules.dialogue.nextOnEnter).toBe('action');
    expect(AV_SCRIPT_TEMPLATE.rules.action.avCell).toBe('video');
    expect(nextTypeAfterEnter('dialogue', 'We build them by hand.', 'audio')).toBe('avPara');
  });

  it('keeps the flow when the target IS offered in this column', () => {
    expect(nextTypeAfterEnter('shot', 'CRANE DOWN.', 'video')).toBe('action');
  });

  it('leaves the split alone for an element with no flow of its own', () => {
    // avPara flows to avPara, which is the cell's default anyway — asking for it
    // would be a transaction that changes nothing.
    expect(nextTypeAfterEnter('avPara', 'Narration.', 'audio')).toBeNull();
  });

  it('never asks for a type this schema does not have', () => {
    for (const [type, side] of [
      ['character', 'audio'], ['dialogue', 'audio'], ['parenthetical', 'audio'],
      ['avShot', 'video'], ['avGraphic', 'video'], ['action', 'video'], ['shot', 'video'],
    ] as const) {
      const next = nextTypeAfterEnter(type, 'Some text', side);
      if (next !== null) expect(testSchema.nodes[next], `${type} -> ${next}`).toBeTruthy();
    }
  });
});

describe('every template rule names a next type that is valid outside a cell', () => {
  it('holds for the AV template', () => {
    // `nextOnEnter` drives Enter in the ordinary script body too, where the AV
    // paragraph types are not legal nodes. A rule that named one would throw on
    // the first Enter in the pre-roll text above an AV body.
    const avOnly = new Set(['avPara', 'avShot', 'avDirection', 'avGraphic']);
    for (const rule of Object.values(AV_SCRIPT_TEMPLATE.rules)) {
      if (avOnly.has(rule.id)) continue; // these exist only inside a cell
      expect(avOnly.has(rule.nextOnEnter), `${rule.id} -> ${rule.nextOnEnter}`).toBe(false);
    }
  });
});

describe('Enter on a blank line inside an AV cell', () => {
  afterEach(() => {
    useFormattingTemplateStore.setState({ activeTemplateId: null });
    useSettingsStore.setState({ elementMenuOnEnter: true });
  });

  it('asks for one more blank line when the element menu is switched off', () => {
    useFormattingTemplateStore.setState({ activeTemplateId: AV_SCRIPT_ID });
    useSettingsStore.setState({ elementMenuOnEnter: false });
    // A blank Character line: the neutral blank inside a cell is avPara, not
    // the `action` a screenplay element would give outside one.
    expect(nextTypeAfterEnter('character', '', 'audio')).toBe('avPara');
  });

  it('does the same under a template with no AV rules at all', () => {
    useFormattingTemplateStore.setState({ activeTemplateId: INDUSTRY_STANDARD_ID });
    useSettingsStore.setState({ elementMenuOnEnter: false });
    expect(nextTypeAfterEnter('avShot', '', 'video')).toBe('avPara');
  });
});
