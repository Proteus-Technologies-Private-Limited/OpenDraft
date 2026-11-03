/**
 * The toolbar layout is device-local view state, like the zoom: a writer who
 * arranges the bar on a laptop does not rearrange the iPad's. These tests pin
 * the save/restore path and the presets.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { defaultToolbarItems, findToolbarPreset } from '../utils/toolbarLayout';

const VIEW_STATE_KEY = 'opendraft:viewState';

async function freshStore() {
  vi.resetModules();
  vi.doMock('../utils/phoneDevice', () => ({ isPhoneDevice: () => false }));
  const { useEditorStore } = await import('./editorStore');
  return useEditorStore;
}

const saved = () => JSON.parse(localStorage.getItem(VIEW_STATE_KEY) || '{}');

beforeEach(() => localStorage.clear());

describe('toolbar layout state', () => {
  it('starts from the default bar and preset', async () => {
    const store = await freshStore();
    expect(store.getState().toolbarItems).toEqual(defaultToolbarItems());
    expect(store.getState().toolbarPreset).toBe('default');
  });

  it('applies a preset and saves it on this device', async () => {
    const store = await freshStore();
    store.getState().applyToolbarPreset('review');
    expect(store.getState().toolbarItems).toEqual(findToolbarPreset('review')?.items);
    expect(store.getState().toolbarPreset).toBe('review');
    expect(saved()).toMatchObject({
      toolbarItems: findToolbarPreset('review')?.items,
      toolbarPreset: 'review',
    });
  });

  it('keeps an edited layout as custom, cleaned of unknown ids', async () => {
    const store = await freshStore();
    store.getState().setToolbarItems(['undo-redo', 'views', 'nonsense', 'undo-redo']);
    expect(store.getState().toolbarItems).toEqual(['undo-redo', 'views']);
    expect(store.getState().toolbarPreset).toBe('custom');
    expect(saved()).toMatchObject({ toolbarItems: ['undo-redo', 'views'], toolbarPreset: 'custom' });
  });

  it('restores a saved layout on the next launch', async () => {
    localStorage.setItem(VIEW_STATE_KEY, JSON.stringify({
      toolbarItems: ['views', 'undo-redo'], toolbarPreset: 'custom',
    }));
    const store = await freshStore();
    expect(store.getState().toolbarItems).toEqual(['views', 'undo-redo']);
    expect(store.getState().toolbarPreset).toBe('custom');
  });

  it('ignores a preset that does not exist', async () => {
    const store = await freshStore();
    store.getState().applyToolbarPreset('made-up');
    expect(store.getState().toolbarItems).toEqual(defaultToolbarItems());
    expect(store.getState().toolbarPreset).toBe('default');
  });
});

describe('named toolbar layouts', () => {
  it('saves the current bar under a name and applies it again', async () => {
    const store = await freshStore();
    store.getState().setToolbarItems(['views', 'undo-redo', 'zoom']);
    const id = store.getState().saveToolbarLayout('My bar');
    expect(id).toBeTruthy();
    expect(store.getState().toolbarLayouts).toHaveLength(1);
    expect(saved().toolbarLayouts[0]).toMatchObject({
      label: 'My bar',
      items: ['views', 'undo-redo', 'zoom'],
    });
    expect(store.getState().toolbarPreset).toBe(id);

    store.getState().applyToolbarPreset('default');
    store.getState().applyToolbarLayout(id as string);
    expect(store.getState().toolbarItems).toEqual(['views', 'undo-redo', 'zoom']);
    expect(store.getState().toolbarPreset).toBe(id);

    store.getState().deleteToolbarLayout(id as string);
    expect(store.getState().toolbarLayouts).toEqual([]);
    expect(store.getState().toolbarPreset).toBe('custom');
  });

  it('refuses a blank name', async () => {
    const store = await freshStore();
    expect(store.getState().saveToolbarLayout('   ')).toBeNull();
    expect(store.getState().toolbarLayouts).toHaveLength(0);
  });

  it('restores saved layouts on the next launch', async () => {
    localStorage.setItem(VIEW_STATE_KEY, JSON.stringify({
      toolbarLayouts: [{ id: 'mine', label: 'Mine', items: ['views', 'zoom'] }],
      toolbarPreset: 'mine',
      toolbarItems: ['views', 'zoom'],
    }));
    const store = await freshStore();
    expect(store.getState().toolbarLayouts).toEqual([
      { id: 'mine', label: 'Mine', items: ['views', 'zoom'] },
    ]);
    expect(store.getState().toolbarPreset).toBe('mine');
  });
});