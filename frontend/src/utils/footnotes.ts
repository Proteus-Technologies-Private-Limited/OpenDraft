/**
 * Which script notes print, where they sit, and how much room they need.
 *
 * A note that prints is not an annotation any more — it is content, and content
 * takes space. The editor reserves that space by shrinking the lines available
 * on the page; the PDF exporter has to reserve exactly the same amount or the
 * writer's page count stops matching the file they send out. That is the same
 * contract `wrapText.ts` describes between `getTextLines` and `wordWrapRuns`,
 * and it is why the reserve is computed here, once, for both.
 *
 * Two rules earn their own explanation.
 *
 * **Marker width is an upper bound, not the real number.** A note's height
 * depends on how much of its first line the marker eats; the marker depends on
 * the note's number; and under "restart each page" the number depends on which
 * page the note landed on — which is what pagination is trying to decide. That
 * circle is cut by measuring against the widest marker the document could
 * possibly produce (`markerWidthUpperBound`). Reserved space is then always at
 * least the drawn space, and pagination becomes completely independent of the
 * numbers, so no iteration is needed anywhere.
 *
 * **A superscript marker costs no cells.** It is drawn above the line and
 * overhangs, exactly as the editor's decoration does, so neither the editor nor
 * the PDF counts it and the two agree by construction. A bracketed marker is
 * ordinary inline text, so both count it — and the PDF pads it out to the same
 * upper bound the editor reserved, so they still agree to the character.
 *
 * Free of React, stores beyond plain types, and Tauri, so it is unit-testable
 * in the node environment.
 */
import type { JSONContent } from '@tiptap/react';
import type { Node as PMNode } from '@tiptap/pm/model';
import {
  type FootnoteSettings,
  type GeneralNote,
  type NoteInfo,
  effectiveNotePlacement,
  generalNoteWillPrint,
  noteWillPrint,
  resolveFootnotes,
  type PageLayout,
} from '../stores/editorStore';
import {
  markerWidthUpperBound,
  noteEntryLabel,
  noteMarkerText,
  type FootnoteMarkerStyle,
} from './noteNumbering';
import { parseNoteContent, noteBlockText, type NoteBlock, type NoteRenderContext } from './noteContent';
import { getTextLines } from './wrapText';

/** The mark that anchors a script note to its text. */
const NOTE_MARK = 'scriptNote';

/** A blank line plus the separator rule above the footnote block. */
export const FOOTNOTE_SEPARATOR_LINES = 2;

/** Height of an unmeasured image, mirroring `screenplayImage`'s own default. */
export const FOOTNOTE_IMAGE_LINES = 8;

/** Lines of heading above the first endnote page: "NOTES" plus two blank. */
export const ENDNOTE_HEADING_LINES = 3;

/**
 * Most of a page that footnotes may take. Word has no such cap and will happily
 * push every line of script off the page; this keeps a page readable and, more
 * importantly, keeps termination from depending on the `lineCount > 0` guard in
 * `computeBreaks` alone. Anything over the cap continues on the next page,
 * which is what Word does with a long footnote too.
 */
export const MAX_FOOTNOTE_FRACTION = 0.5;

/** Characters per line for footnote text: the full action measure. */
export const FOOTNOTE_CPL = 62;

/** One printing note's anchor in the script. */
export interface FootnoteRef {
  noteId: string;
  /** Index into the document's top-level content, before any exporter filters. */
  srcIndex: number;
  /** Character offset within the block's text at which the marker is drawn. */
  charOffset: number;
  /** The number shown, already offset by "Start at". */
  number: number;
  /** What is drawn in the script: `1` (raised) or `[1]`. */
  label: string;
}

