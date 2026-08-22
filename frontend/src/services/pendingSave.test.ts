import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPendingSave, setPendingSaveFlush } from './pendingSave';

afterEach(() => {
  // Leave no registration behind for the next test.
  setPendingSaveFlush(async () => {})();
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
