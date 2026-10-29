/**
 * Suggest mode — edits proposed rather than made, for the script's owner (or
 * any editor) to accept or reject, one at a time or all at once.
 *
 * A suggestion lives in the document itself, so it is saved with the script,
 * synced to collaborators through Yjs like any other text, and survives a
 * reload:
 *
 * - Text a suggester types carries a `suggestionInsert` mark.
 * - Text a suggester deletes stays where it was, carrying a `suggestionDelete`
 *   mark, and is drawn struck through.
 * - A new line (Enter) marks the element it starts with `suggestedSplit`: the
 *   boundary before it is suggested. Rejecting joins it back.
 * - Deleting across a line break marks the element after it `suggestedJoin`:
 *   accepting joins it to the one before.
 * - Changing an element's type (Action to Dialogue) records the old type in
 *   `suggestedType`, so rejecting can set it back.
 *
 * Every suggestion carries an id, its author's name (`by`) and when it was
 * made (`at`). Edits made next to one of the author's own suggestions join it,
 * so typing a sentence is one suggestion, not one per letter.
 *
 * `suggestTransaction` turns an ordinary edit into that: it takes the
 * transaction the editor was about to apply and builds the equivalent one in
 * suggestions. Undoing a suggestion of your own — deleting text you suggested,
 * pressing Backspace after your own Enter — really undoes it, as it would in
 * any editor. Formatting cannot be suggested (yet); a script note can still be
 * added, since that is how a reviewer comments.
 *
 * Everything here is pure ProseMirror, with no editor or store, so it is tested
 * on its own (suggestions.test.ts) and shared by the collab server's check.
 */
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { TextSelection } from '@tiptap/pm/state';
import { Fragment, Slice, type Mark, type MarkType, type Node as PmNode, type Schema } from '@tiptap/pm/model';
import { canJoin } from '@tiptap/pm/transform';
import {
  AddMarkStep, RemoveMarkStep, ReplaceAroundStep, ReplaceStep, type Mappable, type Step, type StepMap,
} from '@tiptap/pm/transform';
import type { JSONContent } from '@tiptap/core';
import { uuid } from '../utils/uuid';
import { REVISION_SKIP_META } from './revisionMarks';

export const SUGGEST_INSERT = 'suggestionInsert';
export const SUGGEST_DELETE = 'suggestionDelete';
/** Block attributes, each `{ id, by, at }` — plus `from` (the old type) on `suggestedType`. */
export const SUGGESTED_SPLIT = 'suggestedSplit';
export const SUGGESTED_JOIN = 'suggestedJoin';
export const SUGGESTED_TYPE = 'suggestedType';
export const SUGGESTION_BLOCK_ATTRS = [SUGGESTED_SPLIT, SUGGESTED_JOIN, SUGGESTED_TYPE] as const;

/** Marks a suggester may still add or remove: a script note is how a reviewer comments. */
const MARKS_A_SUGGESTER_MAY_SET = new Set(['scriptNote']);

/** Set on every transaction this module builds, so it is not rewritten again. */
export const SUGGESTION_META = 'suggestionRewrite';

export interface SuggestionStamp {
  id: string;
  by: string;
  at: number;
}

export interface TypeStamp extends SuggestionStamp {
  /** The element's type before the suggestion. */
  from: string;
}

export type SuggestionKind = 'insert' | 'delete' | 'split' | 'join' | 'type';

/**
 * What a suggester tried that a suggestion cannot carry, for the editor to
 * explain. A line break inside an element is one: collaboration stores marks
 * on text only, so a suggested break would reach everyone else unmarked.
 */
export type Blocked = 'formatting' | 'lineBreak';

export interface SuggestOptions {
  /** The suggester's name, as collaborators see it. */
  by: string;
  now?: number;
  /** Called when part of the edit was dropped because it cannot be suggested. */
  onBlocked?: (what: Blocked) => void;
}

const isStamp = (v: unknown): v is SuggestionStamp =>
  !!v && typeof v === 'object' && typeof (v as SuggestionStamp).id === 'string'
  && typeof (v as SuggestionStamp).by === 'string';

const stampOf = (node: PmNode, attr: string): SuggestionStamp | null => {
  const v = node.attrs?.[attr];
  return isStamp(v) ? v : null;
};

const markOf = (marks: readonly Mark[], name: string): Mark | undefined => marks.find((m) => m.type.name === name);

