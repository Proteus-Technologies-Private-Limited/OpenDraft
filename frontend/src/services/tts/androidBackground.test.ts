import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AndroidBackgroundRead, type BackgroundState } from './androidBackground';

vi.mock('../../i18n', () => ({ t: (key: string) => key }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const lines = [{ text: 'Synthetic line', voice: 'reader', rate: 1, pitch: 1, gap: 200 }];

describe('Android background read UI reconciliation', () => {
  it('does not advance speech or poll a hidden WebView and reconciles on return', async () => {
    let native: BackgroundState = { status: 'playing', index: 0, offset: 0, end: 0 };
    const request = vi.fn(async (_request: Record<string, unknown>) => native);
    const changed = vi.fn();
    const read = new AndroidBackgroundRead(changed, request);
    await read.start(lines, 0, 0);
    expect(request.mock.calls[0][0]).toMatchObject({ action: 'start', lines, index: 0, labels: { pause: 'tools:tableRead.pause' } });
    Object.assign(document, { visibilityState: 'hidden' });
    native = { status: 'playing', index: 8, offset: 14, end: 19 };
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).toHaveBeenCalledTimes(1);
    Object.assign(document, { visibilityState: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(changed).toHaveBeenLastCalledWith(native);
    expect(request.mock.calls[1][0]).toMatchObject({ action: 'snapshot' });
    read.dispose();
  });

  it('deduplicates UI updates, ignores stale sessions and handles lost ownership', async () => {
    let native: BackgroundState = { status: 'playing', index: 0 };
    const request = vi.fn(async (_request: Record<string, unknown>) => native);
    const changed = vi.fn();
    const read = new AndroidBackgroundRead(changed, request);
    await read.start(lines, 0, 0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(changed).toHaveBeenCalledTimes(1);
    native = { status: 'paused', session: 'obsolete' };
    await vi.advanceTimersByTimeAsync(200);
    expect(changed).toHaveBeenCalledTimes(1);
    native = { status: 'idle', owned: false };
    await vi.advanceTimersByTimeAsync(200);
    expect(changed).toHaveBeenLastCalledWith(native);
    read.dispose();
  });

  it('stops a pending start and removes all foreground listeners on disposal', async () => {
    let acknowledge: (value: BackgroundState) => void = () => {};
    const request = vi.fn((value: Record<string, unknown>) => value.action === 'start'
      ? new Promise<BackgroundState>(resolve => { acknowledge = resolve; }) : Promise.resolve({ status: 'idle' as const }));
    const changed = vi.fn();
    const read = new AndroidBackgroundRead(changed, request);
    const starting = read.start(lines, 0, 0);
    await vi.advanceTimersByTimeAsync(0);
    read.dispose(); acknowledge({ status: 'playing' }); await starting;
    await vi.advanceTimersByTimeAsync(1000);
    window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(request.mock.calls.map(([value]) => value.action)).toEqual(['start', 'stop']);
    expect(request.mock.calls[0][0].session).toEqual(request.mock.calls[1][0].session);
    expect(changed).not.toHaveBeenCalled();
  });

  it('reports an unavailable native transport without exposing its error text', async () => {
    const request = vi.fn().mockResolvedValueOnce({ status: 'playing' }).mockRejectedValue(new Error('synthetic private details'));
    const changed = vi.fn(); const read = new AndroidBackgroundRead(changed, request);
    await read.start(lines, 0, 0); await vi.advanceTimersByTimeAsync(200);
    expect(changed).toHaveBeenLastCalledWith({ status: 'error' });
    read.dispose();
  });
});
