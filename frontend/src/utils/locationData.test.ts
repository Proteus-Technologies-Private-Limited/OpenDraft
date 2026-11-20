import { describe, it, expect } from 'vitest';
import type { LocationEntry } from '../services/api';
import {
  applyLocationUpdate,
  buildLocation,
  cleanLooks,
  discoverNewLocations,
  lookForScene,
  newLocationId,
  newLookId,
  normalizeLocationName,
  parseHeadingLocation,
  parseLocationFromHeading,
  sanitizeLocations,
  sceneHeadingsOf,
} from './locationData';

const NOW = '2026-11-20T10:00:00.000Z';

const heading = (text: string) => ({ type: 'sceneHeading', content: [{ type: 'text', text }] });
const doc = (...headings: string[]) => ({
  type: 'doc',
  content: headings.flatMap((h) => [heading(h), { type: 'action', content: [{ type: 'text', text: 'Something happens.' }] }]),
});

function location(over: Partial<LocationEntry> = {}): LocationEntry {
  return {
    id: 'loc-000000000001', name: 'KITCHEN', fullName: '', description: '', type: 'interior', address: '', notes: '',
    contact: '', availability: '', tags: [], imageAssetIds: [], aliases: [], looks: [],
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('parseHeadingLocation', () => {
  it.each([
    ['INT. KITCHEN - DAY', 'KITCHEN', 'interior'],
    ['EXT. GARDEN - NIGHT', 'GARDEN', 'exterior'],
    ['INT./EXT. CAR - CONTINUOUS', 'CAR', 'both'],
    ['EXT/INT BARN - DUSK', 'BARN', 'both'],
    ['I/E. TAXI - LATER', 'TAXI', 'both'],
    ['int. anna’s flat - magic hour', 'ANNA’S FLAT', 'interior'],
    ['INT. POLICE STATION. NIGHT', 'POLICE STATION', 'interior'],
    ['INT. HOUSE - KITCHEN - DAY', 'HOUSE - KITCHEN', 'interior'],
    ['EXT. BEACH', 'BEACH', 'exterior'],
    ['THE VOID', 'THE VOID', 'interior'],
    // Half-typed headings name no place — the backend parser agrees
    // (test-script/test_location_images.py).
    ['INT.', '', 'interior'],
    ['EXT', '', 'exterior'],
    ['INTERIOR DESIGN STUDIO', 'INTERIOR DESIGN STUDIO', 'interior'],
  ])('%s → %s (%s)', (text, name, type) => {
    expect(parseHeadingLocation(text)).toEqual({ name, type });
  });

  it('collapses runs of spaces, so a heading matches the name discovery stores', () => {
    expect(parseLocationFromHeading('INT.  BIG   HOUSE  -  DAY')).toBe('BIG HOUSE');
    expect(parseLocationFromHeading('INT.  BIG   HOUSE  -  DAY')).toBe(normalizeLocationName('big house'));
  });

  it('gives an empty name for a heading that names no place', () => {
    expect(parseLocationFromHeading('')).toBe('');
    expect(parseLocationFromHeading('INT. ')).toBe('');
  });
});

describe('buildLocation', () => {
  it('normalises the name and aliases and fills every field', () => {
    const loc = buildLocation({ name: '  anna’s   flat ', aliases: ['the flat', ''], tags: ['studio'] }, 'loc-1', NOW);
    expect(loc).toEqual({
      id: 'loc-1', name: 'ANNA’S FLAT', fullName: '', description: '', type: 'interior', address: '', notes: '', contact: '',
      availability: '', tags: ['studio'], imageAssetIds: [], aliases: ['THE FLAT'], looks: [], created_at: NOW, updated_at: NOW,
    });
  });

  it('refuses a location with no name', () => {
    expect(() => buildLocation({ name: '   ' }, 'loc-1', NOW)).toThrow();
  });

  it('falls back to interior for a type it does not know', () => {
    expect(buildLocation({ name: 'A', type: 'underwater' as LocationEntry['type'] }, 'loc-1', NOW).type).toBe('interior');
  });
});

describe('applyLocationUpdate', () => {
  it('changes only the fields it was given', () => {
    const before = location({ address: '1 High St', imageAssetIds: ['a1'] });
    const after = applyLocationUpdate(before, { notes: 'Low ceiling' }, NOW);
    expect(after).toEqual({ ...before, notes: 'Low ceiling', updated_at: NOW });
    expect(before.notes).toBe(''); // the original is not mutated
  });

  it('replaces the image list, keeping its order', () => {
    const after = applyLocationUpdate(location({ imageAssetIds: ['a1', 'a2'] }), { imageAssetIds: ['a2', 'a1', 'a3'] }, NOW);
    expect(after.imageAssetIds).toEqual(['a2', 'a1', 'a3']);
  });

  it('can empty the image list', () => {
    expect(applyLocationUpdate(location({ imageAssetIds: ['a1'] }), { imageAssetIds: [] }, NOW).imageAssetIds).toEqual([]);
  });

  it('never changes the id or the creation date, and ignores a blank name', () => {
    const before = location();
    const after = applyLocationUpdate(
      before,
      { id: 'other', created_at: 'later', name: '   ' } as Partial<LocationEntry>,
      NOW,
    );
    expect(after.id).toBe(before.id);
    expect(after.created_at).toBe(before.created_at);
    expect(after.name).toBe('KITCHEN');
  });

  it('normalises a new name and new aliases', () => {
    const after = applyLocationUpdate(location(), { name: 'galley  kitchen', aliases: ['galley'] }, NOW);
    expect(after.name).toBe('GALLEY KITCHEN');
    expect(after.aliases).toEqual(['GALLEY']);
  });
});

describe('sanitizeLocations', () => {
  it('reads a bare list and the backend’s { locations: [] } wrapper alike', () => {
    const list = [location()];
    expect(sanitizeLocations(list)).toEqual(list);
    expect(sanitizeLocations({ locations: list })).toEqual(list);
  });

  it('returns an empty list for anything that is not one', () => {
    for (const raw of [null, undefined, 'x', 42, {}, { locations: 'no' }]) {
      expect(sanitizeLocations(raw)).toEqual([]);
    }
  });

  it('drops entries with no id or name, and a repeated id', () => {
    const raw = [location(), { name: 'NO ID' }, { id: 'loc-2' }, null, 'junk', location({ name: 'DUPLICATE' })];
    expect(sanitizeLocations(raw).map((l) => l.name)).toEqual(['KITCHEN']);
  });

  it('repairs missing and malformed fields instead of passing them on', () => {
    const [loc] = sanitizeLocations([{ id: 'loc-9', name: 'cellar', type: 'weird', tags: 'x', imageAssetIds: ['a1', 7, null] }]);
    expect(loc).toMatchObject({ name: 'CELLAR', type: 'interior', tags: [], imageAssetIds: ['a1'], aliases: [], address: '', description: '', looks: [] });
  });

  it('keeps well-formed looks and drops the rest', () => {
    const [loc] = sanitizeLocations([{
      id: 'loc-9', name: 'cellar',
      looks: [{ id: 'look-1', name: ' Night ', imageAssetId: 'a1' }, { id: 'look-1', name: 'Again' }, { name: 'No id' }, { id: 'look-2', name: '' }, 'junk'],
    }]);
    expect(loc.looks).toEqual([{ id: 'look-1', name: 'Night', imageAssetId: 'a1' }]);
  });
});

describe('looks', () => {
  const looks = [
    { id: 'look-day', name: 'Day', imageAssetId: null },
    { id: 'look-night', name: 'Night', imageAssetId: 'a1' },
  ];

  it('cleanLooks treats a missing image as none', () => {
    expect(cleanLooks([{ id: 'x', name: 'Dawn', imageAssetId: 7 }])).toEqual([{ id: 'x', name: 'Dawn', imageAssetId: null }]);
    expect(cleanLooks('nope')).toEqual([]);
  });

  it('a scene shows the look it chose', () => {
    expect(lookForScene(looks, 'look-day', 'NIGHT')?.id).toBe('look-day');
  });

  it('a scene that chose none shows the look its time of day names', () => {
    expect(lookForScene(looks, null, 'NIGHT')?.id).toBe('look-night');
    expect(lookForScene(looks, 'look-gone', 'day')?.id).toBe('look-day');
  });

  it('shows no look when the time of day names none', () => {
    expect(lookForScene(looks, null, 'CONTINUOUS')).toBeNull();
    expect(lookForScene(looks, null, '')).toBeNull();
  });

  it('applyLocationUpdate replaces the looks and the description', () => {
    const after = applyLocationUpdate(location(), { description: 'Steel counters', looks }, NOW);
    expect(after.description).toBe('Steel counters');
    expect(after.looks).toEqual(looks);
  });

  it('newLookId has its own shape and does not repeat', () => {
    const ids = new Set(Array.from({ length: 100 }, newLookId));
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(/^look-[0-9a-f]{12}$/);
  });
});

describe('sceneHeadingsOf', () => {
  it('finds headings at any depth and joins their text', () => {
    const nested = {
      type: 'doc',
      content: [
        { type: 'act', content: [{ type: 'sceneHeading', content: [{ type: 'text', text: 'INT. ' }, { type: 'text', text: 'LAB - DAY', marks: [{ type: 'bold' }] }] }] },
        heading('EXT. ROOF - NIGHT'),
      ],
    };
    expect(sceneHeadingsOf(nested)).toEqual(['INT. LAB - DAY', 'EXT. ROOF - NIGHT']);
  });

  it('reads a line break inside a heading as a space', () => {
    const broken = { type: 'doc', content: [{ type: 'sceneHeading', content: [{ type: 'text', text: 'INT. LONG' }, { type: 'hardBreak' }, { type: 'text', text: 'HALL - DAY' }] }] };
    expect(sceneHeadingsOf(broken)).toEqual(['INT. LONG HALL - DAY']);
  });

  it('copes with a script that has no content', () => {
    expect(sceneHeadingsOf(null)).toEqual([]);
    expect(sceneHeadingsOf({ type: 'doc' })).toEqual([]);
  });
});

describe('discoverNewLocations', () => {
  let n = 0;
  const makeId = () => `loc-test-${++n}`;

  it('adds one entry per place named, across every script', () => {
    const result = discoverNewLocations([], [doc('INT. KITCHEN - DAY', 'EXT. GARDEN - NIGHT'), doc('INT. KITCHEN - NIGHT')], makeId, NOW);
    expect(result.discovered).toBe(2);
    expect(result.locations.map((l) => [l.name, l.type])).toEqual([['KITCHEN', 'interior'], ['GARDEN', 'exterior']]);
  });

  it('records a place seen inside and outside as both', () => {
    const result = discoverNewLocations([], [doc('INT. BARN - DAY', 'EXT. BARN - DAY')], makeId, NOW);
    expect(result.locations.map((l) => [l.name, l.type])).toEqual([['BARN', 'both']]);
  });

  it('leaves alone what is already known, by name or by alias', () => {
    const known = [location({ name: 'KITCHEN', aliases: ['GALLEY'], notes: 'keep me' })];
    const result = discoverNewLocations(known, [doc('INT. KITCHEN - DAY', 'INT. GALLEY - DAY', 'EXT. YARD - DAY')], makeId, NOW);
    expect(result.discovered).toBe(1);
    expect(result.locations[0]).toEqual(known[0]);
    expect(result.locations.map((l) => l.name)).toEqual(['KITCHEN', 'YARD']);
  });

  it('finds nothing in scripts with no scene headings', () => {
    const known = [location()];
    const result = discoverNewLocations(known, [null, { type: 'doc', content: [] }], makeId, NOW);
    expect(result).toEqual({ discovered: 0, locations: known });
  });
});

describe('newLocationId', () => {
  it('has the backend’s shape and does not repeat', () => {
    const ids = new Set(Array.from({ length: 200 }, newLocationId));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^loc-[0-9a-f]{12}$/);
  });
});

describe('locationNamed', () => {
  it('finds a location by its name or an alias', async () => {
    const { locationNamed } = await import('./locationData');
    const list = [location({ id: 'a', name: 'KITCHEN', aliases: ['GALLEY'] }), location({ id: 'b', name: 'ROOF' })];
    expect(locationNamed(list, 'kitchen')?.id).toBe('a');
    expect(locationNamed(list, 'Galley')?.id).toBe('a');
    expect(locationNamed(list, 'CELLAR')).toBeNull();
    expect(locationNamed(list, '')).toBeNull();
  });
});
