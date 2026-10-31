import { afterEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { startNativeRecognition } from './native';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const call = vi.mocked(invoke);
const callbacks = () => ({ result: vi.fn(), interim: vi.fn(), error: vi.fn(), end: vi.fn() });
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });
describe('native speech session lifecycle', () => {
  it('filters stale events and ends with the current result', async () => {
    let id = '';
    call.mockImplementation(async (command, args) => {
      if (command === 'dictation_native_start') { id = (args as { id: string }).id; return; }
      if (command === 'dictation_native_poll') return [{ id: 'old', kind: 'result', text: 'stale' }, { id, kind: 'result', text: 'new scene' }, { id, kind: 'end' }];
    });
    const cb = callbacks(); await startNativeRecognition('en', cb, new AbortController().signal);
    await vi.waitFor(() => expect(cb.end).toHaveBeenCalledOnce());
    expect(cb.result).toHaveBeenCalledExactlyOnceWith('new scene');
    expect(call).toHaveBeenCalledWith('dictation_native_poll', { id });
  });
  it('cancels a session while permission is still pending', async () => {
    let resolve!: () => void;
    call.mockImplementation((command) => command === 'dictation_native_start' ? new Promise<void>(r => { resolve = r; }) : Promise.resolve());
    const abort = new AbortController(); const cb = callbacks();
    const starting = startNativeRecognition('en', cb, abort.signal);
    abort.abort(); resolve();
    await expect(starting).rejects.toThrow(/Cancelled/);
    expect(call.mock.calls.some(([name]) => name === 'dictation_native_stop')).toBe(true);
    expect(cb.result).not.toHaveBeenCalled();
  });
  it('ignores an in-flight poll after cancellation', async () => {
    let resolve!: (v: unknown) => void;
    call.mockImplementation(command => command === 'dictation_native_poll' ? new Promise(r => { resolve = r; }) : Promise.resolve());
    const cb = callbacks(); const abort = new AbortController();
    await startNativeRecognition('en', cb, abort.signal);
    abort.abort(); resolve([{ kind: 'error', message: 'late' }]);
    await Promise.resolve(); expect(cb.error).not.toHaveBeenCalled();
  });
});
