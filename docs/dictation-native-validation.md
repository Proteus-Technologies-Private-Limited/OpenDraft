# Dictation native validation

## Confirmed evidence

For PR #184, commit `92db4fc154d7adcc7312b7734bc80c2c4c2a2cd8`,
[CI run 41510996738](https://github.com/Proteus-Technologies-Private-Limited/OpenDraft/actions/runs/41510996738)
passed all three jobs:

- Frontend typecheck, unit tests and production build.
- Android Rust type check (`aarch64-linux-android`). This does not compile Kotlin or package an APK.
- iOS Simulator app compilation, including the tracked Xcode project and native helpers, without `ios init` or project regeneration. This is an unsigned simulator build.

The prior local frontend suite passed 2,715 tests across 197 files. Controlled browser
recognition checks passed for activation privacy, settings, final-result handling,
focus, script changes and cancellation. These checks do not establish actual
microphone recognition, signing, notarization or physical-device behavior.

## Earlier review follow-up evidence

The first review follow-up passed the full frontend suite on Node 20: **3,094 tests**, with three SQLite tests skipped (214 files pass, one skipped). The dictation subset passes all **62 tests**; frontend build, TypeScript and targeted dictation ESLint checks pass.

A controlled Chromium fixture using the actual plugin panel and editor verified non-modal cursor changes while recording, insertion at the new destination, single-step undo, a dual-dialogue command staying in its column, actionable browser/local permission errors, 375px layout, and Escape/close focus restoration. No model was downloaded. Recognition and denied permissions were simulated; this was not an acoustic test.

The changed Android bridge methods were extracted directly from `MainActivity.kt` and compiled with Kotlin 1.9.24 in an isolated JVM harness with Android API stubs. Cross-window cancellation, immediate restart, stale-result isolation, a failed `finishActivity`, a caller without an activity, a destroyed owner, and an unrelated cancel all passed. This verifies the bridge's session logic and Kotlin syntax, not Android SDK linkage, APK packaging or a real speech provider.

## Simulator review and latest follow-up

At `54e210e`, [CI run 41683344927](https://github.com/Proteus-Technologies-Private-Limited/OpenDraft/actions/runs/41683344927)
passed frontend tests/build, Android Rust checking, and the tracked iOS Simulator compile.
The full local suite at that head passed **3,189 tests**, with three SQLite tests skipped.

The [maintainer's simulator review](https://github.com/Proteus-Technologies-Private-Limited/OpenDraft/pull/184#pullrequestreview-5758187541)
used iOS 26.4 / Xcode 27 and confirmed activation, engine filtering, OS permission
prompts, real recognition, final-word retention on Stop, non-modal cursor changes,
explicit insertion, single Undo, and a clear revoked-microphone message. This is
simulator evidence, not a physical-device check. A later Start failed after Apple
speech assets downloaded; Table Read and Cancel were not covered by that run.

The latest code normalizes locale separators before matching. The native helper
has 19 deterministic locale cases (including en on en-GB/en-IN and fr on fr-CA),
plus 10 recognition-error cases, run in the existing macOS CI job. To run
these checks locally on a Mac from the repository root:

```sh
xcrun clang -fobjc-arc -fblocks -framework Foundation \
  -I src-tauri/gen/apple/Sources/opendraft \
  test-script/dictation_native_test.m -o /tmp/opendraft-dictation-native-tests
/tmp/opendraft-dictation-native-tests
```

Only an on-device recognizer-initialization failure (`kLSRErrorDomain`, code `300`)
gives restart/download guidance and offers Local Whisper as an alternative engine.
Other errors, including no speech and interruptions, retain Apple’s description.
Recognition failures and native audio setup failures log the original error domain,
code and description under `[Dictation]`. It does **not** retry recorded audio on
Apple's servers. Languages without on-device support retain their existing,
disclosed Apple-processing path. The panel suppresses the stopped/review status
after an error and clears insertion errors after a successful insertion.

## macOS: signed, notarized app

Use a Mac and the project's existing signing/notarization setup. Follow the macOS
build instructions in `CLAUDE.md` and `build-desktop.sh`; do not create a release
tag or publish a release just to test this branch. Record the tested source SHA,
macOS version, architecture and app version.

For the built app, check the signature, microphone entitlement, usage description
and notarization. Substitute its real path below:

```sh
DICTATION_APP='/path/to/OpenDraft.app'
codesign --verify --deep --strict --verbose=2 "$DICTATION_APP"
codesign -d --entitlements :- "$DICTATION_APP"
/usr/libexec/PlistBuddy -c 'Print :NSMicrophoneUsageDescription' "$DICTATION_APP/Contents/Info.plist"
spctl --assess --type execute --verbose=4 "$DICTATION_APP"
xcrun stapler validate "$DICTATION_APP"
```

The entitlements must include `com.apple.security.device.audio-input = true`.
Record the Developer ID identity and Gatekeeper/notarization result. If the
stapled ticket is attached to the distributed DMG, validate that DMG as well.

Test the installed app:

1. With Dictation off, confirm its Tools entry is absent and no microphone prompt appears.
2. Enable it in Settings → Add-ons. Confirm the privacy statement and engine choice appear before activation. Choose Local Whisper.
3. Start recording and deny microphone access. Confirm an actionable error, no inserted text and no continuing microphone indicator. Enable access in macOS settings, reopen as needed, and retry.
4. Allow recording, speak a short phrase, Stop, review the final transcript and insert it. Undo once and confirm the insertion is reverted.
5. Record a second phrase in the same dialog. Confirm the loaded model is reused. After an initial successful download, check cached reuse offline; note whether this web view supports persistent model caching.
6. Cancel during recording and model loading, then close the dialog. Confirm the microphone stops and late results do not alter the script. Reopen and confirm settings persist.
7. Play Table Read after recording, Stop, Cancel and Close. Confirm playback works and audio output is correct.
8. Disable the add-on with deletion selected. Confirm recording stops, its menu/panel disappear and engine/language/command preferences are forgotten.

Mac App Store sandbox microphone behavior needs a separate sandboxed signed build;
a Developer ID test alone does not establish it.

## iOS: physical device

Use `./build-ios-device.sh` for the signed device build, following `CLAUDE.md`.
Record the source SHA, iOS version, device, language and whether on-device speech
recognition is available. Verify the installed app has both
`NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription`.

1. Enable Dictation and choose Device speech service. Test speech/microphone allow and deny flows. No text should enter the script until Insert is chosen. Check every offered language (en, pl, fr, de, es, it, pt, ja), the current-region match and a different-language fallback. Record the requested language, device locale, and selected Apple locale from the `[Dictation]` device log for each language. Specifically verify `en` on an `en-GB` device selects `en-GB`, `en` on `en-IN` selects `en-IN`, and `fr` on `fr-CA` selects `fr-CA` when supported. Confirm defaults when the device language differs (for example `en` on `fr-CA` selects `en-US` when supported), and confirm bare language codes do not cause an unavailable-recognizer error.
2. Start, Stop, then Start again after the on-device speech assets arrive. Record the selected locale and recognition mode each time. If initialization fails with `kLSRErrorDomain` / `300`, confirm actionable restart/Local Whisper guidance, no remote retry, no continuing microphone indicator, and no misleading “Recording stopped. Review…” status. Then speak a phrase whose last words are easy to identify. Press Stop while speaking, wait for the final result, and verify the phrase ending is retained. Repeat several times; record the actual transcript.
3. Cancel while listening and while permission is pending; close/reopen and switch scripts. Confirm stale results are ignored and the microphone stops.
4. Play Table Read before dictation and after Stop, Cancel, Close and an error. Confirm playback remains audible; this checks restoration of the audio-session category, mode and options.
5. Start, say nothing, then Stop: confirm “No speech detected” is not replaced with asset-download/restart guidance. Record the original domain, code and description from the `[Dictation]` failure log. Background the app and interrupt it with another audio session (for example a phone call or Siri); check the interruption message likewise retains Apple’s description. Confirm capture stops appropriately and the app can record again afterwards.
6. When on-device recognition is supported, test offline. When unavailable, confirm the UI notice and document the required connection rather than claiming an offline guarantee.
7. On iPad, open another window and confirm sessions and results remain isolated.

## Additional review checks

- On native macOS/Windows, a webview exposing a speech constructor must still offer no Browser speech service. Local Whisper remains subject to actual capture support.
- The non-modal panel must allow moving the script cursor before insertion, including both dual-dialogue columns. Incompatible commands must leave the document unchanged.
- On Android, cancel from the window that started recognition and from another window. Immediately start another session, then deliver/dismiss the older dialog: its result must not end or insert into the newer session. Check activity recreation as well as normal cancellation.
- After a failed Insert, move to a valid script element and Insert again: the error must clear and the status must say “Inserted.” Confirm Tools → Dictation has a monochrome SVG microphone matching the built-in Tools icons.
- Confirm permission failures show instructions for the relevant browser/system settings. Inject an audio-context close failure and confirm it is logged without an unhandled rejection.

## Opt-in boundary and release metadata

Dictation's opt-in is enforced by the add-on UI and lifecycle. Native bridge commands remain registered in the app; this is not a native IPC authorization boundary. Application code invoking those commands directly still reaches the OS permission checks. There is no recording during ordinary use while the add-on is disabled, and disabling cancels its active session.

Before distribution, update the App Store privacy labels and Play Data safety form to match the optional Apple/Google/Microsoft voice processing disclosed in `PRIVACY.md`. These store forms are release tasks, and have not been changed by this PR.

## Result record

For each run, record the source SHA, build/signature/notarization evidence,
OS/device/language, pass/fail for each applicable step, and any exact error or
failed transcript. Leave unperformed steps marked **not run**.

Current status: signed/notarized macOS microphone and physical iOS checks are
**not run**. The implementation workspace is Linux and has no Apple SDK,
Apple signing identity or attached iOS device. The successful simulator compilation and maintainer simulator checks above apply
to `54e210e`; they must not be treated as physical-device evidence or as validation
of a newer source head.
