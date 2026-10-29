/**
 * The collab server's check on suggesters (collab-server/src/services/
 * suggestionGuard), run on what y-prosemirror really writes: each script state
 * is synced into a Y.Doc the way the editor's Collaboration extension does,
 * and the update between two states is what the server would receive.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { updateYFragment } from 'y-prosemirror';
import { EditorState, type Transaction } from '@tiptap/pm/state';
import type { Node as PmNode } from '@tiptap/pm/model';
import type { JSONContent } from '@tiptap/core';
import { testSchema, block, doc } from '../test/screenplaySchema';
import { listSuggestions, resolveSuggestionTransaction, suggestTransaction } from './suggestions';
import {
  checkSuggesterUpdate, updateInMessage, SCRIPT_FIELD, type YjsLike,
} from '../../../collab-server/src/services/suggestionGuard';

const Yjs = Y as unknown as YjsLike;

/** A script kept in step with a Y.Doc, as the Collaboration extension keeps it. */
function synced(...blocks: JSONContent[]) {
  let state = EditorState.create({ schema: testSchema, doc: testSchema.nodeFromJSON(doc(...blocks)) });
  const ydoc = new Y.Doc();
  const fragment = ydoc.getXmlFragment(SCRIPT_FIELD);
  const meta = { mapping: new Map(), isOMark: new Map() };
  const write = (node: PmNode) => ydoc.transact(() => updateYFragment(ydoc, fragment, node, meta));
  write(state.doc);
  return {
    get state() { return state; },
    ydoc,
    /**
     * Apply `tr` and sync it: what the server would make of it from `by`.
     * Returns null when it would be let through, else why not.
     */
    send(tr: Transaction, by = 'Ann'): string | null {
      const before = Y.encodeStateAsUpdate(ydoc);
      let update: Uint8Array | null = null;
      const listener = (u: Uint8Array) => { update = update ? Y.mergeUpdates([update, u]) : u; };
      ydoc.on('update', listener);
      state = state.apply(tr);
      write(state.doc);
      ydoc.off('update', listener);
      // Every edit here changes the script, so there must be something to check.
      if (!update) throw new Error('the edit produced no update');
      const server = new Y.Doc();
      Y.applyUpdate(server, before);
      return checkSuggesterUpdate(Yjs, server, update, by);
    },
  };
}

const at = (s: EditorState, index: number, offset = 0) => {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += s.doc.child(i).nodeSize;
  return pos + 1 + offset;
};

const suggesting = (s: EditorState, edit: (tr: Transaction) => Transaction, by = 'Ann') =>
  suggestTransaction(s, edit(s.tr), { by, now: 1 });

describe('what a suggester may send', () => {
  it('a suggested insertion', () => {
    const c = synced(block('action', 'She waits.'));
    expect(c.send(suggesting(c.state, (tr) => tr.insertText(' alone', at(c.state, 0, 9))))).toBeNull();
  });

  it('a suggested deletion, and taking back their own suggestion', () => {
    const c = synced(block('action', 'She waits alone.'));
    expect(c.send(suggesting(c.state, (tr) => tr.delete(at(c.state, 0, 9), at(c.state, 0, 15))))).toBeNull();
    expect(c.send(suggesting(c.state, (tr) => tr.insertText('X', at(c.state, 0, 0))))).toBeNull();
    const own = listSuggestions(c.state.doc)[0];
    expect(c.send(resolveSuggestionTransaction(c.state, own.id, false)!)).toBeNull();
  });

  it('a suggested new line with words in it', () => {
    const c = synced(block('character', 'MAYA'), block('dialogue', 'Hi.'));
    expect(c.send(suggesting(c.state, (tr) => tr.split(at(c.state, 1, 3))))).toBeNull();
    expect(c.send(suggesting(c.state, (tr) => tr.insertText('Bye.', at(c.state, 2, 0))))).toBeNull();
  });

  it('a new line, then its type set — as the editor’s Enter does it', () => {
    const c = synced(block('character', 'MAYA'), block('dialogue', 'Hi.'));
    expect(c.send(suggesting(c.state, (tr) => tr.split(at(c.state, 1, 3), 1, [{ type: testSchema.nodes.action }])))).toBeNull();
    const pos = c.state.doc.child(0).nodeSize + c.state.doc.child(1).nodeSize;
    expect(c.send(suggesting(c.state, (tr) => tr.setNodeMarkup(pos, testSchema.nodes.dialogue)))).toBeNull();
    expect(c.state.doc.child(2).type.name).toBe('dialogue');
  });

  it('a suggested join, and a suggested change of element type', () => {
    const c = synced(block('action', 'One.'), block('action', 'MAYA'));
    expect(c.send(suggesting(c.state, (tr) => tr.delete(at(c.state, 0, 4), at(c.state, 1, 0))))).toBeNull();
    expect(c.send(suggesting(c.state, (tr) => tr.setBlockType(at(c.state, 1), at(c.state, 1), testSchema.nodes.character)))).toBeNull();
  });

  it('a script note', () => {
    const c = synced(block('action', 'Note me.'));
    expect(c.send(suggesting(c.state, (tr) => tr.addMark(1, 5, testSchema.marks.scriptNote.create({ noteId: 'n1' }))))).toBeNull();
  });

  it('an attribute default one app version writes and another does not', () => {
    const c = synced(block('dialogue', 'Hi.'));
    const before = Y.encodeStateAsUpdate(c.ydoc);
    let update: Uint8Array | null = null;
    c.ydoc.on('update', (u: Uint8Array) => { update = u; });
    (c.ydoc.getXmlFragment(SCRIPT_FIELD).get(0) as Y.XmlElement).setAttribute('someNewSetting', 0 as unknown as string);
    const server = new Y.Doc();
    Y.applyUpdate(server, before);
    expect(checkSuggesterUpdate(Yjs, server, update!, 'Ann')).toBeNull();
  });
});

