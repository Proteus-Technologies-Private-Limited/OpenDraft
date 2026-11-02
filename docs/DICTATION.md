# Screenplay dictation

Enable **Dictation** in **Settings → Add-ons** first. Read “What leaves your device” and choose an available engine, language and optional voice commands before pressing **Turn On**. These choices persist locally and can be deleted when disabling the add-on. While off, dictation has no menu or panel and performs no capture or downloads.

Open **Tools → Dictation…** (after Table Read) from an editable script. Speak one short phrase,
stop, review or correct the transcript, and choose **Insert into script**. The
script is never changed by an interim result or a cancelled recording.

## Recognition choices

- **Local Whisper** (default wherever supported): records up to 30 seconds, releases
  the microphone, and runs multilingual Whisper Tiny in a WebAssembly worker.
  The first recognition downloads model assets from **huggingface.co**, exposing
  your IP address. The pinned q8 weights total **40,844,231 bytes (38.95 MiB)**:
  encoder_model_quantized.onnx = 10,124,990 bytes and
  decoder_model_merged_quantized.onnx = 30,719,241 bytes, measured using the
  Hugging Face tree API at revision `ff4177021cc41f7db950912b73ea4fdf7d01d8e7`.
  Tokenizer/configuration and bundled ONNX runtime assets are additional.
  The browser can cache model assets; cache eviction or unavailable caching causes re-downloads. Audio is not uploaded. Model loading and
  inference may take several minutes on slower devices. This is phrase-based,
  not continuous dictation. A microphone-capable secure context is required:
  HTTPS, localhost or a supported desktop web view.
- **Browser speech service**: uses SpeechRecognition/webkitSpeechRecognition.
  Availability depends on the browser and installed service; a browser can send
  recorded voice to Google, Apple or Microsoft. This requires choosing the engine before activation, followed by a separate Start click.
- **Device speech service** (the only engine offered on native Android): iOS uses SFSpeechRecognizer
  with microphone and speech permission prompts, requiring on-device recognition when supported for the selected language; Android opens the system
  recognition dialog, whose provider owns the microphone and permission UI.
  Otherwise Apple may process recorded voice remotely. Android requests offline recognition, but its provider (usually Google) can ignore that preference and process audio remotely.
  Android's system dialog is intentionally allowed to cover the app while it
  listens. Cancel that dialog to return without inserting anything.

No API key or external speech server is required. No model is downloaded on
app launch. Cancel/Close discards pending callbacks and stops recording; local
inference workers are terminated. Successful phrases reuse the worker and loaded model until the dialog closes. Stop on iOS ends audio and waits up to 10 seconds for a final result; Cancel discards results immediately. The prior iOS audio-session category, mode and options are restored for Table Read. Native events are scoped to session ids so
late callbacks and another window's events cannot insert text into this script.
Switching scripts cancels the old dialog's session. Read-only views cannot insert.
Microphone denial, unsupported engines, unavailable providers and download or
inference failures are shown in the dialog instead of silently switching engines.

Native Linux WebKitGTK capture is unsupported in this build; use a microphone-capable browser for Local Whisper. Unsupported engines are omitted rather than silently falling back to a remote provider.

## English voice commands

Commands are **off by default**. Enable **Interpret English voice commands** in the add-on settings,
then review the recognized command before inserting it:

| Whole phrase | Result |
|---|---|
| `new scene` | Start an empty scene heading |
| `character Sarah` | Start a character cue containing `SARAH` |
| `action`, `dialogue`, `parenthetical`, `transition` | Start that element |
| `new paragraph` or `new line` | Start a new action paragraph |
| `literal new scene` | Insert the words `new scene` |

Commands match a complete phrase, case-insensitively, with terminal punctuation
ignored. They never match a substring such as “We need a new scene.” Commands
append after a populated paragraph rather than converting its existing words.
Ordinary text replaces the selected text, with surrounding spaces adjusted.
Insertion uses a normal ProseMirror transaction so existing suggestion, revision,
undo and collaboration processing applies. Title pages, AV cells and selections
across paragraphs are rejected with an explanation.

## Reference repositories

The implementation is independent code. The attached OpenSuperWhisper and Parrot
repositories informed bounded recording and the separation of recognition from
transcript processing; Voquill and Whisper_dictation informed keeping local
recognition separate from provider-backed recognition. No third-party application
code or model weights were copied into OpenDraft. The existing Transformers.js
and ONNX dependencies provide the local runtime; it uses the same bundled WASM
asset configuration as Table Read's Kokoro worker.

## Verification

Tests cover command matching, literal text, selection preservation, a single undo
step, unsupported elements, final/interim separation, cancellation during a
permission prompt, microphone cleanup, late native callbacks and session isolation.
Tests also cover settings persistence/forgetting, platform engine availability,
worker reuse, cancellation during inference and polling after Stop for a final result.
A Chromium UI check with controlled recognition events covers activation privacy,
no model fetch before starting, remembered settings, command insertion, modal
focus/Escape, script-switch cancellation, disabling/forgetting and a 375px-wide viewport. This is not an acoustic accuracy test.

Before release, test on real supported devices:

- Web and desktop: microphone allow/deny, actual Whisper model download/cache and
  inference, offline reuse, language choice and cancelling during download.
- macOS: signed app and Mac App Store sandbox microphone permissions.
- iOS: build with Speech/AVFoundation frameworks and the microphone/speech usage
  descriptions, then test allow/deny, Stop, backgrounding, interruptions and iPad
  multi-window. Re-test in a signed device build.
- Android: compile and test a minified release with the JNI keep rules; test a
  speech provider present/absent, system-dialog cancellation and a second window.

The PR adds an iOS Simulator compile job that builds the tracked Xcode project
without regeneration. A successful job establishes compilation, not microphone
or signed-device behavior.

Native SDKs and the Rust toolchain were unavailable in the implementation cloud
instance. Native compilation, real microphone recognition, acoustic accuracy and
physical-device behavior must not be treated as validated by the frontend tests.
