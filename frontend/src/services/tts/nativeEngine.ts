/**
 * The platform's own text-to-speech, reached through Tauri, for the web views
 * that have no `speechSynthesis`:
 *
 *  - Android's WebView never implemented it; the app speaks through
 *    android.speech.tts.TextToSpeech (MainActivity.kt), which also reports
 *    the word being spoken.
 *  - Linux's WebKitGTK is usually built without it; the app speaks through
 *    speech-dispatcher (`spd-say`) or eSpeak NG, whichever is installed. Neither
 *    reports words, so the word clock estimates them.
 *  - macOS can fall back to `say` if its web view ever comes up without voices.
 *
 * Speaking is started by one command and followed by polling for events, so a
 * long line never holds an IPC call open and Stop is always answered at once.
 */
import type { SpeakOptions, TtsEngine, VoiceInfo } from './types';
import { estimateDurationMs, WordClock } from './wordClock';
import { isNoveltyVoice, voiceGender } from './voiceTraits';

interface NativeVoice {
  id: string;
  name: string;
  lang: string;
  gender?: string | null;
  detail?: string | null;
}

interface NativeEvent {
  id: number;
  /** 'start' | 'word' | 'done' | 'error' */
  kind: string;
  start?: number;
  end?: number;
  message?: string | null;
}

const POLL_MS = 60;
/** Android's engine binds asynchronously; give it this long to come up. */
const READY_WAIT_MS = 6000;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let nextUtteranceId = 1;

export class NativeEngine implements TtsEngine {
  readonly kind = 'system' as const;
  readonly id = 'native';
  readonly label = 'System voices';

  async listVoices(): Promise<VoiceInfo[]> {
    const deadline = Date.now() + READY_WAIT_MS;
    for (;;) {
      // null = the engine is still starting (Android binds its TTS service in
      // the background on first use).
      const voices = await invoke<NativeVoice[] | null>('tts_native_voices');
      if (voices) {
        return voices.map((v) => {
          const novelty = isNoveltyVoice(v.name);
          return {
            id: v.id,
            name: v.name,
            lang: v.lang || '',
            gender: v.gender === 'female' || v.gender === 'male' ? v.gender : voiceGender(v.name),
            detail: novelty ? 'novelty' : v.detail || undefined,
            novelty,
          };
        });
      }
      if (Date.now() > deadline) throw new Error('The system speech engine did not start in time.');
      await sleep(250);
    }
  }

  async speak(text: string, opts: SpeakOptions): Promise<void> {
    if (opts.signal.aborted) return;
    const id = nextUtteranceId++;
    // Drop anything left over from an earlier utterance.
    await invoke<NativeEvent[]>('tts_native_poll').catch(() => []);
    await invoke('tts_native_speak', {
      id,
      text,
      voice: opts.voiceId,
      rate: opts.rate,
      pitch: opts.pitch,
    });

    const clock = new WordClock(text, opts.onWord);
    const expected = estimateDurationMs(text, opts.rate);
    let startedAt = 0;
    let realWords = false;
    const giveUpAt = Date.now() + expected * 3 + 15000;

    for (;;) {
      if (opts.signal.aborted) {
        await invoke('tts_native_stop').catch((err) => console.warn('[tableRead] native stop failed:', err));
        return;
      }
      let events: NativeEvent[] = [];
      try {
        events = await invoke<NativeEvent[]>('tts_native_poll');
      } catch (err) {
        throw new Error(`The system speech engine stopped responding: ${err instanceof Error ? err.message : String(err)}`);
      }
      for (const ev of events) {
        if (ev.id !== id) continue;
        if (ev.kind === 'start' && !startedAt) {
          startedAt = performance.now();
          opts.onStart?.();
        } else if (ev.kind === 'word' && typeof ev.start === 'number' && typeof ev.end === 'number') {
          realWords = true;
          opts.onWord?.(ev.start, ev.end);
        } else if (ev.kind === 'done') {
          return;
        } else if (ev.kind === 'error') {
          throw new Error(ev.message || 'The system voice could not speak this line.');
        }
      }
      if (startedAt && !realWords) clock.update((performance.now() - startedAt) / expected);
      if (Date.now() > giveUpAt) {
        console.warn('[tableRead] native speech never reported finishing; moving on');
        await invoke('tts_native_stop').catch(() => undefined);
        return;
      }
      await sleep(POLL_MS);
    }
  }

  dispose(): void {
    void invoke('tts_native_stop').catch(() => undefined);
  }
}
