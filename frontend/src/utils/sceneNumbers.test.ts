import { describe, it, expect } from 'vitest';
import { assignSceneNumbers, newDuplicateNumbers } from './sceneNumbers';
import { testSchema } from '../test/screenplaySchema';

const locked = { visible: true, locked: true };

describe('assignSceneNumbers', () => {
  it('numbers 1, 2, 3 while unlocked, and clears them when hidden', () => {
    expect(assignSceneNumbers(['7', null, '9'], { visible: true, locked: false })).toEqual(['1', '2', '3']);
    expect(assignSceneNumbers(['1', '2'], { visible: false, locked: false })).toEqual([null, null]);
  });

  it('keeps locked numbers when they are hidden', () => {
    expect(assignSceneNumbers(['1', '2', '3'], { visible: false, locked: true })).toEqual(['1', '2', '3']);
  });

  it('gives a scene added after 12 the number 12A, then 12B', () => {
    expect(assignSceneNumbers(['12', null, '13'], locked)).toEqual(['12', '12A', '13']);
    expect(assignSceneNumbers(['12', null, null, '13'], locked)).toEqual(['12', '12A', '12B', '13']);
    expect(assignSceneNumbers(['12', '12A', null, '13'], locked)).toEqual(['12', '12A', '12B', '13']);
  });

  it('skips a letter already in use further on', () => {
    expect(assignSceneNumbers(['12', null, '12A'], locked)).toEqual(['12', '12B', '12A']);
  });

  it('numbers a scene before scene 1 A1', () => {
    expect(assignSceneNumbers([null, '1', '2'], locked)).toEqual(['A1', '1', '2']);
    expect(assignSceneNumbers([null, null, '1'], locked)).toEqual(['A1', 'A1A', '1']);
  });

  it('never gives two scenes the same number: the later one keeps it', () => {
    // How 2.3 numbered a scene inserted before scene 5 of a locked script.
    expect(assignSceneNumbers(['4', '5', '5', '6'], locked)).toEqual(['4', '4A', '5', '6']);
  });

  it('runs past Z without colliding', () => {
    expect(assignSceneNumbers(['3Z', null], locked)).toEqual(['3Z', '3AA']);
  });

  it('numbers a never-numbered script the moment it is locked', () => {
    expect(assignSceneNumbers([null, null], locked)).toEqual(['1', '2']);
  });
});

describe('newDuplicateNumbers', () => {
  const h = (n: string | null) => ({ type: 'sceneHeading', attrs: { sceneNumber: n }, content: [{ type: 'text', text: 'INT. X' }] });
  const d = (...nums: Array<string | null>) => testSchema.nodeFromJSON({ type: 'doc', content: nums.map(h) });

  it('takes the number off the second half of a split heading', () => {
    const before = d('1', '2A', '3');
    const after = d('1', '2A', '2A', '3');
    const clear = newDuplicateNumbers(before, after);
    expect(clear).toHaveLength(1);
    expect(after.resolve(clear[0]).nodeAfter?.attrs.sceneNumber).toBe('2A');
    // It is the later one.
    expect(clear[0]).toBeGreaterThan(after.child(1).nodeSize);
  });

  it('leaves duplicates that were already there to assignSceneNumbers', () => {
    expect(newDuplicateNumbers(d('3', '3'), d('3', '3', '4'))).toEqual([]);
  });
});