function markTypes(schema: Schema): { ins: MarkType; del: MarkType } | null {
  const ins = schema.marks[SUGGEST_INSERT];
  const del = schema.marks[SUGGEST_DELETE];
  return ins && del ? { ins, del } : null;
}

/** True when a textblock can carry the suggestion attributes. */
const tracksBlocks = (node: PmNode) => node.isTextblock && SUGGESTED_SPLIT in (node.type.spec.attrs ?? {});

/** Whether a transaction is an edit someone made, as opposed to sync, undo, or one of ours. */
export function isLocalEdit(tr: Transaction): boolean {
  if (!tr.docChanged) return false;
  if (tr.getMeta(SUGGESTION_META)) return false;
  // Remote changes and collaborative undo arrive through y-prosemirror.
  if (tr.getMeta('y-sync$')) return false;
  // prosemirror-history's undo and redo: the inverse of what was suggested.
  if (tr.getMeta('history$')) return false;
  // Housekeeping the app keeps out of undo — not something anyone typed.
  if (tr.getMeta('addToHistory') === false) return false;
  // A script being opened: Tiptap's setContent replaces the whole document
  // and always sets `preventUpdate`, which typing never does. Select-all and
  // type also replaces it all, but is an edit, and is suggested.
  if (tr.getMeta('preventUpdate') !== undefined && replacesWholeDoc(tr)) return false;
  return true;
}

/**
 * A change the app makes to the script by itself — renumbering scenes after
 * an edit, tidying a note's highlight — kept out of undo. In a suggester's
 * session these are dropped rather than suggested: the host's own client
 * makes them for everyone, and the collab server would refuse them from a
 * suggester anyway.
 */
export function isHousekeeping(tr: Transaction): boolean {
  return tr.docChanged && tr.getMeta('addToHistory') === false
    && !tr.getMeta('y-sync$') && !tr.getMeta(SUGGESTION_META);
}

function replacesWholeDoc(tr: Transaction): boolean {
  const size = tr.before.content.size;
  return tr.steps.some((s) => s instanceof ReplaceStep && s.from === 0 && s.to === size);
}

// ── Rewriting an edit as suggestions ─────────────────────────────────────

interface Ctx {
  state: EditorState;
  out: Transaction;
  types: { ins: MarkType; del: MarkType };
  opts: SuggestOptions;
  now: number;
}

/** The author's own suggestion mark right beside `pos`, to join rather than start a new one. */
function neighbourId(doc: PmNode, pos: number, mark: MarkType, by: string): string | null {
  const $pos = doc.resolve(pos);
  for (const node of [$pos.nodeBefore, $pos.nodeAfter]) {
    const m = node && mark.isInSet(node.marks);
    if (m && m.attrs.by === by && typeof m.attrs.id === 'string') return m.attrs.id;
  }
  return null;
}

/**
 * Suggest deleting `[from, to)` of the output document. Returns the id it
 * used, so a replacement typed over the deletion joins the same suggestion.
 */
function suggestDeletion(ctx: Ctx, from: number, to: number): string | null {
  const { out, types, opts } = ctx;
  if (to <= from) return null;
  const doc = out.doc;
  const id = neighbourId(doc, from, types.del, opts.by) ?? neighbourId(doc, to, types.del, opts.by) ?? uuid();
  const stamp = { id, by: opts.by, at: ctx.now };

  const toMark: Array<[number, number]> = [];
  const toRemove: Array<[number, number]> = [];
  const joins: number[] = [];
  const joinMarks: number[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock && pos > from && pos < to) {
      // A line break inside the deletion: suggest joining the line to the
      // one before, unless it is the author's own suggested new line, which
      // simply goes.
      const split = stampOf(node, SUGGESTED_SPLIT);
      if (split && split.by === opts.by) joins.push(pos);
      else if (tracksBlocks(node) && !stampOf(node, SUGGESTED_JOIN)) joinMarks.push(pos);
    }
    if (!node.isInline) return true;
    const start = Math.max(from, pos);
    const end = Math.min(to, pos + node.nodeSize);
    if (end <= start) return false;
    const inserted = types.ins.isInSet(node.marks);
    if (inserted && inserted.attrs.by === opts.by) toRemove.push([start, end]);
    else if (!types.del.isInSet(node.marks)) toMark.push([start, end]);
    return false;
  });

  for (const [a, b] of toMark) out.addMark(a, b, types.del.create(stamp));
  for (const pos of joinMarks) out.setNodeAttribute(pos, SUGGESTED_JOIN, stamp);
  // Real removals from the end, so earlier positions hold.
  const before = out.steps.length;
  for (const [a, b] of [...toRemove].reverse()) out.delete(a, b);
  const mapping = out.mapping.slice(before);
  for (const pos of [...joins].sort((a, b) => b - a)) {
    const at = mapping.map(pos, -1);
    // Clear the split first so the joined line does not carry it on.
    const node = out.doc.nodeAt(at);
    if (node) out.setNodeAttribute(at, SUGGESTED_SPLIT, null);
    if (canJoin(out.doc, at)) out.join(at);
  }
  return toMark.length || joinMarks.length ? id : null;
}

