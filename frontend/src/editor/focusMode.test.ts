import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { getExtensionField } from '@tiptap/core';
import { testSchema, block, doc } from '../test/screenplaySchema';
import {
  FocusMode, FOCUS_MODE_REFRESH, focusModePluginKey, focusTextblocks, type FocusModeConfig,
} from './extensions/FocusMode';

const script = doc(
  block('action', 'Cold open.'),
  block('sceneHeading', 'INT. A - DAY'),
  block('action', 'In A.'),
  {
    type: 'dualDialogue',
    content: [
      { type: 'dualDialogueColumn', content: [block('character', 'X'), block('dialogue', 'Left.')] },
      { type: 'dualDialogueColumn', content: [block('character', 'Y'), block('dialogue', 'Right.')] },
    ],
  },
  block('sceneHeading', 'INT. B - DAY'),
  block('action', 'In B.'),
  block('newAct', 'ACT TWO'),
  block('action', 'After the act.'),
);

const pmDoc = testSchema.nodeFromJSON(script);

/** Position just inside the first textblock whose text is `text`. */
function inside(text: string): number {
  let at = -1;
  pmDoc.descendants((n, p) => {
    if (at < 0 && n.isTextblock && n.textContent === text) at = p + 1;
    return at < 0;
  });
  return at;
}

const texts = (positions: number[]) => positions.map((p) => pmDoc.nodeAt(p)!.textContent);

describe('focus dimming range', () => {
  it('keeps just the current element bright', () => {
    expect(texts(focusTextblocks(pmDoc, inside('Left.'), 'element'))).toEqual(['Left.']);
  });

  it('keeps the whole scene bright, including dual dialogue inside it', () => {
    expect(texts(focusTextblocks(pmDoc, inside('In A.'), 'scene'))).toEqual([
      'INT. A - DAY', 'In A.', 'X', 'Left.', 'Y', 'Right.',
    ]);
  });

  it('starts at the top when there is no heading above, and stops at a new act', () => {
    expect(texts(focusTextblocks(pmDoc, inside('Cold open.'), 'scene'))).toEqual(['Cold open.']);
    expect(texts(focusTextblocks(pmDoc, inside('In B.'), 'scene'))).toEqual(['INT. B - DAY', 'In B.']);
    expect(texts(focusTextblocks(pmDoc, inside('After the act.'), 'scene'))).toEqual(['ACT TWO', 'After the act.']);
  });

  it('marks nothing with dimming off', () => {
    expect(focusTextblocks(pmDoc, inside('In A.'), 'off')).toEqual([]);
  });
});

describe('focus mode plugin', () => {
  function setup(config: { current: FocusModeConfig | null }) {
    const ext = FocusMode.configure({ getConfig: () => config.current });
    const addPlugins = getExtensionField<() => import('@tiptap/pm/state').Plugin[]>(ext, 'addProseMirrorPlugins', {
      name: ext.name, options: ext.options, storage: {}, editor: {} as never, type: null,
    } as never);
    return EditorState.create({
      schema: testSchema,
      doc: pmDoc,
      plugins: addPlugins(),
      selection: TextSelection.create(pmDoc, inside('In A.')),
    });
  }

  const marked = (s: EditorState) =>
    focusModePluginKey.getState(s)!.find().map((d) => s.doc.nodeAt(d.from)!.textContent);

  it('follows the caret and the settings', () => {
    const config: { current: FocusModeConfig | null } = { current: null };
    let s = setup(config);
    expect(marked(s)).toEqual([]);

    config.current = { typewriter: false, dim: 'element' };
    s = s.apply(s.tr.setMeta(FOCUS_MODE_REFRESH, true));
    expect(marked(s)).toEqual(['In A.']);

    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, inside('In B.'))));
    expect(marked(s)).toEqual(['In B.']);

    config.current = { typewriter: false, dim: 'scene' };
    s = s.apply(s.tr.setMeta(FOCUS_MODE_REFRESH, true));
    expect(marked(s)).toEqual(['INT. B - DAY', 'In B.']);

    config.current = null;
    s = s.apply(s.tr.setMeta(FOCUS_MODE_REFRESH, true));
    expect(marked(s)).toEqual([]);
  });
});
