/**
 * The voices installed on the writer's machine, through the web view's own
 * speech synthesis (`window.speechSynthesis`).
 *
 * This is how the desktop app reaches system voices on macOS (WKWebView →
 * AVSpeechSynthesizer), Windows (WebView2 → the Windows voices) and iOS.
 * Linux's WebKitGTK and Android's WebView ship without it — those platforms
 * go through nativeEngine instead.
 *
 * Three web-speech quirks are handled here:
 *  - getVoices() is empty until the `voiceschanged` event on first use;
 *  - Chrome silently stops an utterance after about fifteen seconds, so long
 *    lines are spoken a sentence at a time;
 *  - an utterance whose only reference is the queue can be garbage collected
 *    mid-sentence, taking its `end` event with it, so each one is held until
 *    it finishes.
 */
import type { SpeakOptions, TtsEngine, VoiceInfo } from './types';
import { estimateDurationMs, WordClock } from './wordClock';
import { isNoveltyVoice, voiceGender } from './voiceTraits';

const VOICE_WAIT_MS = 2500;
const MAX_CHUNK = 220;

export function hasWebSpeech(): boolean {
  return typeof window !== 'undefined'
    && 'speechSynthesis' in window
    && typeof (window as unknown as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance === 'function';
}

/** Installed voices, waiting briefly for the list to load on first use. */
async function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!hasWebSpeech()) return [];
  const synth = window.speechSynthesis;
  const now = synth.getVoices();
  if (now.length) return now;
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      synth.removeEventListener?.('voiceschanged', finish);
      resolve(synth.getVoices());
    };
    synth.addEventListener?.('voiceschanged', finish);
    setTimeout(finish, VOICE_WAIT_MS);
  });
}

