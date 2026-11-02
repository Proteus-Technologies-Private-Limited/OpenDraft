/**
 * Plain text from a reply: a newline starts a block, the marks at the caret are
 * not inherited, and the whole replacement is one transaction.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { testSchema } from '../../../test/screenplaySchema';
import { insertPlainText } from './plainText';

const block = (type: string, text: string, marks?: JSONContent['marks']): JSONContent => ({
  type,
  content: text ? [{ type: 'text', text, ...(marks ? { marks } : {}) }] : [],
});

const doc = (...content: JSONContent[]): PmNode => testSchema.nodeFromJSON({ type: 'doc', content });

/** Position just after `needle` in the document text. */
function afterText(node: PmNode, needle: string): number {
  let found = -1;
  node.descendants((child, pos) => {
    if (found < 0 && child.isText && child.text?.includes(needle)) {
      found = pos + (child.text.indexOf(needle) + needle.length);
    }
    return true;
  });
  if (found < 0) throw new Error(`not found: ${needle}`);
  return found;
}

/** Run the helper as the adapter does: one transaction, built from the state. */
function insert(
  node: PmNode,
  from: number,
  to: number,
  text: string,
  element?: Parameters<typeof insertPlainText>[4],
) {
  const state = EditorState.create({
    schema: testSchema,
    doc: node,
    selection: TextSelection.create(node, from, to),
  });
  const tr = state.tr;
  const end = insertPlainText(tr, from, to, text, element);
  return { tr, end };
}

const blocksOf = (node: PmNode): Array<[string, string]> =>
  node.content.content.map((child) => [child.type.name, child.textContent]);

describe('insertPlainText', () => {
  it('starts a new block at each newline instead of leaving a \\n inside one', () => {
    const source = doc(block('action', 'Before.'));
    const from = afterText(source, 'Before.');
    const { tr } = insert(source, from, from, 'One\nTwo');
    expect(blocksOf(tr.doc)).toEqual([
      ['action', 'Before.'],
      ['action', 'One'],
      ['action', 'Two'],
    ]);
  });

  it('splits the line and puts the reply between the halves', () => {
    const source = doc(block('action', 'Hello world'));
    const from = afterText(source, 'Hello');
    const { tr } = insert(source, from, from, 'One\nTwo');
    expect(blocksOf(tr.doc)).toEqual([
      ['action', 'Hello'],
      ['action', 'One'],
      ['action', 'Two'],
      ['action', ' world'],
    ]);
  });

  it('replaces an empty line outright', () => {
    const source = doc(block('action', ''));
    const { tr } = insert(source, 1, 1, 'One\nTwo');
    expect(blocksOf(tr.doc)).toEqual([
      ['action', 'One'],
      ['action', 'Two'],
    ]);
  });

  it('does not inherit the bold or italic at the caret', () => {
    const source = doc(block('action', 'Bold', [{ type: 'bold' }]));
    const from = afterText(source, 'Bold');
    const { tr } = insert(source, from, from, ' plain');
    const paragraph = tr.doc.firstChild!;
    expect(paragraph.textContent).toBe('Bold plain');
    expect(paragraph.child(1).marks).toHaveLength(0);
  });

  it('replaces a selection and retypes the block in the same transaction', () => {
    const source = doc(block('action', 'Hello world'));
    const from = afterText(source, 'Hello ');
    const to = afterText(source, 'world');
    const { tr } = insert(source, from, to, 'there', 'dialogue');
    expect(blocksOf(tr.doc)).toEqual([['dialogue', 'Hello there']]);
    // The words and the element change ride the one transaction the adapter
    // dispatches, so a single undo takes both back.
    expect(tr.steps.length).toBe(2);
  });

  it('writes the requested element for every line', () => {
    const source = doc(block('action', ''));
    const { tr } = insert(source, 1, 1, 'ANNA\nHi.', 'dialogue');
    expect(blocksOf(tr.doc)).toEqual([
      ['dialogue', 'ANNA'],
      ['dialogue', 'Hi.'],
    ]);
  });
});