/** One printing note's body, as it will appear in the footnote block. */
export interface FootnoteEntry {
  noteId: string;
  number: number;
  /** What opens the note's own line: the bare number, whatever the marker style. */
  entryLabel: string;
  blocks: NoteBlock[];
  /** Height in 12pt lines, marker and images included. */
  lines: number;
  /** A general note's title, shown before its text. Anchored notes have none. */
  title?: string;
  /** True for a general note: anchored to nothing, so always an endnote. */
  isGeneral?: boolean;
}

export interface FootnotePlan {
  settings: FootnoteSettings;
  /** Document order. */
  refs: FootnoteRef[];
  /** srcIndex → the refs anchored in that block, in offset order. */
  refsByNode: Map<number, FootnoteRef[]>;
  /**
   * Anchored notes that print at the foot of their page, in document order.
   *
   * Not every anchored note is here: a note can be sent to the end of the
   * script on its own, overriding the document's Location. Those are in
   * `endnoteEntries` instead — but they still carry a reference number in the
   * script, so `refs` covers both.
   */
  entries: FootnoteEntry[];
  /**
   * Printing general notes, which belong to the file rather than to any line of
   * it. With nothing to anchor them to there is no marker to draw and no page
   * that is theirs, so they always collect at the end of the script — even when
   * the anchored notes are set to print at the foot of the page.
   */
  generalEntries: FootnoteEntry[];
  /** Anchored notes sent to the end of the script rather than to a page foot. */
  anchoredEndnotes: FootnoteEntry[];
  /** Everything bound for the sheets at the end, in the order it appears there. */
  endnoteEntries: FootnoteEntry[];
  /** Ids of the anchored notes that print at a page foot — those, and only
   *  those, take room away from a page. */
  footnoteIds: ReadonlySet<string>;
  entryById: Map<string, FootnoteEntry>;
  /** Widest marker this document could produce — see the module comment. */
  markerWidth: number;
  /** Cells a marker occupies in the character grid: none if it is superscript. */
  markerCells: number;

  /**
   * Ids of the notes anchored in the block range [from, to] that take room at
   * the foot of the page. A note bound for the end of the script is anchored
   * here too, but costs this page nothing.
   */
  notesForNodes(from: number, to: number): string[];
  /** Lines to hold back on a page carrying these notes, plus any carried in. */
  reserveLines(carry: number, noteIds: readonly string[], linesPerPage: number): number;
  /** Lines that will not fit and must continue on the next page. */
  overflowLines(carry: number, noteIds: readonly string[], linesPerPage: number): number;
  /** A block's text with marker placeholders spliced in, for line counting. */
  textWithMarkers(srcIndex: number, text: string): string;
}

// ── Reading anchors out of a document ───────────────────────────────────────

interface AnchorHit { noteId: string; charOffset: number }

function isPmNode(doc: unknown): doc is PMNode {
  const d = doc as { forEach?: unknown; type?: { name?: unknown } };
  return !!d && typeof d.forEach === 'function' && typeof d.type?.name === 'string';
}

/** Note ids carried by an inline child's marks, if any. */
function markNoteIds(marks: readonly { type: unknown; attrs?: Record<string, unknown> | null }[] | undefined): string[] {
  if (!marks) return [];
  const out: string[] = [];
  for (const m of marks) {
    const name = typeof m.type === 'string' ? m.type : (m.type as { name?: string })?.name;
    if (name !== NOTE_MARK) continue;
    const id = m.attrs?.noteId;
    if (typeof id === 'string' && id) out.push(id);
  }
  return out;
}

/**
 * Walk one block's inline children, recording where each note's marked range
 * ends. Offsets are in the same coordinate system as `jsonBlockText` and
 * ProseMirror's `textContent` — a hard break counts as one character — so they
 * line up with what `getTextLines` and `wordWrapRuns` measure.
 */
