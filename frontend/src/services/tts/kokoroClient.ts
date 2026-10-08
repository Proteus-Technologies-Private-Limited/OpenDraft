/**
 * The page's side of the Kokoro worker (see kokoroWorker.ts): one worker per
 * page, created on first use, with the model's download progress published
 * so the Table Read panel can show it.
 */
import type { VoiceInfo } from './types';

interface KokoroVoice {
  id: string;
  name: string;
  language: string;
  gender: string;
  grade: string;
}

export interface KokoroProgress {
  /** 0–1 across every file the model needs, or null when not downloading. */
  fraction: number | null;
  /** Where the model runs once loaded: the graphics chip or the CPU. */
  device: 'webgpu' | 'wasm' | null;
  /** Lines being generated right now. */
  busy: number;
}

/** A line taking longer than this is treated as stuck. */
const GENERATE_TIMEOUT_MS = 120_000;

let worker: Worker | null = null;
let ready: Promise<VoiceInfo[]> | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (wav: ArrayBuffer) => void; reject: (err: Error) => void }>();
const fileProgress = new Map<string, { loaded: number; total: number }>();
const listeners = new Set<(p: KokoroProgress) => void>();
let progress: KokoroProgress = { fraction: null, device: null, busy: 0 };

function publish(patch: Partial<KokoroProgress>) {
  const p = { ...progress, ...patch };
  progress = p;
  for (const fn of listeners) fn(p);
}

/** Follow the model download; returns an unsubscribe function. */
export function onKokoroProgress(fn: (p: KokoroProgress) => void): () => void {
  listeners.add(fn);
  fn(progress);
  return () => { listeners.delete(fn); };
}

/** Voice grades from the model card; better voices are offered first. */
const GRADE_ORDER = ['A', 'A-', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F+', 'F'];

function toVoiceInfo(v: KokoroVoice): VoiceInfo {
  const accent = v.language === 'en-gb' ? 'British' : v.language === 'en-us' ? 'American' : v.language;
  const g = v.gender.toLowerCase();
  return {
    id: `kokoro:${v.id}`,
    name: v.name,
    lang: v.language,
    gender: g === 'female' || g === 'male' ? g : undefined,
    detail: [accent, v.grade ? `grade ${v.grade}` : ''].filter(Boolean).join(', '),
  };
}

function spawn(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./kokoroWorker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (ev: MessageEvent) => {
    const msg = ev.data as {
      type: string; id?: number; wav?: ArrayBuffer; message?: string;
      file?: string; loaded?: number; total?: number;
    };
    if (msg.type === 'progress' && msg.file) {
      fileProgress.set(msg.file, { loaded: msg.loaded ?? 0, total: msg.total ?? 0 });
      let loaded = 0;
      let total = 0;
      for (const f of fileProgress.values()) { loaded += f.loaded; total += f.total; }
      publish({ fraction: total > 0 ? Math.min(1, loaded / total) : null });
    } else if (msg.type === 'audio' && msg.id !== undefined && msg.wav) {
      pending.get(msg.id)?.resolve(msg.wav);
      pending.delete(msg.id);
    } else if (msg.type === 'error' && msg.id !== undefined) {
      pending.get(msg.id)?.reject(new Error(msg.message || 'Kokoro failed.'));
      pending.delete(msg.id);
    }
  };
  w.onerror = (ev) => {
    console.error('[kokoro] worker crashed:', ev.message);
    const err = new Error(`The Kokoro voice engine stopped: ${ev.message || 'unknown error'}`);
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    worker?.terminate();
    worker = null;
    ready = null;
    publish({ fraction: null, device: null, busy: 0 });
  };
  worker = w;
  return w;
}

/** Load the model (downloading it the first time) and list its voices. */
export function kokoroVoices(): Promise<VoiceInfo[]> {
  if (!ready) {
    ready = new Promise<VoiceInfo[]>((resolve, reject) => {
      const w = spawn();
      const onMessage = (ev: MessageEvent) => {
        const msg = ev.data as { type: string; id?: number; voices?: KokoroVoice[]; message?: string; device?: 'webgpu' | 'wasm' };
        if (msg.type === 'ready') {
          w.removeEventListener('message', onMessage);
          console.info(`[kokoro] model ready on ${msg.device === 'webgpu' ? 'the GPU (WebGPU)' : 'the CPU (WebAssembly)'}`);
          publish({ fraction: null, device: msg.device ?? null });
          const voices = (msg.voices || [])
            .sort((a, b) => GRADE_ORDER.indexOf(a.grade) - GRADE_ORDER.indexOf(b.grade) || a.name.localeCompare(b.name))
            .map(toVoiceInfo);
          resolve(voices);
        } else if (msg.type === 'error' && msg.id === undefined) {
          w.removeEventListener('message', onMessage);
          publish({ fraction: null });
          reject(new Error(msg.message || 'The Kokoro voice model could not be loaded.'));
        }
      };
      w.addEventListener('message', onMessage);
      w.postMessage({ type: 'load' });
    });
    ready.catch(() => { ready = null; });
  }
  return ready;
}

/** Speak `text` in Kokoro voice `voice` (bare id, e.g. 'af_heart'); resolves to WAV bytes. */
export async function kokoroGenerate(text: string, voice: string): Promise<ArrayBuffer> {
  await kokoroVoices();
  const w = spawn();
  const id = nextId++;
  publish({ busy: progress.busy + 1 });
  try {
    return await new Promise<ArrayBuffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(
          `Kokoro took more than ${GENERATE_TIMEOUT_MS / 60000} minutes to speak one line on this device's `
          + `${progress.device === 'webgpu' ? 'graphics chip' : 'processor'}. Try installed or another AI voice.`,
        ));
      }, GENERATE_TIMEOUT_MS);
      pending.set(id, {
        resolve: (wav) => { clearTimeout(timer); resolve(wav); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });
      // Speed is applied at playback, like every other AI voice, so a speed
      // change never regenerates audio.
      w.postMessage({ type: 'generate', id, text, voice, speed: 1 });
    });
  } finally {
    publish({ busy: Math.max(0, progress.busy - 1) });
  }
}
