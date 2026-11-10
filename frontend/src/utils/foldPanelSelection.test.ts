import { describe, expect, it } from 'vitest';
import { reconcileFoldPanels, type FoldPanelSelection } from './foldPanelSelection';
const empty = (): FoldPanelSelection => ({ selected: '', opened: new Map() });
describe('foldable panel selection', () => {
  it('retains a manual selection when open flags have not changed', () => {
    const panels = [{ id: 'notes', open: true }, { id: 'locations', open: true }];
    const selected = { ...reconcileFoldPanels(empty(), panels), selected: 'notes' };
    expect(reconcileFoldPanels(selected, panels)).toBe(selected);
  });
  it('brings an already-open plugin forward when it requests activation again', () => {
    const panels = [{ id: 'plugin', open: true, activationKey: 1 }, { id: 'locations', open: true }];
    const previous = reconcileFoldPanels(empty(), panels);
    expect(previous.selected).toBe('locations');
    expect(reconcileFoldPanels(previous, [{ ...panels[0], activationKey: 2 }, panels[1]]).selected).toBe('plugin');
  });
  it('falls back to a remaining tab when the selected panel closes or unregisters', () => {
    const previous = reconcileFoldPanels(empty(), [{ id: 'notes', open: true }, { id: 'plugin', open: true }]);
    expect(reconcileFoldPanels(previous, [{ id: 'notes', open: true }]).selected).toBe('notes');
    expect(reconcileFoldPanels(previous, []).selected).toBe('');
  });
});
