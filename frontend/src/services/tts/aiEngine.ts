/**
 * AI voices for Table Read: Kokoro running on this device, or a provider —
 * Google Gemini, OpenAI, ElevenLabs, Microsoft Azure Speech, or any server
 * that speaks OpenAI's `/audio/speech` API (Kokoro-FastAPI, LocalAI …).
 *
 * Requests go straight from the writer's browser or app to the provider with
 * the writer's own key — OpenDraft's servers are never in the path. Kokoro
 * sends nothing anywhere: it runs in a worker on this device.
 *
 * Each line is fetched as finished audio. The next line is fetched while the
 * current one plays, so a read does not pause for the network between lines.
 * ElevenLabs returns per-character timings, which drive the word highlight
 * exactly; for the others the word clock estimates it from playback progress.
 */
import type { AiProviderId, VoiceSettingsState } from '../../stores/voiceSettingsStore';
import type { SpeakOptions, TtsEngine, VoiceInfo } from './types';
import { TtsUnavailableError } from './types';
import { WordClock, estimateDurationMs } from './wordClock';
import { wordRanges } from './script';
import { kokoroGenerate, kokoroVoices } from './kokoroClient';
import { isTauri } from '../platform';
import { t } from '../../i18n';

type ProviderConfig = Pick<VoiceSettingsState,
  | 'aiProvider' | 'apiKeys' | 'openaiModel' | 'elevenlabsModel' | 'geminiModel' | 'azureRegion'
  | 'compatibleBaseUrl' | 'compatibleModel' | 'compatibleVoices'>;

const OPENAI_BASE = 'https://api.openai.com/v1';
const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** Gemini's 30 prebuilt voices: Google's one-word character for each, and the gender it reads as. */
const GEMINI_VOICES: [string, string, 'female' | 'male'][] = [
  ['Zephyr', 'Bright', 'female'], ['Puck', 'Upbeat', 'male'], ['Charon', 'Informative', 'male'],
  ['Kore', 'Firm', 'female'], ['Fenrir', 'Excitable', 'male'], ['Leda', 'Youthful', 'female'],
  ['Orus', 'Firm', 'male'], ['Aoede', 'Breezy', 'female'], ['Callirrhoe', 'Easy-going', 'female'],
  ['Autonoe', 'Bright', 'female'], ['Enceladus', 'Breathy', 'male'], ['Iapetus', 'Clear', 'male'],
  ['Umbriel', 'Easy-going', 'male'], ['Algieba', 'Smooth', 'male'], ['Despina', 'Smooth', 'female'],
  ['Erinome', 'Clear', 'female'], ['Algenib', 'Gravelly', 'male'], ['Rasalgethi', 'Informative', 'male'],
  ['Laomedeia', 'Upbeat', 'female'], ['Achernar', 'Soft', 'female'], ['Alnilam', 'Firm', 'male'],
  ['Schedar', 'Even', 'male'], ['Gacrux', 'Mature', 'female'], ['Pulcherrima', 'Forward', 'female'],
  ['Achird', 'Friendly', 'male'], ['Zubenelgenubi', 'Casual', 'male'], ['Vindemiatrix', 'Gentle', 'female'],
  ['Sadachbia', 'Lively', 'male'], ['Sadaltager', 'Knowledgeable', 'male'], ['Sulafat', 'Warm', 'female'],
];

const PROVIDER_NAMES: Record<AiProviderId, string> = {
  kokoro: 'Kokoro',
  gemini: 'Gemini',
  openai: 'OpenAI',
  elevenlabs: 'ElevenLabs',
  azure: 'Azure Speech',
  'openai-compatible': 'the speech server',
};

function escapeXml(text: string): string {
  return text.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string));
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** OpenAI's built-in voices, with the gender they read as, for automatic casting. */
const OPENAI_VOICES: { id: string; gender?: 'female' | 'male'; detail?: string }[] = [
  { id: 'alloy' },
  { id: 'ash', gender: 'male' },
  { id: 'ballad', gender: 'male' },
  { id: 'coral', gender: 'female' },
  { id: 'echo', gender: 'male' },
  { id: 'fable', gender: 'male', detail: 'British' },
  { id: 'nova', gender: 'female' },
  { id: 'onyx', gender: 'male' },
  { id: 'sage', gender: 'female' },
  { id: 'shimmer', gender: 'female' },
  { id: 'verse', gender: 'male' },
];
/** Voices tts-1 and tts-1-hd do not have. */
const NEWER_OPENAI_VOICES = new Set(['ballad', 'verse']);

