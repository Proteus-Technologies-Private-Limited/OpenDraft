import { describe, expect, it } from 'vitest';
import { foldLayout } from './foldLayout';
describe('open foldable Navigator docking', () => {
  it('docks Navigator only when the remaining page fits at 80%', () => {
    expect(foldLayout(951, 816, false, false)).toEqual({ dockNavigator: false });
    expect(foldLayout(951, 816, true, false)).toEqual({ dockNavigator: true });
    expect(foldLayout(800, 816, true, false)).toEqual({ dockNavigator: false });
  });
  it('accounts for the right column before deciding whether Navigator docks', () => {
    expect(foldLayout(951, 816, true, true)).toEqual({ dockNavigator: false });
    expect(foldLayout(690, 816, true, true)).toEqual({ dockNavigator: false });
  });
  it('handles the exact 80% docking boundary', () => {
    expect(foldLayout(909, 816, true, false).dockNavigator).toBe(true);
    expect(foldLayout(908, 816, true, false).dockNavigator).toBe(false);
  });

});
