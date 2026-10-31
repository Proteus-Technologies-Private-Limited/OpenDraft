# Screenplay dictation

Open **Tools → Dictation…** from an editable script. Speak one short phrase,
stop, review or correct the transcript, and choose **Insert into script**. The
script is never changed by an interim result or a cancelled recording.

## Recognition choices

- **Local Whisper** (default on web/desktop): records up to 30 seconds, releases
  the microphone, and runs multilingual Whisper Tiny in a WebAssembly worker.
  The first recognition downloads model assets from Hugging Face (roughly
  100 MB); the browser can cache them. Audio is not uploaded. Model loading and
  inference may take several minutes on slower devices. This is phrase-based,
  not continuous dictation. A microphone-capable secure context is required:
  HTTPS, localhost or a supported desktop web view.
- **Browser speech service**: uses SpeechRecognition/webkitSpeechRecognition.
  Availability depends on the browser and installed service; a browser can send
  audio to its provider. This requires an explicit choice and Start click.
- **Device speech service** (default on iOS/Android): iOS uses SFSpeechRecognizer
  with microphone and speech permission prompts; Android opens the system
  recognition dialog, whose provider owns the microphone and permission UI.
  The provider may require a network connection or process audio remotely.
  Android's system dialog is intentionally allowed to cover the app while it
  listens. Cancel that dialog to return without inserting anything.

No API key or external speech server is required. No model is downloaded on
app launch. Cancel/Close discards pending callbacks and stops recording; local
inference workers are terminated. Native events are scoped to session ids so
late callbacks and another window's events cannot insert text into this script.
Switching scripts cancels the old dialog's session. Read-only views cannot insert.
Microphone denial, unsupported engines, unavailable providers and download or
inference failures are shown in the dialog instead of silently switching engines.

## English voice commands

Commands are **off by default**. Enable **Interpret English voice commands**,
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
A Chromium UI check with controlled recognition events covers command insertion,
modal focus/Escape and a 375px-wide viewport. This is not an acoustic accuracy test.

Before release, test on real supported devices:

- Web and desktop: microphone allow/deny, actual Whisper model download/cache and
  inference, offline reuse, language choice and cancelling during download.
- macOS: signed app and Mac App Store sandbox microphone permissions.
- iOS: build with Speech/AVFoundation frameworks and the microphone/speech usage
  descriptions, then test allow/deny, Stop, backgrounding, interruptions and iPad
  multi-window. Re-test in a signed device build.
- Android: compile and test a minified release with the JNI keep rules; test a
  speech provider present/absent, system-dialog cancellation and a second window.

Native SDKs and the Rust toolchain were unavailable in the implementation cloud
instance. Native compilation, real microphone recognition, acoustic accuracy and
physical-device behavior must not be treated as validated by the frontend tests.
