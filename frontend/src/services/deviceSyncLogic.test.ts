import { describe, expect, it } from 'vitest';
import {
  classifyPresence, effectiveBase, isRealBase, projectState, rememberFor, reusable,
} from './deviceSyncLogic';
import type { ScriptBase } from './deviceSyncStore';

const base = (over: Partial<ScriptBase> = {}): ScriptBase => ({
  script_id: 's', content_hash: 'h0', cloud_revision: 'r0', device_updated: 'd0', cloud_updated: 'c0',
  deleted: '', sending_hash: '', ...over,
});

describe('classifyPresence', () => {
  it('continues when nothing was synced yet, or both sides exist', () => {
    expect(classifyPresence(undefined, true, false)).toEqual({ action: 'continue', base: undefined });
    expect(classifyPresence(base(), true, true)).toEqual({ action: 'continue', base: base() });
  });

  it('tombstones a screenplay deleted on one side instead of reporting a problem', () => {
    expect(classifyPresence(base(), false, true)).toEqual({ action: 'tombstone', side: 'device' });
    expect(classifyPresence(base(), true, false)).toEqual({ action: 'tombstone', side: 'cloud' });
  });

  it('treats a tombstoned screenplay as settled while the other side is all that is left', () => {
    expect(classifyPresence(base({ deleted: 'device' }), false, true)).toEqual({ action: 'settled' });
    expect(classifyPresence(base({ deleted: 'cloud' }), true, false)).toEqual({ action: 'settled' });
  });

  it('forgets a screenplay that is gone from both sides, tombstoned or not', () => {
    expect(classifyPresence(base(), false, false)).toEqual({ action: 'forget' });
    expect(classifyPresence(base({ deleted: 'cloud' }), false, false)).toEqual({ action: 'forget' });
  });

  it('starts over when a tombstoned screenplay is back on both sides', () => {
    expect(classifyPresence(base({ deleted: 'device' }), true, true)).toEqual({
      action: 'continue', base: undefined, forget: true,
    });
  });

  it('does not tombstone a screenplay that was only noted before its first upload', () => {
    const note = base({ cloud_revision: '', content_hash: '', sending_hash: 'x' });
    expect(isRealBase(note)).toBe(false);
    expect(classifyPresence(note, true, false)).toEqual({ action: 'continue', base: undefined });
  });
});

describe('effectiveBase', () => {
  const remote = { hash: 'h1', revision: 'r1', updated: 'c1' };

  it('uses the recorded base as it is', () => {
    expect(effectiveBase(base(), remote, 'd1')).toEqual(base());
    expect(effectiveBase(undefined, remote, 'd1')).toBeUndefined();
  });

  it('recognises an upload whose reply was lost, so later typing is not a conflict', () => {
    // The cloud holds exactly the text this device was sending, under a new revision.
    const derived = effectiveBase(base({ sending_hash: 'h1' }), remote, 'd1');
    expect(derived).toMatchObject({ content_hash: 'h1', cloud_revision: 'r1', cloud_updated: 'c1', device_updated: 'd0' });
  });

  it('recognises a first upload whose reply was lost', () => {
    const note = base({ cloud_revision: '', content_hash: '', device_updated: '', cloud_updated: '', sending_hash: 'h1' });
    expect(effectiveBase(note, remote, 'd1')).toMatchObject({ content_hash: 'h1', cloud_revision: 'r1', device_updated: 'd1' });
  });

  it('does not mistake another device’s text for its own', () => {
    expect(effectiveBase(base({ sending_hash: 'other' }), remote, 'd1')).toEqual(base({ sending_hash: 'other' }));
    const note = base({ cloud_revision: '', content_hash: '', sending_hash: 'other' });
    expect(effectiveBase(note, remote, 'd1')).toBeUndefined();
  });
});

describe('projectState', () => {
  it('reports the most serious state, and a screenplay waiting to be opened is in step', () => {
    expect(projectState(['synced', 'open'])).toBe('synced');
    expect(projectState(['synced', 'pending'])).toBe('pending');
    expect(projectState(['pending', 'quota'])).toBe('problem');
    expect(projectState(['problem', 'conflict', 'synced'])).toBe('conflict');
    expect(projectState([])).toBe('synced');
  });
});

describe('remembering a verdict', () => {
  const now = 1_000_000;
  it('keeps a conflict or an unread cloud copy until a side changes', () => {
    expect(rememberFor('conflict', now)).toBe(Infinity);
    expect(rememberFor('open', now)).toBe(Infinity);
    expect(reusable({ device: 'd', cloud: 'c', verdict: 'conflict', until: Infinity }, 'd', 'c', now)).toBe('conflict');
    expect(reusable({ device: 'd', cloud: 'c', verdict: 'conflict', until: Infinity }, 'd2', 'c', now)).toBeNull();
    expect(reusable({ device: 'd', cloud: 'c', verdict: 'open', until: Infinity }, 'd', 'c2', now)).toBeNull();
  });

  it('asks again about a refused quota after a while, and always retries network trouble', () => {
    const until = rememberFor('quota', now)!;
    expect(until).toBeGreaterThan(now);
    expect(reusable({ device: 'd', cloud: '', verdict: 'quota', until }, 'd', undefined, now + 1000)).toBe('quota');
    expect(reusable({ device: 'd', cloud: '', verdict: 'quota', until }, 'd', undefined, until + 1)).toBeNull();
    expect(rememberFor('pending', now)).toBeNull();
    expect(rememberFor('problem', now)).toBeNull();
    expect(rememberFor('synced', now)).toBeNull();
  });
});
