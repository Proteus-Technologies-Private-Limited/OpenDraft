/**
 * The production revision colour sequence — the order a script's revised pages
 * go out in once it is locked for production (Final Draft's default list).
 *
 * `slug` is what the DOM and CSS use (`data-rev`, `data-color`); `fdx` is the
 * colour Final Draft writes for that revision in an FDX `<Revisions>` block.
 */
export interface RevisionColor {
  name: string;
  slug: string;
  fdx: string;
  /** The tint a revised page prints on (File → Print / PDF with coloured
   *  pages): light enough that black text stays crisp on a home printer. */
  paper: string;
}

export const REVISION_COLORS: readonly RevisionColor[] = [
  { name: 'White', slug: 'white', fdx: '#FFFFFFFFFFFF', paper: '#FFFFFF' },
  { name: 'Blue', slug: 'blue', fdx: '#6F6FA8A8DCDC', paper: '#DCE8F6' },
  { name: 'Pink', slug: 'pink', fdx: '#E0E06C6C9F9F', paper: '#F8DCE7' },
  { name: 'Yellow', slug: 'yellow', fdx: '#F4F4D3D35E5E', paper: '#FBF3C2' },
  { name: 'Green', slug: 'green', fdx: '#6A6ABFBF6969', paper: '#DDF0D8' },
  { name: 'Goldenrod', slug: 'goldenrod', fdx: '#DADAA5A52020', paper: '#F3DFA2' },
  { name: 'Buff', slug: 'buff', fdx: '#D2D2B4B48C8C', paper: '#EFE3CB' },
  { name: 'Salmon', slug: 'salmon', fdx: '#FAFA80807272', paper: '#F9D5CB' },
  { name: 'Cherry', slug: 'cherry', fdx: '#CCCC33333333', paper: '#F1C0C4' },
  { name: '2nd Blue', slug: '2nd-blue', fdx: '#46468282B4B4', paper: '#CCDDF0' },
  { name: '2nd Pink', slug: '2nd-pink', fdx: '#C7C761619393', paper: '#F2CDDD' },
  { name: '2nd Yellow', slug: '2nd-yellow', fdx: '#E0E0C8C84E4E', paper: '#F6EBB2' },
  { name: '2nd Green', slug: '2nd-green', fdx: '#4E4EA6A64E4E', paper: '#CDE8C6' },
];

export const DEFAULT_REVISION_COLOR = REVISION_COLORS[0].name;

export function findRevisionColor(name: string | null | undefined): RevisionColor | undefined {
  if (!name) return undefined;
  const lower = name.toLowerCase();
  return REVISION_COLORS.find((c) => c.name.toLowerCase() === lower || c.slug === lower);
}

/** The DOM/CSS slug for a colour name; unknown names still get a stable slug. */
export function revisionSlug(name: string): string {
  return findRevisionColor(name)?.slug ?? name.toLowerCase().trim().replace(/\s+/g, '-');
}

/**
 * The colour after `current` in the sequence. After the last it stays on the
 * last — a production that runs past 2nd Green names its own colours.
 */
export function nextRevisionColor(current: string | null | undefined): string {
  const i = REVISION_COLORS.findIndex((c) => c.name === findRevisionColor(current)?.name);
  if (i < 0) return REVISION_COLORS[0].name;
  return REVISION_COLORS[Math.min(i + 1, REVISION_COLORS.length - 1)].name;
}

/** Position in the production sequence; a colour not in it ranks before all. */
export function revisionRank(name: string | null | undefined): number {
  const c = findRevisionColor(name);
  return c ? REVISION_COLORS.indexOf(c) : -1;
}

/** The latest round among `colors` — the one a line or page is marked for. */
export function latestRevision(colors: Iterable<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestRank = -2;
  for (const c of colors) {
    if (!c) continue;
    const r = revisionRank(c);
    if (r > bestRank) { best = c; bestRank = r; }
  }
  return best;
}

/** The paper tint for a revision colour, or null for White / an unknown one. */
export function revisionPaper(name: string | null | undefined): string | null {
  const c = findRevisionColor(name);
  return c && c.slug !== 'white' ? c.paper : null;
}

// ── The mark printed beside a revised line ──────────────────────────────

/**
 * How revised lines are marked. Saved with the script (`_revisionSettings`).
 *
 * `markChar` is the default mark; `marks` overrides it for one revision, so a
 * production can tell the Blue changes (*) from the Pink ones (+) on a page
 * that carries both. A line holding several rounds takes the latest round's.
 */
export interface RevisionSettings {
  markChar: string;
  marks: Record<string, string>;
  /** Print revised pages on their revision colour's paper. */
  colorPages: boolean;
}

export const DEFAULT_REVISION_MARK = '*';

export const DEFAULT_REVISION_SETTINGS: RevisionSettings = {
  markChar: DEFAULT_REVISION_MARK,
  marks: {},
  colorPages: false,
};

/** A usable mark: the first visible character of `raw` (an emoji or other
 *  astral character counts as one), else null. */
export function cleanMark(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const ch = Array.from(raw.trim())[0];
  return ch ?? null;
}

/** The mark for a line marked in `color`. */
export function revisionMarkFor(settings: RevisionSettings | null | undefined, color: string | null | undefined): string {
  const s = settings ?? DEFAULT_REVISION_SETTINGS;
  const named = color ? findRevisionColor(color)?.name ?? color : null;
  return (named && cleanMark(s.marks[named])) || cleanMark(s.markChar) || DEFAULT_REVISION_MARK;
}

/** Read settings from anything (a saved payload, a peer); bad fields fall back. */
export function normalizeRevisionSettings(value: unknown): RevisionSettings {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return { ...DEFAULT_REVISION_SETTINGS, marks: {} }; }
  }
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const marks: Record<string, string> = {};
  if (o.marks && typeof o.marks === 'object') {
    for (const [k, m] of Object.entries(o.marks as Record<string, unknown>)) {
      const ch = cleanMark(m);
      if (ch) marks[findRevisionColor(k)?.name ?? k] = ch;
    }
  }
  return {
    markChar: cleanMark(o.markChar) ?? DEFAULT_REVISION_MARK,
    marks,
    colorPages: o.colorPages === true,
  };
}
