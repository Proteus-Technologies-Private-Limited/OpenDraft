/**
 * The overlay coordinate conversion. Getting the scale wrong is what puts a
 * stand-in caret or a selection handle half a page from the text it belongs
 * to once the writer zooms in.
 */
import { describe, it, expect } from 'vitest';
import { pageScale, toPagePoint, type ScaledPage } from './pageCoords';

/** A page laid out `offsetWidth` wide and painted `paintedWidth` wide. */
const page = (offsetWidth: number, paintedWidth = offsetWidth, at = { left: 0, top: 0 }): ScaledPage => ({
  offsetWidth,
  getBoundingClientRect: () => ({ left: at.left, top: at.top, width: paintedWidth }),
});

describe('pageScale', () => {
  it('is 1 when nothing is scaling the page', () => {
    expect(pageScale(page(816))).toBe(1);
  });

  it('reads the zoom off the painted width', () => {
    expect(pageScale(page(816, 1224))).toBe(1.5);
    expect(pageScale(page(816, 408))).toBe(0.5);
  });

  it('has no answer for a page that is not laid out yet', () => {
    expect(pageScale(page(0, 0))).toBeNull();
    expect(pageScale(page(-1, 100))).toBeNull();
  });

  it('has no answer for a page painted at zero width', () => {
    // Display:none inside the layout: a real offsetWidth, nothing painted.
    expect(pageScale(page(816, 0))).toBeNull();
  });
});

describe('toPagePoint', () => {
  it('is relative to the page, not the viewport', () => {
    const p = page(800, 800, { left: 100, top: 50 });
    expect(toPagePoint(p, { left: 160, top: 90, bottom: 110 }))
      .toEqual({ left: 60, top: 40, height: 20 });
  });

  it('undoes the zoom, so the point lands on its own text', () => {
    const p = page(800, 1600, { left: 100, top: 50 });
    // Twice the scale: a point 120px into the painted page is 60px into it.
    expect(toPagePoint(p, { left: 220, top: 90, bottom: 130 }))
      .toEqual({ left: 60, top: 20, height: 20 });
  });

  it('gives a collapsed rectangle a height worth drawing and grabbing', () => {
    const p = page(800);
    expect(toPagePoint(p, { left: 10, top: 40, bottom: 40 })?.height).toBe(8);
  });

  it('has no point for a page that is not laid out yet', () => {
    expect(toPagePoint(page(0, 0), { left: 10, top: 40, bottom: 50 })).toBeNull();
  });
});
