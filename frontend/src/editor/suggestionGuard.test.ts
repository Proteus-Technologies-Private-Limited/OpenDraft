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
import { createHash } from 'node:crypto';
import { isOwn, listSuggestions, onlyGivesSceneIds, resolveSuggestionTransaction, suggestTransaction } from './suggestions';
import { ensureSceneUid } from '../utils/beatScenes';
import { sha256Hex } from '../utils/sha256';
import { suggesterIdOf } from '../utils/suggesterId';
import {
  checkSuggesterUpdate, suggesterIdOf as serverSuggesterIdOf, updateInMessage, MAX_ALIGN_CELLS, SCRIPT_FIELD, type YjsLike,
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
    send(tr: Transaction, by = 'Ann', uid: string | null = null): string | null {
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
      return checkSuggesterUpdate(Yjs, server, update, { name: by, uid });
    },
  };
}

const at = (s: EditorState, index: number, offset = 0) => {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += s.doc.child(i).nodeSize;
  return pos + 1 + offset;
};

const suggesting = (s: EditorState, edit: (tr: Transaction) => Transaction, by = 'Ann', uid: string | null = null) =>
  suggestTransaction(s, edit(s.tr), { by, uid, now: 1 });

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
    expect(checkSuggesterUpdate(Yjs, server, update!, { name: 'Ann' })).toBeNull();
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

describe('two suggesters with the same name', () => {
  it('each owns only their own suggestions, by id', () => {
    const c = synced(block('action', 'Go.'));
    expect(c.send(suggesting(c.state, (tr) => tr.insertText('Now', at(c.state, 0, 2)), 'Sam', 'id-one'), 'Sam', 'id-one')).toBeNull();
    const first = listSuggestions(c.state.doc)[0];
    expect(first.uid).toBe('id-one');
    expect(isOwn(first, { by: 'Sam', uid: 'id-two' })).toBe(false);
    expect(isOwn(first, { by: 'Sam', uid: 'id-one' })).toBe(true);
    // As on the server: a stamp with an id is not anyone's who has none.
    expect(isOwn(first, { by: 'Sam' })).toBe(false);
    // The other Sam can neither withdraw it nor sign as the first.
    expect(c.send(resolveSuggestionTransaction(c.state, first.id, false)!, 'Sam', 'id-two')).toMatch(/deleted text/);
    const d = synced(block('action', 'Go.'));
    expect(d.send(suggesting(d.state, (tr) => tr.insertText('Now', at(d.state, 0, 2)), 'Sam', 'id-one'), 'Sam', 'id-two')).toMatch(/not a suggestion/);
  });

  it('a suggestion made before ids goes by name', () => {
    const c = synced(block('action', 'Go.'));
    expect(c.send(suggesting(c.state, (tr) => tr.insertText('Now', at(c.state, 0, 2)), 'Sam'), 'Sam', 'id-one')).toBeNull();
    const old = listSuggestions(c.state.doc)[0];
    expect(c.send(resolveSuggestionTransaction(c.state, old.id, false)!, 'Sam', 'id-one')).toBeNull();
  });

  it('a name with someone else’s id is not theirs either', () => {
    const c = synced(block('action', 'Go.'));
    expect(c.send(suggesting(c.state, (tr) => tr.insertText('Now', at(c.state, 0, 2)), 'Ben', 'id-one'), 'Sam', 'id-one')).toMatch(/not a suggestion/);
  });

  it('the editor and the collab server work out the same id from an invite', () => {
    const node = (text: string) => createHash('sha256').update(text).digest('hex');
    for (const text of ['', 'abc', 'é and 日本', 'x'.repeat(1000)]) expect(sha256Hex(text)).toBe(node(text));
    const token = 'k3J9_example-invite-token';
    expect(suggesterIdOf(token)).toBe(serverSuggesterIdOf(node, token));
    expect(suggesterIdOf(token)).toMatch(/^[0-9a-f]{16}$/);
    expect(suggesterIdOf('')).toBeNull();
  });
});

