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
 * They may also give a scene heading that has none its `sceneUid` — what
 * linking a Beat Board beat to the scene does (frontend/src/utils/beatScenes).
 * It is an id, not part of the script, and one already given is not theirs
 * to change. Nor is one another heading has: that would take its links.
 *
 * "Their own" means signed with their session name and, when the stamp has
 * one, their id (`uid`, worked out from their invite token; see server.ts).
 * The id is what tells apart two collaborators invited under the same name.
 * A stamp without one, from a version of the app before ids, goes by name.
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
interface YTypeLike { readonly parent: unknown }
interface YTextLike extends YTypeLike { toDelta(): unknown[] }
interface YElementLike extends YTypeLike { nodeName: string; getAttributes(): Record<string, unknown>; toArray(): unknown[] }
interface YEventLike { target: unknown }
interface YFragmentLike {
  toArray(): unknown[];
  observeDeep(f: (events: YEventLike[]) => void): void;
  unobserveDeep(f: (events: YEventLike[]) => void): void;
}
interface YDocLike {
  getXmlFragment(name: string): YFragmentLike;
  destroy(): void;
  on(event: 'update', f: (update: Uint8Array) => void): void;
  on(event: 'destroy', f: () => void): void;
  off(event: 'update', f: (update: Uint8Array) => void): void;
  off(event: 'destroy', f: () => void): void;
}
/** The parts of the `yjs` module the check needs. */
export interface YjsLike {
  Doc: new () => YDocLike;
  XmlText: abstract new (...args: never[]) => YTextLike;
  XmlElement: abstract new (...args: never[]) => YElementLike;
  applyUpdate(doc: YDocLike, update: Uint8Array): void;
  encodeStateAsUpdate(doc: YDocLike): Uint8Array;
  encodeStateVector(doc: YDocLike): Uint8Array;
  decodeStateVector(state: Uint8Array): Map<number, number>;
}

