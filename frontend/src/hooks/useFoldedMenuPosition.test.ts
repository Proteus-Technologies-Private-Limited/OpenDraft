import { describe, expect, it } from 'vitest';
import { foldedMenuPosition } from './useFoldedMenuPosition';

const none = { top: 0, right: 0, bottom: 0, left: 0 };

describe('folded menu button position', () => {
  it('goes inside a side status column wide enough for it, centred', () => {
    // iPhone Duo cover: 466 x 678 with the status column down the right edge.
    expect(foldedMenuPosition({ ...none, right: 56 }, { width: 466, height: 678 }, 52))
      .toEqual({ x: 466 - 56 + 10, y: 321, inStatusBar: true });
    expect(foldedMenuPosition({ ...none, left: 60 }, { width: 466, height: 678 }, 52))
      .toEqual({ x: 12, y: 321, inStatusBar: true });
  });

  it('keeps the design position under the toolbar when there is no column', () => {
    expect(foldedMenuPosition(none, { width: 412, height: 900 }, 60)).toEqual({ x: 412 - 48, y: 70, inStatusBar: false });
    // A notch-sized inset too narrow for the button is not a status column.
    expect(foldedMenuPosition({ ...none, right: 30 }, { width: 412, height: 900 }, 60).inStatusBar).toBe(false);
  });
});