function scanInline(
  children: Array<{ type: unknown; text?: string; marks?: readonly { type: unknown; attrs?: Record<string, unknown> | null }[]; isText?: boolean }>,
  wanted: ReadonlySet<string>,
): AnchorHit[] {
  const ends = new Map<string, number>();
  let pos = 0;
  for (const child of children) {
    const typeName = typeof child.type === 'string' ? child.type : (child.type as { name?: string })?.name;
    if (typeName === 'hardBreak') { pos += 1; continue; }
    const text = typeof child.text === 'string' ? child.text : '';
    const next = pos + text.length;
    for (const id of markNoteIds(child.marks)) {
      // The last run carrying the mark wins, so the marker lands after the
      // whole annotated phrase rather than after its first styled fragment.
      if (wanted.has(id)) ends.set(id, next);
    }
    pos = next;
  }
  return [...ends.entries()]
    .map(([noteId, charOffset]) => ({ noteId, charOffset }))
    .sort((a, b) => a.charOffset - b.charOffset);
}

function scanDoc(doc: PMNode | JSONContent, wanted: ReadonlySet<string>): Map<number, AnchorHit[]> {
  const out = new Map<number, AnchorHit[]>();
  const record = (index: number, hits: AnchorHit[]) => {
    if (hits.length) out.set(index, hits);
  };

  if (isPmNode(doc)) {
    let index = 0;
    doc.forEach((block) => {
      const children: Parameters<typeof scanInline>[0] = [];
      block.forEach((child) => {
        children.push({
          type: child.type,
          text: child.isText ? child.text ?? '' : undefined,
          marks: child.marks as unknown as readonly { type: unknown; attrs?: Record<string, unknown> | null }[],
        });
      });
      record(index, scanInline(children, wanted));
      index++;
    });
    return out;
  }

  const content = Array.isArray(doc.content) ? doc.content : [];
  content.forEach((block, index) => {
    const children = Array.isArray(block.content) ? block.content : [];
    record(index, scanInline(children as Parameters<typeof scanInline>[0], wanted));
  });
  return out;
}

// ── Measuring ───────────────────────────────────────────────────────────────

/**
 * Height of one entry in 12pt lines.
 *
 * The label opens the first line, so it is counted against that line's wrap.
 * Images are counted by their measured height when one is known and by
 * `FOOTNOTE_IMAGE_LINES` until then — the same guess `screenplayImage` makes.
 */
export function footnoteEntryLines(
  blocks: readonly NoteBlock[],
  labelWidth: number,
  imageLines: number | undefined,
  cpl: number,
): number {
  let lines = 0;
  let imageCount = 0;
  let first = true;
  for (const block of blocks) {
    if (block.kind === 'image') { imageCount++; continue; }
    const text = noteBlockText(block);
    lines += getTextLines(first ? ' '.repeat(labelWidth + 1) + text : text, cpl);
    first = false;
  }
  // A note that is nothing but pictures still needs a line to carry its number.
  if (first) lines += 1;
  if (imageCount > 0) {
    lines += imageLines !== undefined && Number.isFinite(imageLines)
      ? Math.max(1, Math.round(imageLines))
      : imageCount * FOOTNOTE_IMAGE_LINES;
  }
  return lines;
}

/** Total height of a footnote block: the separator plus every entry. */
export function footnoteBlockLines(entries: readonly FootnoteEntry[]): number {
  if (entries.length === 0) return 0;
  return FOOTNOTE_SEPARATOR_LINES + entries.reduce((n, e) => n + e.lines, 0);
}

/** The most a page will give up to footnotes. Never the whole page. */
export function footnoteCap(linesPerPage: number): number {
  return Math.max(1, Math.floor(linesPerPage * MAX_FOOTNOTE_FRACTION));
}

// ── Building the plan ───────────────────────────────────────────────────────

/**
 * Everything the editor and the exporters need about printing notes, or `null`
 * when there is nothing to do.
 *
 * Returning `null` — rather than an empty plan — is deliberate: every consumer
 * opens with `if (!plan)` and takes exactly the code path it took before this
 * feature existed. That is what makes "with the option off, nothing changes"
 * a property of the structure rather than a promise.
 */
