/**
 * Enter on an empty heading whose number is its text (editor/numberedHeadingEnter):
 * a comic script's empty Panel reads "PANEL 3", so Enter moves on to the
 * description instead of opening the element menu a blank line gets.
 */
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state';
import type { JSONContent } from '@tiptap/react';
import { testSchema, doc, block } from '../test/screenplaySchema';
import { enterFromNumberedHeading } from './numberedHeadingEnter';
import { COMIC_TEMPLATE, COMIC_PAGE, COMIC_PANEL } from '../stores/templates/comicTemplate';
import { RADIO_PLAY_TEMPLATE } from '../stores/templates/radioPlayTemplate';

const custom = (id: string, text?: string): JSONContent => ({
  type: 'customElement',
  attrs: { customTypeId: id, customLabel: id },
  ...(text ? { content: [{ type: 'text', text }] } : {}),
});

/** A state with the cursor inside the top-level block at `index`. */
function stateAt(json: JSONContent, index: number): EditorState {
  const state = EditorState.create({ doc: testSchema.nodeFromJSON(json), schema: testSchema });
  let pos = 0;
  for (let i = 0; i < index; i++) pos += state.doc.child(i).nodeSize;
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos + 1)));
}

/** Press Enter; the resulting state, or null when the helper left it to the caller. */
function enter(state: EditorState, rules = COMIC_TEMPLATE.rules, visible = true): EditorState | null {
  let out: Transaction | null = null;
  const handled = enterFromNumberedHeading(state, (tr) => { out = tr; }, rules, visible);
  if (!handled) return null;
  expect(out).not.toBeNull();
  return state.apply(out!);
}

const blockIds = (s: EditorState): string[] => {
  const ids: string[] = [];
  s.doc.forEach((n) => ids.push(n.type.name === 'customElement' ? n.attrs.customTypeId : n.type.name));
  return ids;
};

describe('Enter on an empty numbered heading', () => {
  it('moves from an empty Panel to a Description below it, cursor and all', () => {
    const next = enter(stateAt(doc(custom(COMIC_PAGE, '(SPLASH)'), custom(COMIC_PANEL)), 1));
    expect(next).not.toBeNull();
    expect(blockIds(next!)).toEqual([COMIC_PAGE, COMIC_PANEL, 'action']);
    expect(next!.selection.$from.parent.type.name).toBe('action');
  });

  it('moves from an empty Page to a Panel, a custom element with its label', () => {
    const next = enter(stateAt(doc(custom(COMIC_PAGE)), 0));
    expect(blockIds(next!)).toEqual([COMIC_PAGE, COMIC_PANEL]);
    expect(next!.doc.child(1).attrs.customLabel).toBe('Panel');
  });

  it('leaves every other blank line to the element menu', () => {
    // An empty line of an element numbered in the margin, or not numbered.
    expect(enter(stateAt(doc(block('dialogue', 'a'), { type: 'dialogue' }), 1))).toBeNull();
    expect(enter(stateAt(doc({ type: 'action' }), 0))).toBeNull();
    // A Panel with text is the caller's ordinary split.
    expect(enter(stateAt(doc(custom(COMIC_PANEL, '(WIDE)')), 0))).toBeNull();
    // Numbers hidden: the heading really is blank on screen.
    expect(enter(stateAt(doc(custom(COMIC_PANEL)), 0), COMIC_TEMPLATE.rules, false)).toBeNull();
    // A format that does not number panels.
    expect(enter(stateAt(doc(custom(COMIC_PANEL)), 0), RADIO_PLAY_TEMPLATE.rules)).toBeNull();
  });
});