describe('what a suggester may not send', () => {
  it('plain typing', () => {
    const c = synced(block('action', 'She waits.'));
    expect(c.send(c.state.tr.insertText(' alone', at(c.state, 0, 9)))).toMatch(/not a suggestion/);
  });

  it('a plain deletion', () => {
    const c = synced(block('action', 'She waits alone.'));
    expect(c.send(c.state.tr.delete(at(c.state, 0, 9), at(c.state, 0, 15)))).toMatch(/deleted text/);
  });

  it('accepting a suggestion — their own or anyone’s', () => {
    const c = synced(block('action', 'Go.'));
    expect(c.send(suggesting(c.state, (tr) => tr.insertText('Now', at(c.state, 0, 2))))).toBeNull();
    const own = listSuggestions(c.state.doc)[0];
    expect(c.send(resolveSuggestionTransaction(c.state, own.id, true)!)).toMatch(/suggestionInsert/);
  });

  it('a suggestion signed with someone else’s name', () => {
    const c = synced(block('action', 'Go.'));
    expect(c.send(suggesting(c.state, (tr) => tr.insertText('Now', at(c.state, 0, 2)), 'Ben'), 'Ann')).toMatch(/not a suggestion/);
  });

  it('withdrawing someone else’s suggestion', () => {
    const c = synced(block('action', 'Go.'));
    c.send(suggesting(c.state, (tr) => tr.insertText('Now', at(c.state, 0, 2)), 'Ben'), 'Ben');
    const bens = listSuggestions(c.state.doc)[0];
    expect(c.send(resolveSuggestionTransaction(c.state, bens.id, false)!, 'Ann')).toMatch(/deleted text/);
  });

  it('formatting', () => {
    const c = synced(block('action', 'Bold me.'));
    expect(c.send(c.state.tr.addMark(1, 5, testSchema.marks.bold.create()))).toMatch(/bold/);
  });

  it('changing an element’s attributes', () => {
    const c = synced({ ...block('sceneHeading', 'INT. A - DAY'), attrs: { sceneNumber: '1' } });
    expect(c.send(c.state.tr.setNodeAttribute(0, 'sceneNumber', '9'))).toMatch(/sceneNumber/);
  });

  it('a plain new line, or a change of type that is not suggested', () => {
    const c = synced(block('action', 'Before after.'));
    expect(c.send(c.state.tr.split(at(c.state, 0, 7)))).toMatch(/not a suggested new line/);
    const d = synced(block('action', 'MAYA'));
    expect(d.send(d.state.tr.setBlockType(1, 1, testSchema.nodes.character))).toMatch(/without suggesting/);
  });
});

describe('reading a client’s message', () => {
  const varUint = (n: number) => { const out: number[] = []; while (n > 0x7f) { out.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); } out.push(n); return out; };
  const bytes = (b: Uint8Array) => [...varUint(b.length), ...b];
  const message = (type: number, step: number | null, payload: Uint8Array) => new Uint8Array([
    ...bytes(new TextEncoder().encode('project/script')),
    ...varUint(type),
    ...(step === null ? [] : varUint(step)),
    ...bytes(payload),
  ]);

  it('finds the update in a sync update or a second sync step', () => {
    const payload = new Uint8Array(300).map((_, i) => i % 251);
    expect(updateInMessage(message(0, 2, payload))).toEqual(payload);
    expect(updateInMessage(message(0, 1, payload))).toEqual(payload);
  });

  it('finds none in the first sync step or an awareness message', () => {
    expect(updateInMessage(message(0, 0, new Uint8Array([1, 2])))).toBeNull();
    expect(updateInMessage(message(1, null, new Uint8Array([1, 2])))).toBeNull();
  });

  it('refuses a message that ends too soon', () => {
    expect(() => updateInMessage(new Uint8Array([5, 65]))).toThrow();
  });
});
