import { describe, expect, it } from 'vitest';
import { companionView, foldCompanionPlacement } from './foldCompanion';
import type { FoldState } from './foldPosture';

const base = { outlineOpen: false, beatBoardOpen: false, indexCardsOpen: false,
  statisticsOpen: false, splitScreenOpen: false, splitScreenPane: 'page-view' as const };
const flat: FoldState & { foldable: boolean } = { foldable: true, fold: 'flat', size: 'wide', foldRect: null };

describe('foldable companions', () => {
  it('requires a confirmed usable foldable window, preserving ordinary and cover layouts', () => {
    expect(foldCompanionPlacement({ ...flat, foldable: false })).toBeNull();
    expect(foldCompanionPlacement({ ...flat, size: 'phone' })).toBeNull();
    expect(foldCompanionPlacement(flat)).toBe('column');
    expect(foldCompanionPlacement({ ...flat, fold: 'book' })).toBe('side');
    expect(foldCompanionPlacement({ ...flat, fold: 'laptop', size: 'phone' })).toBe('bottom');
  });

  it('uses a retained inactive crease even when the device is fully open', () => {
    expect(foldCompanionPlacement({ ...flat, foldRect: { width: 20, height: 800 } as DOMRect })).toBe('side');
    expect(foldCompanionPlacement({ ...flat, foldRect: { width: 1000, height: 20 } as DOMRect })).toBe('bottom');
  });

  it('distinguishes a full planning view from a split pane without replacing the selected split view', () => {
    expect(companionView({ ...base, outlineOpen: true }, false)).toEqual({ pane: 'outline', main: true });
    expect(companionView({ ...base, beatBoardOpen: true }, false)).toEqual({ pane: 'beat-board', main: true });
    expect(companionView({ ...base, indexCardsOpen: true }, false)).toEqual({ pane: 'index-cards', main: true });
    expect(companionView({ ...base, indexCardsOpen: true, splitScreenOpen: true }, false)).toEqual({ pane: 'page-view', main: false });
    expect(companionView({ ...base, statisticsOpen: true, splitScreenOpen: true }, false)).toEqual({ pane: null, main: false });
    expect(companionView({ ...base, outlineOpen: true }, true)).toEqual({ pane: null, main: false });
  });
});


describe('companion requests', () => {
  it('reactivates the same pane without changing its layout or saved posture choices', async () => {
    const { useEditorStore: store } = await import('../stores/editorStore');
    const previous = store.getState();
    try {
      store.setState({ ...base, splitScreenMode: 'stacked', splitScreenActivation: 0 });
      const saved = localStorage.getItem('opendraft:viewState');
      store.getState().setSplitScreenPane('page-view');
      const first = store.getState().splitScreenActivation;
      store.getState().setSplitScreenPane('page-view');
      expect(store.getState()).toMatchObject({ splitScreenMode: 'stacked', splitScreenPane: 'page-view', splitScreenOpen: true, splitScreenActivation: first + 1 });
      expect(localStorage.getItem('opendraft:viewState')).toBe(saved);
    } finally { store.setState(previous); }
  });

  it('selects Index Cards from another planning view in both menu and Views controls', async () => {
    const { useEditorStore: store } = await import('../stores/editorStore');
    const { setMainView } = await import('./panelActions');
    const previous = store.getState();
    try {
      store.setState({ ...base, beatBoardOpen: true });
      store.getState().toggleIndexCards();
      expect(store.getState()).toMatchObject({ indexCardsOpen: true, beatBoardOpen: false });
      store.setState({ ...base, beatBoardOpen: true });
      setMainView('index-cards');
      expect(store.getState()).toMatchObject({ indexCardsOpen: true, beatBoardOpen: false, outlineOpen: false });
      store.getState().setSplitScreenPane('page-view');
      store.getState().toggleSplitScreen();
      expect(companionView(store.getState(), false)).toEqual({ pane: null, main: false });
    } finally { store.setState(previous); }
  });
});
