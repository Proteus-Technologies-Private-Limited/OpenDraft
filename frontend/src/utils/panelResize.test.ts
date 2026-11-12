import { describe, expect, it } from 'vitest';
import { panelResize } from './panelResize';

describe('keyboard sidebar resizing', () => {
  it.each([
    ['left', false, 'ArrowRight', 310], ['left', false, 'ArrowLeft', 290],
    ['right', false, 'ArrowRight', 290], ['right', false, 'ArrowLeft', 310],
    ['left', true, 'ArrowRight', 290], ['left', true, 'ArrowLeft', 310],
    ['right', true, 'ArrowRight', 310], ['right', true, 'ArrowLeft', 290],
    ['left', false, 'Home', 160], ['left', false, 'End', 500],
    ['right', false, 'Home', 200], ['right', false, 'End', 600],
  ] as const)('%s RTL=%s %s moves the inner edge', (side, rtl, key, expected) => {
    expect(panelResize(300, key, side, rtl)).toBe(expected);
  });
  it('clamps at the same limits as pointer resizing and leaves other keys alone', () => {
    expect(panelResize(500, 'ArrowRight', 'left')).toBe(500);
    expect(panelResize(200, 'ArrowRight', 'right')).toBe(200);
    expect(panelResize(300, 'Tab', 'right')).toBeNull();
    expect(panelResize(300, 'ArrowDown', 'left')).toBeNull();
  });
});
