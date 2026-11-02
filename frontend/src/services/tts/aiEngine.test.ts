import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
// Kokoro pulls in a worker; nothing here reaches it.
vi.mock('./kokoroClient', () => ({ kokoroGenerate: vi.fn(), kokoroVoices: vi.fn() }));

import { AiEngine, parseServerVoices, unframeSpeechServerResponse } from './aiEngine';

/** What tts_speech_server_request answers: status, Content-Type length, Content-Type, body. */
function framed(status: number, contentType: string, body: Uint8Array | string): ArrayBuffer {
  const ct = new TextEncoder().encode(contentType);
  const b = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const out = new Uint8Array(4 + ct.length + b.length);
  const view = new DataView(out.buffer);
  view.setUint16(0, status);
  view.setUint16(2, ct.length);
  out.set(ct, 4);
  out.set(b, 4 + ct.length);
  return out.buffer;
}

const compatible = {
  aiProvider: 'openai-compatible' as const,
  apiKeys: {},
  openaiModel: 'tts-1',
  elevenlabsModel: '',
  geminiModel: '',
  azureRegion: '',
  // As a writer may well type it.
  compatibleBaseUrl: 'http://127.0.0.1:3900/v1/',
  compatibleModel: 'tts-1',
  compatibleVoices: '',
};

function stubWindow(tauri: boolean) {
  const win: Record<string, unknown> = {};
  if (tauri) win.__TAURI_INTERNALS__ = {};
  vi.stubGlobal('window', win);
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh)', maxTouchPoints: 0 });
  vi.stubGlobal('URL', Object.assign(globalThis.URL, { createObjectURL: () => 'blob:clip' }));
}

