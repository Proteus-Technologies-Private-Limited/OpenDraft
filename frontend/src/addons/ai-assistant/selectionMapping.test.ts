/**
 * The selection a proposal will replace, after the edits made while it waited.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import type { Node as PmNode } from '@tiptap/pm/model';
import { testSchema } from '../../test/screenplaySchema';
import { mappedSelection } from './selectionMapping';

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

describe('mappedSelection', () => {
  it('moves with text typed above the proposal', () => {
    const source = doc('Hello world', 'Second.');
    const state = stateWith(source, 1, 6);
    // Insert before the range: both ends shift by the inserted length.
    const tr = state.tr.insertText('NEW ', 1);
    const range = mappedSelection({ from: 1, to: 6, mapping: tr.mapping }, tr.doc.content.size);
    expect(range).toEqual({ from: 5, to: 10 });
    expect(tr.doc.textBetween(range.from, range.to)).toBe('Hello');
  });

  it('keeps text typed at the start edge outside the replacement', () => {
    const source = doc('Hello world', 'Second.');
    const state = stateWith(source, 1, 6);
    // The writer puts a caret at the start of the selection and types.
    const tr = state.tr.insertText('X', 1);
    const range = mappedSelection({ from: 1, to: 6, mapping: tr.mapping }, tr.doc.content.size);
    expect(tr.doc.textBetween(range.from, range.to)).toBe('Hello');
    expect(tr.doc.textBetween(1, range.from)).toBe('X');
  });

  it('keeps text typed at the end edge outside the replacement', () => {
    const source = doc('Hello world', 'Second.');
    const state = stateWith(source, 1, 7);
    // Typed exactly at `to`.
    const tr = state.tr.insertText('Y', 7);
    const range = mappedSelection({ from: 1, to: 7, mapping: tr.mapping }, tr.doc.content.size);
    expect(tr.doc.textBetween(range.from, range.to)).toBe('Hello ');
    expect(tr.doc.textBetween(range.to, range.to + 1)).toBe('Y');
  });

  it('follows a deletion before it', () => {
    const source = doc('Hello world', 'Second.');
    const state = stateWith(source, 1, 6);
    const tr = state.tr.delete(1, 3); // "He" removed
    const range = mappedSelection({ from: 1, to: 6, mapping: tr.mapping }, tr.doc.content.size);
    expect(tr.doc.textBetween(range.from, range.to)).toBe('llo');
  });

  it('clamps a range left past the end of a shorter document', () => {
    const source = doc('Hello world', 'Second.');
    const state = stateWith(source, 1, 6);
    const tr = state.tr;
    const range = mappedSelection({ from: 500, to: 900, mapping: tr.mapping }, tr.doc.content.size);
    expect(range).toEqual({ from: tr.doc.content.size, to: tr.doc.content.size });
  });
});
