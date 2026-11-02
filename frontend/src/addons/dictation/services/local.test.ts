import { afterEach, describe, expect, it, vi } from 'vitest';
import { startLocalRecognition, disposeLocalRecognition } from './local';
const callbacks = () => ({ result: vi.fn(), interim: vi.fn(), error: vi.fn(), end: vi.fn() });
afterEach(() => { disposeLocalRecognition(); vi.unstubAllGlobals(); vi.useRealTimers(); });
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

function localEnvironment() {
  const stopTrack = vi.fn();
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: stopTrack }] }) } });
  vi.stubGlobal('MediaRecorder', class {
    state = 'inactive'; mimeType = 'audio/webm'; onstop: (() => void) | null = null;
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.onstop?.(); }
  });
  vi.stubGlobal('AudioContext', class {
    close = vi.fn().mockResolvedValue(undefined);
    decodeAudioData = async () => ({ length: 2, numberOfChannels: 1, getChannelData: () => new Float32Array(2) });
  });
  const workers: Array<{ onmessage: ((event: { data: unknown }) => void) | null; onerror: (() => void) | null; terminate: ReturnType<typeof vi.fn>; postMessage: ReturnType<typeof vi.fn> }> = [];
  vi.stubGlobal('Worker', class {
    onmessage = null; onerror = null;
    terminate = vi.fn(); postMessage = vi.fn();
    constructor() { workers.push(this); }
  });
  return workers;
}

it('reuses the loaded worker for successive phrases and releases it on close', async () => {
  const workers = localEnvironment();
  for (const phrase of ['first phrase', 'second phrase']) {
    const cb = callbacks(); const abort = new AbortController();
    const session = await startLocalRecognition('en', cb, abort.signal);
    session.stop();
    await vi.waitFor(() => expect(workers[0]?.postMessage).toHaveBeenCalled());
    const worker = workers[0];
    const id = worker.postMessage.mock.lastCall![0].id;
    worker.onmessage!({ data: { id: 'stale', kind: 'result', text: 'wrong phrase' } });
    expect(cb.result).not.toHaveBeenCalled();
    worker.onmessage!({ data: { id, kind: 'result', text: phrase } });
    expect(cb.result).toHaveBeenCalledExactlyOnceWith(phrase);
    expect(cb.end).toHaveBeenCalledOnce();
    abort.abort(); session.cancel();
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.postMessage.mockClear();
  }
  expect(workers).toHaveLength(1);
  disposeLocalRecognition(); expect(workers[0].terminate).toHaveBeenCalledOnce();
});

it('terminates cancelled inference and ignores the old worker result', async () => {
  const workers = localEnvironment();
  const cb = callbacks(); const abort = new AbortController();
  const session = await startLocalRecognition('en', cb, abort.signal);
  session.stop();
  await vi.waitFor(() => expect(workers[0]?.postMessage).toHaveBeenCalled());
  const oldHandler = workers[0].onmessage!;
  const id = workers[0].postMessage.mock.lastCall![0].id;
  abort.abort();
  expect(workers[0].terminate).toHaveBeenCalledOnce();
  oldHandler({ data: { id, kind: 'result', text: 'too late' } });
  expect(cb.result).not.toHaveBeenCalled();
});
