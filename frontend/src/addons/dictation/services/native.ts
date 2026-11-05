import { invoke } from '@tauri-apps/api/core';
import { t } from '../../../i18n';
import type { RecognitionCallbacks, RecognitionSession } from './recognition';

export async function startNativeRecognition(language: string, callbacks: RecognitionCallbacks, signal: AbortSignal): Promise<RecognitionSession> {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  const id = crypto.randomUUID();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let live = true;
  let stopping = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (!live) return;
    live = false; clearTimeout(timer); clearTimeout(deadline);
    signal.removeEventListener('abort', cancel);
    void invoke('dictation_native_cancel', { id }).catch(() => {});
  };
  const fail = (message: string) => {
    if (!live) return;
    cancel(); callbacks.error(message); callbacks.end();
  };
  // Stop releases the microphone, but keeps polling for the recognizer's final result.
  const stop = () => {
    if (!live || stopping) return;
    stopping = true;
    clearTimeout(deadline);
    deadline = setTimeout(() => fail(t('addons:dictation.error.deviceNotFinished')), 10_000);
    void invoke('dictation_native_stop', { id }).catch(error => fail(String(error)));
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    await invoke('dictation_native_start', { id, language });
    if (signal.aborted) {
      // The start IPC can finish after the earlier cancellation IPC.
      await invoke('dictation_native_cancel', { id }).catch(() => {});
      throw new DOMException('Cancelled', 'AbortError');
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
          if (event.kind === 'notice') callbacks.notice?.(event.message ?? '');
          if (event.kind === 'error') { fail(event.message ?? t('addons:dictation.error.deviceFailed')); return; }
          if (event.kind === 'end') { cancel(); callbacks.end(); return; }
        }
        timer = setTimeout(() => void poll(), 200);
      } catch (error) { fail(String(error)); }
    };
    deadline = setTimeout(() => fail(t('addons:dictation.error.deviceTimeout')), 60_000);
    void poll();
    return { stop, cancel };
  } catch (error) { cancel(); throw error; }
}
