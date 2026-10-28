import { describe, it, expect, beforeEach } from 'vitest';
import {
  addNoteReply,
  assignNote,
  deleteNoteReply,
  editNoteReply,
  isNoteResolved,
  knownPeople,
  mentionToken,
  normalizeNoteThread,
  noteIsForPerson,
  noteReplies,
  personForMention,
  samePerson,
  setNoteResolved,
  splitMention,
  textMentions,
  type NoteThread,
} from './noteThreads';
import { useEditorStore, currentNoteAuthor, type NoteInfo } from '../stores/editorStore';
import { useSettingsStore } from '../stores/settingsStore';
import { hydrateEditorStoresFromContent } from './hydrateStores';

const T0 = new Date('2026-10-01T09:00:00.000Z');
const T1 = new Date('2026-10-02T10:30:00.000Z');

const legacyNote = (): NoteInfo => ({
  id: 'n1',
  content: 'Too long — cut?',
  anchorText: 'She walks',
  elementType: 'action',
  contextLabel: '',
  color: 'Yellow',
  createdAt: '2026-01-01T00:00:00.000Z',
  sceneId: null,
});

describe('reading thread data', () => {
  it('leaves a note from before threads exactly as it was', () => {
    const note = legacyNote();
    expect(normalizeNoteThread(note)).toBe(note);
    expect(isNoteResolved(note)).toBe(false);
    expect(noteReplies(note)).toEqual([]);
  });

  it('keeps a well-formed thread as the same object', () => {
    const note = {
      ...legacyNote(),
      author: 'Ana',
      replies: [{ id: 'r1', author: 'Ben', content: 'Agreed', createdAt: T0.toISOString() }],
      resolved: true,
      resolvedBy: 'Ana',
      resolvedAt: T1.toISOString(),
      assignee: 'Ben',
    };
    expect(normalizeNoteThread(note)).toBe(note);
  });

  it('drops replies that are not replies and repairs the rest', () => {
    const note = {
      ...legacyNote(),
      replies: [
        null,
        'text',
        { id: '', content: 'no id' },
        { id: 'r1', content: 'kept', author: 42 },
        { id: 'r2', content: 'also kept', author: 'Ben', createdAt: 'x', editedAt: 7 },
      ],
    } as unknown as NoteInfo;
    const fixed = normalizeNoteThread(note);
    expect(fixed).not.toBe(note);
    expect(fixed.replies).toEqual([
      { id: 'r1', content: 'kept', author: '', createdAt: '' },
      { id: 'r2', content: 'also kept', author: 'Ben', createdAt: 'x' },
    ]);
  });

  it('reads a resolved flag that is not a boolean, and removes names that are not strings', () => {
    const fixed = normalizeNoteThread({ ...legacyNote(), resolved: 'yes', assignee: 3, author: {} } as unknown as NoteInfo);
    expect(fixed.resolved).toBe(false);
    expect('assignee' in fixed).toBe(false);
    expect('author' in fixed).toBe(false);
    expect(normalizeNoteThread({ ...legacyNote(), replies: 'nope' } as unknown as NoteInfo)).not.toHaveProperty('replies');
  });
});

