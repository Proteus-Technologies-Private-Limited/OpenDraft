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
