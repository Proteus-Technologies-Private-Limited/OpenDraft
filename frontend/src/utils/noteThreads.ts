/**
 * Threaded comments on notes: who wrote a note, the replies under it, whether
 * it is resolved and who it is assigned to.
 *
 * Every field is optional and absent means the obvious thing — no author
 * recorded, no replies, open, unassigned — so a note saved before threads
 * existed reads back as an open note with nothing under it, and a script that
 * never uses them saves exactly as it did before. An older version that opens
 * a newer script keeps the fields too: it changes notes by spreading updates
 * over them, which carries anything it does not know about.
 *
 * The functions that change a thread return the fields to update rather than
 * a new note, so they go straight into `updateNote` / `updateGeneralNote`.
 */
import { uuid } from './uuid';

export interface NoteReply {
  id: string;
  /** Display name of whoever wrote it; empty when nobody was signed in. */
  author: string;
  content: string;
  createdAt: string;
  /** Set when the reply was changed after it was posted. */
  editedAt?: string;
}

/** The thread fields an anchored note and a general note share. */
export interface NoteThread {
  /** Display name of whoever created the note. Absent on notes from before
   *  threads, and when nobody was signed in. */
  author?: string;
  replies?: NoteReply[];
  resolved?: boolean;
  resolvedBy?: string;
  resolvedAt?: string;
  /** Display name of the collaborator the note is assigned to. */
  assignee?: string;
}

/** The fields to write to a note, as `updateNote` takes them. */
export type NoteThreadUpdate = Partial<NoteThread>;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Repair the thread fields of a note read from a file or a collaborator.
 *
 * Nothing is added to a note that does not use threads: absent already reads
 * as open, unassigned and without replies. What this does is make malformed
 * thread data — a hand-edited file, a foreign tool, a half-written sync — safe
 * for the panel to render: replies that are not replies are dropped, a
 * `resolved` that is not a boolean is read as one, names that are not strings
 * are removed. A note that needs none of that is returned as the same object.
 */
export function normalizeNoteThread<T>(note: T): T {
  if (!isObject(note)) return note;
  const n = note as Record<string, unknown>;
  let out: Record<string, unknown> | null = null;
  const edit = () => (out ??= { ...n });

  if ('replies' in n) {
    if (!Array.isArray(n.replies)) {
      delete edit().replies;
    } else {
      let changed = false;
      const replies: NoteReply[] = [];
      for (const r of n.replies as unknown[]) {
        if (!isObject(r) || typeof r.id !== 'string' || !r.id || typeof r.content !== 'string') {
          changed = true;
          continue;
        }
        const author = typeof r.author === 'string' ? r.author : '';
        const createdAt = typeof r.createdAt === 'string' ? r.createdAt : '';
        const editedOk = r.editedAt === undefined || typeof r.editedAt === 'string';
        if (author !== r.author || createdAt !== r.createdAt || !editedOk) {
          changed = true;
          const fixed: NoteReply = { ...(r as unknown as NoteReply), author, createdAt };
          if (!editedOk) delete fixed.editedAt;
          replies.push(fixed);
        } else {
          replies.push(r as unknown as NoteReply);
        }
      }
      if (changed) edit().replies = replies;
    }
  }

  if ('resolved' in n && typeof n.resolved !== 'boolean') edit().resolved = n.resolved === true;
  for (const key of ['author', 'assignee', 'resolvedBy', 'resolvedAt'] as const) {
    if (key in n && n[key] !== undefined && typeof n[key] !== 'string') delete edit()[key];
  }

  return (out ?? note) as T;
}

/** Whether a note has been resolved. */
export function isNoteResolved(note: NoteThread | null | undefined): boolean {
  return note?.resolved === true;
}

/** Replies under a note, oldest first. */
export function noteReplies(note: NoteThread | null | undefined): NoteReply[] {
  return Array.isArray(note?.replies) ? note!.replies! : [];
}

/**
 * Add a reply. Replying to a resolved note reopens it — the conversation is
 * not over if someone is still talking — the way every comment tool does it.
 */
