/**
 * Cue timing for the AV editor.
 *
 * Modelled on how Celtx's Multi-Column AV editor handles the Shot/Timing
 * column: each row carries a duration, the start timestamp of every row is the
 * running sum of the durations before it, and the document's total runtime is
 * the sum of them all. Shot numbers are sequential and derived from row order
 * rather than stored, so inserting a row in the middle renumbers everything
 * below it without a migration pass.
 *
 * Everything here is pure so the editor, the exporters and the tests all agree
 * on one implementation. Nothing throws on bad input: a cell a user is halfway
 * through typing is not an error, it is simply not a time yet, and callers get
 * `null` and carry on rendering.
 */

/** Seconds in a minute / an hour, named so the arithmetic below reads. */
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

/** Upper bound on a parsed timecode: 99:59:59. Anything longer is a typo, not
 *  a running time, and clamping it keeps a stray keypress from producing a
 *  total runtime of several years. */
export const MAX_TIMECODE_SECONDS = 99 * SECONDS_PER_HOUR + 59 * SECONDS_PER_MINUTE + 59;

/**
 * Parse a duration or timestamp into whole seconds.
 *
 * Accepts the shapes an AV writer actually types:
 *   "5"        → 5s      (bare seconds)
 *   "0:05"     → 5s      (M:SS)
 *   "1:30"     → 90s     (MM:SS)
 *   "1:02:03"  → 3723s   (HH:MM:SS)
 *
 * Returns null for anything else — empty, partial ("1:"), non-numeric, or
 * negative — so the caller can leave the cell alone instead of coercing it to
 * zero and silently discarding what the user was typing.
 */
export function parseTimecode(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!text) return null;

  const parts = text.split(':');
  if (parts.length > 3) return null;

  // Every part must be digits only. Rejecting "1:2x" here rather than leaning
  // on Number() keeps "1:2e3" and " 1 " from parsing as something surprising.
  const nums: number[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    if (!/^\d+$/.test(part)) return null;
    const n = Number(part);
    if (!Number.isFinite(n)) return null;
    // Minutes and seconds may not exceed 59 once they are not the leading unit;
    // "1:75" is a typo, and reading it as 2:15 would hide that.
    if (i > 0 && n > 59) return null;
    nums.push(n);
  }

  let seconds: number;
  if (nums.length === 1) seconds = nums[0];
  else if (nums.length === 2) seconds = nums[0] * SECONDS_PER_MINUTE + nums[1];
  else seconds = nums[0] * SECONDS_PER_HOUR + nums[1] * SECONDS_PER_MINUTE + nums[2];

  if (seconds < 0) return null;
  return Math.min(seconds, MAX_TIMECODE_SECONDS);
}

/** How `formatTimecode` renders: `auto` drops the hours field below an hour. */
export type TimecodeStyle = 'auto' | 'mmss' | 'hhmmss';

/**
 * Render whole seconds as a timecode.
 *
 * `auto` matches what Celtx shows in the cue column — "0:00" early in a
 * document, widening to "1:02:03" only once a piece actually runs past an
 * hour, so a 30-second commercial is not padded with a meaningless "00:".
 */
