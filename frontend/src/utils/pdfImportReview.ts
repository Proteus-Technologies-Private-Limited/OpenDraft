/**
 * The import preview for a PDF: what the writer sees between reading the PDF
 * and replacing the open script with it.
 *
 * A PDF's elements are guessed from where each line sits (see pdfImport), and
 * a script from another application will always have some guessed wrong — a
 * whole class of them, usually, because one indent was read as the wrong
 * element. The preview lists every paragraph with its type so the writer can
 * select those lines in bulk and set them right before the import goes in.
 *
 * Two halves:
 *
 * - Pure helpers — the rows, selection by click/range/type/indent, and the
 *   reviewed document — tested in pdfImportReview.test.ts.
 * - A one-slot reviewer the app registers (PdfImportPreviewHost). The import
 *   path asks it for the reviewed document; with none registered — tests, a
 *   headless caller — the document goes through as parsed.
 */
import type { JSONContent } from '@tiptap/react';
import type { ParsedPdfScreenplay } from './pdfImport';

/** The element types a line can be set to, in the order the picker lists them. */
export const REVIEW_TYPES = [
  'sceneHeading',
  'action',
  'character',
  'parenthetical',
  'dialogue',
  'transition',
  'shot',
  'general',
] as const;

export const REVIEW_TYPE_LABELS: Record<string, string> = {
  sceneHeading: 'Scene Heading',
  action: 'Action',
  character: 'Character',
  parenthetical: 'Parenthetical',
  dialogue: 'Dialogue',
  transition: 'Transition',
  shot: 'Shot',
  general: 'General',
  dualDialogue: 'Dual Dialogue',
};

/** One paragraph of the imported script, as the preview lists it. */
export interface ReviewRow {
  /** Index of the node in `doc.content`. */
  node: number;
  /** The type the parser gave it. */
  originalType: string;
  text: string;
  /** Page it starts on, when known. */
  page: number | null;
  /** Inches right of the action margin, when known. */
  indent: number | null;
  /** Whether its text is in capitals — half of what makes a line look like a cue. */
  caps: boolean;
  /** Read-only: dual dialogue, which is two speeches and not one line. */
  locked: boolean;
}

function nodeText(node: JSONContent): string {
  if (typeof node.text === 'string') return node.text;
  return (node.content ?? []).map(nodeText).join('');
}

function isCaps(text: string): boolean {
  const letters = text.replace(/\([^)]*\)/g, '').replace(/[^\p{L}]/gu, '');
  return letters.length > 0 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
}

/**
 * The rows for a parsed PDF: every body paragraph in order. The title page is
 * left out — it is not lines of the script, and it has its own editor.
 */
export function reviewRowsFrom(parsed: Pick<ParsedPdfScreenplay, 'doc' | 'layout'>): ReviewRow[] {
  const rows: ReviewRow[] = [];
  (parsed.doc.content ?? []).forEach((node, i) => {
    if (!node.type || node.type === 'titlePage') return;
    const layout = parsed.layout?.[i] ?? null;
    const locked = node.type === 'dualDialogue';
    const text = locked
      ? (node.content ?? []).map((col) => nodeText(col.content?.[0] ?? {})).join(' / ')
      : nodeText(node);
    rows.push({
      node: i,
      originalType: node.type,
      text,
      page: layout?.page ?? null,
      indent: layout?.indent ?? null,
      caps: isCaps(text),
      locked,
    });
  });
  return rows;
}

/**
 * The scene each row falls in, by the types as they stand now: 0 before the
 * first heading, then 1, 2, … — so retyping a line as a heading moves every
 * line after it into the new scene.
 */
export function sceneOrdinals(types: readonly string[]): number[] {
  let scene = 0;
  return types.map((t) => (t === 'sceneHeading' ? ++scene : scene));
}

/** What a line looks like on the page: its indent and whether it is in capitals. */
export function lookKey(row: ReviewRow): string | null {
  return row.indent === null ? null : `${row.indent.toFixed(1)}|${row.caps ? 'caps' : 'mixed'}`;
}

export interface ClickModifiers {
  /** Shift: extend from the anchor. */
  range?: boolean;
  /** Cmd/Ctrl (or a checkbox): add or remove one line. */
  toggle?: boolean;
}

export interface SelectionState {
  selected: ReadonlySet<number>;
  /** Row the next range starts from. */
  anchor: number | null;
}

/**
 * A click on row `index`, the way a file list takes it: alone it selects just
 * that row; with toggle it adds or removes it; with range it selects every
 * row from the anchor to it in `order` (the rows on show, so a filtered list
 * selects only what is visible), on top of the selection when toggle is held
 * too. Locked rows are never selected.
 */
