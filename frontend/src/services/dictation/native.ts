import { invoke } from '@tauri-apps/api/core';
import type { RecognitionCallbacks, RecognitionSession } from './recognition';

export async function startNativeRecognition(language: string, callbacks: RecognitionCallbacks, signal: AbortSignal): Promise<RecognitionSession> {
  const id = crypto.randomUUID();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let live = true;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (!live) return;
    live = false; clearTimeout(timer); clearTimeout(deadline);
    signal.removeEventListener('abort', cancel);
    void invoke('dictation_native_stop', { id }).catch(() => {});
  };
  const cancel = () => stop();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    await invoke('dictation_native_start', { id, language });
    if (signal.aborted) {
      // The start IPC can finish after the earlier cancellation IPC.
      await invoke('dictation_native_stop', { id }).catch(() => {});
      stop(); throw new DOMException('Cancelled', 'AbortError');
    }
    const poll = async () => {
      if (!live) return;
      try {
        const events = await invoke<Array<{ id: string; kind: string; text?: string; message?: string }>>('dictation_native_poll', { id });
        if (!live) return;
        for (const event of events) {
          if (event.id !== id) continue;
          if (event.kind === 'interim') callbacks.interim(event.text ?? '');
          if (event.kind === 'result') callbacks.result(event.text ?? '');
          if (event.kind === 'error') callbacks.error(event.message ?? 'Device recognition failed.');
          if (event.kind === 'end' || event.kind === 'error') { stop(); callbacks.end(); return; }
        }
        timer = setTimeout(() => void poll(), 200);
      } catch (error) { if (live) { stop(); callbacks.error(String(error)); callbacks.end(); } }
    };
    deadline = setTimeout(() => { if (live) { stop(); callbacks.error('Device recognition timed out. Please try again.'); callbacks.end(); } }, 60_000);
    void poll();
    return { stop: () => { stop(); callbacks.end(); }, cancel };
  } catch (error) { stop(); throw error; }
}