export function formatTimecode(seconds: number | null | undefined, style: TimecodeStyle = 'auto'): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.min(Math.floor(seconds), MAX_TIMECODE_SECONDS);
  const h = Math.floor(total / SECONDS_PER_HOUR);
  const m = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const s = total % SECONDS_PER_MINUTE;
  const pad = (n: number) => String(n).padStart(2, '0');

  if (style === 'hhmmss' || (style === 'auto' && h > 0)) {
    // Minutes pad to two digits once hours are shown, so columns line up.
    return `${h}:${pad(m)}:${pad(s)}`;
  }
  if (style === 'mmss') return `${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

/** One row's resolved cue values, ready to render into the Shot/Timing column. */
export interface AvRowTiming {
  /** 1-based sequential shot number, as shown ("1.", "2." …). */
  shot: string;
  /** Running start timestamp for this row. */
  start: string;
  /** This row's own duration, echoed back formatted (empty when unset). */
  duration: string;
  /** Start in seconds — for exporters that want a number, not a string. */
  startSeconds: number;
  /** Duration in seconds; 0 when the row has no usable duration. */
  durationSeconds: number;
  /** True when the row had a duration that could not be parsed, so the UI can
   *  mark the cell rather than silently treating it as zero. */
  invalidDuration: boolean;
}

/** Where a body's numbering and clock pick up from. See `computeRowTimings`. */
export interface AvTimingOffset {
  /** How many rows came before this body — row 1 here is shot `startIndex + 1`. */
  startIndex?: number;
  /** Where the running clock stood when this body began, in seconds. */
  startSeconds?: number;
}

/**
 * Where a body's numbering and clock LEAVE off, for the body after it.
 *
 * Read off the computed rows rather than recomputed, so the continuation can
 * never disagree with what was drawn: `startSeconds + durationSeconds` of the
 * last row is exactly where the next body starts, manual overrides included.
 */
export function nextTimingOffset(
  rows: readonly AvTimingInput[],
  timings: readonly AvRowTiming[],
  offset: AvTimingOffset = {},
): Required<AvTimingOffset> {
  const last = timings.length ? timings[timings.length - 1] : null;
  return {
    startIndex: Math.max(0, Math.floor(offset.startIndex ?? 0)) + rows.length,
    startSeconds: last
      ? Math.min(last.startSeconds + last.durationSeconds, MAX_TIMECODE_SECONDS)
      : Math.max(0, Math.floor(offset.startSeconds ?? 0)),
  };
}

/** A row as far as timing is concerned. Kept structural so both ProseMirror
 *  nodes and exporter rows can be mapped onto it without a shared class. */
export interface AvTimingInput {
  /** Raw duration text as typed, e.g. "0:05". */
  duration?: string | null;
  /** Manual shot number override. Falsy means "use the sequential number". */
  shot?: string | null;
  /** Manual start override. Falsy means "use the running total". */
  start?: string | null;
}

/**
 * Resolve the cue column for a whole AV body.
 *
 * Start times accumulate: row N starts when every row before it has finished.
 * A row with no duration contributes nothing, so a half-written document still
 * numbers and timestamps sensibly rather than collapsing to blanks.
 *
 * A manual `start` override resets the running clock from that row onward,
 * which is what makes it useful — it is how a writer pins a section to a known
 * timestamp without retyping every duration above it.
 *
 * `offset` carries the numbering in from the bodies ABOVE this one. A document
 * may hold several AV bodies — an intro paragraph or a scene heading between
 * two of them is ordinary — and they are sections of one piece, not separate
 * pieces: Celtx numbers shots from 1 straight through a Multi-Column AV script,
 * and a running time that went back to 0:00 at every heading would be telling
 * the writer something untrue about their own edit.
 */
export function computeRowTimings(
  rows: readonly AvTimingInput[],
  style: TimecodeStyle = 'auto',
  offset: AvTimingOffset = {},
): AvRowTiming[] {
  if (!Array.isArray(rows)) return [];
  const out: AvRowTiming[] = [];
  const firstShot = Math.max(0, Math.floor(offset.startIndex ?? 0));
  let clock = Math.max(0, Math.floor(offset.startSeconds ?? 0));

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || {};
    const rawDuration = row.duration ?? null;
    const parsedDuration = parseTimecode(rawDuration);
    const hasDurationText = typeof rawDuration === 'string' && rawDuration.trim() !== '';
    const invalidDuration = hasDurationText && parsedDuration === null;

    // A manual start pins the clock; otherwise the running total stands.
    const manualStart = parseTimecode(row.start ?? null);
    if (manualStart !== null) clock = manualStart;

    const durationSeconds = parsedDuration ?? 0;
    const manualShot = typeof row.shot === 'string' ? row.shot.trim() : '';

    out.push({
      shot: manualShot || `${firstShot + i + 1}.`,
      start: formatTimecode(clock, style),
      duration: parsedDuration === null ? '' : formatTimecode(parsedDuration, style),
      startSeconds: clock,
      durationSeconds,
      invalidDuration,
    });

    clock = Math.min(clock + durationSeconds, MAX_TIMECODE_SECONDS);
  }

  return out;
}

/**
 * Total runtime of an AV body, in seconds.
 *
 * This is the sum of the durations, not the last row's end time: a manual start
 * override can leave a gap, and for a "Total Duration" field the sum of what
 * was actually timed is the honest number.
 */
export function totalRuntimeSeconds(rows: readonly AvTimingInput[]): number {
  if (!Array.isArray(rows)) return 0;
  let total = 0;
  for (const row of rows) {
    const secs = parseTimecode(row?.duration ?? null);
    if (secs !== null) total += secs;
  }
  return Math.min(total, MAX_TIMECODE_SECONDS);
}

/** Total runtime rendered for display, e.g. in the AV status readout. */
export function formatTotalRuntime(rows: readonly AvTimingInput[], style: TimecodeStyle = 'auto'): string {
  return formatTimecode(totalRuntimeSeconds(rows), style);
}
