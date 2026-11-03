/**
 * One full-screen view at a time.
 *
 * Index Cards, the Beat Board and the Outline each take the whole writing area,
 * so the Views menu treats them as a radio group. These tests pin the store
 * side of that: choosing one closes the others, and a full view closes the
 * split screen because there is no editor left to split.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

async function freshStore() {
  vi.resetModules();
  vi.doMock('../utils/phoneDevice', () => ({ isPhoneDevice: () => false }));
  const { useEditorStore } = await import('./editorStore');
  return useEditorStore;
}

beforeEach(() => localStorage.clear());

describe('the main view', () => {
  it('opens Index Cards and closes the Beat Board, Outline and split screen', async () => {
    const store = await freshStore();
    store.setState({ beatBoardOpen: true, outlineOpen: true, splitScreenOpen: true });
    store.getState().setMainView('index-cards');
    const s = store.getState();
    expect(s.indexCardsOpen).toBe(true);
    expect(s.beatBoardOpen).toBe(false);
    expect(s.outlineOpen).toBe(false);
    expect(s.splitScreenOpen).toBe(false);
  });

  it('opens the Beat Board and closes Index Cards and Outline', async () => {
    const store = await freshStore();
    store.setState({ indexCardsOpen: true, outlineOpen: true });
    store.getState().setMainView('beat-board');
    const s = store.getState();
    expect(s.beatBoardOpen).toBe(true);
    expect(s.indexCardsOpen).toBe(false);
    expect(s.outlineOpen).toBe(false);
  });

  it('opens the Outline and closes Index Cards and the Beat Board', async () => {
    const store = await freshStore();
    store.setState({ indexCardsOpen: true, beatBoardOpen: true });
    store.getState().setMainView('outline');
    const s = store.getState();
    expect(s.outlineOpen).toBe(true);
    expect(s.indexCardsOpen).toBe(false);
    expect(s.beatBoardOpen).toBe(false);
  });

  it('returns to the script without touching the split screen', async () => {
    const store = await freshStore();
    store.setState({ indexCardsOpen: true, splitScreenOpen: true });
    store.getState().setMainView('script');
    const s = store.getState();
    expect(s.indexCardsOpen).toBe(false);
    expect(s.splitScreenOpen).toBe(true);
  });

  it('keeps the opened view when a panel toggles', async () => {
    const store = await freshStore();
    store.getState().setMainView('index-cards');
    store.getState().toggleStoryMap();
    expect(store.getState().indexCardsOpen).toBe(true);
    expect(store.getState().storyMapOpen).toBe(true);
  });

  it('closes Index Cards when the Beat Board opens from its own toggle', async () => {
    const store = await freshStore();
    store.setState({ indexCardsOpen: true });
    store.getState().toggleBeatBoard();
    expect(store.getState().beatBoardOpen).toBe(true);
    expect(store.getState().indexCardsOpen).toBe(false);
  });

  it('closes the Beat Board when Index Cards opens from its own toggle', async () => {
    const store = await freshStore();
    store.setState({ beatBoardOpen: true });
    store.getState().toggleIndexCards();
    expect(store.getState().indexCardsOpen).toBe(true);
    expect(store.getState().beatBoardOpen).toBe(false);
  });

  it('closes a full view when the split screen opens', async () => {
    const store = await freshStore();
    store.setState({ indexCardsOpen: true });
    store.getState().setSplitScreenPane('page-view');
    expect(store.getState().splitScreenOpen).toBe(true);
    expect(store.getState().indexCardsOpen).toBe(false);
  });
});
