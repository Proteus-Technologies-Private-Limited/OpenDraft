/** Two clients attempt version changes, then exchange real Yjs updates. */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { updateYFragment, yXmlFragmentToProsemirror } from 'y-prosemirror';
import { EditorState, type Transaction } from '@tiptap/pm/state';
import { testSchema, block, doc } from '../test/screenplaySchema';
import { addAlternateTransaction, cycleAlternateTransaction } from './alternates';
import { addSceneAlternateTransaction, cycleSceneAlternateTransaction } from './sceneAlternates';
import { alternateSessionGuard } from './extensions/Alternates';

function client(seed: Uint8Array) {
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, seed);
  const fragment = ydoc.getXmlFragment('default');
  const meta = { mapping: new Map(), isOMark: new Map() };
  let state = EditorState.create({ schema: testSchema,
    doc: yXmlFragmentToProsemirror(testSchema, fragment),
    plugins: [alternateSessionGuard(() => true, () => {})] });
  return {
    ydoc,
    get state() { return state; },
    apply(tr: Transaction) {
      const result = state.applyTransaction(tr);
      state = result.state;
      if (result.transactions.length) ydoc.transact(() => updateYFragment(ydoc, fragment, state.doc, meta));
      return result.transactions.length;
    },
    read: () => yXmlFragmentToProsemirror(testSchema, fragment).toJSON(),
  };
}

function exchange(a: ReturnType<typeof client>, b: ReturnType<typeof client>) {
  const fromA = Y.encodeStateAsUpdate(a.ydoc), fromB = Y.encodeStateAsUpdate(b.ydoc);
  Y.applyUpdate(a.ydoc, fromB);
  Y.applyUpdate(b.ydoc, fromA);
}

describe('alternate operations in a shared Yjs script', () => {
  for (const scene of [false, true]) {
    it(`prevents simultaneous ${scene ? 'scene' : 'line'} switches from duplicating text`, () => {
      let state = EditorState.create({ schema: testSchema, doc: testSchema.nodeFromJSON(doc(
        block('sceneHeading', 'INT. ROOM - DAY'), block('action', 'Original version.'),
      )) });
      const actionPos = state.doc.child(0).nodeSize + 1;
      const pos = scene ? 1 : actionPos;
      state = state.apply((scene ? addSceneAlternateTransaction : addAlternateTransaction)(state, pos)!);
      state = state.apply(state.tr.insertText('Rewritten version.', actionPos, state.doc.content.size - 1));
      const seedDoc = new Y.Doc();
      updateYFragment(seedDoc, seedDoc.getXmlFragment('default'), state.doc, { mapping: new Map(), isOMark: new Map() });
      const seed = Y.encodeStateAsUpdate(seedDoc);
      const a = client(seed), b = client(seed);
      const cycle = scene ? cycleSceneAlternateTransaction : cycleAlternateTransaction;
      expect(a.apply(cycle(a.state, pos, 1)!)).toBe(0);
      expect(b.apply(cycle(b.state, pos, -1)!)).toBe(0);
      exchange(a, b);
      expect(a.read()).toEqual(b.read());
      expect(a.read()).toEqual(state.doc.toJSON());
      expect(a.apply(a.state.tr.insertText('A ', actionPos))).toBe(1);
      expect(b.apply(b.state.tr.insertText('B ', actionPos))).toBe(1);
      exchange(a, b);
      expect(a.read()).toEqual(b.read());
      const merged = yXmlFragmentToProsemirror(testSchema, a.ydoc.getXmlFragment('default'));
      expect(merged.child(1).textContent).toContain('A ');
      expect(merged.child(1).textContent).toContain('B ');
      expect(merged.child(1).textContent.match(/Rewritten version\./g)).toHaveLength(1);
      a.ydoc.destroy(); b.ydoc.destroy(); seedDoc.destroy();
    });
  }
});