/** The author's own suggested deletion just before `from` or just after `to`. */
function struckBesideId(doc: PmNode, from: number, to: number, mark: MarkType, by: string): string | null {
  for (const node of [doc.resolve(from).nodeBefore, doc.resolve(to).nodeAfter]) {
    const m = node && mark.isInSet(node.marks);
    if (m && m.attrs.by === by && typeof m.attrs.id === 'string') return m.attrs.id;
  }
  return null;
}

/** The author's own suggested new line holding `pos`: typing into it is part of it. */
function ownNewLineId(doc: PmNode, pos: number, by: string): string | null {
  const $pos = doc.resolve(pos);
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (!node.isTextblock) continue;
    const split = stampOf(node, SUGGESTED_SPLIT);
    return split && split.by === by ? split.id : null;
  }
  return null;
}

/** Mark everything inline in `[from, to)` as suggested by the author, and the lines it starts. */
function markInserted(ctx: Ctx, from: number, to: number, preferredId: string | null): void {
  const { out, types, opts } = ctx;
  if (to <= from) return;
  // Whether this starts new lines, rather than adding words to one.
  let newLines = false;
  out.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock && pos >= from) newLines = true;
    return !newLines;
  });
  const id = preferredId
    ?? neighbourId(out.doc, from, types.ins, opts.by)
    ?? neighbourId(out.doc, to, types.ins, opts.by)
    // Typed right beside words you struck out: the replacement for them.
    ?? (newLines ? null : struckBesideId(out.doc, from, to, types.del, opts.by))
    ?? ownNewLineId(out.doc, from, opts.by)
    ?? uuid();
  const stamp = { id, by: opts.by, at: ctx.now };
  // Pasted text struck through elsewhere is not a deletion here.
  out.removeMark(from, to, types.del);
  out.addMark(from, to, types.ins.create(stamp));
  out.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock && pos >= from && pos < to && pos > 0 && tracksBlocks(node)) {
      if (!stampOf(node, SUGGESTED_SPLIT)) out.setNodeAttribute(pos, SUGGESTED_SPLIT, stamp);
      // A new line has nothing to join or retype.
      if (stampOf(node, SUGGESTED_JOIN)) out.setNodeAttribute(pos, SUGGESTED_JOIN, null);
      if (stampOf(node, SUGGESTED_TYPE)) out.setNodeAttribute(pos, SUGGESTED_TYPE, null);
    }
    return true;
  });
}

/** A slice with its inline line breaks turned into spaces (see `Blocked`). */
function withoutLineBreaks(slice: Slice, ctx: Ctx): Slice {
  let found = false;
  const swap = (fragment: Fragment): Fragment => {
    const nodes: PmNode[] = [];
    fragment.forEach((node) => {
      if (node.type.name === 'hardBreak') {
        found = true;
        nodes.push(ctx.state.schema.text(' ', node.marks));
      } else if (node.content.size) {
        nodes.push(node.copy(swap(node.content)));
      } else {
        nodes.push(node);
      }
    });
    return Fragment.fromArray(nodes);
  };
  const content = swap(slice.content);
  if (!found) return slice;
  ctx.opts.onBlocked?.('lineBreak');
  return new Slice(content, slice.openStart, slice.openEnd);
}

/** Map positions of the original transaction's documents into the output's. */
type PosMap = (pos: number, assoc?: number) => number;

