import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPendingSave, setPendingSaveFlush, setLeaveGuard, leaveEditor } from './pendingSave';

afterEach(() => {
  // Leave no registration behind for the next test.
  setPendingSaveFlush(async () => {})();
  setLeaveGuard(() => {})();
});

describe('flushPendingSave', () => {
  it('does nothing when no editor is registered', async () => {
    await expect(flushPendingSave()).resolves.toBeUndefined();
  });

  it('awaits the registered flush', async () => {
    const order: string[] = [];
    setPendingSaveFlush(async () => {
      await Promise.resolve();
      order.push('saved');
    });
    await flushPendingSave();
    order.push('navigated');
    expect(order).toEqual(['saved', 'navigated']);
  });

  it('stops calling a flush that has been unregistered', async () => {
    const flush = vi.fn(async () => {});
    const unregister = setPendingSaveFlush(flush);
    unregister();
    await flushPendingSave();
    expect(flush).not.toHaveBeenCalled();
  });

  it('leaves a newer registration alone when an older one unregisters', async () => {
    // Two editors mounting and unmounting across a route change must not
    // cancel each other's registration.
    const older = vi.fn(async () => {});
    const newer = vi.fn(async () => {});
    const unregisterOlder = setPendingSaveFlush(older);
    setPendingSaveFlush(newer);
    unregisterOlder();
    await flushPendingSave();
    expect(newer).toHaveBeenCalledOnce();
    expect(older).not.toHaveBeenCalled();
  });

  it('swallows a failed save so the caller still gets to leave', async () => {
    // The editor reports its own save failures; stranding the user on a
    // screen they asked to leave would be the worse outcome.
    setPendingSaveFlush(async () => { throw new Error('disk full'); });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(flushPendingSave()).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('leaveEditor', () => {
  it('flushes, then leaves, when no guard is registered', async () => {
    const order: string[] = [];
    setPendingSaveFlush(async () => { order.push('saved'); });
    await leaveEditor(() => order.push('navigated'));
    expect(order).toEqual(['saved', 'navigated']);
  });

  it('hands the decision to the guard, which may hold the writer back', async () => {
    // With auto-save off the guard asks first; until the writer answers,
    // nothing is saved and nobody navigates (issue #135).
    const flush = vi.fn(async () => {});
    const go = vi.fn();
    let pending: (() => void) | null = null;
    setPendingSaveFlush(flush);
    setLeaveGuard((next) => { pending = next; });

    await leaveEditor(go);
    expect(go).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();

    pending!();
    expect(go).toHaveBeenCalledOnce();
  });

  it('falls back to flushing if the guard throws, so the writer is never stranded', async () => {
    const flush = vi.fn(async () => {});
    const go = vi.fn();
    setPendingSaveFlush(flush);
    setLeaveGuard(() => { throw new Error('dialog unavailable'); });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await leaveEditor(go);
    expect(flush).toHaveBeenCalledOnce();
    expect(go).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it('leaves a newer guard alone when an older one unregisters', async () => {
    const older = vi.fn();
    const newer = vi.fn();
    const unregisterOlder = setLeaveGuard(older);
    setLeaveGuard(newer);
    unregisterOlder();
    await leaveEditor(() => {});
    expect(newer).toHaveBeenCalledOnce();
    expect(older).not.toHaveBeenCalled();
  });
});
