import { describe, it, expect } from 'vitest';
import {
  addedNoteIds,
  mergeNote,
  mergeNoteLists,
  noteListIds,
  removedNoteIds,
  withoutDeletedNotes,
  type NoteMergeContext,
  type NoteReply,
  type NoteThread,
} from './noteThreads';

type N = NoteThread & { id: string; content: string };

const reply = (id: string, createdAt: string, content = id, extra: Partial<NoteReply> = {}): NoteReply => ({
  id, author: 'Ana', content, createdAt, ...extra,
});
const note = (id: string, extra: Partial<N> = {}): N => ({ id, content: `note ${id}`, ...extra });

const nothingDeleted: NoteMergeContext = { isDeleted: () => false };
const deleted = (...ids: string[]): NoteMergeContext => ({ isDeleted: (id) => ids.includes(id) });

describe('merging replies', () => {
  it('keeps both of two replies posted at once, in the order they were posted', () => {
    const base = [reply('r0', '2026-10-01T09:00:00Z')];
    const mine = note('n1', { replies: [...base, reply('rA', '2026-10-01T09:05:00Z')] });
    const theirs = note('n1', { replies: [...base, reply('rB', '2026-10-01T09:06:00Z')] });
    const merged = mergeNote(mine, theirs, nothingDeleted);
    expect(merged.replies!.map((r) => r.id)).toEqual(['r0', 'rA', 'rB']);
    // The other side, receiving the merge, has nothing to add: they agree.
    expect(mergeNote(theirs, merged, nothingDeleted)).toBe(merged);
  });

  it('puts a reply only this copy has among the others by when it was posted', () => {
    const mine = note('n1', { replies: [reply('rA', '2026-10-01T09:05:00Z')] });
    const theirs = note('n1', { replies: [reply('rB', '2026-10-01T09:06:00Z')] });
    expect(mergeNote(theirs, mine, nothingDeleted).replies!.map((r) => r.id)).toEqual(['rA', 'rB']);
  });

  it('keeps the later edit of a reply, whichever side has it', () => {
    const old = reply('r1', '2026-10-01T09:00:00Z', 'first');
    const edited = reply('r1', '2026-10-01T09:00:00Z', 'second', { editedAt: '2026-10-01T10:00:00Z' });
    const later = reply('r1', '2026-10-01T09:00:00Z', 'third', { editedAt: '2026-10-01T11:00:00Z' });
    expect(mergeNote(note('n', { replies: [edited] }), note('n', { replies: [old] }), nothingDeleted).replies).toEqual([edited]);
    expect(mergeNote(note('n', { replies: [edited] }), note('n', { replies: [later] }), nothingDeleted).replies).toEqual([later]);
    expect(mergeNote(note('n', { replies: [later] }), note('n', { replies: [edited] }), nothingDeleted).replies).toEqual([later]);
  });

  it('settles an edit tie on the arrival, so both ends agree', () => {
    const at = { editedAt: '2026-10-01T10:00:00Z' };
    const a = reply('r1', '2026-10-01T09:00:00Z', 'mine', at);
    const b = reply('r1', '2026-10-01T09:00:00Z', 'theirs', at);
    expect(mergeNote(note('n', { replies: [a] }), note('n', { replies: [b] }), nothingDeleted).replies).toEqual([b]);
  });

  it('does not bring back a reply deleted here while the other side still had it', () => {
    const r1 = reply('r1', '2026-10-01T09:00:00Z');
    const r2 = reply('r2', '2026-10-01T09:10:00Z');
    const mine = note('n1', { replies: [] });
    const theirs = note('n1', { replies: [r1, r2] });
    expect(mergeNote(mine, theirs, deleted('r1')).replies).toEqual([r2]);
  });

  it('does not bring back a reply deleted elsewhere that this copy still has', () => {
    const r1 = reply('r1', '2026-10-01T09:00:00Z');
    const mine = note('n1', { replies: [r1] });
    const theirs = note('n1', { replies: [] });
    // Recorded as deleted by a current version…
    expect(mergeNote(mine, theirs, deleted('r1')).replies).toEqual([]);
    // …or deleted by an older one, which records nothing: it was in the last
    // copy received, so whoever sent this one took it out.
    expect(mergeNote(mine, theirs, { isDeleted: () => false, lastRemote: new Set(['n1', 'r1']) }).replies).toEqual([]);
    // Never seen by the other side: new here, kept.
    expect(mergeNote(mine, theirs, { isDeleted: () => false, lastRemote: new Set(['n1']) }).replies).toEqual([r1]);
  });
});

