/// <reference lib="webworker" />
/**
 * Kokoro text-to-speech, run entirely inside this device (issue #131).
 *
 * A Web Worker, so generating a line — a second or more of number-crunching
 * per sentence on the CPU — never freezes the editor. The model (about 90 MB,
 * 8-bit quantised) downloads from Hugging Face on first use and the browser
 * caches it; the text being spoken is never sent anywhere.
 *
 * The ONNX runtime's WebAssembly engine (about 21 MB) ships with the app as
 * an asset beside this worker rather than coming from a CDN: the desktop
 * app's content security policy only runs what the app shipped, and Kokoro
 * then works offline once its model is cached.
 *
 * Messages in:  { type: 'load' } | { type: 'generate', id, text, voice, speed }
 * Messages out: { type: 'progress', file, loaded, total }
 *               { type: 'ready', voices } | { type: 'audio', id, wav }
 *               { type: 'error', id?, message }
 */
import { env } from '@huggingface/transformers';
import { KokoroTTS } from 'kokoro-js';
import { encodeWav16 } from './wav';
// The engine, emitted by Vite as a hashed asset. Named explicitly so the
// runtime can never fall back to fetching it from a CDN.
import ortWasmUrl from '../../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm?url';

declare const self: DedicatedWorkerGlobalScope;

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

try {
  const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number } };
  if (onnx.wasm) {
    onnx.wasm.wasmPaths = { wasm: new URL(ortWasmUrl, self.location.href).href };
    // Threads need a cross-origin-isolated page, which OpenDraft is not.
    onnx.wasm.numThreads = 1;
  }
} catch (err) {
  console.warn('[kokoro] could not configure the ONNX runtime path:', err);
}

let model: Promise<KokoroTTS> | null = null;
/** Where the model runs: the GPU when the device offers WebGPU, the CPU otherwise. */
let device: 'webgpu' | 'wasm' = 'wasm';
/** Lines are generated one at a time; the model is not re-entrant. */
let queue: Promise<unknown> = Promise.resolve();

type Precision = 'fp32' | 'fp16' | 'q8';

function fromPretrained(dev: 'webgpu' | 'wasm', dtype: Precision): Promise<KokoroTTS> {
  return KokoroTTS.from_pretrained(MODEL_ID, {
    dtype,
    device: dev,
    progress_callback: (p: { status?: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status === 'progress' && p.file) {
        self.postMessage({ type: 'progress', file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0 });
      }
    },
  } as Parameters<typeof KokoroTTS.from_pretrained>[1]);
}

/**
 * What the GPU can do: nothing (no WebGPU here), full precision only, or
 * half precision too. Half precision is the same speed in testing and half
 * the download (about 165 MB rather than 330), which matters most on phones.
 */
async function gpuSupport(): Promise<'none' | 'fp32' | 'fp16'> {
  try {
    const gpu = (self.navigator as Navigator & {
      gpu?: { requestAdapter(): Promise<{ features: { has(f: string): boolean } } | null> };
    }).gpu;
    const adapter = gpu ? await gpu.requestAdapter() : null;
    if (!adapter) return 'none';
    return adapter.features.has('shader-f16') ? 'fp16' : 'fp32';
  } catch {
    return 'none';
  }
}

function load(prefer?: { device?: 'webgpu' | 'wasm'; dtype?: Precision }): Promise<KokoroTTS> {
  if (!model) {
    model = (async () => {
      const support = await gpuSupport();
      const wantGpu = prefer?.device ? prefer.device === 'webgpu' : support !== 'none';
      if (wantGpu) {
        try {
          device = 'webgpu';
          return await fromPretrained('webgpu', prefer?.dtype ?? (support === 'fp16' ? 'fp16' : 'fp32'));
        } catch (err) {
          console.warn('[kokoro] WebGPU failed; falling back to the CPU:', err);
        }
      }
      device = 'wasm';
      return fromPretrained('wasm', prefer?.dtype && !wantGpu ? prefer.dtype : 'q8');
    })();
    // A failed download must not stick: the next attempt starts over.
    model.catch(() => { model = null; });
  }
  return model;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

self.onmessage = (ev: MessageEvent) => {
  const msg = ev.data as {
    type: string; id?: number; text?: string; voice?: string; speed?: number;
    device?: 'webgpu' | 'wasm'; dtype?: Precision;
  };
  if (msg.type === 'load') {
    load({ device: msg.device, dtype: msg.dtype })
      .then((tts) => {
        const voices = Object.entries(tts.voices as Record<string, {
          name: string; language: string; gender: string; overallGrade: string;
        }>).map(([id, v]) => ({ id, name: v.name, language: v.language, gender: v.gender, grade: v.overallGrade }));
        self.postMessage({ type: 'ready', voices, device });
      })
      .catch((err) => {
        console.error('[kokoro] model failed to load:', err);
        self.postMessage({ type: 'error', message: `The Kokoro voice model could not be loaded: ${message(err)}` });
      });
    return;
  }
  if (msg.type === 'generate') {
    const { id, text = '', voice, speed = 1 } = msg;
    queue = queue.then(async () => {
      try {
        const tts = await load();
        const audio = await tts.generate(text, { voice: voice as never, speed });
        const wav = encodeWav16(audio.audio, audio.sampling_rate);
        self.postMessage({ type: 'audio', id, wav }, [wav]);
      } catch (err) {
        console.error('[kokoro] generation failed:', err);
        self.postMessage({ type: 'error', id, message: `Kokoro could not speak this line: ${message(err)}` });
      }
    });
  }
};