export function buildFootnotePlan(
  doc: PMNode | JSONContent | null | undefined,
  layout: PageLayout | undefined,
  notes: readonly NoteInfo[] | undefined,
  ctx: NoteRenderContext,
  generalNotes: readonly GeneralNote[] = [],
): FootnotePlan | null {
  const settings = resolveFootnotes(layout);
  if (!settings.enabled) return null;

  const printingGeneral = generalNotes.filter(generalNoteWillPrint);

  const printing = new Map<string, NoteInfo>();
  for (const n of notes ?? []) if (noteWillPrint(n)) printing.set(n.id, n);

  // Anchors are only worth looking for when there is something anchored.
  const hits = doc && printing.size > 0
    ? scanDoc(doc, new Set(printing.keys()))
    : new Map<number, AnchorHit[]>();

  // Nothing to print either way: return null so every consumer takes the path
  // it took before this feature existed.
  if (hits.size === 0 && printingGeneral.length === 0) return null;

  // Document order, and only the first anchor of a note counts: a note pinned
  // to two phrases is still one reference, as it is in Word.
  const seen = new Set<string>();
  const ordered: Array<{ noteId: string; srcIndex: number; charOffset: number }> = [];
  for (const srcIndex of [...hits.keys()].sort((a, b) => a - b)) {
    for (const hit of hits.get(srcIndex)!) {
      if (seen.has(hit.noteId)) continue;
      seen.add(hit.noteId);
      ordered.push({ noteId: hit.noteId, srcIndex, charOffset: hit.charOffset });
    }
  }
  if (ordered.length === 0 && printingGeneral.length === 0) return null;

  // General notes continue the same sequence after the anchored ones, so the
  // script has one run of numbers rather than two competing ones.
  const total = ordered.length + printingGeneral.length;
  const markerWidth = markerWidthUpperBound(
    settings.startAt, total, settings.numberFormat, settings.markerStyle,
  );
  const labelWidth = markerWidthUpperBound(
    settings.startAt, total, settings.numberFormat, 'superscript',
  );
  const markerCells = settings.markerStyle === 'superscript' ? 0 : markerWidth;

  const refs: FootnoteRef[] = [];
  /** Anchored notes that take room at the foot of their page. */
  const entries: FootnoteEntry[] = [];
  /** Anchored notes sent to the end of the script instead. */
  const anchoredEndnotes: FootnoteEntry[] = [];
  /** The ids that cost a page something — the reserve is built from these. */
  const footAnchored = new Set<string>();
  const entryById = new Map<string, FootnoteEntry>();
  const refsByNode = new Map<number, FootnoteRef[]>();

  ordered.forEach((o, i) => {
    const note = printing.get(o.noteId)!;
    const number = settings.startAt + i;
    const ref: FootnoteRef = {
      noteId: o.noteId,
      srcIndex: o.srcIndex,
      charOffset: o.charOffset,
      number,
      label: noteMarkerText(number, settings.numberFormat, settings.markerStyle),
    };
    refs.push(ref);
    const list = refsByNode.get(o.srcIndex);
    if (list) list.push(ref); else refsByNode.set(o.srcIndex, [ref]);

    const blocks = parseNoteContent(note.content, ctx);
    const entry: FootnoteEntry = {
      noteId: o.noteId,
      number,
      entryLabel: noteEntryLabel(number, settings.numberFormat),
      blocks,
      lines: footnoteEntryLines(blocks, labelWidth, note.printImageLines, FOOTNOTE_CPL),
    };
    // One sequence in document order whichever way each note goes, so the
    // numbers a reader meets in the script run 1, 2, 3 without a gap — two
    // independent sequences sharing one number format would show two "1"s.
    if (effectiveNotePlacement(note, settings) === 'endnote') {
      anchoredEndnotes.push(entry);
    } else {
      entries.push(entry);
      footAnchored.add(o.noteId);
    }
    entryById.set(o.noteId, entry);
  });

  // General notes: no anchor, no marker, no page of their own — they are
  // numbered after the anchored ones and collect at the end of the script.
  const generalEntries: FootnoteEntry[] = printingGeneral.map((note, i) => {
    const number = settings.startAt + ordered.length + i;
    const blocks = parseNoteContent(note.content, ctx);
    const entry: FootnoteEntry = {
      noteId: note.id,
      number,
      entryLabel: noteEntryLabel(number, settings.numberFormat),
      blocks,
      lines: footnoteEntryLines(blocks, labelWidth, note.printImageLines, FOOTNOTE_CPL)
        + (note.title.trim() ? 1 : 0),
      title: note.title.trim() || undefined,
      isGeneral: true,
    };
    entryById.set(note.id, entry);
    return entry;
  });

  // What reaches the sheets at the end: any anchored note sent there, then the
  // general ones, which have nowhere else they could go.
  const endnoteEntries = [...anchoredEndnotes, ...generalEntries];

  // Only the page-foot notes are counted against a page's room.
  const nodeNotes = new Map<number, string[]>();
  for (const [srcIndex, list] of refsByNode) {
    const ids = list.map((r) => r.noteId).filter((id) => footAnchored.has(id));
    if (ids.length > 0) nodeNotes.set(srcIndex, ids);
  }

  const rawReserve = (carry: number, noteIds: readonly string[]): number => {
    let sum = 0;
    for (const id of noteIds) sum += entryById.get(id)?.lines ?? 0;
    const content = Math.max(0, carry) + sum;
    // The separator is drawn on every page that carries anything, a continued
    // note included — so it is charged for on every one of them.
    return content > 0 ? FOOTNOTE_SEPARATOR_LINES + content : 0;
  };

  return {
    settings,
    refs,
    refsByNode,
    entries,
    generalEntries,
    anchoredEndnotes,
    endnoteEntries,
    footnoteIds: footAnchored,
    entryById,
    markerWidth,
    markerCells,

    notesForNodes(from, to) {
      let out: string[] | null = null;
      for (let i = from; i <= to; i++) {
        const ids = nodeNotes.get(i);
        if (!ids) continue;
        if (!out) out = [];
        out.push(...ids);
      }
      return out ?? EMPTY_IDS;
    },

    reserveLines(carry, noteIds, linesPerPage) {
      // Deliberately NOT gated on the document's own Location: a note can be
      // sent to the foot of its page against it, and only the ids that actually
      // go there ever reach this — `notesForNodes` filters them. Gating here as
      // well meant such a note reserved nothing and drew over the script.
      const raw = rawReserve(carry, noteIds);
      if (raw === 0) return 0;
      return Math.min(raw, footnoteCap(linesPerPage));
    },

    overflowLines(carry, noteIds, linesPerPage) {
      const raw = rawReserve(carry, noteIds);
      return Math.max(0, raw - footnoteCap(linesPerPage));
    },

    textWithMarkers(srcIndex, text) {
      if (markerCells === 0) return text;
      const list = refsByNode.get(srcIndex);
      if (!list || list.length === 0) return text;
      // Right to left, so an earlier splice cannot move a later offset.
      let out = text;
      for (const ref of [...list].sort((a, b) => b.charOffset - a.charOffset)) {
        const at = Math.min(Math.max(0, ref.charOffset), out.length);
        out = out.slice(0, at) + PLACEHOLDER.repeat(markerCells) + out.slice(at);
      }
      return out;
    },
  };
}