describe('linking a Beat Board beat to a scene, as a suggester', () => {
  it('may give a heading its first id, and nothing more', () => {
    const c = synced(block('sceneHeading', 'INT. ROOM - DAY'), block('action', 'She waits.'));
    const given = ensureSceneUid(c.state, 0)!;
    expect(onlyGivesSceneIds(given.tr!)).toBe(true);
    expect(c.send(given.tr!)).toBeNull();
    // Changing it again — what a copy's heading is given — is not housekeeping a suggester keeps.
    const changed = c.state.tr.setNodeAttribute(0, 'sceneUid', 'another').setMeta('addToHistory', false);
    expect(onlyGivesSceneIds(changed)).toBe(false);
    expect(c.send(changed)).toMatch(/sceneUid/);
  });

  it('not on an element that is not a scene heading, nor alongside other changes', () => {
    // An action has no such attribute in the editor; a changed client could still write one.
    const c = synced(block('action', 'She waits.'));
    const before = Y.encodeStateAsUpdate(c.ydoc);
    let update: Uint8Array | null = null;
    c.ydoc.on('update', (u: Uint8Array) => { update = u; });
    (c.ydoc.getXmlFragment(SCRIPT_FIELD).get(0) as Y.XmlElement).setAttribute('sceneUid', 'x');
    const server = new Y.Doc();
    Y.applyUpdate(server, before);
    expect(checkSuggesterUpdate(Yjs, server, update!, { name: 'Ann' })).toMatch(/sceneUid/);
    const s = synced(block('sceneHeading', 'INT. ROOM - DAY')).state;
    expect(onlyGivesSceneIds(s.tr.setNodeAttribute(0, 'sceneUid', 'x').insertText('!', 3))).toBe(false);
  });
});

describe('scene ids a suggester brings in', () => {
  const heading = (text: string, sceneUid?: string) => ({ ...block('sceneHeading', text), ...(sceneUid ? { attrs: { sceneUid } } : {}) });

  it('not the id another scene already has', () => {
    const c = synced(heading('INT. ROOM - DAY', 'taken'), block('action', 'She waits.'), heading('EXT. YARD - NIGHT'));
    const pos = c.state.doc.child(0).nodeSize + c.state.doc.child(1).nodeSize;
    const tr = c.state.tr.setNodeAttribute(pos, 'sceneUid', 'taken').setMeta('addToHistory', false);
    expect(onlyGivesSceneIds(tr)).toBe(true);
    expect(c.send(tr)).toMatch(/id of another scene/);
  });

  it('nor on a suggested new heading', () => {
    const c = synced(heading('INT. ROOM - DAY', 'taken'), block('action', 'She waits.'));
    const end = c.state.doc.content.size;
    const copy = testSchema.nodeFromJSON(heading('INT. ROOM - DAY', 'taken'));
    expect(c.send(suggesting(c.state, (tr) => tr.insert(end, copy)))).toMatch(/id of another scene/);
    // Without the id, the same new heading is an ordinary suggestion.
    const d = synced(heading('INT. ROOM - DAY', 'taken'), block('action', 'She waits.'));
    const plain = testSchema.nodeFromJSON(heading('INT. ROOM - DAY'));
    expect(d.send(suggesting(d.state, (tr) => tr.insert(d.state.doc.content.size, plain)))).toBeNull();
  });

  it('a fresh id is still fine, and so is editing a script that already has copies', () => {
    const c = synced(heading('INT. ROOM - DAY', 'dup'), heading('INT. ROOM - DAY', 'dup'), heading('EXT. YARD - NIGHT'));
    const pos = c.state.doc.child(0).nodeSize + c.state.doc.child(1).nodeSize;
    expect(c.send(c.state.tr.setNodeAttribute(pos, 'sceneUid', 'fresh').setMeta('addToHistory', false))).toBeNull();
    expect(c.send(suggesting(c.state, (tr) => tr.insertText(' LATER', at(c.state, 1, 15))))).toBeNull();
  });
});

