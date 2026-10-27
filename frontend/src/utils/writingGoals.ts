/**
 * Writing goals, sprints and the words-written history (Tools → Writing Goals).
 *
 * Progress is measured from the script itself: a few seconds after the writer
 * stops typing, the script's word and page counts are compared with the last
 * ones seen, and any increase is "written" — added to today, to this session
 * and to a running sprint. Deleting does not subtract: an afternoon of
 * rewriting is still an afternoon of writing.
 *
 * Two things are deliberately not counted, since neither is writing:
 * - the first count after a script is opened or switched to (it only sets the
 *   baseline), and
 * - a single jump of more than MAX_STEP words between two counts (an import, a
 *   large paste, a script loading in after the baseline was taken).
 *
 * Everything stays on this device. Nothing here is sent anywhere.
 */

/** Words or pages written on one day. */
export interface DayProgress {
  words: number;
  pages: number;
}

/** `YYYY-MM-DD` in local time → what was written that day. */
export type WritingHistory = Record<string, DayProgress>;

export type GoalUnit = 'words' | 'pages';

export interface WritingGoals {
  /** Words to write each day; 0 for no daily goal. */
  dailyWords: number;
  /** Target for this session; 0 for none. */
  sessionTarget: number;
  sessionUnit: GoalUnit;
}

export interface Sprint {
  /** Epoch ms the sprint ends. */
  endsAt: number;
  /** Length in ms, for the progress display. */
  durationMs: number;
  /** Words written so far in the sprint. */
  words: number;
  /** Backspace and Delete do nothing until the sprint ends. */
  noBackspace: boolean;
}

/** What the tracker last saw, so the next count can be compared with it. */
export interface Baseline {
  scriptKey: string;
  words: number;
  pages: number;
}

export interface ProgressState {
  history: WritingHistory;
  session: DayProgress;
  sprint: Sprint | null;
  baseline: Baseline | null;
}

/** A larger single increase than this is an import or a paste, not writing. */
export const MAX_STEP = 500;
/** Pages can jump on load the same way; more than this at once is not writing. */
export const MAX_PAGE_STEP = 3;

export const DEFAULT_GOALS: WritingGoals = { dailyWords: 0, sessionTarget: 0, sessionUnit: 'words' };

/** Local-time date key for `date`. */
export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Words in a script's text, counted the way Script Statistics counts them. */
export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/**
 * The state after seeing the script `scriptKey` at `words` / `pages` on
 * `today`. Returns `state` itself when nothing changed.
 */
export function applyCount(
  state: ProgressState,
  scriptKey: string,
  words: number,
  pages: number,
  today: string,
): ProgressState {
  const base = state.baseline;
  const baseline = { scriptKey, words, pages };
  if (!base || base.scriptKey !== scriptKey) return { ...state, baseline };
  if (base.words === words && base.pages === pages) return state;

  const dw = words - base.words;
  const dp = pages - base.pages;
  const addWords = dw > 0 && dw <= MAX_STEP ? dw : 0;
  const addPages = dp > 0 && dp <= MAX_PAGE_STEP && dw <= MAX_STEP ? dp : 0;
  if (!addWords && !addPages) return { ...state, baseline };

  const day = state.history[today] ?? { words: 0, pages: 0 };
  return {
    baseline,
    history: { ...state.history, [today]: { words: day.words + addWords, pages: day.pages + addPages } },
    session: { words: state.session.words + addWords, pages: state.session.pages + addPages },
    sprint: state.sprint ? { ...state.sprint, words: state.sprint.words + addWords } : null,
  };
}

/** Fraction of a goal reached, 0–1; 0 when there is no goal. */
export function goalFraction(done: number, target: number): number {
  return target > 0 ? Math.min(1, done / target) : 0;
}

/** Normalizes stored goals: non-negative whole numbers, a known unit. */
export function normalizeGoals(raw: unknown): WritingGoals {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  return {
    dailyWords: n(r.dailyWords),
    sessionTarget: n(r.sessionTarget),
    sessionUnit: r.sessionUnit === 'pages' ? 'pages' : 'words',
  };
}

/** Normalizes a stored history, dropping anything that is not a day of counts. */
export function normalizeHistory(raw: unknown): WritingHistory {
  const out: WritingHistory = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !v || typeof v !== 'object') continue;
    const r = v as Record<string, unknown>;
    const words = typeof r.words === 'number' && r.words > 0 ? Math.floor(r.words) : 0;
    const pages = typeof r.pages === 'number' && r.pages > 0 ? Math.floor(r.pages) : 0;
    if (words || pages) out[k] = { words, pages };
  }
  return out;
}

export interface HeatmapCell {
  key: string;
  date: Date;
  words: number;
  /** 0 (nothing) to 4 (one of the best days in view). */
  level: 0 | 1 | 2 | 3 | 4;
  /** After `today` — drawn empty. */
  future: boolean;
}

/**
 * The calendar heat-map: `weeks` columns of seven days (Sunday first), the
 * last column holding `today`. Levels are relative to the best day in view so
 * the map reads at any output, and a day that met the daily goal is at least
 * level 3.
 */
export function heatmap(history: WritingHistory, today: Date, weeks: number, dailyGoal = 0): HeatmapCell[][] {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = new Date(end);
  start.setDate(end.getDate() - end.getDay() - (weeks - 1) * 7);
  const cols: HeatmapCell[][] = [];
  let max = 0;
  const cells: HeatmapCell[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = dayKey(date);
    const words = history[key]?.words ?? 0;
    if (date <= end) max = Math.max(max, words);
    cells.push({ key, date, words, level: 0, future: date > end });
  }
  for (const c of cells) {
    if (c.future || !c.words) continue;
    let level = Math.max(1, Math.ceil((c.words / max) * 4)) as HeatmapCell['level'];
    if (dailyGoal > 0 && c.words >= dailyGoal && level < 3) level = 3;
    c.level = level;
  }
  for (let w = 0; w < weeks; w++) cols.push(cells.slice(w * 7, w * 7 + 7));
  return cols;
}

/** Days in a row, ending today (or yesterday, if nothing yet today), with any words written. */
export function writingStreak(history: WritingHistory, today: Date): number {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!history[dayKey(d)]?.words) d.setDate(d.getDate() - 1);
  let n = 0;
  while (history[dayKey(d)]?.words) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

/** Words written over the 7 days ending `today`. */
export function lastSevenDays(history: WritingHistory, today: Date): number {
  let total = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    total += history[dayKey(d)]?.words ?? 0;
  }
  return total;
}
