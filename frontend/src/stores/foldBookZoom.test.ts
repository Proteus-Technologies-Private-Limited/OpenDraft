import { beforeEach, describe, expect, it, vi } from 'vitest';

const posture = vi.hoisted(() => ({ fold: 'flat' as 'flat' | 'book' | 'laptop' }));
vi.mock('../utils/foldPosture', () => ({
  isFoldableDevice: () => true,
  getFoldState: () => ({ size: 'wide', fold: posture.fold, foldRect: null }),
}));
const saved = () => JSON.parse(localStorage.getItem('opendraft:viewState') ?? '{}');
beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  posture.fold = 'flat';
  localStorage.setItem('opendraft:viewState', JSON.stringify({ zoomLevel: 78, phoneZoomLevel: 115, viewLayout: 'page' }));
});

describe('book reflow zoom', () => {
  it('changes zoom buckets even when the selected Page layout stays the same', async () => {
    const { useEditorStore: store } = await import('./editorStore');
    posture.fold = 'book';
    store.getState().followFoldPosture();
    expect(store.getState()).toMatchObject({ viewLayout: 'page', zoomLayout: 'phone', zoomLevel: 115 });
    store.getState().setZoomLevel(135);
    expect(saved()).toMatchObject({ zoomLevel: 78, phoneZoomLevel: 135 });
    store.getState().followFoldPosture();
    expect(store.getState().zoomLevel).toBe(135);
    posture.fold = 'laptop';
    store.getState().followFoldPosture();
    expect(store.getState()).toMatchObject({ viewLayout: 'page', zoomLayout: 'page', zoomLevel: 78 });
    posture.fold = 'book';
    store.getState().followFoldPosture();
    expect(store.getState().zoomLevel).toBe(135);
  });

  it('loads the phone zoom on a first launch in book posture', async () => {
    posture.fold = 'book';
    const { useEditorStore: store } = await import('./editorStore');
    expect(store.getState()).toMatchObject({ viewLayout: 'page', zoomLevel: 115, zoomLayout: 'phone' });
    store.getState().setViewLayout('phone');
    store.getState().setViewLayout('page');
    expect(store.getState().zoomLevel).toBe(115);
    expect(saved().zoomLevel).toBe(78);
  });
});
