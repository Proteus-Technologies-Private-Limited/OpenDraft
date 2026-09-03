import { describe, it, expect } from 'vitest';
import {
  clampPanelPosition,
  defaultPanelPosition,
  splitHandwriting,
  PANEL_MARGIN,
} from './handwriting';

const PANEL = { width: 700, height: 400 };
const IPAD = { width: 1180, height: 820 };

describe('clampPanelPosition', () => {
  it('leaves a panel that is already on screen where it is', () => {
    expect(clampPanelPosition({ left: 200, top: 100 }, PANEL, IPAD))
      .toEqual({ left: 200, top: 100 });
  });

  it('pulls a panel dragged off the right or the bottom back into view', () => {
    expect(clampPanelPosition({ left: 2000, top: 2000 }, PANEL, IPAD))
      .toEqual({ left: 1180 - 700 - PANEL_MARGIN, top: 820 - 400 - PANEL_MARGIN });
  });

  it('pulls a panel dragged off the left or the top back into view', () => {
    expect(clampPanelPosition({ left: -500, top: -500 }, PANEL, IPAD))
      .toEqual({ left: PANEL_MARGIN, top: PANEL_MARGIN });
  });

  it('keeps the controls reachable when the panel is larger than the viewport', () => {
    // The keyboard is up and the panel is taller than what is left: the header
    // is the end with the drag handle and the close button, so it stays put.
    const squashed = { width: 400, height: 300 };
    expect(clampPanelPosition({ left: 100, top: 100 }, PANEL, squashed))
      .toEqual({ left: PANEL_MARGIN, top: PANEL_MARGIN });
  });
});

describe('defaultPanelPosition', () => {
  it('opens centred across the foot of the window', () => {
    const pos = defaultPanelPosition(PANEL, IPAD);
    expect(pos.left).toBe(Math.round((1180 - 700) / 2));
    expect(pos.top).toBe(820 - 400 - PANEL_MARGIN);
  });

  it('is on screen even when the panel does not fit', () => {
    expect(defaultPanelPosition(PANEL, { width: 500, height: 300 }))
      .toEqual({ left: PANEL_MARGIN, top: PANEL_MARGIN });
  });
});

describe('splitHandwriting', () => {
  it('returns a single line as one paragraph', () => {
    expect(splitHandwriting('He crosses to the window.'))
      .toEqual(['He crosses to the window.']);
  });

  it('splits lines into paragraphs', () => {
    expect(splitHandwriting('First line\nSecond line'))
      .toEqual(['First line', 'Second line']);
  });

  it('collapses blank lines rather than reproducing them', () => {
    expect(splitHandwriting('First\n\n\nSecond'))
      .toEqual(['First', 'Second']);
  });

  it('trims the stray leading space handwriting recognition adds', () => {
    expect(splitHandwriting('  He turns.  \n  She does not.  '))
      .toEqual(['He turns.', 'She does not.']);
  });

  it('has nothing to insert for whitespace alone', () => {
    expect(splitHandwriting('   \n  \n')).toEqual([]);
  });
});