// Braces matter: whatever a beforeEach returns, Vitest calls as its cleanup.
beforeEach(() => { invoke.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

describe('unframeSpeechServerResponse', () => {
  it('reads the status, content type and body', async () => {
    const res = unframeSpeechServerResponse(framed(200, 'audio/mpeg', new Uint8Array([1, 2, 3])));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('accepts the bytes as a plain array too', async () => {
    const res = unframeSpeechServerResponse(Array.from(new Uint8Array(framed(403, 'application/json', '{"a":1}'))));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ a: 1 });
  });

  it('gives a 204 no body', () => {
    expect(unframeSpeechServerResponse(framed(204, '', '')).body).toBeNull();
  });

  it('rejects a truncated answer', () => {
    expect(() => unframeSpeechServerResponse(new Uint8Array([0, 200]))).toThrow(/nothing readable/);
  });
});

describe('parseServerVoices', () => {
  it('shows a cloned voice by its name and keeps its id for the server', () => {
    expect(parseServerVoices([
      { voice_id: '395cafef', id: '395cafef', name: 'My Voice' },
      { voice_id: 'alloy', name: 'Alloy' },
      'af_bella',
      { name: 'Only A Name' },
      null,
      42,
      { id: '' },
    ])).toEqual([
      { id: '395cafef', name: 'My Voice' },
      { id: 'alloy', name: 'Alloy' },
      { id: 'af_bella', name: 'af_bella' },
      { id: 'Only A Name', name: 'Only A Name' },
    ]);
  });

  it('takes nothing from something that is not a list', () => {
    expect(parseServerVoices({ voices: [] })).toEqual([]);
    expect(parseServerVoices(undefined)).toEqual([]);
  });
});

describe('a speech server of the writer\'s own', () => {
  it('in the app, is asked by the app itself, at the address less its trailing slash', async () => {
    stubWindow(true);
    invoke.mockImplementation(async (_cmd: string, args: { url: string }) => (
      args.url.endsWith('/audio/voices')
        ? framed(200, 'application/json', JSON.stringify({ voices: [{ id: '395cafef', name: 'My Voice' }] }))
        : framed(200, 'audio/mpeg', new Uint8Array([9, 9, 9]))
    ));
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const engine = new AiEngine(compatible);
    const voices = await engine.listVoices();
    expect(voices).toEqual([{ id: 'openai-compatible:395cafef', name: 'My Voice', lang: '' }]);

    await (engine as unknown as { synthesise(t: string, v: string): Promise<unknown> })
      .synthesise('In my voice.', 'openai-compatible:395cafef');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith('tts_speech_server_request', expect.objectContaining({
      url: 'http://127.0.0.1:3900/v1/audio/voices', method: 'GET',
    }));
    const speech = invoke.mock.calls.find((c) => (c[1] as { url: string }).url.endsWith('/audio/speech'))![1] as {
      url: string; method: string; headers: Record<string, string>; body: string;
    };
    expect(speech.url).toBe('http://127.0.0.1:3900/v1/audio/speech');
    expect(speech.method).toBe('POST');
    expect(speech.headers['content-type']).toBe('application/json');
    expect(JSON.parse(speech.body)).toEqual({ model: 'tts-1', voice: '395cafef', input: 'In my voice.', response_format: 'mp3' });
  });

  it('in a browser, is still fetched by the page', async () => {
    stubWindow(false);
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ voices: ['af_bella'] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const voices = await new AiEngine(compatible).listVoices();
    expect(voices.map((v) => v.name)).toEqual(['af_bella']);
    expect(fetchSpy).toHaveBeenCalledWith('http://127.0.0.1:3900/v1/audio/voices', expect.anything());
    expect(invoke).not.toHaveBeenCalled();
  });

  it('says a 403 refused the request, not that the key is wrong, when the key is not the reason', async () => {
    stubWindow(true);
    invoke.mockResolvedValue(framed(403, 'application/json', JSON.stringify({
      detail: 'Request refused: it came from another website.',
    })));
    const engine = new AiEngine(compatible) as unknown as { synthesise(t: string, v: string): Promise<unknown> };
    await expect(engine.synthesise('Hello.', 'openai-compatible:alloy'))
      .rejects.toThrow('The speech server refused the request: Request refused: it came from another website.');
  });

  it('names the cause when the app could not reach the server', async () => {
    stubWindow(true);
    invoke.mockRejectedValue('error sending request: could not establish a connection: Connection refused (os error 61)');
    const engine = new AiEngine(compatible) as unknown as { synthesise(t: string, v: string): Promise<unknown> };
    await expect(engine.synthesise('Hello.', 'openai-compatible:alloy'))
      .rejects.toThrow(/Could not reach the speech server at http:\/\/127\.0\.0\.1:3900 \(.*Connection refused.*\)\. Check that it is running/);
  });

  it('waits out a busy server (429) and tries the line again', async () => {
    stubWindow(true);
    vi.useFakeTimers();
    try {
      const busy = framed(429, 'application/json', JSON.stringify({ detail: 'the local GPU worker pool is saturated' }));
      invoke
        .mockResolvedValueOnce(busy)
        .mockResolvedValueOnce(busy)
        .mockResolvedValueOnce(framed(200, 'audio/mpeg', new Uint8Array([7])));
      const engine = new AiEngine(compatible) as unknown as { synthesise(t: string, v: string): Promise<{ url: string }> };
      const pending = engine.synthesise('Hello.', 'openai-compatible:alloy');
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(pending).resolves.toEqual({ url: 'blob:clip' });
      expect(invoke).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up on a server that stays busy, and says why', async () => {
    stubWindow(true);
    vi.useFakeTimers();
    try {
      invoke.mockResolvedValue(framed(429, 'application/json', JSON.stringify({ detail: 'pool is saturated' })));
      const engine = new AiEngine(compatible) as unknown as { synthesise(t: string, v: string): Promise<unknown> };
      const pending = engine.synthesise('Hello.', 'openai-compatible:alloy');
      const settled = expect(pending).rejects.toThrow(/pool is saturated/);
      await vi.advanceTimersByTimeAsync(60_000);
      await settled;
      expect(invoke).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry a cloud provider\'s 429, which is a quota', async () => {
    stubWindow(false);
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 }));
    vi.stubGlobal('fetch', fetchSpy);
    const engine = new AiEngine({ ...compatible, aiProvider: 'openai', apiKeys: { openai: 'sk-test' } }) as unknown as {
      synthesise(t: string, v: string): Promise<unknown>;
    };
    await expect(engine.synthesise('Hello.', 'openai:alloy')).rejects.toThrow(/rate limit or quota/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('stops waiting the moment the read is stopped', async () => {
    stubWindow(true);
    invoke.mockReturnValue(new Promise(() => undefined));
    const ctrl = new AbortController();
    const engine = new AiEngine(compatible) as unknown as {
      synthesise(t: string, v: string, s?: string, signal?: AbortSignal): Promise<unknown>;
    };
    const pending = engine.synthesise('Hello.', 'openai-compatible:alloy', undefined, ctrl.signal);
    ctrl.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
