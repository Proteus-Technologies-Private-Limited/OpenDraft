import { describe, expect, it } from 'vitest';
import { foldedMenuPosition, statusColumnX } from './useFoldedMenuPosition';

const none = { top: 0, right: 0, bottom: 0, left: 0 };

describe('folded menu button position', () => {
  it('goes at the foot of a side status column wide enough for it', () => {
    // iPhone Duo cover: 466 x 678 with the status column down the right edge.
    expect(foldedMenuPosition({ ...none, right: 56 }, { width: 466, height: 678 }, 52))
      .toEqual({ x: 466 - 56 + 10, y: 678 - 36 - 12, inStatusBar: true,
        statusColumn: { side: 'right', start: 410, end: 466, buttonX: 420 } });
    expect(foldedMenuPosition({ ...none, left: 60 }, { width: 466, height: 678 }, 52))
      .toEqual({ x: 12, y: 678 - 36 - 12, inStatusBar: true,
        statusColumn: { side: 'left', start: 0, end: 60, buttonX: 12 } });
  });

  it('stays above the home indicator', () => {
    // The Duo cover as measured: 84 px status column, 34 px bottom inset.
    expect(foldedMenuPosition({ ...none, right: 84, bottom: 34 }, { width: 466, height: 678 }, 52))
      .toMatchObject({ x: 406, y: 678 - 34 - 36 - 12, inStatusBar: true });
  });

  it('keeps the design position under the toolbar when there is no column', () => {
    expect(foldedMenuPosition(none, { width: 412, height: 900 }, 60))
      .toEqual({ x: 412 - 48, y: 70, inStatusBar: false, statusColumn: null });
    // A notch-sized inset too narrow for the button is not a status column.
    expect(foldedMenuPosition({ ...none, right: 30 }, { width: 412, height: 900 }, 60).inStatusBar).toBe(false);
  });

  it('snaps a button dragged over the status column back into it', () => {
    const { statusColumn } = foldedMenuPosition({ ...none, right: 56 }, { width: 466, height: 678 }, 52);
    // Dragged to the right edge: the clamp leaves it at 430, centre 448, inside 410..466.
    expect(statusColumnX(430, statusColumn)).toBe(420);
    // Centre just inside the column's leading edge still counts.
    expect(statusColumnX(392, statusColumn)).toBe(420);
    // Over the script: placed where it was dropped.
    expect(statusColumnX(300, statusColumn)).toBeNull();
    expect(statusColumnX(430, null)).toBeNull();
  });
});
