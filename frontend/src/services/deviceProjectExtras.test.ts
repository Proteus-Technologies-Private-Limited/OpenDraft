import { describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({ api: {}, ApiError: class extends Error {} }));
vi.mock('./cloudApi', () => ({ cloudApi: {} }));
vi.mock('./deviceSyncStore', () => ({}));

const { mergeDetails, mergeLocationLists, projectDetails } = await import('./deviceProjectExtras');

const loc = (id: string, notes = '') => ({ id, name: id.toUpperCase(), notes }) as never;

describe('project details', () => {
  it('leaves device-only properties out', () => {
    const details = projectDetails({ name: 'A', color: '', properties: { logline: 'x', folder_path: '/tmp' } as never });
    expect(details).toEqual({ name: 'A', color: '', 'p.logline': 'x' });
  });

  it('takes a change from either side, and this device on a clash', () => {
    const base = { name: 'Film', 'p.logline': 'old', 'p.genre': 'drama' };
    const device = { name: 'Film', 'p.logline': 'mine', 'p.genre': 'comedy' };
    const cloud = { name: 'Film 2', 'p.logline': 'theirs', 'p.genre': 'drama' };
    expect(mergeDetails(base, device, cloud)).toEqual({ name: 'Film 2', 'p.logline': 'mine', 'p.genre': 'comedy' });
  });

  it('fills blanks from the cloud on the first pass', () => {
    expect(mergeDetails(null, { name: 'Film', 'p.logline': '' }, { name: 'Film', 'p.logline': 'from cloud' }))
      .toEqual({ name: 'Film', 'p.logline': 'from cloud' });
  });
});

describe('location lists', () => {
  it('merges by id: additions from both, edits from either, a deletion kept', () => {
    const base = [loc('a'), loc('b')];
    const device = [loc('a', 'edited here'), loc('c')];
    const cloud = [loc('a'), loc('b'), loc('d')];
    expect(mergeLocationLists(base, device, cloud).map(l => [l.id, l.notes])).toEqual([
      // A record only the cloud has goes in after the one before it there.
      ['a', 'edited here'], ['d', ''], ['c', ''],
    ]);
  });

  it('unions both lists on the first pass', () => {
    expect(mergeLocationLists(null, [loc('a')], [loc('b')]).map(l => l.id)).toEqual(['a', 'b']);
  });
});

describe('syncing project details', () => {
  const project = (properties: Record<string, unknown>, name = 'Film') =>
    ({ id: 'project', name, color: '', properties: { folder_path: '/linked', ...properties } }) as never;

  it('keeps an edit made here while the pass ran, and merges the cloud\'s change over it', async () => {
    const { api } = await import('./api') as unknown as { api: Record<string, unknown> };
    const { cloudApi } = await import('./cloudApi') as unknown as { cloudApi: Record<string, unknown> };
    const store = await import('./deviceSyncStore') as unknown as Record<string, unknown>;
    const { syncProjectExtras } = await import('./deviceProjectExtras');
    const base = { name: 'Film', color: '', 'p.logline': 'old', 'p.genre': 'drama' };
    const reads = [project({ logline: 'old', genre: 'drama' }), project({ logline: 'old', genre: 'comedy' })];
    api.getProject = vi.fn(async () => reads.shift() ?? project({ logline: 'old', genre: 'comedy' }));
    api.updateProject = vi.fn(async () => ({}));
    api.listAssets = vi.fn(async () => []);
    const cloud = { id: 'sync-binding', name: 'Film', color: '', properties: { logline: 'from the cloud', genre: 'drama' } };
    cloudApi.getProject = vi.fn(async () => cloud);
    cloudApi.updateProject = vi.fn(async () => ({}));
    cloudApi.readLocationList = vi.fn(async () => { throw new Error('offline'); });
    store.readProjectSyncBases = vi.fn(async () => ({ details_base: JSON.stringify(base) }));
    store.rememberProjectSyncBases = vi.fn(async () => {});
    store.readDeviceLocationsRaw = vi.fn(async () => null);
    const binding = { project_id: 'project' } as never;
    const scope = { isCurrent: () => true } as never;

    await syncProjectExtras(binding, scope, 'sync-binding');
    // Nothing to send: the cloud already holds the merge of what was read…
    expect(cloudApi.updateProject).not.toHaveBeenCalled();
    // …and this device keeps the genre changed during the pass, with the cloud's logline.
    expect(api.updateProject).toHaveBeenCalledWith('project', {
      name: 'Film', color: '', properties: { logline: 'from the cloud', genre: 'comedy', folder_path: '/linked' },
    });
    // The base is what the cloud holds, so the genre goes up on the next pass.
    expect(store.rememberProjectSyncBases).toHaveBeenCalledWith(binding, {
      details_base: JSON.stringify({ ...base, 'p.logline': 'from the cloud' }),
    });
  });

  it('writes nothing to the cloud when it changed since it was read', async () => {
    const { api } = await import('./api') as unknown as { api: Record<string, unknown> };
    const { cloudApi } = await import('./cloudApi') as unknown as { cloudApi: Record<string, unknown> };
    const store = await import('./deviceSyncStore') as unknown as Record<string, unknown>;
    const { syncProjectExtras } = await import('./deviceProjectExtras');
    api.getProject = vi.fn(async () => project({ logline: 'mine' }));
    api.updateProject = vi.fn(async () => ({}));
    const reads = [
      { id: 'sync-binding', name: 'Film', color: '', properties: { logline: 'old' } },
      { id: 'sync-binding', name: 'Film', color: '', properties: { logline: 'another device' } },
    ];
    cloudApi.getProject = vi.fn(async () => reads.shift());
    cloudApi.updateProject = vi.fn(async () => ({}));
    store.readProjectSyncBases = vi.fn(async () => ({
      details_base: JSON.stringify({ name: 'Film', color: '', 'p.logline': 'old' }),
    }));
    store.rememberProjectSyncBases = vi.fn(async () => {});
    await syncProjectExtras({ project_id: 'project' } as never, { isCurrent: () => true } as never, 'sync-binding');
    expect(cloudApi.updateProject).not.toHaveBeenCalled();
    expect(api.updateProject).not.toHaveBeenCalled();
    expect(store.rememberProjectSyncBases).not.toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ details_base: expect.any(String) }));
  });
});
