/**
 * Notes in a collaboration session: two copies of the shared Yjs document, one
 * bound to the store through collabSync (this writer) and one written to
 * directly (a collaborator). Updates are exchanged by hand, so a "concurrent"
 * change is simply one made on both sides before the next exchange.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { startCollabSync, stopCollabSync, NOTE_TOMBSTONE_TTL_MS } from './collabSync';
import { useEditorStore, type GeneralNote } from '../stores/editorStore';
import { addNoteReply, deleteNoteReply, setNoteResolved, type NoteReply } from '../utils/noteThreads';

const reply = (id: string, createdAt: string, content = id): NoteReply => ({ id, author: 'Ben', content, createdAt });
const general = (id: string, extra: Partial<GeneralNote> = {}): GeneralNote => ({
  id, title: id, content: `about ${id}`, color: 'Yellow', createdAt: '2026-10-01T08:00:00.000Z', ...extra,
});

let mine: Y.Doc;
let peer: Y.Doc;

/** Exchange everything each side has that the other lacks. */
function exchange() {
  const toPeer = Y.encodeStateAsUpdate(mine, Y.encodeStateVector(peer));
  const toMine = Y.encodeStateAsUpdate(peer, Y.encodeStateVector(mine));
  Y.applyUpdate(peer, toPeer, 'remote');
  Y.applyUpdate(mine, toMine, 'remote');
}

const peerNotes = (): GeneralNote[] => JSON.parse(peer.getMap<string>('metadata').get('generalNotes') ?? '[]');
const peerWrites = (notes: GeneralNote[]) => peer.getMap<string>('metadata').set('generalNotes', JSON.stringify(notes));
const storeNotes = () => useEditorStore.getState().generalNotes;
const ids = (list: Array<{ id: string }>) => list.map((n) => n.id);
const replyIds = (n: GeneralNote | undefined) => (n?.replies ?? []).map((r) => r.id);

beforeEach(() => {
  mine = new Y.Doc();
  peer = new Y.Doc();
  // Concurrent writes to one key go to the higher client id: the peer's, so
  // every race below is one this writer loses.
  mine.clientID = 1;
  peer.clientID = 2;
  useEditorStore.setState({ notes: [], generalNotes: [] });
});

afterEach(() => {
  stopCollabSync();
});

/** Host with these notes, already shared with the peer. */
function hostWith(notes: GeneralNote[]) {
  useEditorStore.getState().setGeneralNotes(notes);
  startCollabSync(mine, true);
  exchange();
}