/** A `Mappable` from a position function, for `Step.map`. */
function mappable(map: PosMap): Mappable {
  return {
    map: (pos, assoc = 1) => map(pos, assoc),
    mapResult: (pos, assoc = 1) => ({ pos: map(pos, assoc), deleted: false, deletedBefore: false, deletedAfter: false, deletedAcross: false }),
  } as Mappable;
}

/** Replace step: what was deleted is struck instead, what was inserted is marked. */
function suggestReplace(ctx: Ctx, step: ReplaceStep, toOut: PosMap): { insertedAt: number; insertedSize: number; deletedFrom: number; deletedTo: number } {
  const { out } = ctx;
  const a = toOut(step.from, 1);
  const b = Math.max(a, toOut(step.to, -1));
  const start = out.steps.length;
  const deletionId = suggestDeletion(ctx, a, b);
  const afterDelete = out.mapping.slice(start);
  const deletedFrom = afterDelete.map(a, -1);
  const deletedTo = afterDelete.map(b, 1);

  let insertedAt = deletedTo;
  let insertedSize = 0;
  const slice = withoutLineBreaks(step.slice, ctx);
  if (slice.size > 0) {
    const before = out.steps.length;
    out.replace(insertedAt, insertedAt, slice);
    // Where the slice actually landed, after ProseMirror fitted it.
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = before; i < out.steps.length; i++) {
      (out.mapping.maps[i] as StepMap).forEach((_os, _oe, ns, ne) => { lo = Math.min(lo, ns); hi = Math.max(hi, ne); });
    }
    if (hi > lo) {
      markInserted(ctx, lo, hi, deletionId);
      insertedAt = lo;
      insertedSize = hi - lo;
    }
  }
  return { insertedAt, insertedSize, deletedFrom, deletedTo };
}

/** Type changes: kept, with the old type recorded so they can be rejected. Attribute-only changes are dropped. */
function suggestReplaceAround(ctx: Ctx, step: ReplaceAroundStep, toOut: PosMap): boolean {
  const { out, opts } = ctx;
  const mapped = step.map(mappable(toOut));
  if (!mapped) return false;
  // What each textblock in the range was before.
  const range = mapped.getMap();
  let from = Infinity;
  let to = -Infinity;
  range.forEach((os, oe) => { from = Math.min(from, os); to = Math.max(to, oe); });
  if (!(to > from)) return false;
  const before: Array<{ pos: number; type: string; attrs: Record<string, unknown> }> = [];
  out.doc.nodesBetween(from, Math.min(to, out.doc.content.size), (node, pos) => {
    if (node.isTextblock) { before.push({ pos, type: node.type.name, attrs: node.attrs }); return false; }
    return true;
  });
  const startStep = out.steps.length;
  if (out.maybeStep(mapped).failed) return false;
  const mapping = out.mapping.slice(startStep);
  for (const b of before) {
    const pos = mapping.map(b.pos, 1);
    const node = out.doc.nodeAt(pos);
    if (!node || !node.isTextblock) continue;
    if (node.type.name === b.type) {
      // Same element, new attributes: not something a suggestion can carry.
      const changed = Object.keys(node.attrs).some((k) => node.attrs[k] !== b.attrs[k]);
      if (changed) {
        out.setNodeMarkup(pos, undefined, b.attrs);
        opts.onBlocked?.('formatting');
      }
      continue;
    }
    if (!tracksBlocks(node)) continue;
    // setBlockType gives the new element default attributes, so the
    // suggestions it already carried are read from before the change and put
    // back.
    const was = (key: string) => {
      const v = b.attrs[key];
      return isStamp(v) ? v : null;
    };
    const join = was(SUGGESTED_JOIN);
    if (join) out.setNodeAttribute(pos, SUGGESTED_JOIN, join);
    // A new line's type is part of the new line, already suggested.
    const split = was(SUGGESTED_SPLIT);
    if (split) {
      out.setNodeAttribute(pos, SUGGESTED_SPLIT, split);
      out.setNodeAttribute(pos, SUGGESTED_TYPE, null);
      continue;
    }
    const prior = was(SUGGESTED_TYPE) as TypeStamp | null;
    const original = prior?.from ?? b.type;
    if (original === node.type.name) {
      out.setNodeAttribute(pos, SUGGESTED_TYPE, null);
    } else {
      const id = prior?.id ?? uuid();
      out.setNodeAttribute(pos, SUGGESTED_TYPE, { id, by: opts.by, at: ctx.now, from: original } satisfies TypeStamp);
    }
  }
  return true;
}

