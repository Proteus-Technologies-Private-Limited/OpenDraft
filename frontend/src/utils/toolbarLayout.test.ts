import { describe, it, expect } from 'vitest';
import {
  TOOLBAR_ITEMS,
  TOOLBAR_PRESETS,
  addToolbarItem,
  defaultToolbarItems,
  findToolbarPreset,
  moveToolbarItem,
  moveToolbarItemTo,
  normaliseToolbarItems,
  normaliseSavedLayouts,
  TOOLBAR_PINNED_ITEMS,
  removeToolbarItem,
} from './toolbarLayout';

const knownIds = new Set(TOOLBAR_ITEMS.map((item) => item.id));

describe('toolbarLayout', () => {
  it('starts from the bar the app has always drawn', () => {
    expect(defaultToolbarItems()).toEqual([
      'undo-redo', 'element', 'font', 'format', 'align', 'search', 'notes', 'theme', 'zoom',
    ]);
  });

  it('gives every preset known items only', () => {
    for (const preset of TOOLBAR_PRESETS) {
      expect(preset.items.length).toBeGreaterThan(0);
      for (const id of preset.items) expect(knownIds.has(id)).toBe(true);
    }
  });

  it('includes the current bar in the Default preset', () => {
    expect(findToolbarPreset('default')?.items).toEqual(defaultToolbarItems());
  });

  it('pins zoom and the theme toggle to the right whatever the saved order says', () => {
    expect(TOOLBAR_PINNED_ITEMS.has('zoom')).toBe(true);
    expect(TOOLBAR_PINNED_ITEMS.has('theme')).toBe(true);
  });

  it('offers the Views menu and file actions outside the Default preset', () => {
    expect(defaultToolbarItems()).not.toContain('views');
    expect(findToolbarPreset('everything')?.items).toContain('views');
    expect(findToolbarPreset('everything')?.items).toContain('document');
  });

  it('drops unknown ids and duplicates from a saved layout', () => {
    expect(normaliseToolbarItems(['undo-redo', 'undo-redo', 'made-up', 7, 'zoom']))
      .toEqual(['undo-redo', 'zoom']);
  });

  it('keeps plugin items, installed or not, so they return with the plugin', () => {
    expect(normaliseToolbarItems(['plugin:my-panel', 'zoom']))
      .toEqual(['plugin:my-panel', 'zoom']);
  });

  it('falls back to the default bar for an empty or malformed layout', () => {
    expect(normaliseToolbarItems([])).toEqual(defaultToolbarItems());
    expect(normaliseToolbarItems('undo-redo')).toEqual(defaultToolbarItems());
    expect(normaliseToolbarItems(null)).toEqual(defaultToolbarItems());
  });

  it('adds an item once, in the order it was added', () => {
    const once = addToolbarItem(['undo-redo'], 'views');
    expect(once).toEqual(['undo-redo', 'views']);
    expect(addToolbarItem(once, 'views')).toBe(once);
  });

  it('removes an item but never the last one', () => {
    expect(removeToolbarItem(['undo-redo', 'views'], 'views')).toEqual(['undo-redo']);
    expect(removeToolbarItem(['undo-redo'], 'undo-redo')).toEqual(['undo-redo']);
  });

  it('moves an item to a drop position and clamps at the ends', () => {
    expect(moveToolbarItemTo(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
    expect(moveToolbarItemTo(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a']);
    expect(moveToolbarItemTo(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'b', 'c']);
    expect(moveToolbarItemTo(['a', 'b', 'c'], 'missing', 0)).toEqual(['a', 'b', 'c']);
  });

  it('moves an item one place and clamps at the ends', () => {
    expect(moveToolbarItem(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveToolbarItem(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(moveToolbarItem(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveToolbarItem(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
    expect(moveToolbarItem(['a', 'b'], 'missing', 1)).toEqual(['a', 'b']);
  });
});

describe('saved toolbar layouts', () => {
  it('keeps named layouts, cleaning their items and labels', () => {
    const layouts = normaliseSavedLayouts([
      { id: 'a', label: '  My bar  ', items: ['views', 'made-up', 'undo-redo'] },
      { id: 'b', label: 'Empty', items: [] },
      { id: 'a', label: 'Duplicate', items: ['zoom'] },
      { id: '', label: 'No id', items: ['zoom'] },
      'nonsense',
    ]);
    expect(layouts).toEqual([{ id: 'a', label: 'My bar', items: ['views', 'undo-redo'] }]);
  });

  it('ignores a malformed value', () => {
    expect(normaliseSavedLayouts(null)).toEqual([]);
    expect(normaliseSavedLayouts({})).toEqual([]);
  });
});