/** Stands in for a marker while counting lines; never rendered. */
const PLACEHOLDER = '•';

const EMPTY_IDS: string[] = [];

// ── Endnotes ────────────────────────────────────────────────────────────────

/**
 * One note's share of a page — a whole note, or as much of one as fits.
 *
 * A footnote longer than the room its page can give up is not dropped and does
 * not overflow into the script: what fits is drawn, and the remainder continues
 * at the foot of the next page, which is what Word does with a long footnote.
 */
export interface NoteSlice {
  noteId: string;
  /** First line of the note drawn here, so a long one can span pages. */
  fromLine: number;
  lines: number;
  /** False on a continuation, where the number is not repeated. */
  isStart: boolean;
}

/** Historical name, kept because the endnote sheets use the same shape. */
export type EndnoteSlice = NoteSlice;

export interface EndnotePage {
  /** True on the page carrying the "NOTES" heading. */
  hasHeading: boolean;
  slices: EndnoteSlice[];
}

/**
 * Pack the entries into pages at the end of the script.
 *
 * An entry taller than a whole page is split rather than dropped — the
 * alternative is content that silently never prints.
 */
/** What one page draws at its foot, and what it hands on to the next. */
export interface FootnotePageFill {
  /** Lines held back from the script — separator included. */
  reserve: number;
  /** Exactly what to draw, already clipped to the room available. */
  slices: NoteSlice[];
  /** What did not fit, for the next page to continue. */
  pending: NoteSlice[];
}

