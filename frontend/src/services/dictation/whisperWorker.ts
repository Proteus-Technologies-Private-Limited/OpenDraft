/// <reference lib="webworker" />
import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import ortWasmUrl from '../../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm?url';
declare const self: DedicatedWorkerGlobalScope;
env.allowLocalModels = false;
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = { wasm: new URL(ortWasmUrl, self.location.href).href };
  env.backends.onnx.wasm.numThreads = 1;
}
// No audio leaves the worker. Only model assets are fetched, on explicit start.
let recognizer: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
const createRecognizer = pipeline as (task: 'automatic-speech-recognition', model: string, options: Record<string, unknown>) => Promise<AutomaticSpeechRecognitionPipeline>;
self.onmessage = async (event: MessageEvent<{ audio: Float32Array; language: string }>) => {
  try {
    recognizer ??= createRecognizer('automatic-speech-recognition', 'onnx-community/whisper-tiny', {
      device: 'wasm', dtype: 'q8',
      progress_callback: (p: { progress?: number }) => {
        if ('progress' in p) self.postMessage({ kind: 'progress', progress: p.progress });
      },
    });
    const model = await recognizer;
    const result = await model(event.data.audio, { language: event.data.language, task: 'transcribe' });
    const output = Array.isArray(result) ? result[0] : result;
    self.postMessage({ kind: 'result', text: output.text });
  } catch (error) {
    recognizer = null;
    self.postMessage({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
