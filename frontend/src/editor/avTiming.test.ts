import { describe, it, expect } from 'vitest';
import {
  parseTimecode,
  formatTimecode,
  computeRowTimings,
  totalRuntimeSeconds,
  formatTotalRuntime,
  nextTimingOffset,
  MAX_TIMECODE_SECONDS,
} from './avTiming';

describe('parseTimecode', () => {
  it('reads the shapes an AV writer types', () => {
    expect(parseTimecode('5')).toBe(5);
    expect(parseTimecode('0:05')).toBe(5);
    expect(parseTimecode('1:30')).toBe(90);
    expect(parseTimecode('01:30')).toBe(90);
    expect(parseTimecode('1:02:03')).toBe(3723);
    expect(parseTimecode('  1:30  ')).toBe(90);
  });

  it('returns null rather than guessing at input that is not a time', () => {
    // A half-typed cell is not an error — the caller leaves it alone.
    for (const bad of ['', '   ', '1:', ':30', 'abc', '1:2x', '-5', '1:2:3:4', '1.5', null, undefined]) {
      expect(parseTimecode(bad as string)).toBeNull();
    }
  });

  it('rejects an out-of-range minute or second instead of carrying it', () => {
    // "1:75" is a typo. Reading it as 2:15 would hide the mistake.
    expect(parseTimecode('1:75')).toBeNull();
    expect(parseTimecode('1:60:00')).toBeNull();
    // Leading unit may exceed 59 — 90 bare seconds and 90 minutes are both real.
    expect(parseTimecode('90')).toBe(90);
    expect(parseTimecode('90:00')).toBe(5400);
  });

  it('clamps absurd input instead of producing a runtime of years', () => {
    expect(parseTimecode('999999999')).toBe(MAX_TIMECODE_SECONDS);
  });
});

describe('formatTimecode', () => {
  it('drops the hours field below an hour, as Celtx does', () => {
    expect(formatTimecode(0)).toBe('0:00');
    expect(formatTimecode(5)).toBe('0:05');
    expect(formatTimecode(90)).toBe('1:30');
    expect(formatTimecode(600)).toBe('10:00');
  });

  it('widens to HH:MM:SS once a piece runs past an hour', () => {
    expect(formatTimecode(3723)).toBe('1:02:03');
    expect(formatTimecode(3600)).toBe('1:00:00');
  });

  it('honours an explicit style', () => {
    expect(formatTimecode(5, 'mmss')).toBe('00:05');
    expect(formatTimecode(5, 'hhmmss')).toBe('0:00:05');
  });

  it('renders nothing for a missing or invalid value', () => {
    expect(formatTimecode(null)).toBe('');
    expect(formatTimecode(undefined)).toBe('');
    expect(formatTimecode(-1)).toBe('');
    expect(formatTimecode(NaN)).toBe('');
  });
});

describe('computeRowTimings', () => {
  it('numbers rows sequentially and accumulates start times', () => {
    const t = computeRowTimings([
      { duration: '0:05' },
      { duration: '0:10' },
      { duration: '1:00' },
    ]);
    expect(t.map(r => r.shot)).toEqual(['1.', '2.', '3.']);
    expect(t.map(r => r.start)).toEqual(['0:00', '0:05', '0:15']);
    expect(t.map(r => r.startSeconds)).toEqual([0, 5, 15]);
  });

  it('keeps numbering a half-written document where durations are missing', () => {
    const t = computeRowTimings([{ duration: '0:05' }, {}, { duration: '0:10' }]);
    expect(t.map(r => r.shot)).toEqual(['1.', '2.', '3.']);
    // The untimed row contributes nothing, so the clock does not move.
    expect(t.map(r => r.start)).toEqual(['0:00', '0:05', '0:05']);
    expect(t[1].duration).toBe('');
    expect(t[1].durationSeconds).toBe(0);
  });

  it('flags a duration it could not read instead of treating it as zero', () => {
    const t = computeRowTimings([{ duration: 'soon' }]);
    expect(t[0].invalidDuration).toBe(true);
    expect(t[0].durationSeconds).toBe(0);
  });

  it('does not flag an empty duration as invalid', () => {
    expect(computeRowTimings([{ duration: '' }])[0].invalidDuration).toBe(false);
    expect(computeRowTimings([{}])[0].invalidDuration).toBe(false);
  });

  it('lets a manual start pin the clock from that row onward', () => {
    const t = computeRowTimings([
      { duration: '0:05' },
      { duration: '0:05', start: '1:00' },
      { duration: '0:05' },
    ]);
    expect(t.map(r => r.start)).toEqual(['0:00', '1:00', '1:05']);
  });

  it('lets a manual shot number override the sequential one', () => {
    const t = computeRowTimings([{ shot: '22c' }, {}]);
    expect(t.map(r => r.shot)).toEqual(['22c', '2.']);
  });

  it('survives junk input without throwing', () => {
    expect(computeRowTimings([])).toEqual([]);
    expect(computeRowTimings(null as never)).toEqual([]);
    expect(() => computeRowTimings([null as never, undefined as never])).not.toThrow();
  });
});

