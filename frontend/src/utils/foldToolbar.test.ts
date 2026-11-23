import { describe, expect, it } from 'vitest';
import { laptopToolbarPlacement } from './foldToolbar';
import type { FoldState } from './foldPosture';
const laptop: FoldState & { foldable: boolean } = {
  foldable: true, fold: 'laptop', size: 'wide',
  foldRect: { top: 490, height: 20 } as DOMRect,
};
describe('laptop toolbar placement', () => {
  it('reserves toolbar space below the crease when visible', () => {
    expect(laptopToolbarPlacement(laptop, { top: 0, height: 1000 }, 28))
      .toEqual({ top: 510, side: 'below', scriptBottom: 490, panelTop: 616 });
  });
  it('uses the upper half when an overlaid keyboard covers the lower half', () => {
    expect(laptopToolbarPlacement(laptop, { top: 0, height: 480 }, 28))
      .toEqual({ top: 374, side: 'above', scriptBottom: 374, panelTop: 510 });
  });
  it('accounts for a panned visible viewport', () => {
    expect(laptopToolbarPlacement(laptop, { top: 100, height: 380 }, 128)?.top).toBe(374);
  });
  it('keeps the ordinary toolbar on an unusably short viewport', () => {
    expect(laptopToolbarPlacement(laptop, { top: 0, height: 180 }, 28)).toBeNull();
    expect(laptopToolbarPlacement(laptop, { top: 300, height: 180 }, 328)).toBeNull();
  });
  it('requires confirmed laptop geometry, leaving desktop, cover and book alone', () => {
    for (const fold of [ { ...laptop, foldable: false }, { ...laptop, foldRect: null },
      { ...laptop, fold: 'flat' as const }, { ...laptop, fold: 'book' as const }]) {
      expect(laptopToolbarPlacement(fold, { top: 0, height: 1000 }, 28)).toBeNull();
    }
  });
});