/** Split into sentence-sized chunks, remembering where each starts. */
export function chunkText(text: string, max = MAX_CHUNK): { text: string; offset: number }[] {
  const out: { text: string; offset: number }[] = [];
  const re = /[^.!?…]+[.!?…]+["'”’)\]]*\s*|[^.!?…]+$/g;
  let m: RegExpExecArray | null;
  let pending = '';
  let pendingStart = 0;
  const flush = () => {
    if (pending.trim()) out.push({ text: pending, offset: pendingStart });
    pending = '';
  };
  while ((m = re.exec(text)) !== null) {
    if (!m[0]) { re.lastIndex++; continue; }
    let sentence = m[0];
    let start = m.index;
    // A single sentence longer than the limit is cut at the last space before it.
    while (sentence.length > max) {
      flush();
      const cut = sentence.lastIndexOf(' ', max) > 0 ? sentence.lastIndexOf(' ', max) + 1 : max;
      out.push({ text: sentence.slice(0, cut), offset: start });
      sentence = sentence.slice(cut);
      start += cut;
    }
    if (pending && pending.length + sentence.length > max) flush();
    if (!pending) pendingStart = start;
    pending += sentence;
  }
  flush();
  return out.length ? out : [{ text, offset: 0 }];
}

export class WebSpeechEngine implements TtsEngine {
  readonly kind = 'system' as const;
  readonly id = 'web-speech';
  readonly label = 'System voices';
  private voices: SpeechSynthesisVoice[] = [];
  /** Held so the browser cannot collect an utterance before its end event. */
  private live: SpeechSynthesisUtterance | null = null;

  async listVoices(): Promise<VoiceInfo[]> {
    this.voices = await loadVoices();
    const seen = new Set<string>();
    const out: VoiceInfo[] = [];
    // The platform default first: it is the voice the writer chose for their
    // system, and the natural narrator.
    const ordered = [...this.voices].sort((a, b) => Number(b.default) - Number(a.default));
    for (const v of ordered) {
      const id = v.voiceURI || v.name;
      if (seen.has(id)) continue;
      seen.add(id);
      const novelty = isNoveltyVoice(v.name);
      out.push({
        id,
        name: v.name,
        lang: v.lang || '',
        gender: voiceGender(v.name),
        detail: novelty ? 'novelty' : v.localService === false ? 'online' : undefined,
        novelty,
      });
    }
    return out;
  }

  private findVoice(id: string | null): SpeechSynthesisVoice | null {
    if (!id) return null;
    return this.voices.find((v) => (v.voiceURI || v.name) === id)
      ?? this.voices.find((v) => v.name === id)
      ?? null;
  }

  async speak(text: string, opts: SpeakOptions): Promise<void> {
    if (!hasWebSpeech()) throw new Error('Speech synthesis is not available in this window.');
    if (!this.voices.length) this.voices = await loadVoices();
    const synth = window.speechSynthesis;
    const voice = this.findVoice(opts.voiceId);
    const chunks = chunkText(text);
    let started = false;

    for (const chunk of chunks) {
      if (opts.signal.aborted) return;
      await new Promise<void>((resolve, reject) => {
        const u = new SpeechSynthesisUtterance(chunk.text);
        if (voice) {
          u.voice = voice;
          u.lang = voice.lang;
        }
        u.rate = Math.min(4, Math.max(0.3, opts.rate));
        u.pitch = Math.min(2, Math.max(0, opts.pitch));
        this.live = u;

        // Estimated words until the voice proves it reports its own.
        let realBoundaries = false;
        const clock = new WordClock(chunk.text, (s, e) => opts.onWord?.(chunk.offset + s, chunk.offset + e));
        const expected = estimateDurationMs(chunk.text, u.rate);
        let startedAt = 0;
        let ticker: ReturnType<typeof setInterval> | null = null;
        let watchdog: ReturnType<typeof setTimeout> | null = null;

        const cleanup = () => {
          if (ticker) clearInterval(ticker);
          if (watchdog) clearTimeout(watchdog);
          opts.signal.removeEventListener('abort', onAbort);
          if (this.live === u) this.live = null;
        };
        const onAbort = () => {
          cleanup();
          synth.cancel();
          resolve();
        };
        opts.signal.addEventListener('abort', onAbort);

        u.onstart = () => {
          startedAt = performance.now();
          if (!started) {
            started = true;
            opts.onStart?.();
          }
          ticker = setInterval(() => {
            if (!realBoundaries) clock.update((performance.now() - startedAt) / expected);
          }, 80);
        };
        u.onboundary = (ev: SpeechSynthesisEvent) => {
          if (ev.name && ev.name !== 'word') return;
          realBoundaries = true;
          const start = ev.charIndex ?? 0;
          // Safari leaves charLength undefined; find the end of the word.
          const len = ev.charLength || (/^\S+/.exec(chunk.text.slice(start))?.[0].length ?? 1);
          opts.onWord?.(chunk.offset + start, chunk.offset + start + len);
        };
        u.onend = () => {
          cleanup();
          resolve();
        };
        u.onerror = (ev: SpeechSynthesisErrorEvent) => {
          cleanup();
          // cancel() reports itself as an error; that is a stop, not a failure.
          if (opts.signal.aborted || ev.error === 'interrupted' || ev.error === 'canceled') {
            resolve();
            return;
          }
          reject(new Error(`The voice could not speak this line (${ev.error || 'unknown error'}).`));
        };

        // Some engines never fire `end` on a long utterance. Give up waiting
        // well after it should have finished, rather than hang the read.
        watchdog = setTimeout(() => {
          console.warn('[tableRead] web speech never finished an utterance; moving on');
          cleanup();
          synth.cancel();
          resolve();
        }, expected * 3 + 8000);

        try {
          // A paused synthesiser (from another tab, or a stop mid-word in
          // Safari) queues silently forever.
          if (synth.paused) synth.resume();
          synth.speak(u);
        } catch (err) {
          cleanup();
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    }
  }

  dispose(): void {
    if (hasWebSpeech()) window.speechSynthesis.cancel();
    this.live = null;
  }
}
