/**
 * A store update that changes nothing must not reach subscribers: the editor
 * screen and the menu bar read the editor store whole, and the editor sets
 * its page count, scenes and characters after every keystroke (issue #229).
 *
 * @vitest-environment node
 */
import { describe, it, expect, afterEach } from 'vitest';
import { create } from 'zustand';
import { skipUnchanged } from './skipUnchanged';
import { useEditorStore, type SceneInfo } from './editorStore';

const scene = (heading: string, i: number): SceneInfo => ({
  id: `scene-${i + 1}`, heading, sceneNumber: String(i + 1), color: '', synopsis: '', plotlineIds: [],
});

function countNotifications(run: () => void): number {
  let n = 0;
  const unsubscribe = useEditorStore.subscribe(() => { n += 1; });
  try { run(); } finally { unsubscribe(); }
  return n;
}

describe('skipUnchanged', () => {
  it('drops a set whose fields all hold their values, and passes any change', () => {
    const store = create<{ a: number; b: string }>()(skipUnchanged(() => ({ a: 1, b: 'x' })));
    let n = 0;
    store.subscribe(() => { n += 1; });
    store.setState({ a: 1 });
    store.setState((s) => ({ b: s.b }));
    expect(n).toBe(0);
    store.setState({ a: 1, b: 'y' });
    expect(n).toBe(1);
    expect(store.getState()).toEqual({ a: 1, b: 'y' });
  });
});

describe('editor store per-keystroke setters', () => {
  afterEach(() => {
    useEditorStore.setState({ pageCount: 1, currentPage: 1, scenes: [], characters: [] });
  });

  it('does not notify for an unchanged page count or current page', () => {
    useEditorStore.setState({ pageCount: 9, currentPage: 3 });
    expect(countNotifications(() => {
      useEditorStore.getState().setPageCount(9);
      useEditorStore.getState().setCurrentPage(3);
    })).toBe(0);
  });

  it('keeps the scene list when it is rebuilt with the same scenes', () => {
    useEditorStore.getState().setScenes(['INT. HOUSE - DAY', 'EXT. ROAD - NIGHT'].map(scene));
    const before = useEditorStore.getState().scenes;
    expect(countNotifications(() => {
      useEditorStore.getState().setScenes(['INT. HOUSE - DAY', 'EXT. ROAD - NIGHT'].map(scene));
    })).toBe(0);
    expect(useEditorStore.getState().scenes).toBe(before);

    useEditorStore.getState().setScenes(['INT. HOUSE - DAY', 'EXT. ROAD - DAWN'].map(scene));
    expect(useEditorStore.getState().scenes[1].heading).toBe('EXT. ROAD - DAWN');
  });

  it('keeps the character list when it is rebuilt with the same names', () => {
    useEditorStore.getState().setCharacters(['ANNA', 'BEN']);
    expect(countNotifications(() => useEditorStore.getState().setCharacters(['ANNA', 'BEN']))).toBe(0);
    expect(countNotifications(() => useEditorStore.getState().setCharacters(['ANNA', 'BEN', 'CAL']))).toBe(1);
  });
});