/** Who a suggester is: their session name and, from their invite, their id. */
export interface SuggesterIdentity {
  name: string;
  uid?: string | null;
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

/** One node of the script, and everything in it, as a flat run of units. */
function flattenNode(Y: YjsLike, child: unknown, out: Unit[]): void {
  if (child instanceof Y.XmlText) {
    for (const op of (child as YTextLike).toDelta() as Array<{ insert: unknown; attributes?: Attrs }>) {
      if (typeof op.insert !== 'string') continue;
      const marks = op.attributes ?? {};
      for (const ch of op.insert) out.push({ kind: 'char', ch, marks });
    }
  } else if (child instanceof Y.XmlElement) {
    const el = child as YElementLike;
    out.push({ kind: 'open', name: el.nodeName, attrs: el.getAttributes() as Attrs });
    for (const inner of el.toArray()) flattenNode(Y, inner, out);
    out.push({ kind: 'close', name: el.nodeName });
  }
}

/** The script as a flat run of characters and element boundaries. */
export function flatten(Y: YjsLike, fragment: YFragmentLike): Unit[] {
  const out: Unit[] = [];
  for (const child of fragment.toArray()) flattenNode(Y, child, out);
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

/**
 * Whether a stamp — a suggestion mark's attributes, or a suggestion attribute
 * on an element — is the suggester's own: their name, and their id if it
 * carries one. A stamp in their name with someone else's id is not theirs.
 */
function owns(v: unknown, me: SuggesterIdentity): boolean {
  if (!v || typeof v !== 'object') return false;
  const { by, uid } = v as { by?: unknown; uid?: unknown };
  if (typeof by !== 'string' || by !== me.name) return false;
  return isEmpty(uid) || uid === me.uid;
}

/** Attribute keys of a mark, with y-prosemirror's `--hash` suffix for overlapping marks removed. */
const markName = (key: string) => key.replace(/--[a-zA-Z0-9+/=]{8}$/, '');

const SUGGESTION_ATTRS = new Set(['suggestedSplit', 'suggestedJoin', 'suggestedType']);

/** A scene heading's stable id, which Beat Board links go by. */
const SCENE_UID = 'sceneUid';

/** Why a change from `a` to `b` of the same character is not the author's to make, or null. */
function charChange(a: Attrs, b: Attrs, me: SuggesterIdentity): string | null {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const before = a[key];
    const after = b[key];
    if (same(before, after)) continue;
    const name = markName(key);
    if (name === 'scriptNote') continue;
    if (name === 'suggestionDelete') {
      if (after !== undefined && !owns(after, me)) return 'marked a deletion as someone else';
      if (after === undefined && !owns(before, me)) return "removed someone else's suggested deletion";
      continue;
    }
    return `changed ${name} on existing text`;
  }
  return null;
}

/** Why a change to an element's type or attributes is not the author's to make, or null. */
function elementChange(a: Unit & { kind: 'open' }, b: Unit & { kind: 'open' }, me: SuggesterIdentity): string | null {
  // A line the author suggested is theirs: its type and settings are part of
  // the suggestion (the editor makes a new line, then sets what it is).
  if (owns(a.attrs.suggestedSplit, me) && owns(b.attrs.suggestedSplit, me)) return null;
  const keys = new Set([...Object.keys(a.attrs), ...Object.keys(b.attrs)]);
  for (const key of keys) {
    const before = a.attrs[key];
    const after = b.attrs[key];
    if (same(before, after)) continue;
    if (!SUGGESTION_ATTRS.has(key)) {
      // A type change replaces the element, and its attributes go back to
      // their defaults: tolerated only alongside the author's suggestedType.
      if (a.name !== b.name && (owns(b.attrs.suggestedType, me) || owns(a.attrs.suggestedType, me))) continue;
      // Linking a beat to a scene gives its heading an id, once.
      if (key === SCENE_UID && a.name === 'sceneHeading' && b.name === 'sceneHeading'
        && isEmpty(before) && typeof after === 'string') continue;
      return `changed ${key} on a ${a.name}`;
    }
    if (after !== undefined && !owns(after, me)) return `set ${key} as someone else`;
    if (after === undefined && !owns(before, me)) return `cleared someone else's ${key}`;
  }
  if (a.name !== b.name && !owns(b.attrs.suggestedType, me) && !owns(a.attrs.suggestedType, me)) {
    return `changed a ${a.name} to ${b.name} without suggesting it`;
  }
  return null;
}

function insertedUnit(u: Unit, me: SuggesterIdentity): string | null {
  if (u.kind === 'char') return owns(u.marks.suggestionInsert, me) ? null : 'added text that is not a suggestion';
  if (u.kind === 'open') return owns(u.attrs.suggestedSplit, me) ? null : `added a ${u.name} that is not a suggested new line`;
  return null;
}

function removedUnit(u: Unit, me: SuggesterIdentity): string | null {
  if (u.kind === 'char') return owns(u.marks.suggestionInsert, me) ? null : 'deleted text instead of suggesting the deletion';
  if (u.kind === 'open') return owns(u.attrs.suggestedSplit, me) ? null : `removed a ${u.name}`;
  return null;
}

/** Why one unit becoming another of the same kind is not the author's to make, or null. */
function unitChange(x: Unit, y: Unit, me: SuggesterIdentity): string | null {
  if (x.kind === 'char' && y.kind === 'char') return charChange(x.marks, y.marks, me);
  if (x.kind === 'open' && y.kind === 'open') return elementChange(x, y, me);
  return null;
}

/**
 * A pairing of `a` with `b` that shows the change is the author's to make,
 * found in one pass, or null when this pass finds none. Each unit of `b` is
 * either the next unit of `a`, changed only as the author may, or something
 * they may add; each unit of `a` not paired is something they may take away.
 * Any pairing like that is proof enough, so this can only refuse wrongly,
 * never accept wrongly — and a refusal falls back to the full alignment.
 */
function greedyPairs(a: Unit[], b: Unit[], me: SuggesterIdentity): Array<[number, number]> | null {
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const x = a[i];
    const y = b[j];
    if (x && y && alignKey(x) === alignKey(y) && !unitChange(x, y, me)) { pairs.push([i, j]); i++; j++; continue; }
    if (y && !insertedUnit(y, me)) { j++; continue; }
    if (x && !removedUnit(x, me)) { i++; continue; }
    return null;
  }
  return pairs;
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

/**
 * Above this many unit pairs the full alignment is too slow and too big
 * (4 bytes a pair) to run on a message: 4M is 16 MB and a few tens of ms.
 * Typing never comes near it — the changed part is a line or two — and the
 * one-pass check above handles large, ordinary suggestions before this.
 */
export const MAX_ALIGN_CELLS = 4_000_000;

/** The id a unit gives a scene heading, if it is one and has one. */
const sceneIdOf = (u: Unit): string | null => {
  if (u.kind !== 'open' || u.name !== 'sceneHeading') return null;
  const id = u.attrs[SCENE_UID];
  return typeof id === 'string' && id ? id : null;
};

/** How many scene headings carry each id. */
export function sceneIdCounts(units: Iterable<Unit>): Map<string, number> {
  const out = new Map<string, number>();
  for (const u of units) {
    const id = sceneIdOf(u);
    if (id) out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}

/**
 * Why the script `after` is not one `by` could reach by suggesting from
 * `before`, or null when it is. `sceneIds` counts the scene ids in the whole
 * script after the change, when `after` is only the part of it that changed.
 */
export function suggestionViolation(
  before: Unit[], after: Unit[], me: SuggesterIdentity, sceneIds?: ReadonlyMap<string, number>,
): string | null {
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
  } else {
    const quick = greedyPairs(a, b, me);
    if (quick) {
      pairs = quick;
    } else {
      if (a.length * b.length > MAX_ALIGN_CELLS) return 'changed too much of the script in one go to check';
      pairs = align(a, b);
    }
  }

  // A scene id this change brings in must be the only one of its kind: a
  // second heading with an existing scene's id would take its beat links
  // (utils/beatScenes: the first heading with an id has it).
  const counts = sceneIds ?? sceneIdCounts(after);
  const duplicate = (id: string | null) => !!id && (counts.get(id) ?? 0) > 1;
  for (const [i, j] of pairs) {
    const id = sceneIdOf(b[j]);
    if (id !== sceneIdOf(a[i]) && duplicate(id)) return 'gave a scene heading the id of another scene';
  }

  const matchedA = new Set(pairs.map(([i]) => i));
  const matchedB = new Set(pairs.map(([, j]) => j));
  for (const [i, j] of pairs) {
    const why = unitChange(a[i], b[j], me);
    if (why) return why;
  }
  for (let i = 0; i < a.length; i++) {
    if (matchedA.has(i)) continue;
    const why = removedUnit(a[i], me);
    if (why) return why;
  }
  for (let j = 0; j < b.length; j++) {
    if (matchedB.has(j)) continue;
    const why = insertedUnit(b[j], me);
    if (why) return why;
    if (duplicate(sceneIdOf(b[j]))) return 'gave a scene heading the id of another scene';
  }
  return null;
}

/**
 * A copy of one document's script to try suggesters' updates on, kept in step
 * with the document and remembering each top-level element flattened, so a
 * message costs about the size of the lines it touches rather than of the
 * script. Made for a document the first time a suggester sends it a change,
 * and dropped with the document.
 *
 * It costs a second copy of the document in memory while suggesters are in
 * it. Refusing an update leaves the copy with it applied, so it is rebuilt.
 */
class ShadowScript {
  private shadow!: YDocLike;
  private fragment!: YFragmentLike;
  private readonly units = new Map<unknown, Unit[]>();
  /** The top-level nodes the update being tried changed. */
  private readonly touched = new Set<unknown>();
  private readonly follow = (update: Uint8Array) => this.Y.applyUpdate(this.shadow, update);
  private readonly forget = (events: YEventLike[]) => {
    for (const { target } of events) {
      const top = this.topLevel(target);
      if (top !== null) { this.units.delete(top); this.touched.add(top); }
    }
  };

