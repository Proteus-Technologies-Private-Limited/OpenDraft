import { afterEach, describe, expect, it, vi } from 'vitest';
import { startLocalRecognition } from './local';
const callbacks = () => ({ result: vi.fn(), interim: vi.fn(), error: vi.fn(), end: vi.fn() });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('local recording resource ownership', () => {
  it('releases a microphone granted after Cancel', async () => {
    let grant!: (value: unknown) => void;
    const stop = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => new Promise(r => { grant = r; }) } });
    vi.stubGlobal('MediaRecorder', class {});
    const abort = new AbortController();
    const pending = startLocalRecognition('en', callbacks(), abort.signal);
    abort.abort(); grant({ getTracks: () => [{ stop }] });
    await expect(pending).rejects.toThrow(/Cancelled/);
    expect(stop).toHaveBeenCalledOnce();
  });
  it('releases the microphone if MediaRecorder cannot initialize', async () => {
    const stop = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop }] }) } });
    vi.stubGlobal('MediaRecorder', class { constructor() { throw new Error('No audio codec'); } });
    await expect(startLocalRecognition('en', callbacks(), new AbortController().signal)).rejects.toThrow('No audio codec');
    expect(stop).toHaveBeenCalledOnce();
  });
  it('cancels without launching an inference worker or delivering text', async () => {
    const stop = vi.fn(); const worker = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop }] }) } });
    vi.stubGlobal('Worker', worker);
    vi.stubGlobal('MediaRecorder', class {
      state = 'inactive'; onstop: (() => void) | null = null;
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; this.onstop?.(); }
    });
    const abort = new AbortController(); const cb = callbacks();
    await startLocalRecognition('en', cb, abort.signal);
    abort.abort();
    expect(stop).toHaveBeenCalled(); expect(worker).not.toHaveBeenCalled();
    expect(cb.result).not.toHaveBeenCalled();
  });
  it('releases the microphone before decoding and reports decoding failure', async () => {
    const stop = vi.fn(); const close = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop }] }) } });
    vi.stubGlobal('MediaRecorder', class {
      state = 'inactive'; mimeType = 'audio/webm'; onstop: (() => void) | null = null;
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; this.onstop?.(); }
    });
    vi.stubGlobal('AudioContext', class { close = close; decodeAudioData = async () => { expect(stop).toHaveBeenCalled(); throw new Error('Invalid audio'); }; });
    const cb = callbacks(); const session = await startLocalRecognition('en', cb, new AbortController().signal);
    session.stop();
    await vi.waitFor(() => expect(cb.error).toHaveBeenCalledWith('Invalid audio'));
    expect(close).toHaveBeenCalledOnce(); expect(cb.end).toHaveBeenCalledOnce();
  });
});
