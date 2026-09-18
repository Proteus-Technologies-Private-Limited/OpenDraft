/**
 * Dragging an AV column divider.
 *
 * Widths are stored in relative units and the drag arrives in pixels, so the
 * conversion is where this can go wrong — and it goes wrong invisibly, as a
 * divider that drifts away from the pointer.
 */
import { describe, it, expect } from 'vitest';
import { AV_BOUNDARIES, frPerPixel, widthsAfterDrag, measureRow } from './avColumnDrag';
import { AV_DEFAULT_COLUMNS, readColumnConfig, visibleColumns } from './extensions/AvBlock';

const cfg = (over: Partial<typeof AV_DEFAULT_COLUMNS> = {}) =>
  readColumnConfig({ columns: { ...AV_DEFAULT_COLUMNS, ...over } });

const boundary = (id: string) => AV_BOUNDARIES.find((b) => b.id === id)!;

describe('visibleColumns', () => {
  it('lists the tracks the grid actually draws, in order', () => {
    expect(visibleColumns(cfg())).toEqual(['cue', 'video', 'audio']);
    expect(visibleColumns(cfg({ cue: false }))).toEqual(['video', 'audio']);
    expect(visibleColumns(cfg({ image: true }))).toEqual(['cue', 'video', 'audio', 'image']);
    expect(visibleColumns(cfg({ cue: false, image: true }))).toEqual(['video', 'audio', 'image']);
  });
});

describe('frPerPixel', () => {
  it('converts using only the columns that are on', () => {
    // cue 0.5 + video 2 + audio 2 = 4.5fr across 450px → 0.01fr per px.
    expect(frPerPixel(cfg(), { totalPx: 450 })).toBeCloseTo(4.5 / 450, 10);
  });

  it('excludes a column that is switched off', () => {
    // Without the cue column only video+audio share the width.
    expect(frPerPixel(cfg({ cue: false }), { totalPx: 400 })).toBeCloseTo(4 / 400, 10);
  });

  it('refuses to divide by a row it could not measure', () => {
    expect(frPerPixel(cfg(), { totalPx: 0 })).toBe(0);
    expect(frPerPixel(cfg(), { totalPx: Number.NaN })).toBe(0);
  });
});

describe('widthsAfterDrag', () => {
  const metrics = { totalPx: 450 };

  it('moves width from one column to its neighbour', () => {
    const next = widthsAfterDrag(cfg(), boundary('video-audio'), 50, metrics)!;
    // 50px at 0.01fr/px = 0.5fr out of audio and into video.
    expect(next.video).toBeCloseTo(2.5, 10);
    expect(next.audio).toBeCloseTo(1.5, 10);
  });

  it('keeps the pair’s total constant, so the other columns do not shift', () => {
    const next = widthsAfterDrag(cfg(), boundary('video-audio'), -37, metrics)!;
    expect(next.video! + next.audio!).toBeCloseTo(4, 10);
  });

  it('leaves every other column alone', () => {
    const next = widthsAfterDrag(cfg(), boundary('video-audio'), 50, metrics)!;
    expect(next.cue).toBeUndefined();
    expect(next.image).toBeUndefined();
  });

  it('drags the cue divider against the video column', () => {
    const next = widthsAfterDrag(cfg(), boundary('cue-video'), 20, metrics)!;
    expect(next.cue).toBeCloseTo(0.7, 10);
    expect(next.video).toBeCloseTo(1.8, 10);
  });

  it('stops BOTH columns when either hits its limit', () => {
    // A huge drag would take audio below the 0.2 floor. Video must not keep
    // growing past the point audio stopped shrinking, or the divider parts
    // company with the line it is dragging.
    const next = widthsAfterDrag(cfg(), boundary('video-audio'), 100000, metrics)!;
    expect(next.audio).toBeCloseTo(0.2, 10);
    expect(next.video).toBeCloseTo(3.8, 10);
    expect(next.video! + next.audio!).toBeCloseTo(4, 10);
  });

  it('is a no-op for a drag that has not moved', () => {
    expect(widthsAfterDrag(cfg(), boundary('video-audio'), 0, metrics)).toBeNull();
  });

  it('is a no-op when the row could not be measured', () => {
    expect(widthsAfterDrag(cfg(), boundary('video-audio'), 50, { totalPx: 0 })).toBeNull();
  });

  it('is a no-op once a column is already pinned at its limit', () => {
    const pinned = cfg({ widths: { ...AV_DEFAULT_COLUMNS.widths, audio: 0.2 } });
    expect(widthsAfterDrag(pinned, boundary('video-audio'), 80, metrics)).toBeNull();
  });
});

describe('measureRow', () => {
  const withComputedStyle = (style: Record<string, string>, width: number, run: () => void) => {
    const saved = globalThis.getComputedStyle;
    (globalThis as { getComputedStyle: unknown }).getComputedStyle = () => style as unknown as CSSStyleDeclaration;
    try {
      run();
    } finally {
      (globalThis as { getComputedStyle: unknown }).getComputedStyle = saved;
    }
    void width;
  };

  const rowEl = (width: number) => ({
    getBoundingClientRect: () => ({ width }),
  }) as unknown as Element;

  it('adds up the used pixel widths a rendered grid computes to', () => {
    withComputedStyle({ gridTemplateColumns: '64px 200.5px 200.5px', columnGap: '12px' }, 0, () => {
      expect(measureRow(rowEl(489), 3).totalPx).toBeCloseTo(465, 10);
    });
  });

  it('falls back to the row box when the computed value is the SPECIFIED one', () => {
    // A row that is not being laid out reports what the stylesheet asked for.
    // Parsing "minmax(64px, 0.5fr) 2fr 2fr" as pixels would yield about 4.5px
    // of total width and make the first pixel of travel hit the clamp.
    withComputedStyle({ gridTemplateColumns: 'minmax(64px, 0.5fr) 2fr 2fr', columnGap: '12px' }, 0, () => {
      // 3 columns, 2 gaps of 12px, inside a 489px row.
      expect(measureRow(rowEl(489), 3).totalPx).toBeCloseTo(465, 10);
    });
  });

  it('subtracts the row’s own padding from the fallback', () => {
    withComputedStyle(
      { gridTemplateColumns: 'none', columnGap: '12px', paddingLeft: '10px', paddingRight: '10px' },
      0,
      () => { expect(measureRow(rowEl(489), 3).totalPx).toBeCloseTo(445, 10); },
    );
  });

  it('reports nothing measurable rather than throwing on a detached row', () => {
    expect(measureRow(null, 3).totalPx).toBe(0);
  });
});