  private readonly Y: YjsLike;
  private readonly doc: YDocLike;

  constructor(Y: YjsLike, doc: YDocLike) {
    this.Y = Y;
    this.doc = doc;
    this.build();
    doc.on('update', this.follow);
  }

  private build(): void {
    this.shadow = new this.Y.Doc();
    this.Y.applyUpdate(this.shadow, this.Y.encodeStateAsUpdate(this.doc));
    this.fragment = this.shadow.getXmlFragment(SCRIPT_FIELD);
    this.fragment.observeDeep(this.forget);
    this.units.clear();
  }

  private rebuild(): void {
    this.fragment.unobserveDeep(this.forget);
    this.shadow.destroy();
    this.build();
  }

  dispose(): void {
    this.doc.off('update', this.follow);
    this.fragment.unobserveDeep(this.forget);
    this.shadow.destroy();
  }

  /** The top-level node of the script holding `type`, or null for the script itself. */
  private topLevel(type: unknown): unknown {
    let node = type;
    while (node && (node as YTypeLike).parent !== this.fragment) {
      node = (node as YTypeLike).parent;
    }
    return node ?? null;
  }

  private unitsOf(node: unknown): Unit[] {
    let out = this.units.get(node);
    if (!out) {
      out = [];
      flattenNode(this.Y, node, out);
      this.units.set(node, out);
    }
    return out;
  }

