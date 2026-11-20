import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { LocationEntry } from './api';
import { browserLocationStore, createLocationApi, forgetBrowserLocations, type LocationStore } from './localLocations';

const heading = (text: string) => ({ type: 'sceneHeading', content: [{ type: 'text', text }] });
const doc = (...headings: string[]) => ({ type: 'doc', content: headings.map(heading) });

/** A store held in memory, slow enough that overlapping calls would interleave. */
function memoryStore(scripts: Record<string, unknown[]> = {}) {
  const data = new Map<string, string>();
  const tick = () => new Promise((r) => setTimeout(r, 1));
  const store: LocationStore = {
    read: async (projectId) => {
      await tick();
      const raw = data.get(projectId);
      return raw ? JSON.parse(raw) : null;
    },
    write: async (projectId, locations) => {
      await tick();
      data.set(projectId, JSON.stringify(locations));
    },
    scriptDocs: async (projectId) => scripts[projectId] ?? [],
  };
  return { store, data };
}

describe('createLocationApi', () => {
  it('starts with no locations', async () => {
    const api = createLocationApi(memoryStore().store);
    expect(await api.listLocations('p1')).toEqual([]);
  });

  it('creates, lists, updates and deletes a location', async () => {
    const api = createLocationApi(memoryStore().store);
    const made = await api.createLocation('p1', { name: 'old mill', type: 'exterior' });
    expect(made).toMatchObject({ name: 'OLD MILL', type: 'exterior', imageAssetIds: [] });
    expect(made.id).toMatch(/^loc-[0-9a-f]{12}$/);
    expect(await api.listLocations('p1')).toEqual([made]);

    const edited = await api.updateLocation('p1', made.id, { address: 'Mill Lane', imageAssetIds: ['a1'] });
    expect(edited).toMatchObject({ id: made.id, name: 'OLD MILL', address: 'Mill Lane', imageAssetIds: ['a1'] });
    expect(await api.listLocations('p1')).toEqual([edited]);

    expect(await api.deleteLocation('p1', made.id)).toEqual({ message: 'ok' });
    expect(await api.listLocations('p1')).toEqual([]);
  });

  it('keeps each project’s locations apart', async () => {
    const api = createLocationApi(memoryStore().store);
    await api.createLocation('p1', { name: 'ATTIC' });
    await api.createLocation('p2', { name: 'CELLAR' });
    expect((await api.listLocations('p1')).map((l) => l.name)).toEqual(['ATTIC']);
    expect((await api.listLocations('p2')).map((l) => l.name)).toEqual(['CELLAR']);
  });

  it('rejects an update or delete of a location that is not there', async () => {
    const api = createLocationApi(memoryStore().store);
    await expect(api.updateLocation('p1', 'loc-missing', { notes: 'x' })).rejects.toThrow(/not found/i);
    await expect(api.deleteLocation('p1', 'loc-missing')).rejects.toThrow(/not found/i);
  });

  it('rejects a location with no name and stores nothing', async () => {
    const { store, data } = memoryStore();
    const api = createLocationApi(store);
    await expect(api.createLocation('p1', { name: '  ' })).rejects.toThrow();
    expect(data.has('p1')).toBe(false);
  });

  it('does not lose a change when two are made at once', async () => {
    const api = createLocationApi(memoryStore().store);
    const loc = await api.createLocation('p1', { name: 'PIER' });
    // Fired together, as two quick clicks would: without taking turns both
    // would read the same list and the second write would drop the first.
    await Promise.all([
      api.createLocation('p1', { name: 'BOAT' }),
      api.updateLocation('p1', loc.id, { imageAssetIds: ['a1'] }),
      api.createLocation('p1', { name: 'LIGHTHOUSE' }),
    ]);
    const all = await api.listLocations('p1');
    expect(all.map((l) => l.name).sort()).toEqual(['BOAT', 'LIGHTHOUSE', 'PIER']);
    expect(all.find((l) => l.id === loc.id)?.imageAssetIds).toEqual(['a1']);
  });

  it('carries on after a failed change', async () => {
    const api = createLocationApi(memoryStore().store);
    await expect(api.deleteLocation('p1', 'nope')).rejects.toThrow();
    expect((await api.createLocation('p1', { name: 'QUAY' })).name).toBe('QUAY');
  });

  it('discovers locations from the project’s scripts, once', async () => {
    const { store } = memoryStore({ p1: [doc('INT. KITCHEN - DAY', 'EXT. GARDEN - NIGHT'), doc('EXT. KITCHEN - DAY')] });
    const api = createLocationApi(store);

    const first = await api.discoverLocations('p1');
    expect(first.discovered).toBe(2);
    expect(first.locations.map((l) => [l.name, l.type])).toEqual([['KITCHEN', 'both'], ['GARDEN', 'exterior']]);

    const second = await api.discoverLocations('p1');
    expect(second.discovered).toBe(0);
    expect(second.locations).toEqual(first.locations);
    expect(await api.listLocations('p1')).toEqual(first.locations);
  });

  it('keeps what the writer added to a location when discovering again', async () => {
    const { store } = memoryStore({ p1: [doc('INT. KITCHEN - DAY')] });
    const api = createLocationApi(store);
    const [kitchen] = (await api.discoverLocations('p1')).locations;
    await api.updateLocation('p1', kitchen.id, { imageAssetIds: ['a1', 'a2'], notes: 'North light' });
    const again = await api.discoverLocations('p1');
    expect(again.locations[0]).toMatchObject({ imageAssetIds: ['a1', 'a2'], notes: 'North light' });
  });

  it('does not write when discovery finds nothing new', async () => {
    const { store } = memoryStore();
    const write = vi.spyOn(store, 'write');
    await createLocationApi(store).discoverLocations('p1');
    expect(write).not.toHaveBeenCalled();
  });

  it('shows an empty database when the stored list is damaged', async () => {
    const { store, data } = memoryStore();
    data.set('p1', JSON.stringify({ not: 'a list' }));
    expect(await createLocationApi(store).listLocations('p1')).toEqual([]);
  });
});

describe('browserLocationStore', () => {
  // Node has no localStorage; a Map behind the same four methods stands in.
  const mem = new Map<string, string>();
  beforeEach(() => {
    mem.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => { mem.set(k, v); },
      removeItem: (k: string) => { mem.delete(k); },
    });
  });

  it('round-trips a project’s locations and forgets them on request', async () => {
    const api = createLocationApi(browserLocationStore(async () => [doc('INT. STUDIO - DAY')]));
    const { locations } = await api.discoverLocations('p1');
    expect(locations.map((l: LocationEntry) => l.name)).toEqual(['STUDIO']);
    expect(mem.has('opendraft:locations:p1')).toBe(true);
    expect(await api.listLocations('p1')).toEqual(locations);

    forgetBrowserLocations('p1');
    expect(await api.listLocations('p1')).toEqual([]);
  });

  it('treats unreadable stored text as no locations', async () => {
    mem.set('opendraft:locations:p1', '{not json');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await createLocationApi(browserLocationStore(async () => [])).listLocations('p1')).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('reports a failed save instead of pretending it worked', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: () => undefined,
    });
    const api = createLocationApi(browserLocationStore(async () => []));
    await expect(api.createLocation('p1', { name: 'VAULT' })).rejects.toThrow(/save failed/i);
  });
});
