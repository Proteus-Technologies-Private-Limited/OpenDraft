import { describe, it, expect } from 'vitest';
import { panelButtonAction } from './panelButton';

describe('panelButtonAction', () => {
  it('closes only when the panel is open, nothing is selected and the caret is not on a mark', () => {
    expect(panelButtonAction(true, true, false)).toBe('close');
  });

  it('acts when the panel is closed', () => {
    expect(panelButtonAction(false, true, false)).toBe('act');
    expect(panelButtonAction(false, false, true)).toBe('act');
  });

  it('acts when there is a selection, even with the panel open', () => {
    expect(panelButtonAction(true, false, false)).toBe('act');
  });

  it('acts when the caret is on a note or tag, even with the panel open', () => {
    expect(panelButtonAction(true, true, true)).toBe('act');
  });
});