/** A 44-byte silent WAV, played inside the click that starts a read so Safari lets later audio play. */
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';

const CACHE_LIMIT = 8;

/**
 * One audio element for every AI engine. Safari unlocks playback per element,
 * so the element unlocked by the click that started a read has to be the one
 * that plays it — even when the engine is created after that click.
 */
let sharedAudio: HTMLAudioElement | null = null;

function audioElement(): HTMLAudioElement {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.preload = 'auto';
  }
  return sharedAudio;
}

/**
 * Web Audio, for lines that start while the page is hidden. Chrome will not
 * load a new source into an audio element in a background tab until the tab
 * is shown again, so a read carried on in the background would stop at the
 * end of the line in progress. An AudioContext keeps playing there.
 */
let sharedContext: AudioContext | null = null;

function audioContext(): AudioContext | null {
  try {
    if (!sharedContext) {
      const Ctor = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      sharedContext = new Ctor();
    }
    return sharedContext;
  } catch (err) {
    console.warn('[tableRead] Web Audio is unavailable:', err);
    return null;
  }
}

/** Call synchronously inside a click: lets Safari and iOS play audio that arrives later. */
export function primeAudioPlayback(): void {
  try {
    const a = audioElement();
    if (!(a.src && !a.paused)) {
      a.src = SILENT_WAV;
      void a.play().catch(() => undefined);
    }
  } catch { /* nothing to unlock */ }
  // The context has to be started by a gesture too, for when it is needed later.
  const ctx = audioContext();
  if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
}

interface Clip {
  url: string;
  /** Word start times in seconds, when the provider reports them. */
  words?: { start: number; end: number; t: number }[];
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The voices a speech server lists at `/audio/voices`: plain names
 * (Kokoro-FastAPI), or objects with an id and a display name. VoiceStudio's
 * cloned voices have ids like `395cafef`, so the name is what the writer sees,
 * and the id is what goes back to the server.
 */
export function parseServerVoices(voices: unknown): { id: string; name: string }[] {
  if (!Array.isArray(voices)) return [];
  const out: { id: string; name: string }[] = [];
  for (const v of voices) {
    if (typeof v === 'string') {
      if (v) out.push({ id: v, name: v });
      continue;
    }
    if (!v || typeof v !== 'object') continue;
    const o = v as { id?: unknown; voice_id?: unknown; name?: unknown };
    const id = [o.id, o.voice_id, o.name].find((x): x is string => typeof x === 'string' && !!x);
    if (!id) continue;
    out.push({ id, name: typeof o.name === 'string' && o.name ? o.name : id });
  }
  return out;
}

/** `openai:alloy` → `alloy`; ids from another provider are not ours to use. */
function bareVoice(provider: AiProviderId, id: string | null): string | null {
  if (!id) return null;
  const prefix = `${provider}:`;
  return id.startsWith(prefix) ? id.slice(prefix.length) : null;
}

async function describeHttpError(res: Response, name: string): Promise<string> {
  const provider = capitalise(name);
  let detail = '';
  try {
    const body = await res.text();
    try {
      const json = JSON.parse(body);
      detail = json?.error?.message || json?.detail?.message || json?.detail || json?.message || '';
      if (typeof detail !== 'string') detail = JSON.stringify(detail);
      // Gemini answers a bad key with 400 rather than 401.
      if (res.status === 400 && /api key/i.test(detail)) {
        return `${provider} rejected the API key: ${detail} Check it in Settings → Table Read Voices.`;
      }
    } catch {
      detail = body.slice(0, 200);
    }
  } catch { /* body unreadable */ }
  // 403 is not always about the key: a local server refuses requests from an
  // origin it does not know with 403 too, and calling that a bad key sends
  // the writer looking in the wrong place.
  if (res.status === 401 || (res.status === 403 && /key|token|auth|credential|permission/i.test(detail))) {
    return `${provider} rejected the API key${detail ? `: ${detail}` : '.'} Check it in Settings → Table Read Voices.`;
  }
  if (res.status === 403) return `${provider} refused the request${detail ? `: ${detail}` : ' (403).'}`;
  if (res.status === 429) return `${provider} says the account is over its rate limit or quota${detail ? `: ${detail}` : '.'}`;
  return `${provider} returned an error (${res.status})${detail ? `: ${detail}` : '.'}`;
}

/**
 * Turn what `tts_speech_server_request` answers — status (u16 BE), length of
 * the Content-Type (u16 BE), the Content-Type, then the body — into a Response.
 */
export function unframeSpeechServerResponse(raw: ArrayBuffer | Uint8Array | number[]): Response {
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw as ArrayBuffer);
  if (bytes.length < 4) throw new Error(t('messages:tts.unreadable'));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const status = view.getUint16(0);
  const ctLen = view.getUint16(2);
  if (4 + ctLen > bytes.length) throw new Error(t('messages:tts.unreadable'));
  const contentType = new TextDecoder().decode(bytes.subarray(4, 4 + ctLen));
  // A Response refuses a body for these, and refuses a status outside 200–599.
  const body = status === 204 || status === 205 || status === 304 ? null : bytes.slice(4 + ctLen);
  return new Response(body, {
    status: status >= 200 && status <= 599 ? status : 502,
    headers: contentType ? { 'Content-Type': contentType } : {},
  });
}