  check(update: Uint8Array, me: SuggesterIdentity): string | null {
    // The copy follows the document through its own updates; if it has
    // somehow fallen out of step, start again from the document.
    if (!sameState(this.Y, this.shadow, this.doc)) this.rebuild();

    const beforeNodes = this.fragment.toArray();
    const beforeUnits = beforeNodes.map((n) => this.unitsOf(n));
    this.touched.clear();
    try {
      this.Y.applyUpdate(this.shadow, update);
    } catch (err) {
      // Half applied, perhaps: the copy is no longer the document.
      this.rebuild();
      throw err;
    }
    const afterNodes = this.fragment.toArray();

    // Lines the update left alone at either end are the same objects, untouched.
    const same = (x: unknown, y: unknown) => x === y && !this.touched.has(x);
    let p = 0;
    while (p < beforeNodes.length && p < afterNodes.length && same(beforeNodes[p], afterNodes[p])) p++;
    let s = 0;
    while (s < beforeNodes.length - p && s < afterNodes.length - p
      && same(beforeNodes[beforeNodes.length - 1 - s], afterNodes[afterNodes.length - 1 - s])) s++;
    const before = beforeUnits.slice(p, beforeNodes.length - s).flat();
    const after = afterNodes.slice(p, afterNodes.length - s).flatMap((n) => this.unitsOf(n));

    // Scene headings are top-level, so each node's first unit says its id.
    const sceneIds = sceneIdCounts(afterNodes.map((n) => this.unitsOf(n)[0]).filter((u): u is Unit => !!u));
    const why = suggestionViolation(before, after, me, sceneIds);
    if (why) this.rebuild();
    return why;
  }
}

/** Whether two documents have seen the same updates, by their state vectors. */
function sameState(Y: YjsLike, x: YDocLike, y: YDocLike): boolean {
  const a = Y.decodeStateVector(Y.encodeStateVector(x));
  const b = Y.decodeStateVector(Y.encodeStateVector(y));
  if (a.size !== b.size) return false;
  for (const [client, clock] of a) if (b.get(client) !== clock) return false;
  return true;
}

const shadows = new WeakMap<YDocLike, ShadowScript>();

/**
 * Why `update` is not something `me` may do to `doc` as a suggester, or null.
 * The document itself is left alone: the update is tried on a copy of it.
 */
export function checkSuggesterUpdate(Y: YjsLike, doc: YDocLike, update: Uint8Array, me: SuggesterIdentity): string | null {
  let shadow = shadows.get(doc);
  if (!shadow) {
    const made = new ShadowScript(Y, doc);
    shadows.set(doc, made);
    doc.on('destroy', () => { made.dispose(); shadows.delete(doc); });
    shadow = made;
  }
  return shadow.check(update, me);
}

/**
 * A suggester's id, from the invite token they joined with — the same as
 * frontend/src/utils/suggesterId works it out, given a SHA-256 in hex.
 */
export function suggesterIdOf(sha256Hex: (text: string) => string, inviteToken: string): string | null {
  return inviteToken ? sha256Hex(`opendraft-suggester:${inviteToken}`).slice(0, 16) : null;
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