describe('merging resolve and assign', () => {
  const r0 = reply('r0', '2026-10-01T09:00:00Z');
  const rA = reply('rA', '2026-10-01T09:05:00Z');
  const resolved = { resolved: true, resolvedBy: 'Ben', resolvedAt: '2026-10-01T09:06:00Z' };

  it('reopens a note resolved while a reply it had not seen was being posted', () => {
    const mine = note('n1', { replies: [r0, rA] });
    const theirs = note('n1', { replies: [r0], ...resolved });
    const merged = mergeNote(mine, theirs, nothingDeleted);
    expect(merged.resolved).toBe(false);
    expect(merged.resolvedBy).toBeUndefined();
    expect(merged.resolvedAt).toBeUndefined();
    expect(merged.replies!.map((r) => r.id)).toEqual(['r0', 'rA']);
  });

  it('takes a resolve that saw every reply', () => {
    const mine = note('n1', { replies: [r0, rA] });
    const theirs = note('n1', { replies: [r0, rA], ...resolved });
    expect(mergeNote(mine, theirs, nothingDeleted)).toBe(theirs);
  });

  it('takes the assignee, text and resolved state from the arrival', () => {
    const mine = note('n1', { content: 'mine', assignee: 'Ana' });
    const theirs = note('n1', { content: 'theirs', assignee: 'Ben', ...resolved });
    expect(mergeNote(mine, theirs, nothingDeleted)).toBe(theirs);
  });
});

describe('merging notes lists', () => {
  it('keeps a note added here while another was added there', () => {
    const shared = note('n0');
    const merged = mergeNoteLists([shared, note('mine')], [shared, note('theirs')], nothingDeleted);
    expect(merged.map((n) => n.id)).toEqual(['n0', 'theirs', 'mine']);
    expect(mergeNoteLists([shared, note('theirs')], merged, nothingDeleted)).toBe(merged);
  });

  it('returns the arrival itself when it has everything', () => {
    const remote = [note('a', { replies: [reply('r', '2026-10-01T09:00:00Z')] }), note('b')];
    const local = JSON.parse(JSON.stringify(remote)) as N[];
    expect(mergeNoteLists(local, remote, nothingDeleted)).toBe(remote);
  });

  it('does not resurrect a deleted note from either side', () => {
    // Deleted here, the other side still had it.
    expect(mergeNoteLists([note('b')], [note('a'), note('b')], deleted('a')).map((n) => n.id)).toEqual(['b']);
    // Deleted there, this side still has it.
    expect(mergeNoteLists([note('a'), note('b')], [note('b')], deleted('a')).map((n) => n.id)).toEqual(['b']);
    // Deleted there by an older version: in the last copy received, gone now.
    expect(mergeNoteLists([note('a'), note('b')], [note('b')], { isDeleted: () => false, lastRemote: new Set(['a', 'b']) }).map((n) => n.id))
      .toEqual(['b']);
  });

  it('strips deleted replies from notes only one side has', () => {
    const theirs = note('t', { replies: [reply('r1', '2026-10-01T09:00:00Z'), reply('r2', '2026-10-01T09:01:00Z')] });
    const mine = note('m', { replies: [reply('r3', '2026-10-01T09:02:00Z')] });
    const merged = mergeNoteLists([mine], [theirs], deleted('r1', 'r3'));
    expect(merged.map((n) => [n.id, n.replies!.map((r) => r.id)])).toEqual([['t', ['r2']], ['m', []]]);
  });

  it('converges: each side merging the other ends on the same list', () => {
    const shared = note('n0', { replies: [reply('r0', '2026-10-01T09:00:00Z')] });
    const a = [{ ...shared, replies: [...shared.replies!, reply('ra', '2026-10-01T09:01:00Z')] }, note('na')];
    const b = [{ ...shared, replies: [...shared.replies!, reply('rb', '2026-10-01T09:02:00Z')] }, note('nb')];
    // b won the race; a merges and sends its result; b merges that.
    const atA = mergeNoteLists(a, b, nothingDeleted);
    const atB = mergeNoteLists(b, atA, { isDeleted: () => false, lastRemote: noteListIds(b) });
    expect(atB).toBe(atA);
    expect(atA.map((n) => n.id)).toEqual(['n0', 'nb', 'na']);
    expect(atA[0].replies!.map((r) => r.id)).toEqual(['r0', 'ra', 'rb']);
  });
});

describe('telling what changed', () => {
  const r = (id: string) => reply(id, '2026-10-01T09:00:00Z');
  const prev = [note('a', { replies: [r('r1'), r('r2')] }), note('b', { replies: [r('r3')] })];

  it('lists deleted notes, and deleted replies of notes that stay', () => {
    const next = [{ ...prev[0], replies: [r('r2')] }];
    expect(removedNoteIds(prev, next).sort()).toEqual(['b', 'r1']);
    expect(removedNoteIds(prev, prev)).toEqual([]);
  });

  it('lists notes and replies that are new', () => {
    const next = [{ ...prev[0], replies: [r('r1'), r('r2'), r('r9')] }, prev[1], note('c')];
    expect(addedNoteIds(prev, next).sort()).toEqual(['c', 'r9']);
  });

  it('takes deleted notes and replies out, and leaves a clean list as it is', () => {
    expect(withoutDeletedNotes(prev, (id) => id === 'b' || id === 'r1').map((n) => [n.id, n.replies!.map((x) => x.id)]))
      .toEqual([['a', ['r2']]]);
    expect(withoutDeletedNotes(prev, () => false)).toBe(prev);
  });
});