/** How often, and how long, a busy speech server of the writer's own is waited for. */
const COMPATIBLE_BUSY_RETRIES = 3;
const COMPATIBLE_BUSY_WAIT_MS = 5000;

/** Resolves after `ms`, or rejects with an AbortError the moment the signal fires. */
function waitFor(ms: number, signal?: AbortSignal | null): Promise<void> {
  return abortable(new Promise<void>((resolve) => { setTimeout(resolve, ms); }), signal);
}

/** Rejects with an AbortError as soon as the signal fires, whatever the call is doing. */
function abortable<T>(call: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return call;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('The read was stopped.', 'AbortError'));
    if (signal.aborted) { onAbort(); return; }
    signal.addEventListener('abort', onAbort, { once: true });
    call.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * A request to the writer's own speech server, made by the app rather than its
 * web view. In the app the page's origin is `tauri://localhost` on macOS and
 * iOS, and a local server may refuse a POST from an origin it does not
 * recognise — VoiceStudio does, with no setting to allow it. The app sends
 * the request the way any local client would, without one (see tts.rs).
 */
async function fetchFromApp(url: string, init: RequestInit): Promise<Response> {
  const { invoke } = await import('@tauri-apps/api/core');
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((value, name) => { headers[name] = value; });
  const raw = await abortable(invoke<ArrayBuffer | number[]>('tts_speech_server_request', {
    url,
    method: init.method || 'GET',
    headers,
    body: typeof init.body === 'string' ? init.body : undefined,
  }), init.signal);
  return unframeSpeechServerResponse(raw);
}

/**
 * fetch() with a message that says what to check when the request never got an
 * answer. `fromApp` sends it from the app instead of the web view (Tauri only).
 */
async function request(url: string, init: RequestInit, provider: string, fromApp = false): Promise<Response> {
  try {
    return fromApp ? await fetchFromApp(url, init) : await fetch(url, init);
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    console.error(`[tableRead] ${provider} request failed:`, err);
    let origin = url;
    try { origin = new URL(url).origin; } catch { /* keep the address as typed */ }
    if (fromApp) {
      throw new Error(
        `Could not reach ${provider} at ${origin}${typeof err === 'string' && err ? ` (${err})` : ''}. ` +
        'Check that it is running and that the server address is right.',
      );
    }
    throw new Error(
      `Could not reach ${provider} at ${origin}. Check the network connection` +
      (provider === 'the speech server' ? ', the server address, and that the server allows requests from this page (CORS).' : '.'),
    );
  }
}

export class AiEngine implements TtsEngine {
  readonly kind = 'ai' as const;
  readonly id: string;
  readonly label: string;
  private readonly provider: AiProviderId;
  private readonly cache = new Map<string, Promise<Clip>>();
  private voiceList: VoiceInfo[] | null = null;

  private readonly cfg: ProviderConfig;

  constructor(cfg: ProviderConfig) {
    this.cfg = cfg;
    if (!cfg.aiProvider) throw new TtsUnavailableError(t('messages:tts.noProvider'));
    this.provider = cfg.aiProvider;
    this.id = cfg.aiProvider;
    this.label = cfg.aiProvider === 'openai-compatible' ? 'AI voices' : `${PROVIDER_NAMES[cfg.aiProvider]} voices`;
  }

