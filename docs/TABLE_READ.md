# Table Read (issue #131)

Tools → Table Read reads the script aloud, a voice per character, with a live
preview of the line and word being spoken.

## Where the voices come from

| Platform | Engine | Word highlight |
|---|---|---|
| macOS, Windows, iOS app | Web view `speechSynthesis` (`webSpeechEngine.ts`) — the voices installed on the device | `boundary` events (estimated if a voice sends none) |
| Android app | `android.speech.tts.TextToSpeech` via `MainActivity.kt` → `tts.rs` | `onRangeStart` |
| Linux app | `spd-say` (speech-dispatcher), else `espeak-ng` / `espeak`, via `tts.rs` | estimated from elapsed time |
| Browser | The browser's `speechSynthesis` (the computer's installed voices, plus any online voices the browser adds) | `boundary` events, or estimated |
| Any, by choice | AI voices (`aiEngine.ts`): Kokoro on the device, Gemini, OpenAI, ElevenLabs, Azure Speech, or any OpenAI-compatible `/audio/speech` server | ElevenLabs: exact (`/with-timestamps`); others estimated from playback position |

The writer switches between **System voices** and **AI voices** on the panel
header or in Settings → Table Read Voices (`enginePreference`). `engines.ts`
resolves it: in the app, system voices by default — the web view's when it has
any, else the platform engine through Tauri. In a browser nothing is read until
the writer has chosen (`engineChosen`); until then `activeEngineKind()` is
`'ai'` with no provider, which opens `VoiceProviderDialog` to ask. A browser
without `speechSynthesis` is offered AI voices only.

Android's WebView has no `speechSynthesis`, and Linux's WebKitGTK usually ships
without it; that is why `tts.rs` exists. On Android, the manifest needs a
`<queries>` entry for `android.intent.action.TTS_SERVICE` (Android 11+ package
visibility) — CI's manifest patch and `test-script/patch-android-local.py` both
add it. The `tts*` companion methods are listed in `jni-keep-rules.pro`.

The native commands are poll-shaped (`tts_native_speak` starts a line,
`tts_native_poll` drains events, `tts_native_stop` cuts it off) so no IPC call
is held open for a whole sentence.

## AI providers

| Provider | Endpoint | Notes |
|---|---|---|
| Kokoro | none — `kokoroWorker.ts` runs `kokoro-js` in a Web Worker | Model from Hugging Face (`onnx-community/Kokoro-82M-v1.0-ONNX`), cached by the browser. WebGPU when an adapter exists (fp16 if `shader-f16`, else fp32), else WebAssembly q8. The ONNX runtime's `.wasm` ships as an app asset (CSP, offline). Output re-encoded to 16-bit PCM WAV (`wav.ts`) because its own float WAV does not play in Chrome. English only. |
| Gemini | `POST generativelanguage.googleapis.com/v1beta/interactions`, `x-goog-api-key` | 30 prebuilt voices. Delivery note in `speech_metadata.style` (parenthetical + profile Speech Pattern), never in the text. |
| Azure Speech | `https://<region>.tts.speech.microsoft.com/cognitiveservices/{voices/list,v1}`, `Ocp-Apim-Subscription-Key` | SSML request, MP3 out. Needs key + region. |
| OpenAI, ElevenLabs, OpenAI-compatible | as before | |

All of these accept direct browser requests (CORS checked). Lines are fetched
one ahead (two for remote providers); the current line is requested first so a
one-at-a-time engine (Kokoro) is never queued behind the prefetch.

**Confidentiality.** Every provider but Kokoro sends script text to a third
party. `ConfidentialityWarning` (VoiceProviderSettings.tsx) is shown in the
setup dialog and Settings, and the panel shows a warning strip while a remote
provider is active. Wording: may breach data security or confidentiality
obligations; OpenDraft does not guarantee confidentiality.

**Background tabs.** Chrome will not load a new source into an `<audio>`
element in a hidden tab, so a read carried on in the background used to stop
after the current line. When the page is hidden, AI audio plays through Web
Audio instead (`playInBackground`). A 15-second watchdog turns any clip that
never starts into a visible error instead of a silent hang.

## Pieces

- `services/tts/script.ts` — document → `ReadLine[]`: who reads each line, the
  written text, the *spoken* text (scene-heading abbreviations expanded, capitalised
  names title-cased), and a character map from spoken text back to document
  positions so the word being said can be highlighted where it was written.
- `services/tts/voiceAssign.ts` — casting: a voice chosen on the profile wins;
  everyone else gets a distinct voice, in the writer's language, matching the
  profile's gender where the voice's gender is known (`voiceTraits.ts`).
  Novelty voices (Bubbles, Zarvox…) are never cast automatically.
- `services/tts/player.ts` — the read loop, pause-at-word / resume, skip, scene
  jumps, prefetch of the next lines for AI engines, and keeping its place when
  the script is edited mid-read.
- `editor/extensions/TableReadHighlight.ts` — decorations for the current line
  and word; nothing is written to the document.
- `components/TableReadPanel.tsx` — the docked panel; `VoicePicker.tsx` — used on
  character profiles, for the narrator and in the panel's cast list;
  `VoiceProviderSettings.tsx` — Settings → Table Read Voices.

## Data

- `CharacterProfile.voice = { system?, ai? }` — saved with the script. Two slots,
  because a system voice is whatever the reading machine has installed (falls back
  to automatic when missing) while an AI voice (`<provider>:<id>`) travels intact.
- Provider, keys, models, narrator voice and read options are per device, in
  localStorage `opendraft:tableRead` (`voiceSettingsStore.ts`). API keys go only to
  the provider, straight from the browser — never through OpenDraft's servers.

## Testing

- Unit tests: `frontend/src/services/tts/*.test.ts`; Rust voice-list parsers:
  `cargo test --lib tts`.
- AI path without a key: `python3 test-script/mock_tts_server.py` serves an
  OpenAI-compatible speech API on `http://127.0.0.1:8880/v1` using macOS `say`.
  Point Settings → Table Read Voices → OpenAI-compatible server at it.
- The desktop CSP allows `http://localhost:*` and `http://127.0.0.1:*` in
  `connect-src` so a local speech server can be used from the app.
