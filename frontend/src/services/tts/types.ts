/**
 * Shared shapes for Table Read (issue #131).
 *
 * Every way OpenDraft can speak — the web view's own speech synthesis, the
 * platform's text-to-speech reached through Tauri, or an AI voice provider —
 * sits behind {@link TtsEngine}, so the player that walks the script never
 * needs to know which one it is talking to.
 */

/** Which family an engine belongs to; also which slot of a CharacterVoice it reads. */
export type EngineKind = 'system' | 'ai';

export interface VoiceInfo {
  /** Stable id the engine accepts back in {@link SpeakOptions.voiceId}. */
  id: string;
  /** What the writer sees in a voice list. */
  name: string;
  /** BCP-47 tag where the engine reports one ('' when it does not). */
  lang: string;
  /** 'female' | 'male' where the engine says; used only to suggest voices. */
  gender?: 'female' | 'male';
  /** Free-form extra shown next to the name (accent, quality, "network"). */
  detail?: string;
  /** A sound effect rather than a reading voice (macOS's Bubbles, Zarvox …): never cast automatically. */
  novelty?: boolean;
}

export interface SpeakOptions {
  voiceId: string | null;
  /** 1 = the engine's normal speed. Clamped by each engine to what it supports. */
  rate: number;
  /** 1 = the voice's normal pitch. Ignored by engines that cannot change it. */
  pitch: number;
  /**
   * How to deliver the line ("under her breath; short, clipped sentences"),
   * for engines that take a delivery instruction (Gemini). Never spoken.
   */
  style?: string;
  /** Aborting stops the audio and resolves the speak() promise. */
  signal: AbortSignal;
  /**
   * The word now being spoken, as a [start, end) range into the text that was
   * passed to speak(). Engines without word events estimate it from elapsed
   * time, which is why ranges can arrive a little early or late — never out
   * of order.
   */
  onWord?: (start: number, end: number) => void;
  /** Audio has actually started (after any network fetch). */
  onStart?: () => void;
}

export interface TtsEngine {
  readonly kind: EngineKind;
  /** Short id: 'web-speech' | 'native' | 'openai' | 'elevenlabs'. */
  readonly id: string;
  /** Human label for the engine, shown in the Table Read panel. */
  readonly label: string;
  listVoices(): Promise<VoiceInfo[]>;
  /**
   * Speak `text` and resolve when it has been spoken, or as soon as `signal`
   * aborts. Rejects with a readable Error when the engine fails.
   */
  speak(text: string, opts: SpeakOptions): Promise<void>;
  /**
   * Optional warm-up for the text that comes next, so the next line can start
   * without a network round trip. Engines that synthesise locally omit it.
   */
  prefetch?(text: string, opts: Omit<SpeakOptions, 'signal' | 'onWord' | 'onStart'>): void;
  /**
   * Called synchronously inside the click that starts a read. Engines that
   * play fetched audio use it to unlock playback in Safari and iOS, which only
   * allow audio a user gesture started.
   */
  prime?(): void;
  /** Drop any prefetched audio and stop anything in flight. */
  dispose?(): void;
}

/** Raised for problems the writer has to act on (no voices, no key). */
export class TtsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TtsUnavailableError';
  }
}