describe('collaborating on notes', () => {
  it('keeps both replies when two people reply within one round trip', () => {
    hostWith([general('n1', { replies: [reply('r0', '2026-10-01T09:00:00.000Z')] })]);

    const s = useEditorStore.getState();
    s.updateGeneralNote('n1', addNoteReply(s.generalNotes[0], 'Ana', 'mine'));
    const myReply = storeNotes()[0].replies![1].id;
    peerWrites([general('n1', { replies: [reply('r0', '2026-10-01T09:00:00.000Z'), reply('rB', '2026-10-01T09:00:01.000Z')] })]);

    exchange(); // the peer's list wins; this side merges and sends the merge back
    expect(replyIds(storeNotes()[0]).sort()).toEqual(['r0', 'rB', myReply].sort());
    exchange();
    expect(replyIds(peerNotes()[0]).sort()).toEqual(['r0', 'rB', myReply].sort());
  });

  it('keeps both notes when two people add one each', () => {
    hostWith([general('n0')]);
    useEditorStore.getState().addGeneralNote({ title: 'Mine', content: 'mine', color: 'Blue' });
    peerWrites([general('n0'), general('theirs')]);
    exchange();
    exchange();
    expect(ids(storeNotes())).toHaveLength(3);
    expect(ids(peerNotes())).toEqual(ids(storeNotes()));
  });

  it('does not bring back a reply deleted here while the peer was replying', () => {
    const r1 = reply('r1', '2026-10-01T09:00:00.000Z');
    hostWith([general('n1', { replies: [r1] })]);

    const s = useEditorStore.getState();
    s.updateGeneralNote('n1', deleteNoteReply(s.generalNotes[0], 'r1'));
    // The peer had not seen the deletion and still has r1 in its copy.
    peerWrites([general('n1', { replies: [r1, reply('r2', '2026-10-01T09:05:00.000Z')] })]);

    exchange();
    expect(replyIds(storeNotes()[0])).toEqual(['r2']);
    exchange();
    expect(replyIds(peerNotes()[0])).toEqual(['r2']);
    expect(peer.getMap('noteTombstones').has('r1')).toBe(true);
  });

  it('does not bring back a note deleted here when only the deletion reaches the peer', () => {
    hostWith([general('a'), general('b')]);
    useEditorStore.getState().deleteGeneralNote('a');
    // The peer's list, still holding "a", wins the race for the list…
    peerWrites([general('a'), general('b'), general('c')]);
    exchange();
    expect(ids(storeNotes())).toEqual(['b', 'c']);
    exchange();
    expect(ids(peerNotes())).toEqual(['b', 'c']);
  });

  it('honours a deletion by an older version, which records no tombstone', () => {
    hostWith([general('a', { replies: [reply('r1', '2026-10-01T09:00:00.000Z')] }), general('b')]);
    // The peer saw both notes, then deleted "b" and the reply.
    peerWrites([general('a')]);
    exchange();
    expect(ids(storeNotes())).toEqual(['a']);
    expect(replyIds(storeNotes()[0])).toEqual([]);
  });

  it('reopens a note resolved while a reply was being posted', () => {
    hostWith([general('n1')]);
    const s = useEditorStore.getState();
    s.updateGeneralNote('n1', addNoteReply(s.generalNotes[0], 'Ana', 'one more thing'));
    peerWrites([general('n1', setNoteResolved(true, 'Ben') as Partial<GeneralNote>)]);
    exchange();
    expect(storeNotes()[0].resolved).toBe(false);
    expect(storeNotes()[0].replies).toHaveLength(1);
  });

  it('gives a guest the shared notes, not the ones it had open', () => {
    peerWrites([general('shared')]);
    exchange();
    useEditorStore.getState().setGeneralNotes([general('stale')]);
    startCollabSync(mine, false);
    expect(ids(storeNotes())).toEqual(['shared']);
  });

  it('forgets old deletions when a session starts', () => {
    const tombs = mine.getMap<string>('noteTombstones');
    tombs.set('old', new Date(Date.now() - NOTE_TOMBSTONE_TTL_MS - 1000).toISOString());
    tombs.set('recent', new Date().toISOString());
    tombs.set('garbled', 'not a date');
    hostWith([]);
    expect([...tombs.keys()]).toEqual(['recent']);
  });

  it('carries a beat’s linked scenes both ways', () => {
    useEditorStore.setState({ beats: [] });
    hostWith([]);
    const b = {
      id: 'b1', title: 'Midpoint', description: '', columnId: 'c', position: 0, color: '', imageUrl: '',
      cardWidth: 0, cardHeight: 0, x: 0, y: 0, imageHeight: 0, sceneIds: ['scene-a'],
    };
    useEditorStore.getState().setBeats([b]);
    exchange();
    expect(JSON.parse(peer.getMap<string>('metadata').get('beats')!)[0].sceneIds).toEqual(['scene-a']);
    peer.getMap<string>('metadata').set('beats', JSON.stringify([{ ...b, sceneIds: ['scene-a', 'scene-b'] }]));
    exchange();
    expect(useEditorStore.getState().beats[0].sceneIds).toEqual(['scene-a', 'scene-b']);
  });

  it('sends nothing back when it has nothing to add', () => {
    hostWith([general('n1')]);
    let updates = 0;
    mine.on('update', (_u: Uint8Array, origin: unknown) => { if (origin !== 'remote') updates++; });
    peerWrites([general('n1', { content: 'edited by the peer' })]);
    exchange();
    expect(storeNotes()[0].content).toBe('edited by the peer');
    expect(updates).toBe(0);
  });
});