describe('one server document across many messages', () => {
  /** Two clients on one server document that keeps a copy for checking, as the collab server does. */
  function room(...blocks: JSONContent[]) {
    const host = synced(...blocks);
    const server = new Y.Doc();
    Y.applyUpdate(server, Y.encodeStateAsUpdate(host.ydoc));
    const meta = { mapping: new Map(), isOMark: new Map() };
    const guest = { state: host.state };
    const guestDoc = new Y.Doc();
    Y.applyUpdate(guestDoc, Y.encodeStateAsUpdate(server));
    const fragment = guestDoc.getXmlFragment(SCRIPT_FIELD);
    return {
      guest,
      /** The suggester's edit as it reaches the server: checked, then applied if let through. */
      suggest(tr: Transaction): string | null {
        let update: Uint8Array | null = null;
        const listener = (u: Uint8Array) => { update = update ? Y.mergeUpdates([update, u]) : u; };
        guestDoc.on('update', listener);
        guest.state = guest.state.apply(tr);
        guestDoc.transact(() => updateYFragment(guestDoc, fragment, guest.state.doc, meta));
        guestDoc.off('update', listener);
        const why = checkSuggesterUpdate(Yjs, server, update!, { name: 'Ann', uid: 'ann' });
        if (!why) Y.applyUpdate(server, update!);
        return why;
      },
      /** An editor's own change, straight into the server document. */
      edit(apply: (fragment: Y.XmlFragment) => void) {
        const before = Y.encodeStateVector(server);
        apply(server.getXmlFragment(SCRIPT_FIELD));
        Y.applyUpdate(guestDoc, Y.encodeStateAsUpdate(server, before));
        // y-prosemirror would bring it into the guest's editor; here the next
        // edit is made against a state read back from the guest's document.
      },
      server,
    };
  }

  it('checks each message against the document as it now is', () => {
    const lines = Array.from({ length: 200 }, (_, i) => block('action', `Line ${i}.`));
    const r = room(...lines);
    const at0 = (i: number, o: number) => at(r.guest.state, i, o);
    for (let i = 0; i < 20; i++) {
      expect(r.suggest(suggesting(r.guest.state, (tr) => tr.insertText('!', at0(i * 7, 4)), 'Ann', 'ann'))).toBeNull();
    }
    expect(r.suggest(suggesting(r.guest.state, (tr) => tr.delete(at0(150, 0), at0(150, 4)), 'Ann', 'ann'))).toBeNull();
    // A refusal is refused however many messages came first…
    expect(r.suggest(r.guest.state.tr.insertText('plain', at0(199, 0)))).toMatch(/not a suggestion/);
  });

  it('keeps up with the editor’s changes between a suggester’s', () => {
    const r = room(block('action', 'One.'), block('action', 'Two.'), block('action', 'Three.'));
    expect(r.suggest(suggesting(r.guest.state, (tr) => tr.insertText(' more', at(r.guest.state, 1, 3)), 'Ann', 'ann'))).toBeNull();
    // The editor edits line 0 directly: the server's copy follows the document.
    r.edit((f) => (((f.get(0) as Y.XmlElement).get(0)) as Y.XmlText).insert(0, 'Just '));
    expect((r.server.getXmlFragment(SCRIPT_FIELD).get(0) as Y.XmlElement).toString()).toContain('Just One.');
    // Without the editor's change in the guest's view, taking back its own
    // suggestion still checks against what the server holds.
    const own = listSuggestions(r.guest.state.doc)[0];
    expect(r.suggest(resolveSuggestionTransaction(r.guest.state, own.id, false)!)).toBeNull();
  });
});

describe('a large change', () => {
  it('a long suggested replacement passes without the full alignment', () => {
    const lines = Array.from({ length: 400 }, (_, i) => block('action', `This is line number ${i} of the script.`));
    const c = synced(...lines);
    const end = c.state.doc.content.size - 1;
    const pasted = 'An entirely new scene, pasted over all of it. '.repeat(120);
    const tr = suggesting(c.state, (t) => t.insertText(pasted, 1, end), 'Ann');
    const size = (c.state.doc.textContent.length) * (pasted.length);
    expect(size).toBeGreaterThan(MAX_ALIGN_CELLS);
    expect(c.send(tr)).toBeNull();
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