export function clickSelect(
  state: SelectionState,
  index: number,
  mods: ClickModifiers,
  order: readonly number[],
  isLocked: (index: number) => boolean,
): SelectionState {
  if (isLocked(index)) return state;
  if (mods.range && state.anchor !== null) {
    const a = order.indexOf(state.anchor);
    const b = order.indexOf(index);
    if (a !== -1 && b !== -1) {
      const next = new Set(mods.toggle ? state.selected : []);
      const [from, to] = a <= b ? [a, b] : [b, a];
      for (let i = from; i <= to; i++) if (!isLocked(order[i])) next.add(order[i]);
      return { selected: next, anchor: state.anchor };
    }
  }
  if (mods.toggle) {
    const next = new Set(state.selected);
    if (next.has(index)) next.delete(index); else next.add(index);
    return { selected: next, anchor: index };
  }
  return { selected: new Set([index]), anchor: index };
}

/** Every unlocked row whose current type is one the selection already has. */
export function selectSameType(
  rows: readonly ReviewRow[],
  types: readonly string[],
  selected: ReadonlySet<number>,
): Set<number> {
  const wanted = new Set([...selected].map((i) => types[i]));
  const next = new Set<number>();
  rows.forEach((r, i) => { if (!r.locked && wanted.has(types[i])) next.add(i); });
  return next;
}

/** Every unlocked row that looks like one already selected: same indent, same case. */
export function selectSameLook(rows: readonly ReviewRow[], selected: ReadonlySet<number>): Set<number> {
  const wanted = new Set([...selected].map((i) => lookKey(rows[i])).filter((k): k is string => k !== null));
  const next = new Set<number>();
  rows.forEach((r, i) => {
    const key = lookKey(r);
    if (!r.locked && key !== null && wanted.has(key)) next.add(i);
  });
  return next;
}

/** `types` with every selected, unlocked row set to `type`. Returns the same array when nothing changes. */
export function setTypeOf(
  rows: readonly ReviewRow[],
  types: readonly string[],
  selected: ReadonlySet<number>,
  type: string,
): string[] {
  let changed = false;
  const next = [...types];
  for (const i of selected) {
    if (rows[i] && !rows[i].locked && next[i] !== type) {
      next[i] = type;
      changed = true;
    }
  }
  return changed ? next : (types as string[]);
}

/** How many rows now differ from what the parser said. */
export function countChanged(rows: readonly ReviewRow[], types: readonly string[]): number {
  return rows.reduce((n, r, i) => n + (types[i] !== r.originalType ? 1 : 0), 0);
}

/**
 * The document with the writer's corrections. A retyped paragraph keeps its
 * text and drops its attributes — a scene number on what is no longer a
 * heading, or the centring of a title card now read as a cue, belonged to
 * the old type. A paragraph set back to the type it came with is left whole.
 */
export function applyReviewedTypes(
  doc: JSONContent,
  rows: readonly ReviewRow[],
  types: readonly string[],
): JSONContent {
  const content = [...(doc.content ?? [])];
  rows.forEach((row, i) => {
    const type = types[i];
    if (row.locked || type === row.originalType) return;
    const original = content[row.node];
    const node: JSONContent = { type };
    if (original.content) node.content = original.content;
    content[row.node] = node;
  });
  return { ...doc, content };
}

// ── The reviewer the app registers ──────────────────────────────────────────

/** Thrown when the writer cancels the preview. Callers leave the open script alone and stay quiet. */
export class ImportCancelledError extends Error {
  constructor() {
    super('Import cancelled.');
    this.name = 'ImportCancelledError';
  }
}

export function isImportCancelled(err: unknown): boolean {
  return err instanceof ImportCancelledError;
}

export interface PdfImportReviewRequest {
  filename: string;
  parsed: ParsedPdfScreenplay;
}

/** Resolves with the document to import, or null when the writer cancels. */
export type PdfImportReviewer = (request: PdfImportReviewRequest) => Promise<JSONContent | null>;

let reviewer: PdfImportReviewer | null = null;

/** Register the preview. Returns the function that unregisters it. */
export function setPdfImportReviewer(fn: PdfImportReviewer): () => void {
  reviewer = fn;
  return () => {
    if (reviewer === fn) reviewer = null;
  };
}

/**
 * The document the writer approved. With no preview registered it is the
 * parsed one, unchanged. Throws ImportCancelledError when they cancel.
 */
export async function reviewPdfImport(filename: string, parsed: ParsedPdfScreenplay): Promise<JSONContent> {
  if (!reviewer) return parsed.doc;
  const doc = await reviewer({ filename, parsed });
  if (!doc) throw new ImportCancelledError();
  return doc;
}
