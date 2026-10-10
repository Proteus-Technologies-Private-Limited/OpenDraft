/**
 * Script profile — the writer's own description of the film: its pacing and
 * its genres. Saved with the script as `_scriptProfile`.
 *
 * Pacing feeds the runtime estimate. A page-based estimate cannot see how a
 * film is directed, and that is most of what is left of its error: checked
 * against 13 released features (docs/runtime-estimate-validation.md), the
 * slow, image-led ones ran 24-27% longer than their pages and the fast-talking
 * ones ~20% shorter, while every other film sat close to one page a minute.
 * The multipliers below are the middle of those two groups. The writer knows
 * which kind of film they are writing; the page does not.
 *
 * Genres are descriptive only — they do not touch the estimate. Genre did not
 * predict the error at all (dramas ran from −27% to +8%), so letting it move
 * the number would only make the number worse.
 */

export type Pacing = 'brisk' | 'standard' | 'measured';

export interface PacingOption {
  id: Pacing;
  label: string;
  /** Screen time per page relative to the one-page-a-minute standard. */
  multiplier: number;
  description: string;
}

export const PACING_OPTIONS: readonly PacingOption[] = [
  {
    id: 'brisk',
    label: 'Brisk',
    multiplier: 0.85,
    description: 'Fast-talking, quick cutting, overlapping dialogue — screen time runs shorter than the page.',
  },
  {
    id: 'standard',
    label: 'Standard',
    multiplier: 1,
    description: 'One page ≈ one minute. Right for most scripts.',
  },
  {
    id: 'measured',
    label: 'Measured',
    multiplier: 1.3,
    description: 'Slow-burn or contemplative — long silences, lingering images, held moments that play longer than they read.',
  },
];

export const DEFAULT_PACING: Pacing = 'standard';

/** Suggested genres. Writers can add their own alongside these. */
export const GENRE_PRESETS: readonly string[] = [
  'Action', 'Adventure', 'Animation', 'Biopic', 'Comedy', 'Coming-of-Age',
  'Crime', 'Dark Comedy', 'Documentary', 'Drama', 'Family', 'Fantasy',
  'Historical', 'Horror', 'Legal', 'Musical', 'Mystery', 'Noir',
  'Political', 'Psychological Thriller', 'Romance', 'Romantic Comedy',
  'Satire', 'Sci-Fi', 'Sports', 'Superhero', 'Thriller', 'War', 'Western',
];

/** Longest custom genre kept, so a pasted paragraph cannot become a "genre". */
export const MAX_GENRE_LENGTH = 40;
export const MAX_GENRES = 20;

export interface ScriptProfile {
  pacing: Pacing;
  genres: string[];
}

export const DEFAULT_SCRIPT_PROFILE: ScriptProfile = { pacing: DEFAULT_PACING, genres: [] };

export function pacingOption(pacing: Pacing): PacingOption {
  return PACING_OPTIONS.find((o) => o.id === pacing) ?? PACING_OPTIONS[1];
}

export function pacingMultiplier(pacing: Pacing | null | undefined): number {
  return pacing ? pacingOption(pacing).multiplier : 1;
}

/** Trim, collapse spaces, cap length. Empty means "not a genre". */
export function cleanGenre(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_GENRE_LENGTH);
}

/**
 * Genres de-duplicated case-insensitively, keeping the first spelling — and
 * a preset's own spelling when the writer types one ("sci-fi" → "Sci-Fi").
 */
export function normalizeGenres(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const cleaned = cleanGenre(item);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(GENRE_PRESETS.find((g) => g.toLowerCase() === key) ?? cleaned);
    if (out.length >= MAX_GENRES) break;
  }
  return out;
}

/**
 * Read a stored profile. Anything missing or malformed falls back to the
 * default, so an older script — or one a peer wrote with a pacing this build
 * does not know — still opens.
 */
export function normalizeScriptProfile(raw: unknown): ScriptProfile {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return DEFAULT_SCRIPT_PROFILE;
    }
  }
  if (!value || typeof value !== 'object') return DEFAULT_SCRIPT_PROFILE;
  const v = value as Record<string, unknown>;
  const pacing = PACING_OPTIONS.some((o) => o.id === v.pacing) ? (v.pacing as Pacing) : DEFAULT_PACING;
  return { pacing, genres: normalizeGenres(v.genres) };
}