/**
 * Fit a page's footnotes into the room a page can give up.
 *
 * Anything left over becomes the next page's problem rather than spilling over
 * the script — the single rule that keeps a long footnote from wrecking the
 * page. Shared by the paginator and the PDF exporter so the two cannot draw
 * different amounts.
 */
export function packFootnotePage(
  carried: readonly NoteSlice[],
  arriving: readonly FootnoteEntry[],
  linesPerPage: number,
): FootnotePageFill {
  const queue: NoteSlice[] = [
    ...carried,
    ...arriving.map((e) => ({ noteId: e.noteId, fromLine: 0, lines: e.lines, isStart: true })),
  ];
  const content = queue.reduce((n, q) => n + q.lines, 0);
  if (content === 0) return { reserve: 0, slices: [], pending: [] };

  const reserve = Math.min(FOOTNOTE_SEPARATOR_LINES + content, footnoteCap(linesPerPage));
  const drawable = Math.max(0, reserve - FOOTNOTE_SEPARATOR_LINES);

  const slices: NoteSlice[] = [];
  const pending: NoteSlice[] = [];
  let used = 0;
  for (const q of queue) {
    const room = drawable - used;
    if (room <= 0) { pending.push(q); continue; }
    const take = Math.min(room, q.lines);
    slices.push({ noteId: q.noteId, fromLine: q.fromLine, lines: take, isStart: q.isStart });
    used += take;
    if (take < q.lines) {
      pending.push({
        noteId: q.noteId, fromLine: q.fromLine + take, lines: q.lines - take, isStart: false,
      });
    }
  }
  return { reserve, slices, pending };
}

export function buildEndnotePages(
  entries: readonly FootnoteEntry[],
  linesPerPage: number,
  /**
   * Footnote text that ran out of script to continue on. A note longer than
   * the pages left below it finishes here rather than being cut off — the
   * alternative is content that silently never prints.
   */
  carried: readonly NoteSlice[] = [],
): EndnotePage[] {
  if ((entries.length === 0 && carried.length === 0) || linesPerPage <= 0) return [];

  const pages: EndnotePage[] = [];
  let page: EndnotePage = { hasHeading: true, slices: [] };
  let used = ENDNOTE_HEADING_LINES;

  const nextPage = () => {
    pages.push(page);
    page = { hasHeading: false, slices: [] };
    used = 0;
  };

  for (const slice of carried) {
    let placed = 0;
    while (placed < slice.lines) {
      const room = linesPerPage - used;
      if (room <= 0) { nextPage(); continue; }
      const take = Math.min(room, slice.lines - placed);
      page.slices.push({
        noteId: slice.noteId,
        fromLine: slice.fromLine + placed,
        lines: take,
        isStart: false,
      });
      placed += take;
      used += take;
      if (placed < slice.lines) nextPage();
    }
  }

  for (const entry of entries) {
    let placed = 0;
    while (placed < entry.lines) {
      const room = linesPerPage - used;
      if (room <= 0) { nextPage(); continue; }
      const take = Math.min(room, entry.lines - placed);
      page.slices.push({
        noteId: entry.noteId,
        fromLine: placed,
        lines: take,
        isStart: placed === 0,
      });
      placed += take;
      used += take;
      if (placed < entry.lines) nextPage();
    }
  }
  pages.push(page);
  return pages.filter((p) => p.hasHeading || p.slices.length > 0);
}