describe('changing a thread', () => {
  it('adds replies in order', () => {
    let note: NoteThread = {};
    note = { ...note, ...addNoteReply(note, 'Ana', 'First', T0) };
    note = { ...note, ...addNoteReply(note, 'Ben', 'Second', T1) };
    expect(noteReplies(note).map((r) => [r.author, r.content, r.createdAt])).toEqual([
      ['Ana', 'First', T0.toISOString()],
      ['Ben', 'Second', T1.toISOString()],
    ]);
    expect(new Set(noteReplies(note).map((r) => r.id)).size).toBe(2);
  });

  it('reopens a resolved note when someone replies', () => {
    const note: NoteThread = { resolved: true, resolvedBy: 'Ana', resolvedAt: T0.toISOString() };
    const next = { ...note, ...addNoteReply(note, 'Ben', 'Not done yet', T1) };
    expect(isNoteResolved(next)).toBe(false);
    expect(JSON.parse(JSON.stringify(next))).not.toHaveProperty('resolvedBy');
  });

  it('marks an edit only when the text changed', () => {
    const note: NoteThread = { replies: [{ id: 'r1', author: 'Ana', content: 'Hi', createdAt: '' }] };
    expect(noteReplies({ ...note, ...editNoteReply(note, 'r1', 'Hi', T1) })[0].editedAt).toBeUndefined();
    const edited = noteReplies({ ...note, ...editNoteReply(note, 'r1', 'Hello', T1) })[0];
    expect(edited).toMatchObject({ content: 'Hello', editedAt: T1.toISOString() });
  });

  it('deletes one reply', () => {
    const note: NoteThread = {
      replies: [
        { id: 'r1', author: 'Ana', content: 'a', createdAt: '' },
        { id: 'r2', author: 'Ben', content: 'b', createdAt: '' },
      ],
    };
    expect(noteReplies({ ...note, ...deleteNoteReply(note, 'r1') }).map((r) => r.id)).toEqual(['r2']);
  });

  it('resolves with who and when, and reopens without them', () => {
    expect(setNoteResolved(true, 'Ana', T0)).toEqual({ resolved: true, resolvedBy: 'Ana', resolvedAt: T0.toISOString() });
    const reopened = JSON.parse(JSON.stringify({ resolved: true, resolvedBy: 'Ana', ...setNoteResolved(false, 'Ben') }));
    expect(reopened).toEqual({ resolved: false });
    // Nobody signed in: resolved, but by no one in particular.
    expect(setNoteResolved(true, '', T0).resolvedBy).toBeUndefined();
  });

  it('assigns, and unassigns with an empty name', () => {
    expect(assignNote(' Ben ')).toEqual({ assignee: 'Ben' });
    expect(assignNote('')).toEqual({ assignee: undefined });
  });
});

describe('people and mentions', () => {
  it('matches a person whatever the case and spacing', () => {
    expect(samePerson('Jane  Doe', 'jane doe')).toBe(true);
    expect(samePerson('', '')).toBe(false);
  });

  it('writes a mention as one word and reads it back', () => {
    expect(mentionToken('Jane Doe')).toBe('@Jane_Doe');
    expect(personForMention('@jane_doe', ['Jane Doe', 'Ben'])).toBe('Jane Doe');
    expect(personForMention('@Nobody', ['Jane Doe'])).toBeNull();
  });

  it('keeps the punctuation after a mention, and a name that ends in some', () => {
    expect(splitMention('@Jane_Doe,', ['Jane Doe'])).toEqual({ person: 'Jane Doe', trail: ',' });
    expect(splitMention('@J.R.', ['J.R.'])).toEqual({ person: 'J.R.', trail: '' });
    expect(splitMention('@Ben?!', ['Ben'])).toEqual({ person: 'Ben', trail: '?!' });
  });

  it('finds a mention anywhere in the text', () => {
    expect(textMentions('Can @Jane_Doe look at this?', 'Jane Doe')).toBe(true);
    expect(textMentions('Can Jane look at this?', 'Jane Doe')).toBe(false);
    expect(textMentions('@Jane_Doe', '')).toBe(false);
  });

  it('knows a note is for someone by assignment or by mention in a reply', () => {
    const base = { content: 'Fix the scene' };
    expect(noteIsForPerson({ ...base, assignee: 'ben' }, 'Ben')).toBe(true);
    expect(noteIsForPerson({ ...base, replies: [{ id: 'r', author: 'Ana', content: 'over to @Ben', createdAt: '' }] }, 'Ben')).toBe(true);
    expect(noteIsForPerson(base, 'Ben')).toBe(false);
  });

  it('lists everyone once, from the session and from the notes', () => {
    const notes: NoteThread[] = [
      { author: 'Ana', assignee: 'ben', replies: [{ id: 'r', author: 'Cleo', content: '', createdAt: '' }] },
      { author: '', resolvedBy: 'Dev' },
    ];
    expect(knownPeople(notes, ['Ben', null, ' ', 'ana'])).toEqual(['ana', 'Ben', 'Cleo', 'Dev']);
  });
});

