import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import { testExtensions, block, doc } from '../test/screenplaySchema';
import { ElementNumbers } from './extensions/ElementNumbers';
import { mapElementNumberTarget } from './elementNumberTarget';
const schema = getSchema([...testExtensions, ElementNumbers]);
function fixture(stored = true) {
  const json = doc(block('action', 'before'), block('action', 'target'));
  if (stored) json.content![1].attrs = { elementNumber: '12', elementNumberId: 'target-id' };
  const state = EditorState.create({ schema, doc: schema.nodeFromJSON(json) });
  return { state, target: { position: state.doc.child(0).nodeSize, node: state.doc.child(1) } };
}
describe('element-number dialog target', () => {
  it('follows a stable reference through a remote whole-document replacement', () => {
    const { state, target } = fixture();
    const replacement = state.doc.toJSON();
    replacement.content.unshift(block('action', 'remote insertion'));
    replacement.content[2].content[0].text = 'target edited remotely';
    const tr = state.tr.replaceWith(
      0,
      state.doc.content.size,
      schema.nodeFromJSON(replacement).content,
    );
    const next = mapElementNumberTarget(target, tr)!;
    expect(next.node.textContent).toBe('target edited remotely');
    expect(next.node.attrs.elementNumberId).toBe('target-id');
    expect(next.position).toBeGreaterThan(target.position);
  });
  it('maps a paragraph without a stored ID through ordinary edits before it', () => {
    const { state, target } = fixture(false);
    const next = mapElementNumberTarget(target, state.tr.insertText('new ', 1))!;
    expect(next.position).toBe(target.position + 4);
    expect(next.node.textContent).toBe('target');
  });
  it('does not edit a replacement paragraph after deletion or a concurrent number change', () => {
    const { state, target } = fixture();
    expect(
      mapElementNumberTarget(target, state.tr.delete(target.position, state.doc.content.size)),
    ).toBeNull();
    expect(
      mapElementNumberTarget(
        target,
        state.tr.setNodeAttribute(target.position, 'elementNumber', '14'),
      ),
    ).toBeNull();
    expect(
      mapElementNumberTarget(target, state.tr.insert(state.doc.content.size, target.node)),
    ).toBeNull();
  });
});
