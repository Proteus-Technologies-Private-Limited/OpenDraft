/**
 * Reading Final Draft's revisions back in.
 *
 * An .fdx lists its revisions once, in a `<Revisions>` block, and each
 * revised `<Text>` run points into that list with `RevisionID`. Final Draft
 * names a revision whatever the writer called it ("Blue Rev.", "Second Pink",
 * "Revision 3"), so each one is matched to OpenDraft's colour sequence by its
 * name first, then by its page colour, and failing both by its place in the
 * list — the order a production issues them in.
 */
import {
  REVISION_COLORS, DEFAULT_REVISION_MARK, DEFAULT_REVISION_SETTINGS, cleanMark, findRevisionColor,
  type RevisionSettings,
} from '../editor/revisionColors';

export interface FDXRevisionImport {
  /** RevisionID → OpenDraft colour name. */
  colorById: Map<string, string>;
  /** Revision Mode was on when the file was saved. */
  mode: boolean;
  /** The active revision's colour. */
  color: string | null;
  settings: RevisionSettings;
  /** Every colour the file lists, in its own order. */
  colors: string[];
}

/** "Blue Rev.", "Blue Revision", "2nd Blue", "BLUE" → "Blue" / "2nd Blue". */
export function colorFromRevisionName(name: string): string | null {
  const cleaned = name
    .replace(/\b(rev(ision)?s?)\.?/gi, '')
    .replace(/\bpages?\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const direct = findRevisionColor(cleaned);
  if (direct) return direct.name;
  // "Second Blue", "Double Pink" — the 2nd round under another name.
  const second = /^(second|2nd|double)\s+(.+)$/i.exec(cleaned);
  if (second) return findRevisionColor(`2nd ${second[2]}`)?.name ?? null;
  return null;
}

function rgbOf(hex: string): [number, number, number] | null {
  const h = hex.replace('#', '');
  if (/^[0-9a-f]{12}$/i.test(h)) {
    return [0, 4, 8].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  }
  if (/^[0-9a-f]{6}$/i.test(h)) {
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  }
  return null;
}

/** The sequence colour whose Final Draft page colour is nearest `hex`. */
export function colorFromPageColor(hex: string | null | undefined): string | null {
  if (!hex) return null;
  const rgb = rgbOf(hex);
  if (!rgb) return null;
  let best: string | null = null;
  let bestDist = Infinity;
  for (const c of REVISION_COLORS) {
    const ref = rgbOf(c.fdx);
    if (!ref) continue;
    const d = (ref[0] - rgb[0]) ** 2 + (ref[1] - rgb[1]) ** 2 + (ref[2] - rgb[2]) ** 2;
    if (d < bestDist) { bestDist = d; best = c.name; }
  }
  // Close enough to be that colour, not merely the least far.
  return bestDist <= 40 * 40 * 3 ? best : null;
}

/** Read a document's `<Revisions>` block; null when it has none. */
export function parseFDXRevisions(xmlDoc: Pick<Document, 'getElementsByTagName'>): FDXRevisionImport | null {
  // getElementsByTagName, not a selector: this also runs against the
  // lightweight XML DOM in tests, which has no querySelector.
  const block = xmlDoc.getElementsByTagName('Revisions')[0];
  if (!block) return null;
  const entries = Array.from(block.getElementsByTagName('Revision'));
  const colorById = new Map<string, string>();
  const marks: Record<string, string> = {};
  const markCounts = new Map<string, number>();
  const taken = new Set<string>();
  entries.forEach((rev, index) => {
    const id = rev.getAttribute('ID');
    if (!id) return;
    let color = colorFromRevisionName(rev.getAttribute('Name') || '')
      ?? colorFromPageColor(rev.getAttribute('PageColor'))
      ?? colorFromPageColor(rev.getAttribute('Color'));
    if (!color || taken.has(color)) {
      // Its place in the list: Final Draft's first revision is the Blue one.
      color = (REVISION_COLORS.slice(1).find((c) => !taken.has(c.name))
        ?? REVISION_COLORS[Math.min(index + 1, REVISION_COLORS.length - 1)]).name;
    }
    taken.add(color);
    colorById.set(id, color);
    const mark = cleanMark(rev.getAttribute('Mark'));
    if (mark) {
      marks[color] = mark;
      markCounts.set(mark, (markCounts.get(mark) ?? 0) + 1);
    }
  });
  if (colorById.size === 0) return null;

  // The mark most revisions use is the default; the rest are per-revision.
  let markChar = DEFAULT_REVISION_MARK;
  let most = 0;
  for (const [m, n] of markCounts) if (n > most) { most = n; markChar = m; }
  const perRevision: Record<string, string> = {};
  for (const [color, m] of Object.entries(marks)) if (m !== markChar) perRevision[color] = m;

  const activeId = block.getAttribute('ActiveSet');
  // Final Draft can hide every round but the current one. What it was not
  // showing must not suddenly print beside every line in the PDF, so only the
  // active round's runs are read as revised then.
  const showsAll = block.getAttribute('ShowAllMarks') !== 'No' && block.getAttribute('ShowAllSets') !== 'No';
  if (!showsAll && activeId && colorById.has(activeId)) {
    for (const id of [...colorById.keys()]) if (id !== activeId) colorById.delete(id);
  }
  return {
    colorById,
    mode: block.getAttribute('RevisionMode') === 'Yes',
    color: (activeId && colorById.get(activeId)) || null,
    settings: {
      ...DEFAULT_REVISION_SETTINGS,
      markChar,
      marks: perRevision,
      colorPages: block.getAttribute('ShowPageColor') === 'Yes',
    },
    colors: [...colorById.values()],
  };
}
