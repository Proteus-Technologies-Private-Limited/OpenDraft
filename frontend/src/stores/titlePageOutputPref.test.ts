/**
 * "Include Title Page" is remembered per device, not per script.
 *
 * It is a habit of the person printing — send the producer the pages, keep the
 * title page for the draft you file — so it has to survive a restart and follow
 * the writer from one document to the next. That rules out `PageLayout`, which
 * travels inside a .odraft file and a collab session and would push one
 * writer's printing habit onto everyone sharing the script (issue #98).
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const VIEW_STATE_KEY = 'opendraft:viewState';

/** Import the store with a fresh module registry, so `_vs` re-reads storage. */
async function freshStore() {
  vi.resetModules();
  const { useEditorStore } = await import('./editorStore');
  return useEditorStore;
}

beforeEach(() => localStorage.clear());

describe('includeTitlePageInOutput', () => {
  it('is on when nothing has been stored', async () => {
    const store = await freshStore();
    expect(store.getState().includeTitlePageInOutput).toBe(true);
  });

  it('writes the writer\'s choice to the view state', async () => {
    const store = await freshStore();
    store.getState().toggleIncludeTitlePageInOutput();

    expect(store.getState().includeTitlePageInOutput).toBe(false);
    expect(JSON.parse(localStorage.getItem(VIEW_STATE_KEY)!))
      .toMatchObject({ includeTitlePageInOutput: false });
  });

  it('reads it back on the next launch', async () => {
    localStorage.setItem(VIEW_STATE_KEY, JSON.stringify({ includeTitlePageInOutput: false }));
    const store = await freshStore();
    expect(store.getState().includeTitlePageInOutput).toBe(false);

    store.getState().toggleIncludeTitlePageInOutput();
    expect(store.getState().includeTitlePageInOutput).toBe(true);
  });

  it('leaves the rest of the view state alone', async () => {
    localStorage.setItem(VIEW_STATE_KEY, JSON.stringify({ zoomLevel: 125 }));
    const store = await freshStore();
    store.getState().toggleIncludeTitlePageInOutput();

    expect(JSON.parse(localStorage.getItem(VIEW_STATE_KEY)!))
      .toMatchObject({ zoomLevel: 125, includeTitlePageInOutput: false });
  });
});
