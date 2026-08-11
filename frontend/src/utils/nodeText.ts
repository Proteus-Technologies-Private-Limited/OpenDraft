/**
 * Hard-break-aware text extraction, shared by every consumer of a screenplay
 * block's inline content.
 *
 * Screenplay blocks contain `inline*`, which today means text nodes and
 * `hardBreak` leaves. A `hardBreak` carries no `text`, so the obvious
 * `node.content.map(c => c.text || '').join('')` drops it and glues the words
 * on either side together. Every exporter, every analysis pass and every
 * importer used to hand-roll that same broken walk; they all call in here now.
 *
 * Two domains, deliberately separate:
 *
 * - **JSON** (`JSONContent`) — what exporters, importers and analysis see.
 *   Nothing consults the ProseMirror schema, so `leafText` cannot help; these
 *   helpers do the substitution explicitly.
 * - **ProseMirror nodes** — `node.textContent` is already correct thanks to the
 *   `leafText` patch in `editor/extensions/ScreenplayHardBreak.ts`. The only
 *   helper needed here is `blockContentRange`, for position safety.
 *
 * Kept free of framework and Tauri imports (only a type-only ProseMirror
 * import) so it stays trivially unit-testable in the node test environment,
 * matching the convention in `docText.ts`.
 */
import type { JSONContent } from '@tiptap/react';
import type { Node as PMNode } from '@tiptap/pm/model';

/** The node type name for an inline hard break. */
export const BREAK_TYPE = 'hardBreak';

// ── JSON side ───────────────────────────────────────────────────────────────

/**
 * Plain text of a JSON node, with `hardBreak` rendered as a newline.
 *
 * Recurses through container nodes (dual dialogue columns, AV cells) so a
 * single call covers nested structures. Leaves that are neither text nor a
 * break contribute nothing, which matches how they render.
 */
export function jsonBlockText(node: JSONContent | null | undefined): string {
  if (!node) return '';
  if (node.type === BREAK_TYPE) return '\n';
  if (typeof node.text === 'string') return node.text;
  if (!Array.isArray(node.content)) return '';
  let out = '';
  for (const child of node.content) out += jsonBlockText(child);
  return out;
}

/** The block's text split into the lines the hard breaks divide it into. */
export function jsonBlockLines(node: JSONContent | null | undefined): string[] {
  return jsonBlockText(node).split('\n');
}

/** True when the node contains a hard break at any depth. */
export function jsonHasBreak(node: JSONContent | null | undefined): boolean {
  if (!node) return false;
  if (node.type === BREAK_TYPE) return true;
  if (!Array.isArray(node.content)) return false;
  return node.content.some(jsonHasBreak);
}

/**
 * One styled run per inline child. A hard break becomes an empty run flagged
 * `isBreak`, so serializers that have a native line-break primitive (DOCX
 * `TextRun({break:1})`, FDX `&#10;`) can emit it, and those that wrap text
 * themselves (PDF) can force a line boundary.
 *
 * A node with no content yields a single empty run — callers rely on that to
 * render a blank line rather than nothing at all.
 */
export interface Run {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  isBreak: boolean;
  /**
   * Typeface this run was explicitly given, from the `textStyle` mark.
   * Absent — the common case — means the run follows the document's font,
   * which is what every exporter should fall back to.
   */
  fontFamily?: string;
}

const EMPTY_RUN: Run = { text: '', bold: false, italic: false, underline: false, strike: false, isBreak: false };

export function jsonBlockRuns(node: JSONContent | null | undefined): Run[] {
  if (!node || !Array.isArray(node.content) || node.content.length === 0) {
    return [{ ...EMPTY_RUN }];
  }
  return node.content.map((child): Run => {
    if (child.type === BREAK_TYPE) return { ...EMPTY_RUN, isBreak: true };
    let bold = false, italic = false, underline = false, strike = false;
    let fontFamily: string | undefined;
    if (child.marks) {
      for (const mark of child.marks) {
        if (mark.type === 'bold') bold = true;
        if (mark.type === 'italic') italic = true;
        if (mark.type === 'underline') underline = true;
        if (mark.type === 'strike') strike = true;
        if (mark.type === 'textStyle' && typeof mark.attrs?.fontFamily === 'string') {
          fontFamily = mark.attrs.fontFamily;
        }
      }
    }
    return { text: child.text || '', bold, italic, underline, strike, isBreak: false, fontFamily };
  });
}

// ── ProseMirror side ────────────────────────────────────────────────────────

/**
 * The document range covering a block node's inline content.
 *
 * Always use this instead of `pos + 1 + node.textContent.length`. That form is
 * off by one per inline atom, and the resulting short range makes `insertText`
 * leave the tail of the block behind — duplicating it. Deriving from
 * `nodeSize` is correct regardless of what inline nodes the block contains.
 */
export function blockContentRange(node: PMNode, pos: number): { from: number; to: number } {
  return { from: pos + 1, to: pos + node.nodeSize - 1 };
}

// ── Normalization ───────────────────────────────────────────────────────────

/**
 * Collapse hard breaks (and the whitespace around them) into single spaces.
 *
 * For contexts that are one line by definition: a character-cue lookup key, a
 * scene-heading being parsed for location and time of day, a one-line UI label,
 * or a target format whose syntax a newline would break (a Fountain transition,
 * an FDX Character paragraph).
 */
export function singleLine(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').trim();
}

/**
 * Canonical lookup key for a character cue: one line, extensions like
 * `(CONT'D)` or `(V.O.)` removed, uppercased.
 *
 * This regex was copy-pasted across a dozen components. Any site that compares
 * a cue against a stored name must use this same normalization on BOTH sides or
 * the match silently fails.
 */
export function characterKey(raw: string): string {
  return singleLine(raw).replace(/\s*\([^)]*\)\s*/g, '').trim().toUpperCase();
}
