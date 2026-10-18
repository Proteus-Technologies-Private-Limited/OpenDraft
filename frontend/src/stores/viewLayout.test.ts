/**
 * Page view vs phone view (View ▸ Layout).
 *
 * Phones start in the phone view — a whole sheet fitted to one is 8px type —
 * and everything else starts on the page. Each layout keeps its own zoom: in
 * the phone view it is the size of the text, while on the page it is the size
 * of the sheet, so carrying one number across would hand the writer either
 * unreadable text or a sheet three screens wide.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const VIEW_STATE_KEY = 'opendraft:viewState';

/** Import the store with a fresh module registry, on a phone or not. */
async function freshStore(onPhone: boolean) {
  vi.resetModules();
  vi.doMock('../utils/phoneDevice', () => ({ isPhoneDevice: () => onPhone }));
  const { useEditorStore } = await import('./editorStore');
  return useEditorStore;
}

const saved = () => JSON.parse(localStorage.getItem(VIEW_STATE_KEY) || '{}');

beforeEach(() => localStorage.clear());

describe('viewLayout', () => {
  it('starts in the phone view on a phone', async () => {
    const store = await freshStore(true);
    expect(store.getState().viewLayout).toBe('phone');
  });

  it('starts on the page everywhere else', async () => {
    const store = await freshStore(false);
    expect(store.getState().viewLayout).toBe('page');
  });

  it('remembers a phone writer who picked the page view', async () => {
    localStorage.setItem(VIEW_STATE_KEY, JSON.stringify({ viewLayout: 'page' }));
    const store = await freshStore(true);
    expect(store.getState().viewLayout).toBe('page');
  });

  it('writes the choice to the view state', async () => {
    const store = await freshStore(true);
    store.getState().setViewLayout('page');
    expect(saved()).toMatchObject({ viewLayout: 'page' });
  });

  it('opens the phone view at full-size text, whatever the page view was fitted to', async () => {
    // The page view on a phone is fitted to the screen, so its stored zoom is ~50.
    localStorage.setItem(VIEW_STATE_KEY, JSON.stringify({ zoomLevel: 50 }));
    const store = await freshStore(true);
    expect(store.getState().zoomLevel).toBe(100);
  });

  it('keeps each layout\'s zoom apart', async () => {
    localStorage.setItem(VIEW_STATE_KEY, JSON.stringify({ zoomLevel: 80 }));
    const store = await freshStore(true);

    store.getState().setZoomLevel(130);
    expect(saved()).toMatchObject({ phoneZoomLevel: 130, zoomLevel: 80 });

    store.getState().setViewLayout('page');
    expect(store.getState().zoomLevel).toBe(80);

    store.getState().setZoomLevel(90);
    store.getState().setViewLayout('phone');
    expect(store.getState().zoomLevel).toBe(130);
    expect(saved()).toMatchObject({ phoneZoomLevel: 130, zoomLevel: 90 });
  });

  it('leaves the desktop zoom exactly where it was', async () => {
    localStorage.setItem(VIEW_STATE_KEY, JSON.stringify({ zoomLevel: 125 }));
    const store = await freshStore(false);
    expect(store.getState().zoomLevel).toBe(125);
    store.getState().setZoomLevel(150);
    expect(saved()).toMatchObject({ zoomLevel: 150 });
    expect(saved().phoneZoomLevel).toBeUndefined();
  });

  it('follows the device while the writer has not picked a layout', async () => {
    const store = await freshStore(true);
    store.getState().followDevice(false);
    expect(store.getState().viewLayout).toBe('page');
    store.getState().followDevice(true);
    expect(store.getState().viewLayout).toBe('phone');
    // Following is not a choice: nothing is saved for the next launch.
    expect(saved().viewLayout).toBeUndefined();
  });

  it('keeps the writer\'s own choice when the device changes', async () => {
    const store = await freshStore(true);
    store.getState().setViewLayout('phone');
    store.getState().setViewLayout('page');
    store.getState().followDevice(true);
    expect(store.getState().viewLayout).toBe('page');
  });
});
