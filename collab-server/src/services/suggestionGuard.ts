/**
 * Holding a suggester to suggestions.
 *
 * A collaborator invited with the `suggester` role edits in suggest mode
 * (frontend/src/editor/suggestions): what they type is marked as their
 * suggestion, what they delete stays, struck through, and the writer decides.
 * The client does that, but a client can be changed, so every update a
 * suggester sends is checked here before it is applied. One that does
 * anything else to the script is refused, and the connection closed.
 *
 * The check compares the script before and after the update, character by
 * character, in the form y-prosemirror stores it: each element a Y.XmlElement
 * named after its type with its attributes, each run of text a Y.XmlText whose
 * formatting attributes are its marks. A suggester may:
 *
 * - add text carrying their own `suggestionInsert` mark, and remove text that
 *   carries it (taking back their own suggestion);
 * - put their own `suggestionDelete` mark on text, or take it off again;
 * - add or remove a `scriptNote` mark — a reviewer's comment;
 * - start a new element carrying their own `suggestedSplit`, or remove one;
 * - set or clear their own `suggestedJoin` / `suggestedType` on an element,
 *   and change its type when it carries their `suggestedType`.
 *
 * Nothing else about the script: no plain text, no formatting, no other
 * attribute. Only the script itself (the `default` fragment) is checked; the
 * notes, beats and other panels sync beside it as they do for any
 * collaborator.
 */
/*
 * No import of Yjs here: the server passes its own in (server.ts), and the
 * frontend's tests pass theirs, so the check is tested against what
 * y-prosemirror really writes (frontend/src/editor/suggestionGuard.test.ts)
 * without the collab server's packages installed. What is used of Yjs is
 * described structurally below.
 */
interface YTextLike { toDelta(): unknown[] }
interface YElementLike { nodeName: string; getAttributes(): Record<string, unknown>; toArray(): unknown[] }
interface YFragmentLike { toArray(): unknown[] }
interface YDocLike { getXmlFragment(name: string): YFragmentLike; destroy(): void }
/** The parts of the `yjs` module the check needs. */
export interface YjsLike {
  Doc: new () => YDocLike;
  XmlText: abstract new (...args: never[]) => YTextLike;
  XmlElement: abstract new (...args: never[]) => YElementLike;
  applyUpdate(doc: YDocLike, update: Uint8Array): void;
  encodeStateAsUpdate(doc: YDocLike): Uint8Array;
}

/**
 * How a refused change ends the connection. Hocuspocus passes the reason on
 * to the client as given — the editor looks for it to stop reconnecting —
 * while the code may arrive as a plain 1000 when the socket is shared.
 */
export const SUGGESTION_REFUSED_CLOSE_CODE = 4403;
export const SUGGESTION_REFUSED_REASON = 'suggestion-refused';

/** The fragment Tiptap's Collaboration extension keeps the script in. */
export const SCRIPT_FIELD = 'default';

type Attrs = Record<string, unknown>;

type Unit =
  | { kind: 'char'; ch: string; marks: Attrs }
  | { kind: 'open'; name: string; attrs: Attrs }
  | { kind: 'close'; name: string };

const stableJSON = (v: unknown): string => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableJSON).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableJSON(o[k])}`).join(',')}}`;
};

/** The script as a flat run of characters and element boundaries. */
export function flatten(Y: YjsLike, fragment: YFragmentLike): Unit[] {
  const out: Unit[] = [];
  const walk = (node: YFragmentLike) => {
    for (const child of node.toArray()) {
      if (child instanceof Y.XmlText) {
        for (const op of (child as YTextLike).toDelta() as Array<{ insert: unknown; attributes?: Attrs }>) {
          if (typeof op.insert !== 'string') continue;
          const marks = op.attributes ?? {};
          for (const ch of op.insert) out.push({ kind: 'char', ch, marks });
        }
      } else if (child instanceof Y.XmlElement) {
        const el = child as YElementLike;
        out.push({ kind: 'open', name: el.nodeName, attrs: el.getAttributes() as Attrs });
        walk(el);
        out.push({ kind: 'close', name: el.nodeName });
      }
    }
  };
  walk(fragment);
  return out;
}

