import { describe, it, expect } from 'vitest';
import {
  applyCount, countWords, dayKey, goalFraction, heatmap, lastSevenDays, normalizeGoals, normalizeHistory,
  writingStreak, MAX_STEP, type ProgressState,
} from './writingGoals';

const empty = (): ProgressState => ({ history: {}, session: { words: 0, pages: 0 }, sprint: null, baseline: null });
const T = '2026-10-27';

describe('counting what was written', () => {
  it('takes the first count as a baseline only', () => {
    const s = applyCount(empty(), 's1', 1000, 10, T);
    expect(s.history).toEqual({});
    expect(s.baseline).toEqual({ scriptKey: 's1', words: 1000, pages: 10 });
  });

  it('adds increases to today, the session and a running sprint', () => {
    let s = applyCount(empty(), 's1', 1000, 10, T);
    s = { ...s, sprint: { endsAt: 0, durationMs: 0, words: 0, noBackspace: false } };
    s = applyCount(s, 's1', 1040, 11, T);
    s = applyCount(s, 's1', 1100, 11, T);
    expect(s.history[T]).toEqual({ words: 100, pages: 1 });
    expect(s.session).toEqual({ words: 100, pages: 1 });
    expect(s.sprint!.words).toBe(100);
  });

  it('does not subtract deletions, and counts rewriting after them', () => {
    let s = applyCount(empty(), 's1', 1000, 10, T);
    s = applyCount(s, 's1', 950, 10, T);
    s = applyCount(s, 's1', 980, 10, T);
    expect(s.history[T].words).toBe(30);
  });

  it('ignores script switches and big jumps (loading, imports, pastes)', () => {
    let s = applyCount(empty(), 's1', 1000, 10, T);
    s = applyCount(s, 's2', 5000, 50, T);
    s = applyCount(s, 's2', 5000 + MAX_STEP + 1, 55, T);
    s = applyCount(s, 's2', 5000 + MAX_STEP + 21, 55, T);
    expect(s.history[T]).toEqual({ words: 20, pages: 0 });
  });

  it('returns the same state when nothing changed', () => {
    const s = applyCount(empty(), 's1', 10, 1, T);
    expect(applyCount(s, 's1', 10, 1, T)).toBe(s);
  });
});

describe('goals, history and the heat-map', () => {
  it('counts words and keys days in local time', () => {
    expect(countWords('  INT. HOUSE - DAY\nShe runs. ')).toBe(6);
    expect(countWords('')).toBe(0);
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('caps goal progress and treats no goal as none', () => {
    expect(goalFraction(500, 1000)).toBe(0.5);
    expect(goalFraction(1500, 1000)).toBe(1);
    expect(goalFraction(10, 0)).toBe(0);
  });

  it('normalizes stored goals and history', () => {
    expect(normalizeGoals({ dailyWords: 750.6, sessionTarget: -3, sessionUnit: 'nope' }))
      .toEqual({ dailyWords: 750, sessionTarget: 0, sessionUnit: 'words' });
    expect(normalizeHistory({ '2026-10-01': { words: 12, pages: 1 }, bad: { words: 1 }, '2026-10-02': { words: 0 } }))
      .toEqual({ '2026-10-01': { words: 12, pages: 1 } });
  });

  it('lays out weeks ending today, with levels relative to the best day and goal days lifted', () => {
    const today = new Date(2026, 9, 27); // a Tuesday
    const history = { '2026-10-27': { words: 100, pages: 0 }, '2026-10-26': { words: 400, pages: 0 }, '2026-10-20': { words: 10, pages: 0 } };
    const cols = heatmap(history, today, 2, 90);
    expect(cols).toHaveLength(2);
    expect(cols[1][0].key).toBe('2026-10-25'); // Sunday of this week
    expect(cols[1][1]).toMatchObject({ key: '2026-10-26', level: 4 });
    expect(cols[1][2]).toMatchObject({ key: '2026-10-27', level: 3 }); // 1/4 of best, but met the goal
    expect(cols[0][2]).toMatchObject({ key: '2026-10-20', level: 1 });
    expect(cols[1][3].future).toBe(true);
  });

  it('measures the streak and the last seven days', () => {
    const today = new Date(2026, 9, 27);
    const h = { '2026-10-26': { words: 5, pages: 0 }, '2026-10-25': { words: 5, pages: 0 }, '2026-10-23': { words: 5, pages: 0 } };
    expect(writingStreak(h, today)).toBe(2);
    expect(writingStreak({ ...h, '2026-10-27': { words: 1, pages: 0 } }, today)).toBe(3);
    expect(lastSevenDays(h, today)).toBe(15);
  });
});