/**
 * A cheap value that changes exactly when the plan would lay out differently.
 *
 * The plan is rebuilt on a short debounce as the writer types, so its object
 * identity churns even when nothing about the page has changed. Repaginating on
 * identity would dispatch a transaction every debounce tick; repaginating on
 * this only does so when a marker, an anchor or a note's height actually moved.
 */
export function footnotePlanSignature(plan: FootnotePlan | null): string {
  if (!plan) return '';
  const s = plan.settings;
  return [
    s.placement, s.markerStyle, s.numberFormat, s.numbering, s.startAt,
    plan.markerCells,
    plan.refs.map((r) => `${r.srcIndex}:${r.charOffset}:${r.label}`).join(','),
    // Page-foot notes by height, since that is what they cost a page...
    plan.entries.map((e) => `${e.noteId}:${e.lines}`).join(','),
    // ...and everything bound for the end, which decides how many sheets get
    // added. Leaving these out meant adding a general note changed nothing
    // until the writer's next keystroke.
    plan.endnoteEntries.map((e) => `${e.noteId}:${e.lines}`).join(','),
  ].join('|');
}

/** The minimum a run needs for a marker to be attached to it. */
export interface MarkerCarrier {
  text: string;
  isBreak?: boolean;
  marker?: string;
}

/**
 * Put the reference markers into a block's runs, ready to draw.
 *
 * The two marker styles are handled differently, and deliberately:
 *
 *   - **Superscript** rides beside the text in `marker`, because it advances
 *     the cursor by nothing — it overhangs into the following space, exactly as
 *     the editor's decoration does. The editor cannot see a decoration in
 *     `node.textContent`, so a superscript that consumed cells here would make
 *     the PDF wrap differently from the page on screen.
 *   - **Bracketed** is ordinary text and is spliced into the run itself, padded
 *     to the same width the editor reserved for it, so both count the same
 *     cells and wrap in the same place.
 */
export function applyFootnoteMarkers<T extends MarkerCarrier>(
  runs: readonly T[],
  refs: readonly FootnoteRef[],
  style: FootnoteMarkerStyle,
  markerWidth: number,
): T[] {
  if (refs.length === 0) return runs as T[];
  const sorted = [...refs].sort((a, b) => a.charOffset - b.charOffset);

  const out: T[] = [];
  let pos = 0;
  let ri = 0;

  for (const run of runs) {
    if (run.isBreak) { out.push(run); pos += 1; continue; }

    const len = run.text.length;
    const cuts: FootnoteRef[] = [];
    while (ri < sorted.length && sorted[ri].charOffset > pos && sorted[ri].charOffset <= pos + len) {
      cuts.push(sorted[ri]);
      ri++;
    }
    if (cuts.length === 0) { out.push(run); pos += len; continue; }

    let cursor = 0;
    for (const ref of cuts) {
      const at = ref.charOffset - pos;
      const head = run.text.slice(cursor, at);
      if (style === 'bracketed') {
        out.push({ ...run, text: head + ref.label.padEnd(markerWidth, ' ') });
      } else {
        // An empty head is fine: the wrapper hangs the marker on the word
        // before it, which is the phrase the reference belongs to.
        out.push({ ...run, text: head, marker: ref.label });
      }
      cursor = at;
    }
    const tail = run.text.slice(cursor);
    if (tail.length > 0) out.push({ ...run, text: tail });
    pos += len;
  }

  return out;
}
