# Background Table Read on phones and tablets

Android's **System voices** Table Read is owned by a native media-playback
foreground service. Starting a read hands over the complete spoken queue,
per-line voice cast, speed and pauses. The service advances independently of
the WebView, including while the app is behind another app or its page is
frozen. Returning to the app synchronizes the existing panel and word highlight.

The media notification, lock-screen controls and media keys can play, pause,
stop and move between lines. Pausing remembers the beginning of the latest
reported word; engines without word events restart the current utterance.
Long lines are chunked below the platform limit without splitting surrogate
pairs. Changing speed/cast rebuilds the queue; jumping within an unchanged, playing read
uses the service's existing session. Local edits and local undo pause the panel
and discard the native snapshot, so media Play cannot resume obsolete text.
Resume in the panel rebuilds it against the mapped document position.

Collaborator updates and automatic housekeeping keep the existing native queue
reading. Its positions are mapped through those changes as playback advances,
and obsolete highlights are cleared. Pausing and resuming in the panel rebuilds
from the newly reached, mapped line; the running native snapshot itself is not
rewritten on every collaborator keystroke.

This implements the Android **system-voice** part of #231 WP12. AI-provider
audio retains its existing foreground JavaScript player. Browser Media Session
controls remain available on that path and on other platforms. This change
does not implement native background speech on Apple platforms, AI-provider
background audio, pronunciation quality checks, or physical-device validation.

## Native ownership and cleanup

`TableReadService.kt` uses the framework MediaSession, AudioFocusRequest,
TextToSpeech and Notification.MediaStyle APIs. No replacement speech provider,
audio library or JavaScript interface is installed in production. The Tauri
command derives queue ownership from the calling window. Opaque session IDs
reject stale controls, and a different window cannot control another read.
A new read replaces the application's previous native queue.
The command runs on Tauri's worker pool, keeping queue validation, serialization
and JNI/JSON processing off the main thread.

Transient audio-focus loss pauses speech and may resume on focus gain; a
manual pause cancels automatic resume. Permanent loss pauses until the writer
starts again. Audio-focus denial also leaves the read paused. Pausing releases
the wake lock; stopping releases audio focus, notification, media session, TTS
engine, timers and queue. Closing the owning window or dismissing its Android
task stops the read; removing another writing window's task leaves it playing.
`stopWithTask` is false so Android delivers the removal callback. Each Android
window uses a distinct Activity class, matching `open_new_window`'s slots; the
callback compares the removed task's root component with the native queue owner.
It also cancels a pending start for that owner. A killed process never restarts
or restores a private queue.
An utterance that never completes has a bounded watchdog.

The foreground service declares `mediaPlayback`, `FOREGROUND_SERVICE`,
`FOREGROUND_SERVICE_MEDIA_PLAYBACK` and `WAKE_LOCK` in both local and release
builds. Media-session notifications are exempt from the notification runtime
permission; no notification-permission prompt is added. Paused reads retain
their notification and in-memory queue until stopped or the process ends.

Only the translated Table Read title and line counts appear in native media
metadata. Notification visibility is private. Script text and voice queues are
not written to disk or logs. The system voice must be an installed voice that
does not require a network connection. The queue is bounded to 50,000 lines and
two million spoken UTF-16 code units; oversized or malformed requests fail
without echoing their contents. The panel shows a translated generic failure.

## Automated checks

Frontend tests cover queue/cast handoff, word reconciliation after suspension,
local-edit/undo pause behavior, uninterrupted collaborator updates and mapped
resume, queue-preserving jumps, stale sessions, disposal during startup, transport
failure and the unchanged AI path. Native tests exercise the queue without
frontend polling, word offsets, long Unicode lines, cancelled callbacks,
interruption policy, readiness errors and deadlines. Robolectric service tests
on API 28 and 35 exercise the registered MediaSession callbacks, notification privacy, window
ownership, pending pause, owner versus unrelated task removal, and pending-start
cleanup. Python checks execute both manifest patches, check idempotence and
upgrades from the old task policy, and verify production source/JNI wiring.

The [APK emulator workflow](android-fold-emulator.md) additionally runs both
debug and R8-minified APKs against a disposable test-only TTS engine. It uses
the real TTS binder and audio callbacks but emits synthetic tones; it requires
no downloaded voices. That source and its exported engine declaration are
inserted only into the generated test project by `prepare.py`, never by either
production build path. These inspection-enabled APKs must not be distributed.

The scenario starts Table Read through the actual panel, backgrounds the app
and freezes its WebView using CDP. Native media metadata must advance by two
lines while JavaScript is frozen. Native media-key pause must hold its place,
then next/previous/resume must work. On return the panel must match the native
line without changing the document. Panel Stop and, after a new read, the native
media Stop key must each remove the service and wake lock. The custom Stop action
also supports system media cards that derive extra buttons from MediaSession.
Phase evidence and a synthetic screenshot are retained with the existing
foldable emulator artifacts. The original 12 foldable phases still run first.

These checks establish native queue and control behavior for the tested
emulator/API/WebView combinations. They do not establish physical lock-screen
or Bluetooth routing, real voice intelligibility, vendor TTS quirks, or every
power-management policy. No physical foldable, Mac or iPhone was available.
