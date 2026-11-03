/**
 * The selection a proposal will replace, after the edits made while it waited.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import type { Node as PmNode } from '@tiptap/pm/model';
import { testSchema } from '../../test/screenplaySchema';
import { discardsProposal, mappedSelection } from './selectionMapping';

const doc = (...texts: string[]): PmNode => testSchema.nodeFromJSON({
  type: 'doc',
  content: texts.map((text) => ({ type: 'action', content: [{ type: 'text', text }] })),
});

/** A state with the caret selecting `from..to` in the first block. */
function stateWith(node: PmNode, from: number, to: number): EditorState {
  return EditorState.create({
    schema: testSchema,
    doc: node,
    selection: TextSelection.create(node, from, to),
  });
}

/** Position where the text node starting with `needle` begins. */
function textStart(node: PmNode, needle: string): number {
  let found = -1;
  node.descendants((child, pos) => {
    if (found < 0 && child.isText && child.text?.startsWith(needle)) found = pos;
    return true;
  });
  if (found < 0) throw new Error(`not found: ${needle}`);
  return found;
}

describe('mappedSelection', () => {
  it('moves with text typed above the proposal', () => {
    const source = doc('Hello world', 'Second.');
    const state = stateWith(source, 1, 6);
    // Insert before the range: both ends shift by the inserted length.
    const tr = state.tr.insertText('NEW ', 1);
    const range = mappedSelection({ from: 1, to: 6, mapping: tr.mapping }, tr.doc.content.size);
    expect(range).toEqual({ from: 5, to: 10 });
    expect(tr.doc.textBetween(range!.from, range!.to)).toBe('Hello');
  });

  it('keeps text typed at the start edge outside the replacement', () => {
    const source = doc('Hello world', 'Second.');
    const state = stateWith(source, 1, 6);
    // The writer puts a caret at the start of the selection and types.
    const tr = state.tr.insertText('X', 1);
    const range = mappedSelection({ from: 1, to: 6, mapping: tr.mapping }, tr.doc.content.size);
    expect(tr.doc.textBetween(range!.from, range!.to)).toBe('Hello');
    expect(tr.doc.textBetween(1, range!.from)).toBe('X');
  });

  it('keeps text typed at the end edge outside the replacement', () => {
    const source = doc('Hello world', 'Second.');
    const state = stateWith(source, 1, 7);
    // Typed exactly at `to`.
    const tr = state.tr.insertText('Y', 7);
    const range = mappedSelection({ from: 1, to: 7, mapping: tr.mapping }, tr.doc.content.size);
    expect(tr.doc.textBetween(range!.from, range!.to)).toBe('Hello ');
    expect(tr.doc.textBetween(range!.to, range!.to + 1)).toBe('Y');
  });

  it('follows a deletion before it', () => {
    const source = doc('Top.', 'Hello world');
    const start = textStart(source, 'Hello');
    const state = stateWith(source, start, start + 5);
    const tr = state.tr.delete(1, 5); // "Top." removed from the previous block
    const range = mappedSelection({ from: start, to: start + 5, mapping: tr.mapping }, tr.doc.content.size);
    expect(tr.doc.textBetween(range!.from, range!.to)).toBe('Hello');
  });

  it('drops the range when an end of the selected words was deleted', () => {
    const source = doc('Hello world', 'Second.');
    const state = stateWith(source, 1, 6);
    const tr = state.tr.delete(1, 3);
    expect(mappedSelection({ from: 1, to: 6, mapping: tr.mapping }, tr.doc.content.size)).toBeNull();
  });

  it('clamps a range left past the end of a shorter document', () => {
    const source = doc('Hello world', 'Second.');
    const state = stateWith(source, 1, 6);
    const tr = state.tr;
    const range = mappedSelection({ from: 500, to: 900, mapping: tr.mapping }, tr.doc.content.size);
    expect(range).toEqual({ from: tr.doc.content.size, to: tr.doc.content.size });
  });

  it('drops the range when the selected words were deleted', () => {
    const source = doc('Hello world', 'Second.');
    const state = stateWith(source, 1, 6);
    const tr = state.tr.delete(1, 6);
    expect(mappedSelection({ from: 1, to: 6, mapping: tr.mapping }, tr.doc.content.size)).toBeNull();
  });

  it('drops the range when the selected words were replaced', () => {
    const source = doc('Hello world', 'Second.');
    const state = stateWith(source, 1, 6);
    const tr = state.tr.insertText('Bye', 1, 6);
    expect(mappedSelection({ from: 1, to: 6, mapping: tr.mapping }, tr.doc.content.size)).toBeNull();
  });

  it('keeps a single caret when text is typed at it', () => {
    const source = doc('Hello world', 'Second.');
    const state = stateWith(source, 5, 5);
    const tr = state.tr.insertText('X', 5);
    expect(mappedSelection({ from: 5, to: 5, mapping: tr.mapping }, tr.doc.content.size)).toEqual({ from: 6, to: 6 });
  });
});

describe('discardsProposal', () => {
  it('is true for a remote Yjs change', () => {
    const source = doc('Hello world', 'Second.');
    const state = stateWith(source, 1, 6);
    const tr = state.tr.insertText('X', 1).setMeta('y-sync$', { isChangeOrigin: true });
    expect(discardsProposal(tr)).toBe(true);
  });

  it('is true for a whole-document replace', () => {
    const source = doc('Hello world', 'Second.');
    const state = stateWith(source, 1, 6);
    const replacement = doc('Something else entirely.');
    const tr = state.tr.replaceWith(0, state.doc.content.size, replacement.content);
    expect(discardsProposal(tr)).toBe(true);
  });

  it('is false for an ordinary edit', () => {
    const source = doc('Hello world', 'Second.');
    const state = stateWith(source, 1, 6);
    expect(discardsProposal(state.tr.insertText('X', 1))).toBe(false);
    expect(discardsProposal(state.tr.insertText('X', 1).setMeta('y-sync$', { isChangeOrigin: false }))).toBe(false);
  });
});
