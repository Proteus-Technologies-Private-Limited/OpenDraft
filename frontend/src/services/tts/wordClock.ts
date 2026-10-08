/**
 * Estimated word timing, for voices that do not say which word they are on.
 *
 * An AI provider returns finished audio, and Linux's speech-dispatcher only
 * reports when an utterance starts and ends. Given how far through the audio
 * playback is, the word clock picks the word that should be sounding, weighting
 * each word by its length and the pause its punctuation earns. It drifts on a
 * long sentence, but never moves backwards and always lands on the last word.
 */
import { wordRanges } from './script';

export class WordClock {
  private readonly words: { start: number; end: number; at: number }[];
  private current = -1;
  private readonly onWord?: (start: number, end: number) => void;

  constructor(text: string, onWord?: (start: number, end: number) => void) {
    this.onWord = onWord;
    const ranges = wordRanges(text);
    const total = ranges.reduce((sum, w) => sum + w.weight, 0) || 1;
    let acc = 0;
    this.words = ranges.map((w) => {
      const at = acc / total;
      acc += w.weight;
      return { start: w.start, end: w.end, at };
    });
  }

  /** Move to the word at `fraction` (0–1) of the way through. */
  update(fraction: number): void {
    if (!this.onWord || !this.words.length) return;
    const f = Math.min(1, Math.max(0, fraction));
    let idx = this.current < 0 ? 0 : this.current;
    while (idx + 1 < this.words.length && this.words[idx + 1].at <= f) idx++;
    if (idx !== this.current) {
      this.current = idx;
      const w = this.words[idx];
      this.onWord(w.start, w.end);
    }
  }
}

/** Rough reading time of `text` at `rate` 1 ≈ 165 words a minute, for engines with no clock of their own. */
export function estimateDurationMs(text: string, rate: number): number {
  const chars = text.replace(/\s+/g, ' ').trim().length;
  const charsPerSecond = 14.5 * Math.max(0.25, rate);
  return Math.max(400, (chars / charsPerSecond) * 1000);
}