  private get providerName(): string {
    return PROVIDER_NAMES[this.provider];
  }

  /** Locale of each Azure voice, which its SSML has to name. */
  private azureLocales = new Map<string, string>();

  private get azureHost(): string {
    return `https://${encodeURIComponent(this.cfg.azureRegion)}.tts.speech.microsoft.com`;
  }

  private get key(): string {
    return this.cfg.apiKeys[this.provider] || '';
  }

  /** The server address as typed, less any trailing slash. */
  private get compatibleBase(): string {
    return this.cfg.compatibleBaseUrl.trim().replace(/\/+$/, '');
  }

  /** The writer's own server is asked from the app itself, never from its web view. */
  private get fromApp(): boolean {
    return this.provider === 'openai-compatible' && isTauri();
  }

  prime(): void {
    primeAudioPlayback();
  }

  async listVoices(): Promise<VoiceInfo[]> {
    if (this.voiceList) return this.voiceList;
    const p = this.provider;
    let list: VoiceInfo[];
    if (p === 'openai') {
      const older = this.cfg.openaiModel.startsWith('tts-1');
      list = OPENAI_VOICES
        .filter((v) => !(older && NEWER_OPENAI_VOICES.has(v.id)))
        .map((v) => ({ id: `openai:${v.id}`, name: capitalise(v.id), lang: '', gender: v.gender, detail: v.detail }));
    } else if (p === 'elevenlabs') {
      list = await this.elevenLabsVoices();
    } else if (p === 'gemini') {
      if (!this.key) throw new TtsUnavailableError(t('messages:tts.needGeminiKey'));
      list = GEMINI_VOICES.map(([name, character, gender]) => ({ id: `gemini:${name}`, name, lang: '', gender, detail: character }));
    } else if (p === 'azure') {
      list = await this.azureVoices();
    } else if (p === 'kokoro') {
      list = await kokoroVoices();
    } else {
      list = await this.compatibleVoices();
    }
    if (!list.length) throw new TtsUnavailableError(`${capitalise(this.providerName)} has no voices to offer.`);
    this.voiceList = list;
    return list;
  }

  private async elevenLabsVoices(): Promise<VoiceInfo[]> {
    if (!this.key) throw new TtsUnavailableError(t('messages:tts.needElevenLabsKey'));
    const res = await request(`${ELEVENLABS_BASE}/voices`, { headers: { 'xi-api-key': this.key } }, 'ElevenLabs');
    if (!res.ok) throw new Error(await describeHttpError(res, 'ElevenLabs'));
    const json = await res.json() as { voices?: { voice_id: string; name: string; labels?: Record<string, string> }[] };
    return (json.voices || []).map((v) => {
      const g = (v.labels?.gender || '').toLowerCase();
      const detail = [v.labels?.accent, v.labels?.age, v.labels?.description].filter(Boolean).join(', ');
      return {
        id: `elevenlabs:${v.voice_id}`,
        name: v.name,
        lang: '',
        gender: g === 'female' || g === 'male' ? g : undefined,
        detail: detail || undefined,
      };
    });
  }

  private async azureVoices(): Promise<VoiceInfo[]> {
    if (!this.key || !this.cfg.azureRegion) {
      throw new TtsUnavailableError(t('messages:tts.needAzureKey'));
    }
    const res = await request(`${this.azureHost}/cognitiveservices/voices/list`, {
      headers: { 'Ocp-Apim-Subscription-Key': this.key },
    }, 'Azure Speech');
    if (!res.ok) throw new Error(await describeHttpError(res, 'Azure Speech'));
    const json = await res.json() as {
      ShortName: string; DisplayName?: string; LocalName?: string; Locale: string;
      Gender?: string; LocaleName?: string; VoiceType?: string; Status?: string;
    }[];
    return json
      .filter((v) => v.ShortName && v.Status !== 'Deprecated')
      .map((v) => {
        this.azureLocales.set(v.ShortName, v.Locale);
        const g = (v.Gender || '').toLowerCase();
        return {
          id: `azure:${v.ShortName}`,
          name: v.DisplayName || v.LocalName || v.ShortName,
          lang: v.Locale || '',
          gender: g === 'female' || g === 'male' ? g : undefined,
          detail: [v.LocaleName, /multilingual/i.test(v.ShortName) ? 'multilingual' : ''].filter(Boolean).join(', ') || undefined,
        } as VoiceInfo;
      });
  }