export function addNoteReply(
  note: NoteThread,
  author: string,
  content: string,
  now: Date = new Date(),
): NoteThreadUpdate {
  const reply: NoteReply = { id: uuid(), author, content, createdAt: now.toISOString() };
  return {
    replies: [...noteReplies(note), reply],
    ...(isNoteResolved(note) ? reopened() : {}),
  };
}

/** Change a reply's text. An unchanged text is not an edit. */
export function editNoteReply(
  note: NoteThread,
  replyId: string,
  content: string,
  now: Date = new Date(),
): NoteThreadUpdate {
  return {
    replies: noteReplies(note).map((r) =>
      r.id === replyId && r.content !== content ? { ...r, content, editedAt: now.toISOString() } : r,
    ),
  };
}

export function deleteNoteReply(note: NoteThread, replyId: string): NoteThreadUpdate {
  return { replies: noteReplies(note).filter((r) => r.id !== replyId) };
}

const reopened = (): NoteThreadUpdate => ({ resolved: false, resolvedBy: undefined, resolvedAt: undefined });

/** Resolve a note, or reopen it. */
export function setNoteResolved(
  resolved: boolean,
  by: string,
  now: Date = new Date(),
): NoteThreadUpdate {
  if (!resolved) return reopened();
  return { resolved: true, resolvedBy: by || undefined, resolvedAt: now.toISOString() };
}

/** Assign a note to someone, or to nobody with an empty name. */
export function assignNote(assignee: string): NoteThreadUpdate {
  const name = assignee.trim();
  return { assignee: name || undefined };
}

// ── People and mentions ─────────────────────────────────────────────────────

/** The same person, whatever the case or spacing their name was typed in. */
export function samePerson(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  const x = norm(a);
  return !!x && x === norm(b);
}

/**
 * How a name is written as a mention. Spaces become underscores, the way an
 * `@asset` reference is written, so a mention is one word and the existing
 * `@` parsing in note text finds it.
 */
export function mentionToken(name: string): string {
  return `@${name.trim().replace(/\s+/g, '_')}`;
}

/**
 * The person a mention token names, out of the people known to the script,
 * and whatever punctuation trailed the name — `@Jane_Doe,` is Jane Doe and a
 * comma. A name that itself ends in punctuation (`@J.R.`) is tried whole first.
 */
export function splitMention(token: string, people: string[]): { person: string; trail: string } | null {
  const bare = token.replace(/^@/, '');
  const trimmed = bare.replace(/[.,;:!?)]+$/, '');
  for (const candidate of [bare, trimmed]) {
    if (!candidate) continue;
    const wanted = candidate.replace(/_/g, ' ');
    const person = people.find((p) => samePerson(p, wanted));
    if (person) return { person, trail: bare.slice(candidate.length) };
  }
  return null;
}

/** The person a mention token names, out of the people known to the script. */
export function personForMention(token: string, people: string[]): string | null {
  return splitMention(token, people)?.person ?? null;
}

/** Whether a piece of note text mentions this person. */
export function textMentions(text: string, person: string): boolean {
  if (!person.trim()) return false;
  for (const m of text.matchAll(/@(\S+)/g)) {
    if (personForMention(m[0], [person])) return true;
  }
  return false;
}

/**
 * Whether a note is waiting on this person: assigned to them, or mentioning
 * them in the note or any reply.
 */
export function noteIsForPerson(note: NoteThread & { content: string }, person: string): boolean {
  if (!person.trim()) return false;
  if (samePerson(note.assignee, person)) return true;
  if (textMentions(note.content, person)) return true;
  return noteReplies(note).some((r) => textMentions(r.content, person));
}

/**
 * Everyone the notes panel can offer to assign or mention: the people passed
 * in (the writer, collaborators online now, those invited) and everyone who
 * has already written, been assigned or resolved something in these notes.
 * One entry per person, first spelling wins, sorted.
 */
export function knownPeople(notes: NoteThread[], extra: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const add = (name: string | null | undefined) => {
    const n = (name ?? '').trim();
    if (n && !out.some((p) => samePerson(p, n))) out.push(n);
  };
  extra.forEach(add);
  for (const note of notes) {
    add(note.author);
    add(note.assignee);
    add(note.resolvedBy);
    for (const r of noteReplies(note)) add(r.author);
  }
  return out.sort((a, b) => a.localeCompare(b));
}