describe('totalRuntimeSeconds', () => {
  it('sums the durations', () => {
    expect(totalRuntimeSeconds([{ duration: '0:05' }, { duration: '0:10' }])).toBe(15);
  });

  it('ignores rows with no or unreadable duration', () => {
    expect(totalRuntimeSeconds([{ duration: '0:05' }, {}, { duration: 'soon' }])).toBe(5);
  });

  it('sums what was actually timed, ignoring gaps a manual start creates', () => {
    // Last row ends at 1:05, but only 10s is genuinely accounted for.
    const rows = [{ duration: '0:05' }, { duration: '0:05', start: '1:00' }];
    expect(totalRuntimeSeconds(rows)).toBe(10);
  });

  it('formats for display', () => {
    expect(formatTotalRuntime([{ duration: '0:30' }, { duration: '0:30' }])).toBe('1:00');
    expect(formatTotalRuntime([])).toBe('0:00');
  });

  it('survives junk input', () => {
    expect(totalRuntimeSeconds(null as never)).toBe(0);
    expect(() => totalRuntimeSeconds([null as never])).not.toThrow();
  });
});

describe('numbering across several AV bodies', () => {
  const rows = (...durations: (string | null)[]) => durations.map((d) => ({ duration: d }));

  it('continues the shot numbers from where the body above left off', () => {
    const first = computeRowTimings(rows('0:05', '0:10'));
    const carry = nextTimingOffset(rows('0:05', '0:10'), first);
    const second = computeRowTimings(rows('0:07'), 'auto', carry);

    expect(first.map(t => t.shot)).toEqual(['1.', '2.']);
    expect(second.map(t => t.shot)).toEqual(['3.']);
  });

  it('continues the running clock too', () => {
    const r1 = rows('0:05', '0:10');
    const first = computeRowTimings(r1);
    const second = computeRowTimings(rows('0:07'), 'auto', nextTimingOffset(r1, first));

    expect(first.map(t => t.start)).toEqual(['0:00', '0:05']);
    // 5s + 10s of the body above.
    expect(second[0].start).toBe('0:15');
    expect(second[0].startSeconds).toBe(15);
  });

  it('numbers from 1 and starts at 0:00 with no offset — a body read alone', () => {
    const only = computeRowTimings(rows('0:05'));
    expect(only[0].shot).toBe('1.');
    expect(only[0].start).toBe('0:00');
  });

  it('carries the offset through a body with no rows at all', () => {
    const r1 = rows('0:05');
    const carry = nextTimingOffset(r1, computeRowTimings(r1));
    const empty = nextTimingOffset([], computeRowTimings([], 'auto', carry), carry);
    expect(empty).toEqual(carry);
  });

  it('lets a manual start in a later body pin the clock, as it does in the first', () => {
    const r1 = rows('0:05');
    const carry = nextTimingOffset(r1, computeRowTimings(r1));
    const r2 = [{ duration: '0:03', start: '1:00' }, { duration: '0:02' }];
    const second = computeRowTimings(r2, 'auto', carry);
    expect(second.map(t => t.start)).toEqual(['1:00', '1:03']);
    // The numbering still continues — only the clock was pinned.
    expect(second.map(t => t.shot)).toEqual(['2.', '3.']);
  });

  it('keeps a manual shot number whatever the offset is', () => {
    const r = [{ duration: '0:05', shot: '12A' }];
    expect(computeRowTimings(r, 'auto', { startIndex: 7 })[0].shot).toBe('12A');
  });

  it('clamps a nonsense offset rather than propagating it', () => {
    const r = rows('0:05');
    expect(computeRowTimings(r, 'auto', { startIndex: -3 })[0].shot).toBe('1.');
    expect(computeRowTimings(r, 'auto', { startSeconds: -60 })[0].start).toBe('0:00');
  });
});