/** What makes two units the same thing, before asking whether its attributes changed. */
const alignKey = (u: Unit) => (u.kind === 'char' ? `c${u.ch}` : u.kind === 'open' ? 'o' : 'x');
const marksKey = (marks: Attrs) => stableJSON(Object.fromEntries(
  Object.entries(marks).filter(([, v]) => v !== undefined && v !== null && v !== false).map(([k, v]) => [k, meaningful(v)]),
));
const fullKey = (u: Unit) =>
  u.kind === 'char' ? `c${u.ch}${marksKey(u.marks)}` : u.kind === 'open' ? `o${u.name}${stableJSON(meaningful(u.attrs))}` : `x${u.name}`;

/**
 * A value that says nothing: what a client writes for an attribute's default.
 * Two app versions can disagree about which defaults they store, so one of
 * these appearing or going is how the script is represented, not an edit.
 */
const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || v === 0 || v === false
  || (Array.isArray(v) && v.length === 0);

/** An attribute set (a mark's or an element's) without its empty values. */
const meaningful = (v: unknown): unknown => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (!isEmpty(x)) out[k] = x;
  return out;
};

const same = (a: unknown, b: unknown) => stableJSON(meaningful(a)) === stableJSON(meaningful(b))
  || (isEmpty(a) && isEmpty(b));

const stampBy = (v: unknown): string | null =>
  v && typeof v === 'object' && typeof (v as { by?: unknown }).by === 'string' ? (v as { by: string }).by : null;

/** Attribute keys of a mark, with y-prosemirror's `--hash` suffix for overlapping marks removed. */
const markName = (key: string) => key.replace(/--[a-zA-Z0-9+/=]{8}$/, '');

const SUGGESTION_ATTRS = new Set(['suggestedSplit', 'suggestedJoin', 'suggestedType']);

/** Why a change from `a` to `b` of the same character is not the author's to make, or null. */
function charChange(a: Attrs, b: Attrs, by: string): string | null {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const before = a[key];
    const after = b[key];
    if (same(before, after)) continue;
    const name = markName(key);
    if (name === 'scriptNote') continue;
    if (name === 'suggestionDelete') {
      if (after !== undefined && stampBy(after) !== by) return 'marked a deletion as someone else';
      if (after === undefined && stampBy(before) !== by) return "removed someone else's suggested deletion";
      continue;
    }
    return `changed ${name} on existing text`;
  }
  return null;
}

/** Why a change to an element's type or attributes is not the author's to make, or null. */
function elementChange(a: Unit & { kind: 'open' }, b: Unit & { kind: 'open' }, by: string): string | null {
  // A line the author suggested is theirs: its type and settings are part of
  // the suggestion (the editor makes a new line, then sets what it is).
  if (stampBy(a.attrs.suggestedSplit) === by && stampBy(b.attrs.suggestedSplit) === by) return null;
  const keys = new Set([...Object.keys(a.attrs), ...Object.keys(b.attrs)]);
  for (const key of keys) {
    const before = a.attrs[key];
    const after = b.attrs[key];
    if (same(before, after)) continue;
    if (!SUGGESTION_ATTRS.has(key)) {
      // A type change replaces the element, and its attributes go back to
      // their defaults: tolerated only alongside the author's suggestedType.
      if (a.name !== b.name && (stampBy(b.attrs.suggestedType) === by || stampBy(a.attrs.suggestedType) === by)) continue;
      return `changed ${key} on a ${a.name}`;
    }
    if (after !== undefined && stampBy(after) !== by) return `set ${key} as someone else`;
    if (after === undefined && stampBy(before) !== by) return `cleared someone else's ${key}`;
  }
  if (a.name !== b.name && stampBy(b.attrs.suggestedType) !== by && stampBy(a.attrs.suggestedType) !== by) {
    return `changed a ${a.name} to ${b.name} without suggesting it`;
  }
  return null;
}

function insertedUnit(u: Unit, by: string): string | null {
  if (u.kind === 'char') return stampBy(u.marks.suggestionInsert) === by ? null : 'added text that is not a suggestion';
  if (u.kind === 'open') return stampBy(u.attrs.suggestedSplit) === by ? null : `added a ${u.name} that is not a suggested new line`;
  return null;
}

function removedUnit(u: Unit, by: string): string | null {
  if (u.kind === 'char') return stampBy(u.marks.suggestionInsert) === by ? null : 'deleted text instead of suggesting the deletion';
  if (u.kind === 'open') return stampBy(u.attrs.suggestedSplit) === by ? null : `removed a ${u.name}`;
  return null;
}

