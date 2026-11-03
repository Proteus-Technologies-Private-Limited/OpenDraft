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

  it('gives new lines the element defaults, not the block they land next to', () => {
    const source = doc({
      type: 'sceneHeading',
      attrs: {
        sceneUid: 'scene-1', sceneNumber: 7, locked: true,
        startsNewPage: true, bookmark: 'Open',
      },
      content: [{ type: 'text', text: 'INT. HOUSE - DAY' }],
    });
    const from = afterText(source, 'DAY');
    const { tr } = insert(source, from, from, 'One\nTwo');
    const blocks = tr.doc.content.content;
    expect(blocks.map((b) => [b.type.name, b.textContent])).toEqual([
      ['sceneHeading', 'INT. HOUSE - DAY'],
      ['sceneHeading', 'One'],
      ['sceneHeading', 'Two'],
    ]);
    // The line the writer was on keeps its own scene identity.
    expect(blocks[0].attrs.sceneUid).toBe('scene-1');
    expect(blocks[0].attrs.startsNewPage).toBe(true);
    for (const created of blocks.slice(1)) {
      expect(created.attrs.sceneUid).toBeNull();
      expect(created.attrs.sceneNumber).toBeNull();
      expect(created.attrs.locked).toBe(false);
      expect(created.attrs.startsNewPage).toBe(false);
      expect(created.attrs.bookmark).toBeNull();
    }
  });

  it('does not copy line versions onto new dialogue lines', () => {
    const source = doc({
      type: 'dialogue',
      attrs: { alternates: [{ id: 'v1', text: 'Hi.' }], alternateIndex: 0 },
      content: [{ type: 'text', text: 'Hello.' }],
    });
    const from = afterText(source, 'Hello.');
    const { tr } = insert(source, from, from, 'One\nTwo');
    const created = tr.doc.content.content.slice(1);
    expect(created.map((b) => b.type.name)).toEqual(['dialogue', 'dialogue']);
    for (const line of created) {
      expect(line.attrs.alternates).toBeNull();
      expect(line.attrs.alternateIndex).toBe(0);
    }
  });

  it('does not give the second half of a split heading the same scene identity', () => {
    const source = doc({
      type: 'sceneHeading',
      attrs: { sceneUid: 'scene-1', sceneNumber: 7, locked: true },
      content: [{ type: 'text', text: 'INT. HOUSE - DAY' }],
    });
    const from = afterText(source, 'HOUSE');
    const { tr } = insert(source, from, from, 'One\nTwo');
    const blocks = tr.doc.content.content;
    expect(blocks.map((b) => b.textContent)).toEqual(['INT. HOUSE', 'One', 'Two', ' - DAY']);
    expect(blocks[0].attrs.sceneUid).toBe('scene-1');
    expect(blocks[0].attrs.sceneNumber).toBe(7);
    const uids = blocks.map((b) => b.attrs.sceneUid).filter(Boolean);
    expect(uids).toEqual(['scene-1']);
  });

  it('keeps a dual dialogue whole when the element asked for cannot go in it', () => {
    const t = (type: string, text: string): JSONContent => block(type, text);
    const source = doc(
      t('action', 'Before.'),
      {
        type: 'dualDialogue',
        content: [
          { type: 'dualDialogueColumn', content: [t('character', 'ANA'), t('dialogue', 'Hello there friend.')] },
          { type: 'dualDialogueColumn', content: [t('character', 'BO'), t('dialogue', 'Hi.')] },
        ],
      },
      t('action', 'After.'),
    );
    const from = afterText(source, 'Hello ');
    const to = afterText(source, 'there');
    for (const element of ['sceneHeading', 'action'] as const) {
      const { tr } = insert(source, from, to, 'A\nB', element);
      // Still one dual dialogue between the two actions, with the reply as
      // dialogue lines in the first column and nothing left empty.
      expect(blocksOf(tr.doc).map(([type]) => type)).toEqual(['action', 'dualDialogue', 'action']);
      const first = tr.doc.child(1).child(0);
      expect(first.content.content.map((b) => [b.type.name, b.textContent])).toEqual([
        ['character', 'ANA'],
        ['dialogue', 'Hello '],
        ['dialogue', 'A'],
        ['dialogue', 'B'],
        ['dialogue', ' friend.'],
      ]);
    }
  });
});
