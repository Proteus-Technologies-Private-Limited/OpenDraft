/**
 * Revision marks for the formats that lay out their own lines.
 *
 * The PDF marks every revised *line*, because it knows where each line ends.
 * Word, Fountain and Fade In each wrap text themselves, so the most any of
 * them can be told is which *paragraph* holds a revision — and that paragraph
 * gets one mark, the latest revision's.
 */
import type { JSONContent } from '@tiptap/react';
import {
  REVISION_COLORS, findRevisionColor, latestRevision, revisionMarkFor, type RevisionSettings,
} from '../editor/revisionColors';
import { REVISION_ATTR, REVISED_ATTR } from '../editor/revisionMarks';

/** Every revision colour a block's text — or the block itself — carries. */
function collect(node: JSONContent, out: string[]): void {
  const flag = node.attrs?.[REVISED_ATTR];
  if (typeof flag === 'string' && flag) out.push(flag);
  for (const mark of node.marks ?? []) {
    const rev = mark.type === 'textStyle' ? mark.attrs?.[REVISION_ATTR] : null;
    if (typeof rev === 'string' && rev) out.push(rev);
  }
  for (const child of node.content ?? []) collect(child, out);
}

/** The latest revision anywhere in `node`, or null when it is unrevised. */
export function blockRevision(node: JSONContent): string | null {
  const found: string[] = [];
  collect(node, found);
  return found.length > 0 ? latestRevision(found) ?? found[found.length - 1] : null;
}

// ── Fountain ─────────────────────────────────────────────────────────────
//
// Fountain has no revisions, and a bare `*` on the end of a line would stop a
// transition ending in TO:, a parenthetical ending in `)`, or a scene number
// sitting last on its heading from being recognised. A note is the spec's way
// to put something on a line without it being read as script, so the mark goes
// in one: `CUT TO: [[* Blue]]`. Apps that show notes in the margin show the
// mark there; OpenDraft reads it back as the revision it was.

/** The note that marks a revised Fountain line, e.g. `[[* Blue revision]]`. */
export function fountainRevisionNote(color: string, settings?: RevisionSettings | null): string {
  let mark = revisionMarkFor(settings, color);
  // A bracket would close the note early.
  if (mark === '[' || mark === ']') mark = '*';
  return `[[${mark} ${findRevisionColor(color)?.name ?? color} revision]]`;
}

/**
 * The revision a Fountain note records, or null when it is an ordinary note.
 *
 * Only the exact form OpenDraft writes counts — one mark, a colour named as
 * the sequence names it, and the word "revision" — so a writer's own note
 * such as `[[+ Blue]]` or `[[* check this]]` stays a note.
 */
export function parseFountainRevisionNote(note: string): string | null {
  const m = /^(\S{1,2}) (.+) revision$/u.exec(note.trim());
  if (!m || /[\p{L}\p{N}]/u.test(m[1])) return null;
  const color = REVISION_COLORS.find((c) => c.name === m[2]);
  return color ? color.name : null;
}

// ── Fade In / OSF ────────────────────────────────────────────────────────
//
// Fade In keeps a revision table in `<lists><revision_colors>` — an index, a
// name and the mark — and marks a revised paragraph with
// `<marks><mark at="…" revision="N"/></marks>`, where N is a row of that table
// and `at` a character offset in the paragraph. OpenDraft knows which
// paragraphs are revised, not which characters, so it marks each from its
// first character: Fade In's mark then sits on the paragraph's first line.

/** Fade In's index for a revision colour: its place in the sequence. */
export function osfRevisionIndex(color: string): number {
  const c = findRevisionColor(color);
  return c ? Math.max(0, REVISION_COLORS.indexOf(c)) : 1;
}

/** `<revision_colors>` for the colours a document uses (always with White). */
export function osfRevisionColors(used: Iterable<string>, settings?: RevisionSettings | null): string[] {
  const names = new Set([...used].map((u) => findRevisionColor(u)?.name ?? u));
  const rows = REVISION_COLORS.filter((c, i) => i === 0 || names.has(c.name));
  return [
    '    <revision_colors>',
    ...rows.map((c) => {
      const index = REVISION_COLORS.indexOf(c);
      const mark = index === 0 ? '' : revisionMarkFor(settings, c.name);
      return `      <revision_color name="${c.name}" index="${index}" color_name="${c.name}" color_index="${index}" mark="${xmlAttr(mark)}"/>`;
    }),
    '    </revision_colors>',
  ];
}

function xmlAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Read a Fade In revision table: index → OpenDraft colour, and the marks. */
export function parseOsfRevisionColors(rows: Element[]): { byIndex: Map<string, string>; marks: Record<string, string> } {
  const byIndex = new Map<string, string>();
  const marks: Record<string, string> = {};
  for (const row of rows) {
    const index = row.getAttribute('index');
    if (index === null) continue;
    const name = row.getAttribute('name') || row.getAttribute('color_name') || '';
    const color = findRevisionColor(name)?.name
      ?? REVISION_COLORS[Number(index)]?.name
      ?? name;
    if (!color) continue;
    byIndex.set(index, color);
    const mark = row.getAttribute('mark');
    if (mark && mark.trim()) marks[color] = mark.trim();
  }
  return { byIndex, marks };
}
