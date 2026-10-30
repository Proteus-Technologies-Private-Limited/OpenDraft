import { describe, it, expect } from 'vitest';
import { EditorState } from '@tiptap/pm/state';
import { testSchema, doc, block, marked, pmDoc } from '../test/screenplaySchema';
import {
  UPPERCASE_ELEMENT_TYPES,
  blockPosition,
  isUppercaseElement,
  uppercaseBlockTransaction,
} from './elementCase';

const stateOf = (json: ReturnType<typeof doc>) =>
  EditorState.create({ schema: testSchema, doc: pmDoc(json) });

/** The first block's text after normalisation, or null if nothing changed. */
const uppercased = (json: ReturnType<typeof doc>): string | null => {
  const state = stateOf(json);
  const tr = uppercaseBlockTransaction(state, 0);
  if (!tr) return null;
  return state.apply(tr).doc.firstChild?.textContent ?? null;
};

describe('elementCase', () => {
  it('knows the elements the page prints in capitals', () => {
    expect(isUppercaseElement('sceneHeading')).toBe(true);
    expect(isUppercaseElement('character')).toBe(true);
    expect(isUppercaseElement('transition')).toBe(true);
    expect(isUppercaseElement('action')).toBe(false);
    expect(isUppercaseElement('dialogue')).toBe(false);
    expect(UPPERCASE_ELEMENT_TYPES.size).toBeGreaterThan(0);
  });

  it('raises a lower-case scene heading to capitals', () => {
    expect(uppercased(doc(block('sceneHeading', 'int. casa - day')))).toBe('INT. CASA - DAY');
  });

  it('raises a character cue and a transition too', () => {
    expect(uppercased(doc(block('character', 'margo (v.o.)')))).toBe('MARGO (V.O.)');
    expect(uppercased(doc(block('transition', 'cut to:')))).toBe('CUT TO:');
  });

  it('never touches an element whose text is not printed in capitals', () => {
    expect(uppercased(doc(block('action', 'The rain falls.')))).toBeNull();
  });

  it('does nothing to a heading already in capitals', () => {
    expect(uppercased(doc(block('sceneHeading', 'INT. CASA - DAY')))).toBeNull();
  });

  it('keeps the marks the line already had', () => {
    const state = stateOf(doc(marked('character', 'margo', 'bold')));
    const tr = uppercaseBlockTransaction(state, 0);
    expect(tr).not.toBeNull();
    if (!tr) return;
    const text = state.apply(tr).doc.firstChild?.firstChild;
    expect(text?.text).toBe('MARGO');
    expect(text?.marks.some((mark) => mark.type.name === 'bold')).toBe(true);
  });

  it('finds the text block the caret is in', () => {
    const state = stateOf(doc(block('action', 'one'), block('sceneHeading', 'int. a - day')));
    expect(blockPosition(state)).toBe(0);
  });

  it('returns null for a position with no block', () => {
    const state = stateOf(doc(block('action', 'one')));
    expect(uppercaseBlockTransaction(state, 999)).toBeNull();
  });
});