/**
 * The suggestion version of `tr`, an edit made on `state`: deletions struck,
 * insertions and new lines marked, type changes recorded, formatting dropped.
 * Returns `tr` itself when there is nothing to rewrite.
 */
export function suggestTransaction(state: EditorState, tr: Transaction, opts: SuggestOptions): Transaction {
  if (!isLocalEdit(tr)) return tr;
  const types = markTypes(state.schema);
  if (!types) return tr;
  const out = state.tr;
  const ctx: Ctx = { state, out, types, opts, now: opts.now ?? Date.now() };

  // Positions in the document before step i of `tr`, as positions in `out`.
  let toOut: PosMap = (pos) => pos;
  let lastReplace: { step: ReplaceStep; result: ReturnType<typeof suggestReplace> } | null = null;

  tr.steps.forEach((step: Step, i: number) => {
    const prev = toOut;
    const outStart = out.steps.length;
    const origMap = tr.mapping.maps[i];
    if (step instanceof ReplaceStep) {
      const result = suggestReplace(ctx, step, prev);
      lastReplace = { step, result };
      const ours = out.mapping.slice(outStart);
      const insertedLen = step.slice.size;
      // Before the change, the same place; inside what was inserted, the same
      // offset into our copy of it; after it, past the struck text as well.
      toOut = (pos, assoc = 1) => {
        if (pos < step.from || (pos === step.from && assoc < 0 && insertedLen > 0)) return ours.map(prev(pos, assoc), assoc);
        if (pos <= step.from + insertedLen && insertedLen > 0) {
          return result.insertedAt + Math.min(result.insertedSize, pos - step.from);
        }
        if (insertedLen === 0 && pos === step.from) return assoc < 0 ? result.deletedFrom : result.deletedTo;
        return ours.map(prev(pos - insertedLen + (step.to - step.from), assoc), assoc);
      };
      return;
    }
    if (step instanceof ReplaceAroundStep) {
      suggestReplaceAround(ctx, step, prev);
    } else if ((step instanceof AddMarkStep || step instanceof RemoveMarkStep) && MARKS_A_SUGGESTER_MAY_SET.has(step.mark.type.name)) {
      const mapped = step.map(mappable(prev));
      if (mapped) out.maybeStep(mapped);
    } else {
      // Formatting, attributes, anything else: not something a suggestion carries.
      opts.onBlocked?.('formatting');
    }
    const ours = out.mapping.slice(outStart);
    const invert = origMap.invert();
    toOut = (pos, assoc = 1) => ours.map(prev(invert.map(pos, assoc), assoc), assoc);
  });

  // The caret: where the edit left it, translated. A deletion keeps the
  // struck text, so Backspace leaves the caret before it — the next
  // Backspace strikes the letter before — and Delete leaves it after.
  let head: number;
  const single = tr.steps.length === 1 ? lastReplace as { step: ReplaceStep; result: ReturnType<typeof suggestReplace> } | null : null;
  if (single && single.step.slice.size === 0 && tr.selection.empty) {
    // Only a real Backspace — from a caret, not over a selection — goes back.
    const backward = state.selection.empty && state.selection.head >= single.step.to;
    head = backward ? single.result.deletedFrom : single.result.deletedTo;
  } else {
    head = toOut(tr.selection.head, 1);
  }
  head = Math.max(0, Math.min(head, out.doc.content.size));
  try {
    out.setSelection(TextSelection.near(out.doc.resolve(head), 1));
  } catch { /* leave the mapped selection */ }

  // Keep what the editor attached to the edit: paste, input type, history grouping.
  const meta = (tr as unknown as { meta?: Record<string, unknown> }).meta ?? {};
  for (const [key, value] of Object.entries(meta)) out.setMeta(key, value);
  out.setMeta(SUGGESTION_META, true);
  // A suggestion is not a revision; it becomes one when it is accepted.
  out.setMeta(REVISION_SKIP_META, true);
  if (tr.scrolledIntoView) out.scrollIntoView();
  return out;
}

// ── Listing, accepting and rejecting ─────────────────────────────────────

export interface Suggestion {
  id: string;
  by: string;
  at: number;
  kinds: SuggestionKind[];
  /** What was suggested, to show in a list. */
  inserted: string;
  deleted: string;
  /** For a type change: the old and new type. */
  fromType?: string;
  toType?: string;
  /** Position of its first piece, to scroll to. */
  pos: number;
}

