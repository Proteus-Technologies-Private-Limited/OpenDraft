import { describe, it, expect } from 'vitest';
import { secondsByScenePosition, storyMapTimeStep } from './storyTimeline';

describe('secondsByScenePosition', () => {
  it('aligns a skipped empty heading by position, not by index', () => {
    // The empty heading at 10 has no screen time; the timeline only has 0 and 20.
    const timeline = [{ pos: 0, seconds: 6 }, { pos: 20, seconds: 9 }];
    expect(secondsByScenePosition([0, 10, 20], timeline)).toEqual([6, 0, 9]);
  });

  it('gives a scene with no heading position no time', () => {
    const timeline = [{ pos: 0, seconds: 4 }];
    expect(secondsByScenePosition([0, null], timeline)).toEqual([4, 0]);
  });

  it('gives a heading the timing engine did not count no time', () => {
    expect(secondsByScenePosition([0, 8], [{ pos: 0, seconds: 4 }])).toEqual([4, 0]);
  });
});

describe('storyMapTimeStep', () => {
  it('spaces the time ruler by the script length', () => {
    expect(storyMapTimeStep(60)).toBe(15);
    expect(storyMapTimeStep(240)).toBe(30);
    expect(storyMapTimeStep(600)).toBe(60);
    expect(storyMapTimeStep(1200)).toBe(120);
    expect(storyMapTimeStep(3600)).toBe(300);
  });
});
