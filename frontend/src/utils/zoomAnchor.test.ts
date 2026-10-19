/**
 * Zooming keeps the writer's place (issue #156): the line under the focal
 * point stays under it, even when the zoom reflows the text so the script's
 * height no longer scales with the zoom (the phone view).
 *
 * No DOM here — a scroll container and a column of blocks are faked with just
 * the boxes the anchor reads.
 */
import { describe, it, expect } from 'vitest';
import { childAtY, captureZoomAnchor, restoreZoomAnchor } from './zoomAnchor';

const VIEW_TOP = 100;
const VIEW_HEIGHT = 800;

/** A scroll container holding blocks of the given heights, stacked from 0. */
function fakeScript(heights: number[]) {
  const state = { heights, scrollTop: 0 };
  const rect = (top: number, height: number) =>
    ({ top, bottom: top + height, height }) as DOMRect;
  const blocks = heights.map((_, i) => ({
    isConnected: true,
    getBoundingClientRect() {
      const top = state.heights.slice(0, i).reduce((a, b) => a + b, 0);
      return rect(VIEW_TOP + top - state.scrollTop, state.heights[i]);
    },
  }));
  const root = { children: blocks } as unknown as Element;
  const container = {
    get scrollTop() { return state.scrollTop; },
    set scrollTop(v: number) { state.scrollTop = v; },
    getBoundingClientRect: () => rect(VIEW_TOP, VIEW_HEIGHT),
    contains: (el: unknown) => blocks.includes(el as (typeof blocks)[number]),
  } as unknown as HTMLElement;
  return { state, blocks, root, container };
}

describe('childAtY', () => {
  it('finds the block spanning a point, and the nearest one past either end', () => {
    const { root, blocks } = fakeScript([50, 50, 50, 50]);
    expect(childAtY(root, VIEW_TOP + 120)).toBe(blocks[2]);
    expect(childAtY(root, VIEW_TOP - 40)).toBe(blocks[0]);
    expect(childAtY(root, VIEW_TOP + 900)).toBe(blocks[3]);
  });
});

describe('zoom anchor', () => {
  it('keeps the pinched line under the fingers when the text reflows unevenly', () => {
    // 1000 blocks of varying height; scrolled well into the script.
    const heights = Array.from({ length: 1000 }, (_, i) => 20 + (i % 7) * 10);
    const s = fakeScript(heights);
    s.state.scrollTop = 20000;
    const focusY = VIEW_TOP + 300;
    const before = childAtY(s.root, focusY)!;

    const anchor = captureZoomAnchor(s.container, s.root, focusY)!;
    // Zoom in: longer lines wrap more, but not in proportion — some blocks
    // double, some barely grow. Scaling scrollTop could not follow this.
    s.state.heights = heights.map((h, i) => h * (i % 3 === 0 ? 2.4 : 1.3));
    restoreZoomAnchor(s.container, anchor);

    expect(childAtY(s.root, focusY)).toBe(before);
    const r = before.getBoundingClientRect();
    expect(r.top + anchor.frac * r.height).toBeCloseTo(focusY, 0);
  });

  it('falls back to the middle of the screen without a focal point', () => {
    const s = fakeScript(Array(200).fill(40));
    s.state.scrollTop = 3000;
    const anchor = captureZoomAnchor(s.container, s.root)!;
    expect(anchor.offsetY).toBe(VIEW_HEIGHT / 2);
  });

  it('lets go of an element that has left the document', () => {
    const s = fakeScript([40, 40]);
    const anchor = captureZoomAnchor(s.container, s.root)!;
    (anchor.el as unknown as { isConnected: boolean }).isConnected = false;
    expect(restoreZoomAnchor(s.container, anchor)).toBe(false);
  });
});