  private async compatibleVoices(): Promise<VoiceInfo[]> {
    const typed = this.cfg.compatibleVoices.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    const toInfo = (id: string, name: string = id): VoiceInfo => ({ id: `openai-compatible:${id}`, name, lang: '' });
    if (typed.length) return typed.map((id) => toInfo(id));
    // Kokoro-FastAPI and several others list their voices here; servers that
    // do not are offered OpenAI's names, which most of them accept.
    try {
      const res = await request(`${this.compatibleBase}/audio/voices`, {
        headers: this.key ? { Authorization: `Bearer ${this.key}` } : {},
      }, this.providerName, this.fromApp);
      if (res.ok) {
        const json = await res.json() as { voices?: unknown[] };
        const voices = parseServerVoices(json.voices);
        if (voices.length) return voices.map((v) => toInfo(v.id, v.name));
      }
    } catch (err) {
      console.info('[tableRead] speech server does not list voices; offering the standard names', err);
    }
    return OPENAI_VOICES.map((v) => ({ id: `openai-compatible:${v.id}`, name: capitalise(v.id), lang: '', gender: v.gender }));
  }

  private cacheKey(text: string, voice: string, style?: string): string {
    // Only Gemini takes a delivery note; for the rest it must not split the cache.
    return `${voice}\u0000${this.provider === 'gemini' ? style ?? '' : ''}\u0000${text}`;
  }

  private async defaultVoice(): Promise<string> {
    const list = await this.listVoices();
    return list[0].id;
  }

  private fetchClip(text: string, voiceId: string, style?: string, signal?: AbortSignal): Promise<Clip> {
    const key = this.cacheKey(text, voiceId, style);
    const hit = this.cache.get(key);
    if (hit) return hit;
    const job = this.synthesise(text, voiceId, style, signal);
    this.cache.set(key, job);
    // A failed fetch must not poison the cache for a retry.
    job.catch(() => this.cache.delete(key));
    while (this.cache.size > CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value as string;
      const old = this.cache.get(oldest);
      this.cache.delete(oldest);
      old?.then((c) => URL.revokeObjectURL(c.url)).catch(() => undefined);
    }
    return job;
  }