/** Longest common subsequence of two short runs, as aligned index pairs. */
function align(a: Unit[], b: Unit[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const ka = a.map(alignKey);
  const kb = b.map(alignKey);
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = ka[i] === kb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (ka[i] === kb[j]) { pairs.push([i, j]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  return pairs;
}

/** Above this many unit pairs the general alignment is too slow to run per message. */
const MAX_ALIGN_CELLS = 16_000_000;

/**
 * Why the script `after` is not one `by` could reach by suggesting from
 * `before`, or null when it is.
 */
export function suggestionViolation(before: Unit[], after: Unit[], by: string): string | null {
  let p = 0;
  while (p < before.length && p < after.length && fullKey(before[p]) === fullKey(after[p])) p++;
  let s = 0;
  while (s < before.length - p && s < after.length - p
    && fullKey(before[before.length - 1 - s]) === fullKey(after[after.length - 1 - s])) s++;
  const a = before.slice(p, before.length - s);
  const b = after.slice(p, after.length - s);
  if (a.length === 0 && b.length === 0) return null;

  let pairs: Array<[number, number]>;
  if (a.length === b.length && a.every((u, i) => alignKey(u) === alignKey(b[i]))) {
    // The usual case for a deletion: the same text, now struck.
    pairs = a.map((_, i) => [i, i]);
  } else if (a.length * b.length <= MAX_ALIGN_CELLS) {
    pairs = align(a, b);
  } else {
    return 'changed too much of the script in one go to check';
  }

  const matchedA = new Set(pairs.map(([i]) => i));
  const matchedB = new Set(pairs.map(([, j]) => j));
  for (const [i, j] of pairs) {
    const x = a[i];
    const y = b[j];
    const why = x.kind === 'char' && y.kind === 'char'
      ? charChange(x.marks, y.marks, by)
      : x.kind === 'open' && y.kind === 'open'
        ? elementChange(x, y, by)
        : null;
    if (why) return why;
  }
  for (let i = 0; i < a.length; i++) {
    if (matchedA.has(i)) continue;
    const why = removedUnit(a[i], by);
    if (why) return why;
  }
  for (let j = 0; j < b.length; j++) {
    if (matchedB.has(j)) continue;
    const why = insertedUnit(b[j], by);
    if (why) return why;
  }
  return null;
}

/**
 * Why `update` is not something `by` may do to `doc` as a suggester, or null.
 * The document itself is left alone: the update is tried on a copy.
 */
export function checkSuggesterUpdate(Y: YjsLike, doc: YDocLike, update: Uint8Array, by: string): string | null {
  const before = flatten(Y, doc.getXmlFragment(SCRIPT_FIELD));
  const trial = new Y.Doc();
  try {
    Y.applyUpdate(trial, Y.encodeStateAsUpdate(doc));
    Y.applyUpdate(trial, update);
    return suggestionViolation(before, flatten(Y, trial.getXmlFragment(SCRIPT_FIELD)), by);
  } finally {
    trial.destroy();
  }
}

// ── Reading the y-protocols message a client sends ───────────────────────

const MESSAGE_SYNC = 0;
const SYNC_STEP_2 = 1;
const SYNC_UPDATE = 2;

class Reader {
  pos = 0;
  private readonly buf: Uint8Array;
  constructor(buf: Uint8Array) {
    this.buf = buf;
  }
  varUint(): number {
    let num = 0;
    let mult = 1;
    for (;;) {
      if (this.pos >= this.buf.length) throw new Error('Unexpected end of message');
      const byte = this.buf[this.pos++];
      num += (byte & 0x7f) * mult;
      if (byte < 0x80) return num;
      mult *= 128;
      if (mult > 2 ** 53) throw new Error('Integer out of range');
    }
  }
  bytes(): Uint8Array {
    const len = this.varUint();
    if (this.pos + len > this.buf.length) throw new Error('Unexpected end of message');
    const out = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }
  string(): string {
    return new TextDecoder().decode(this.bytes());
  }
}

/**
 * The document update a Hocuspocus message carries, or null when it carries
 * none — awareness, authentication, the first step of a sync.
 */
export function updateInMessage(message: Uint8Array): Uint8Array | null {
  const r = new Reader(message);
  r.string(); // document name
  if (r.varUint() !== MESSAGE_SYNC) return null;
  const step = r.varUint();
  if (step !== SYNC_STEP_2 && step !== SYNC_UPDATE) return null;
  return r.bytes();
}
