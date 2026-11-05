import type { RecognitionCallbacks, RecognitionSession } from './recognition';
import { localCaptureProblem } from '../capabilities';
import { permissionErrorMessage } from './permissionError';
import { t } from '../../../i18n';

let cachedWorker: Worker | null = null;
export function disposeLocalRecognition(): void {
  cachedWorker?.terminate();
  cachedWorker = null;
}

/** A bounded push-to-talk clip. Cancel also cancels a pending permission prompt. */
export async function startLocalRecognition(
  language: string,
  callbacks: RecognitionCallbacks,
  signal: AbortSignal,
): Promise<RecognitionSession> {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  const problem = localCaptureProblem();
  if (problem) throw new Error(problem);
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    const message = permissionErrorMessage(error);
    if (message) throw new Error(message);
    throw error;
  }
  if (signal.aborted) {
    stream.getTracks().forEach((t) => t.stop());
    throw new DOMException('Cancelled', 'AbortError');
  }
  let cancelled = false;
  let completed = false;
  const id = crypto.randomUUID();
  let worker: Worker | null = null;
  const timer: { value?: ReturnType<typeof setTimeout> } = {};
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream);
  } catch (error) {
    stream.getTracks().forEach((t) => t.stop());
    throw error;
  }
  const chunks: Blob[] = [];
  const release = () => {
    clearTimeout(timer.value);
    stream.getTracks().forEach((t) => t.stop());
  };
  const finish = () => {
    if (timeout) clearTimeout(timeout);
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
    }
    worker = null;
    completed = true;
    signal.removeEventListener('abort', cancel);
  };
  const cancel = () => {
    if (completed) return;
    cancelled = true;
    if (worker === cachedWorker) disposeLocalRecognition();
    if (recorder.state !== 'inactive') recorder.stop();
    release();
    finish();
  };
  signal.addEventListener('abort', cancel, { once: true });
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  recorder.onerror = () => {
    cancel();
    callbacks.error(t('addons:dictation.error.recordingFailed'));
    callbacks.end();
  };
  recorder.onstop = async () => {
    release();
    if (cancelled) return;
    callbacks.interim(t('addons:dictation.status.preparing'));
    let context: AudioContext | null = null;
    try {
      context = new AudioContext({ sampleRate: 16000 });
      const buffer = await context.decodeAudioData(
        await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer(),
      );
      const audio = new Float32Array(buffer.length);
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const channel = buffer.getChannelData(c);
        for (let i = 0; i < audio.length; i++) audio[i] += channel[i] / buffer.numberOfChannels;
      }
      if (cancelled) return;
      cachedWorker ??= new Worker(new URL('./whisperWorker.ts', import.meta.url), {
        type: 'module',
      });
      worker = cachedWorker;
      timeout = setTimeout(() => {
        if (cancelled) return;
        cancel();
        callbacks.error(t('addons:dictation.error.localTimeout'));
        callbacks.end();
      }, 180_000);
      worker.onmessage = (event) => {
        if (cancelled) return;
        const data = event.data;
        if (data.id !== id) return;
        if (data.kind === 'progress')
          callbacks.interim(t('addons:dictation.status.downloading', { percent: Math.round(data.progress) }));
        if (data.kind === 'result') {
          finish();
          callbacks.result(data.text);
          callbacks.end();
        }
        if (data.kind === 'error') {
          disposeLocalRecognition();
          finish();
          callbacks.error(data.message);
          callbacks.end();
        }
      };
      worker.onerror = () => {
        if (!cancelled) {
          disposeLocalRecognition();
          finish();
          callbacks.error(t('addons:dictation.error.workerFailed'));
          callbacks.end();
        }
      };
      worker.postMessage({ id, audio, language }, [audio.buffer]);
    } catch (error) {
      if (!cancelled) {
        finish();
        callbacks.error(error instanceof Error ? error.message : String(error));
        callbacks.end();
      }
    } finally {
      try {
        await context?.close();
      } catch (error) {
        console.warn('[dictation] could not close the audio context', error);
      }
    }
  };
  try {
    recorder.start();
  } catch (error) {
    cancel();
    throw error;
  }
  timer.value = setTimeout(() => {
    if (recorder.state !== 'inactive') recorder.stop();
  }, 30_000);
  return {
    stop: () => {
      if (recorder.state !== 'inactive') recorder.stop();
    },
    cancel,
  };
}
