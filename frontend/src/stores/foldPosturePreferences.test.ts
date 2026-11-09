import { beforeEach, describe, expect, it, vi } from 'vitest';
const posture = vi.hoisted(() => ({ key: null as 'folded' | 'open' | null }));
vi.mock('../utils/posturePreferences', async importOriginal => ({
  ...await importOriginal<typeof import('../utils/posturePreferences')>(),
  currentPostureKey: () => posture.key,
}));
const saved = () => JSON.parse(localStorage.getItem('opendraft:viewState') ?? '{}');
beforeEach(() => { vi.resetModules(); localStorage.clear(); posture.key = null; });

describe('editor store posture memory', () => {
  it('restores choices independently, including a choice that equals the current default', async () => {
    const { useEditorStore: store } = await import('./editorStore');
    posture.key = 'folded'; store.getState().followFoldPosture();
    expect(store.getState()).toMatchObject({ toolbarMode: 'hidden', viewLayout: 'phone' });
    store.getState().setToolbarMode('comfortable');
    posture.key = 'open'; store.getState().followFoldPosture();
    expect(store.getState()).toMatchObject({ toolbarMode: 'compact', viewLayout: 'page' });
    store.getState().setViewLayout('page');
    expect(saved().byPosture.open.viewLayout).toBe('page');
    posture.key = 'folded'; store.getState().followFoldPosture();
    expect(store.getState()).toMatchObject({ toolbarMode: 'comfortable', viewLayout: 'phone' });
    expect(saved().toolbarMode).toBeUndefined(); expect(saved().viewLayout).toBeUndefined();
  });
  it('seeds legacy choices into folded once, even on an open first launch', async () => {
    localStorage.setItem('opendraft:viewState', JSON.stringify({ toolbarMode: 'comfortable', viewLayout: 'page' }));
    const { useEditorStore: store } = await import('./editorStore');
    posture.key = 'open'; store.getState().followFoldPosture();
    expect(store.getState().toolbarMode).toBe('compact');
    posture.key = 'folded'; store.getState().followFoldPosture();
    expect(store.getState()).toMatchObject({ toolbarMode: 'comfortable', viewLayout: 'page' });
    store.getState().setToolbarMode('hidden');
    posture.key = 'open'; store.getState().followFoldPosture();
    posture.key = 'folded'; store.getState().followFoldPosture();
    expect(store.getState().toolbarMode).toBe('hidden');
    expect(saved().toolbarMode).toBe('comfortable');
  });
  it('preserves zoom on geometry updates within a posture', async () => {
    const { useEditorStore: store } = await import('./editorStore');
    posture.key = 'open'; store.getState().followFoldPosture();
    store.getState().setZoomLevel(85);
    store.getState().followFoldPosture();
    expect(store.getState().zoomLevel).toBe(85);
  });
  it('leaves ordinary devices on the existing single preference', async () => {
    const { useEditorStore: store } = await import('./editorStore');
    store.getState().setToolbarMode('hidden'); store.getState().setViewLayout('phone');
    store.getState().followFoldPosture();
    expect(saved()).toMatchObject({ toolbarMode: 'hidden', viewLayout: 'phone' });
    expect(saved().byPosture).toBeUndefined();
  });
});