describe('the note store', () => {
  beforeEach(() => {
    useEditorStore.setState({ notes: [], generalNotes: [], collabSelfName: null, collabPeerNames: [] });
    useSettingsStore.setState({ collabAuth: { accessToken: null, refreshToken: null, user: null } });
  });

  it('signs a new note with the collaboration name, else the account, else nothing', () => {
    const add = () => {
      const id = useEditorStore.getState().addNote({
        content: '', anchorText: '', elementType: 'action', contextLabel: '', color: 'Yellow', sceneId: null,
      });
      return useEditorStore.getState().notes.find((n) => n.id === id)!;
    };
    expect(add()).not.toHaveProperty('author');

    useSettingsStore.setState({
      collabAuth: { accessToken: 't', refreshToken: null, user: { id: 'u', email: 'a@b.c', displayName: 'Ana', emailVerified: true } },
    });
    expect(add().author).toBe('Ana');

    useEditorStore.getState().setCollabIdentity('Ana (laptop)', ['Ben']);
    expect(currentNoteAuthor()).toBe('Ana (laptop)');
    expect(add().author).toBe('Ana (laptop)');
  });

  it('signs a new general note the same way', () => {
    useEditorStore.getState().setCollabIdentity('Ben', []);
    const id = useEditorStore.getState().addGeneralNote({ title: 't', content: '', color: 'Yellow' });
    expect(useEditorStore.getState().generalNotes.find((n) => n.id === id)?.author).toBe('Ben');
  });

  it('repairs thread data on every load path', () => {
    const bad = { ...legacyNote(), replies: [{ nope: true }], resolved: 1 } as unknown as NoteInfo;
    useEditorStore.getState().setNotes([bad]);
    expect(useEditorStore.getState().notes[0]).toMatchObject({ replies: [], resolved: false });

    hydrateEditorStoresFromContent({ _notes: JSON.stringify([bad]), _generalNotes: [{ ...bad, title: '' }] });
    expect(useEditorStore.getState().notes[0].replies).toEqual([]);
    expect(useEditorStore.getState().generalNotes[0].resolved).toBe(false);
  });

  it('carries a thread through a save and load unchanged', () => {
    const note: NoteInfo = {
      ...legacyNote(),
      author: 'Ana',
      assignee: 'Ben',
      resolved: true,
      resolvedBy: 'Ben',
      resolvedAt: T1.toISOString(),
      replies: [{ id: 'r1', author: 'Ben', content: 'Done @Ana', createdAt: T0.toISOString(), editedAt: T1.toISOString() }],
    };
    hydrateEditorStoresFromContent({ _notes: JSON.parse(JSON.stringify([note])) });
    expect(useEditorStore.getState().notes).toEqual([note]);
  });

  it('does not touch the store when the same people are reported again', () => {
    const s = useEditorStore.getState();
    s.setCollabIdentity('Ana', ['Ana', 'Ben']);
    const before = useEditorStore.getState();
    s.setCollabIdentity('Ana', ['Ana', 'Ben']);
    expect(useEditorStore.getState()).toBe(before);
    s.setCollabIdentity('Ana', ['Ana']);
    expect(useEditorStore.getState().collabPeerNames).toEqual(['Ana']);
  });

  it('reads a notes list that is not a list as empty', () => {
    useEditorStore.getState().setNotes({} as unknown as NoteInfo[]);
    expect(useEditorStore.getState().notes).toEqual([]);
  });

  it('keeps thread fields through an edit that knows nothing about them', () => {
    // What an older version does to a note it opens: spread an update over it.
    useEditorStore.getState().setNotes([{ ...legacyNote(), replies: [{ id: 'r', author: 'A', content: 'x', createdAt: '' }] }]);
    useEditorStore.getState().updateNote('n1', { color: 'Red' });
    expect(useEditorStore.getState().notes[0].replies).toHaveLength(1);
  });
});