  private async synthesise(text: string, voiceId: string, style?: string, signal?: AbortSignal): Promise<Clip> {
    const p = this.provider;
    if (p === 'kokoro') {
      const voice = bareVoice(p, voiceId);
      if (!voice) throw new Error(t('messages:tts.noKokoroVoice'));
      const wav = await kokoroGenerate(text, voice);
      return { url: URL.createObjectURL(new Blob([wav], { type: 'audio/wav' })) };
    }
    if (p === 'gemini') {
      const voice = bareVoice(p, voiceId);
      if (!voice) throw new Error(t('messages:tts.noGeminiVoice'));
      const content: Record<string, unknown> = { type: 'text', text };
      // A delivery note goes in speech_metadata, never into the text — a
      // prefix like "Say quietly:" would be read aloud.
      if (style) content.annotations = [{ type: 'speech_metadata', style }];
      const res = await request(`${GEMINI_BASE}/interactions`, {
        method: 'POST',
        headers: { 'x-goog-api-key': this.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.cfg.geminiModel,
          input: [{ type: 'user_input', content: [content] }],
          response_format: { type: 'audio' },
          generation_config: { speech_config: [{ voice }] },
        }),
        signal,
      }, 'Gemini');
      if (!res.ok) throw new Error(await describeHttpError(res, 'Gemini'));
      const json = await res.json() as {
        steps?: { type?: string; content?: { type?: string; data?: string; mime_type?: string }[] }[];
      };
      const audio = (json.steps || [])
        .filter((st) => st.type === 'model_output')
        .flatMap((st) => st.content || [])
        .filter((c) => c.type === 'audio' && c.data)
        .pop();
      if (!audio?.data) {
        console.error('[tableRead] Gemini response had no audio:', JSON.stringify(json).slice(0, 500));
        throw new Error(t('messages:tts.geminiNoAudio'));
      }
      return { url: URL.createObjectURL(new Blob([base64ToBytes(audio.data)], { type: audio.mime_type || 'audio/wav' })) };
    }
    if (p === 'azure') {
      const voice = bareVoice(p, voiceId);
      if (!voice) throw new Error(t('messages:tts.noAzureVoice'));
      if (!this.azureLocales.size) await this.listVoices();
      const locale = this.azureLocales.get(voice) || 'en-US';
      const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}">`
        + `<voice name="${escapeXml(voice)}">${escapeXml(text)}</voice></speak>`;
      const res = await request(`${this.azureHost}/cognitiveservices/v1`, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': this.key,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3',
        },
        body: ssml,
        signal,
      }, 'Azure Speech');
      if (!res.ok) throw new Error(await describeHttpError(res, 'Azure Speech'));
      const blob = await res.blob();
      if (!blob.size) throw new Error(t('messages:tts.azureNoAudio'));
      return { url: URL.createObjectURL(new Blob([blob], { type: 'audio/mpeg' })) };
    }
    if (p === 'elevenlabs') {
      const voice = bareVoice(p, voiceId);
      if (!voice) throw new Error(t('messages:tts.noElevenLabsVoice'));
      const res = await request(`${ELEVENLABS_BASE}/text-to-speech/${encodeURIComponent(voice)}/with-timestamps`, {
        method: 'POST',
        headers: { 'xi-api-key': this.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model_id: this.cfg.elevenlabsModel }),
        signal,
      }, 'ElevenLabs');
      if (!res.ok) throw new Error(await describeHttpError(res, 'ElevenLabs'));
      const json = await res.json() as {
        audio_base64: string;
        alignment?: { characters: string[]; character_start_times_seconds: number[] };
      };
      const bytes = Uint8Array.from(atob(json.audio_base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
      let words: Clip['words'];
      const al = json.alignment;
      if (al && al.characters?.length === text.length) {
        words = wordRanges(text).map((w) => ({ start: w.start, end: w.end, t: al.character_start_times_seconds[w.start] ?? 0 }));
      }
      return { url, words };
    }

    const base = p === 'openai' ? OPENAI_BASE : this.compatibleBase;
    const voice = bareVoice(p, voiceId);
    if (!voice) throw new Error(t('messages:tts.noVoice'));
    const model = p === 'openai' ? this.cfg.openaiModel : this.cfg.compatibleModel;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.key) headers.Authorization = `Bearer ${this.key}`;
    const send = () => request(`${base}/audio/speech`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, voice, input: text, response_format: 'mp3' }),
      signal,
    }, this.providerName, this.fromApp);
    let res = await send();
    // A server on the writer's own machine often has one worker, and Table Read
    // asks for the next line while this one plays — so it answers "busy, try
    // again in a few seconds" with 429 (VoiceStudio says exactly that). That is
    // not a quota; wait as asked and try again rather than fail the line.
    for (let attempt = 0; p === 'openai-compatible' && res.status === 429 && attempt < COMPATIBLE_BUSY_RETRIES; attempt++) {
      const after = Number(res.headers.get('Retry-After'));
      const ms = Number.isFinite(after) && after > 0 ? Math.min(after, 30) * 1000 : COMPATIBLE_BUSY_WAIT_MS;
      console.info(`[tableRead] the speech server is busy; trying the line again in ${ms / 1000}s`);
      await waitFor(ms, signal);
      res = await send();
    }
    if (!res.ok) throw new Error(await describeHttpError(res, this.providerName));
    const blob = await res.blob();
    if (!blob.size) throw new Error(`${capitalise(this.providerName)} returned no audio.`);
    return { url: URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: 'audio/mpeg' })) };
  }

  prefetch(text: string, opts: { voiceId: string | null; style?: string }): void {
    const run = async () => {
      const voice = opts.voiceId ?? await this.defaultVoice();
      await this.fetchClip(text, voice, opts.style);
    };
    run().catch((err) => console.info('[tableRead] prefetch failed; will retry when the line comes up:', err));
  }

  async speak(text: string, opts: SpeakOptions): Promise<void> {
    if (opts.signal.aborted) return;
    const voice = opts.voiceId ?? await this.defaultVoice();
    const clip = await this.fetchClip(text, voice, opts.style);
    if (opts.signal.aborted) return;

    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      const ctx = audioContext();
      if (ctx) return this.playInBackground(ctx, clip, text, opts);
    }

    const audio = audioElement();
    audio.src = clip.url;
    // The speed slider is applied at playback, so changing it never refetches.
    audio.playbackRate = Math.min(4, Math.max(0.25, opts.rate));
    (audio as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;

    const clock = new WordClock(text, opts.onWord);
    await new Promise<void>((resolve, reject) => {
      let raf = 0;
      let lastWord = -1;
      const tick = () => {
        const t = audio.currentTime;
        if (clip.words?.length) {
          let i = Math.max(0, lastWord);
          while (i + 1 < clip.words.length && clip.words[i + 1].t <= t) i++;
          if (i !== lastWord) {
            lastWord = i;
            opts.onWord?.(clip.words[i].start, clip.words[i].end);
          }
        } else {
          const d = Number.isFinite(audio.duration) && audio.duration > 0
            ? audio.duration
            : estimateDurationMs(text, 1) / 1000;
          clock.update(t / d);
        }
        raf = requestAnimationFrame(tick);
      };
      // Audio the element cannot decode can fail without any error event (a
      // format it does not support just never loads). Give up rather than
      // leave the read hanging on one line.
      const stall = setTimeout(() => {
        if (audio.currentTime > 0 || opts.signal.aborted) return;
        cleanup();
        audio.pause();
        reject(new Error(t('messages:tts.audioNoStart', { provider: this.providerName })));
      }, 15000);
      const cleanup = () => {
        clearTimeout(stall);
        cancelAnimationFrame(raf);
        audio.onended = null;
        audio.onerror = null;
        audio.onplaying = null;
        opts.signal.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        cleanup();
        audio.pause();
        resolve();
      };
      opts.signal.addEventListener('abort', onAbort);
      audio.onplaying = () => opts.onStart?.();
      audio.onended = () => {
        cleanup();
        resolve();
      };
      audio.onerror = () => {
        cleanup();
        reject(new Error(t('messages:tts.audioNoPlay', { provider: this.providerName })));
      };
      audio.play().then(() => {
        raf = requestAnimationFrame(tick);
      }).catch((err: Error) => {
        cleanup();
        if (opts.signal.aborted) { resolve(); return; }
        reject(new Error(
          err?.name === 'NotAllowedError'
            ? 'The browser blocked audio playback. Press Play again to start the read.'
            : `Could not play the audio: ${err?.message || err}`,
        ));
      });
    });
  }

  /**
   * Play a clip through Web Audio while the page is hidden (see audioContext).
   * Timers run at most once a second in a background tab, which is plenty for
   * a word highlight nobody is looking at.
   */
  private async playInBackground(ctx: AudioContext, clip: Clip, text: string, opts: SpeakOptions): Promise<void> {
    if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
    let buffer: AudioBuffer;
    try {
      const bytes = await (await fetch(clip.url)).arrayBuffer();
      buffer = await ctx.decodeAudioData(bytes);
    } catch (err) {
      throw new Error(t('messages:tts.audioNoDecode', { provider: this.providerName, message: err instanceof Error ? err.message : String(err) }));
    }
    if (opts.signal.aborted) return;
    const rate = Math.min(4, Math.max(0.25, opts.rate));
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    source.connect(ctx.destination);
    const clock = new WordClock(text, opts.onWord);
    await new Promise<void>((resolve) => {
      let lastWord = -1;
      const startedAt = ctx.currentTime;
      const tick = () => {
        const t = (ctx.currentTime - startedAt) * rate;
        if (clip.words?.length) {
          let i = Math.max(0, lastWord);
          while (i + 1 < clip.words.length && clip.words[i + 1].t <= t) i++;
          if (i !== lastWord) {
            lastWord = i;
            opts.onWord?.(clip.words[i].start, clip.words[i].end);
          }
        } else {
          clock.update(t / buffer.duration);
        }
      };
      const timer = setInterval(tick, 100);
      const finish = () => {
        clearInterval(timer);
        opts.signal.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = () => {
        try { source.stop(); } catch { /* already stopped */ }
        finish();
      };
      opts.signal.addEventListener('abort', onAbort);
      source.onended = finish;
      source.start();
      opts.onStart?.();
    });
  }

  dispose(): void {
    if (sharedAudio) {
      sharedAudio.pause();
      sharedAudio.removeAttribute('src');
    }
    for (const job of this.cache.values()) job.then((c) => URL.revokeObjectURL(c.url)).catch(() => undefined);
    this.cache.clear();
  }
}
