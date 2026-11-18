import { describe, it, expect } from 'vitest';
import {
  DEFAULT_EXPANSION, allScenesOpen, isSceneOpen, loadExpansion, saveExpansion, setAllScenes, toggleScene,
} from './navigatorSynopses';

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(key: string) { return this.map.get(key) ?? null; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  removeItem(key: string) { this.map.delete(key); }
  setItem(key: string, value: string) { this.map.set(key, String(value)); }
}

describe('synopsis expansion', () => {
  it('starts with every scene closed', () => {
    expect(isSceneOpen(DEFAULT_EXPANSION, 'scene-1')).toBe(false);
  });

  it('opens and closes one scene without touching the others', () => {
    const opened = toggleScene(DEFAULT_EXPANSION, 'scene-2');
    expect(isSceneOpen(opened, 'scene-2')).toBe(true);
    expect(isSceneOpen(opened, 'scene-1')).toBe(false);
    expect(isSceneOpen(toggleScene(opened, 'scene-2'), 'scene-2')).toBe(false);
  });

  it('Show all opens scenes written later too, and a row can still close on its own', () => {
    const all = setAllScenes(true);
    expect(isSceneOpen(all, 'scene-99')).toBe(true);
    const oneShut = toggleScene(all, 'scene-3');
    expect(isSceneOpen(oneShut, 'scene-3')).toBe(false);
    expect(isSceneOpen(oneShut, 'scene-4')).toBe(true);
  });

  it('reports all open only when every listed scene is', () => {
    const ids = ['scene-1', 'scene-2'];
    expect(allScenesOpen(setAllScenes(true), ids)).toBe(true);
    expect(allScenesOpen(toggleScene(setAllScenes(true), 'scene-2'), ids)).toBe(false);
    expect(allScenesOpen(setAllScenes(true), [])).toBe(false);
  });
});

describe('remembered per script', () => {
  it('round-trips and keeps scripts apart', () => {
    const storage = new MemoryStorage();
    saveExpansion('p1:s1', toggleScene(DEFAULT_EXPANSION, 'scene-2'), storage);
    saveExpansion('p1:s2', setAllScenes(true), storage);
    expect(isSceneOpen(loadExpansion('p1:s1', storage), 'scene-2')).toBe(true);
    expect(loadExpansion('p1:s2', storage).allOpen).toBe(true);
    expect(loadExpansion('other', storage)).toEqual(DEFAULT_EXPANSION);
  });

  it('survives corrupt storage', () => {
    const storage = new MemoryStorage();
    storage.setItem('opendraft:navigatorSynopses', '{not json');
    expect(loadExpansion('p1:s1', storage)).toEqual(DEFAULT_EXPANSION);
    storage.setItem('opendraft:navigatorSynopses', JSON.stringify({ scripts: { a: { allOpen: 'yes', flipped: 3 } } }));
    expect(loadExpansion('a', storage)).toEqual(DEFAULT_EXPANSION);
  });

  it('forgets the least recently used script past the cap', () => {
    const storage = new MemoryStorage();
    for (let i = 0; i < 55; i++) saveExpansion(`s${i}`, setAllScenes(true), storage);
    expect(loadExpansion('s0', storage)).toEqual(DEFAULT_EXPANSION);
    expect(loadExpansion('s54', storage).allOpen).toBe(true);
  });

  it('does nothing without a script', () => {
    const storage = new MemoryStorage();
    saveExpansion(null, setAllScenes(true), storage);
    expect(storage.length).toBe(0);
    expect(loadExpansion(null, storage)).toEqual(DEFAULT_EXPANSION);
  });
});
