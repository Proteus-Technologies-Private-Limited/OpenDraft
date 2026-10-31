import type { RecognitionCallbacks, RecognitionSession } from './recognition';

/** A bounded push-to-talk clip. Cancel also cancels a pending permission prompt. */
export async function startLocalRecognition(language: string, callbacks: RecognitionCallbacks, signal: AbortSignal): Promise<RecognitionSession> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw new Error('Microphone recording is unavailable. Use HTTPS or localhost and check microphone permissions.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  if (signal.aborted) { stream.getTracks().forEach(t => t.stop()); throw new DOMException('Cancelled', 'AbortError'); }
  let cancelled = false;
  let worker: Worker | null = null;
  const timer: { value?: ReturnType<typeof setTimeout> } = {};
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let recorder: MediaRecorder;
  try { recorder = new MediaRecorder(stream); }
  catch (error) { stream.getTracks().forEach(t => t.stop()); throw error; }
  const chunks: Blob[] = [];
  const release = () => { clearTimeout(timer.value); stream.getTracks().forEach(t => t.stop()); };
  const finish = () => {
    if (timeout) clearTimeout(timeout);
    worker?.terminate(); worker = null;
    signal.removeEventListener('abort', cancel);
  };
  const cancel = () => {
    cancelled = true;
    if (recorder.state !== 'inactive') recorder.stop();
    release(); finish();
  };
  signal.addEventListener('abort', cancel, { once: true });
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  recorder.onerror = () => { cancel(); callbacks.error('Microphone recording failed.'); callbacks.end(); };
  recorder.onstop = async () => {
    release();
    if (cancelled) return;
    callbacks.interim('Preparing audio and loading the local model…');
    let context: AudioContext | null = null;
    try {
      context = new AudioContext({ sampleRate: 16000 });
      const buffer = await context.decodeAudioData(await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer());
      const audio = new Float32Array(buffer.length);
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const channel = buffer.getChannelData(c);
        for (let i = 0; i < audio.length; i++) audio[i] += channel[i] / buffer.numberOfChannels;
      }
      if (cancelled) return;
      worker = new Worker(new URL('./whisperWorker.ts', import.meta.url), { type: 'module' });
      timeout = setTimeout(() => {
        if (cancelled) return;
        cancel(); callbacks.error('Local recognition timed out. Try a shorter recording or check the model download connection.'); callbacks.end();
      }, 180_000);
      worker.onmessage = (event) => {
        if (cancelled) return;
        const data = event.data;
        if (data.kind === 'progress') callbacks.interim(`Downloading model assets: ${Math.round(data.progress)}%`);
        if (data.kind === 'result') { finish(); callbacks.result(data.text); callbacks.end(); }
        if (data.kind === 'error') { finish(); callbacks.error(data.message); callbacks.end(); }
      };
      worker.onerror = () => { if (!cancelled) { finish(); callbacks.error('The local speech worker failed.'); callbacks.end(); } };
      worker.postMessage({ audio, language }, [audio.buffer]);
    } catch (error) {
      if (!cancelled) { finish(); callbacks.error(error instanceof Error ? error.message : String(error)); callbacks.end(); }
    } finally { await context?.close(); }
  };
  try { recorder.start(); }
  catch (error) { cancel(); throw error; }
  timer.value = setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, 30_000);
  return { stop: () => { if (recorder.state !== 'inactive') recorder.stop(); }, cancel };
}