/** Every suggestion in the document, in script order, each piece of an id gathered together. */
export function listSuggestions(doc: PmNode): Suggestion[] {
  const byId = new Map<string, Suggestion>();
  const order: string[] = [];
  const get = (stamp: SuggestionStamp, pos: number): Suggestion => {
    let s = byId.get(stamp.id);
    if (!s) {
      s = { id: stamp.id, by: stamp.by, at: Number(stamp.at) || 0, kinds: [], inserted: '', deleted: '', pos };
      byId.set(stamp.id, s);
      order.push(stamp.id);
    }
    return s;
  };
  const add = (s: Suggestion, kind: SuggestionKind) => { if (!s.kinds.includes(kind)) s.kinds.push(kind); };
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      const split = stampOf(node, SUGGESTED_SPLIT);
      if (split) { const s = get(split, pos); add(s, 'split'); s.inserted += s.inserted ? '\n' : ''; }
      const join = stampOf(node, SUGGESTED_JOIN);
      if (join) add(get(join, pos), 'join');
      const type = stampOf(node, SUGGESTED_TYPE) as TypeStamp | null;
      if (type) { const s = get(type, pos); add(s, 'type'); s.fromType = type.from; s.toType = node.type.name; }
      return true;
    }
    if (!node.isInline) return true;
    const text = node.isText ? node.text ?? '' : '\n';
    const ins = markOf(node.marks, SUGGEST_INSERT);
    if (ins && isStamp(ins.attrs)) { const s = get(ins.attrs as SuggestionStamp, pos); add(s, 'insert'); s.inserted += text; }
    const del = markOf(node.marks, SUGGEST_DELETE);
    if (del && isStamp(del.attrs)) { const s = get(del.attrs as SuggestionStamp, pos); add(s, 'delete'); s.deleted += text; }
    return false;
  });
  return order.map((id) => byId.get(id)!);
}

export function hasSuggestions(doc: PmNode): boolean {
  let found = false;
  doc.descendants((node) => {
    if (found) return false;
    if (node.isTextblock && SUGGESTION_BLOCK_ATTRS.some((a) => stampOf(node, a))) found = true;
    else if (node.isInline && node.marks.some((m) => m.type.name === SUGGEST_INSERT || m.type.name === SUGGEST_DELETE)) found = true;
    return !found;
  });
  return found;
}

type Which = (stamp: SuggestionStamp) => boolean;

/**
 * Resolve the suggestions `which` picks out: accept makes them part of the
 * script, reject puts the script back as it was.
 */
export function resolveSuggestionsTransaction(state: EditorState, which: Which, accept: boolean): Transaction | null {
  const types = markTypes(state.schema);
  if (!types) return null;
  const tr = state.tr;
  const doc = state.doc;
  const removeText: Array<[number, number]> = [];
  const unmark: Array<[number, number, MarkType]> = [];
  /** Accepted words, written back without their mark — a change Revision Mode can see. */
  const settle: Array<[number, number, PmNode]> = [];
  const clearAttr: Array<[number, string]> = [];
  const joins: number[] = [];
  const retype: Array<[number, string]> = [];

  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      const split = stampOf(node, SUGGESTED_SPLIT);
      if (split && which(split)) { clearAttr.push([pos, SUGGESTED_SPLIT]); if (!accept) joins.push(pos); }
      const join = stampOf(node, SUGGESTED_JOIN);
      if (join && which(join)) { clearAttr.push([pos, SUGGESTED_JOIN]); if (accept) joins.push(pos); }
      const type = stampOf(node, SUGGESTED_TYPE) as TypeStamp | null;
      if (type && which(type)) { clearAttr.push([pos, SUGGESTED_TYPE]); if (!accept && type.from) retype.push([pos, type.from]); }
      return true;
    }
    if (!node.isInline) return true;
    const end = pos + node.nodeSize;
    const ins = types.ins.isInSet(node.marks);
    if (ins && isStamp(ins.attrs) && which(ins.attrs as SuggestionStamp)) {
      if (accept) settle.push([pos, end, node.mark(ins.removeFromSet(node.marks))]); else removeText.push([pos, end]);
    }
    const del = types.del.isInSet(node.marks);
    if (del && isStamp(del.attrs) && which(del.attrs as SuggestionStamp)) {
      if (accept) removeText.push([pos, end]); else unmark.push([pos, end, types.del]);
    }
    return false;
  });

  if (!removeText.length && !unmark.length && !clearAttr.length && !settle.length) return null;

  // Marks, attributes and same-size rewrites first: they move nothing.
  for (const [a, b, type] of unmark) tr.removeMark(a, b, type);
  for (const [a, b, node] of settle) tr.replaceWith(a, b, node);
  for (const [pos, attr] of clearAttr) tr.setNodeAttribute(pos, attr, null);
  for (const [pos, type] of retype) {
    const nodeType = state.schema.nodes[type];
    const node = tr.doc.nodeAt(pos);
    if (nodeType && node) {
      try { tr.setNodeMarkup(pos, nodeType, { ...node.attrs, [SUGGESTED_TYPE]: null }); } catch { /* type not valid here */ }
    }
  }
  // Then text and joins, from the end of the script back.
  const ops: Array<{ pos: number; run: () => void }> = [
    ...removeText.map(([a, b]) => ({ pos: a, run: () => tr.delete(a, b) })),
    ...joins.map((p) => ({ pos: p, run: () => { if (p > 0 && canJoin(tr.doc, p)) tr.join(p); } })),
  ];
  ops.sort((x, y) => y.pos - x.pos);
  for (const op of ops) op.run();
  tr.setMeta(SUGGESTION_META, true);
  // Rejecting puts the script back as it was: nothing there to revise.
  if (!accept) tr.setMeta(REVISION_SKIP_META, true);
  return tr;
}

export const resolveSuggestionTransaction = (state: EditorState, id: string, accept: boolean) =>
  resolveSuggestionsTransaction(state, (s) => s.id === id, accept);

/** The suggestion (if any) touching `pos`: the mark on the text there, or the line's own. */
export function suggestionAt(doc: PmNode, pos: number): SuggestionStamp | null {
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  for (const node of [$pos.nodeAfter, $pos.nodeBefore]) {
    if (!node) continue;
    for (const name of [SUGGEST_INSERT, SUGGEST_DELETE]) {
      const m = markOf(node.marks, name);
      if (m && isStamp(m.attrs)) return m.attrs as SuggestionStamp;
    }
  }
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (!node.isTextblock) continue;
    for (const attr of SUGGESTION_BLOCK_ATTRS) {
      const stamp = stampOf(node, attr);
      if (stamp) return stamp;
    }
  }
  return null;
}

/**
 * The script as it stands before any suggestion: every one rejected. What the
 * exports print, so nothing nobody has accepted reaches paper.
 */
export function withoutSuggestionsJSON(doc: JSONContent): JSONContent {
  const withoutDeleteMark = (marks: JSONContent['marks']) => (marks ?? []).filter((m) => m.type !== SUGGEST_DELETE);
  const inserted = (node: JSONContent) => (node.marks ?? []).some((m) => m.type === SUGGEST_INSERT);
  const strip = (node: JSONContent): JSONContent | null => {
    if (node.type === 'text' || node.type === 'hardBreak') {
      if (inserted(node)) return null;
      const next: JSONContent = { ...node };
      const marks = withoutDeleteMark(node.marks);
      if (marks.length) next.marks = marks; else delete next.marks;
      return next;
    }
    const next: JSONContent = { ...node };
    if (node.attrs) {
      const attrs = { ...node.attrs };
      for (const a of SUGGESTION_BLOCK_ATTRS) delete attrs[a];
      const type = node.attrs[SUGGESTED_TYPE];
      if (isStamp(type) && typeof (type as TypeStamp).from === 'string') next.type = (type as TypeStamp).from;
      next.attrs = attrs;
    }
    if (node.content) {
      const children: JSONContent[] = [];
      for (const child of node.content) {
        const stripped = strip(child);
        if (!stripped) continue;
        const prev = children[children.length - 1];
        // A suggested new line goes back onto the end of the line before it.
        if (isStamp(child.attrs?.[SUGGESTED_SPLIT]) && prev && prev.type !== 'text' && prev.type !== 'hardBreak') {
          prev.content = [...(prev.content ?? []), ...(stripped.content ?? [])];
          continue;
        }
        children.push(stripped);
      }
      next.content = children;
    }
    return next;
  };
  return strip(doc) ?? doc;
}
