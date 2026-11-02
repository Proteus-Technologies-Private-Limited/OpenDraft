# Dictation native validation

## Confirmed evidence

For PR #184, commit `92db4fc154d7adcc7312b7734bc80c2c4c2a2cd8`,
[CI run 41510996738](https://github.com/Proteus-Technologies-Private-Limited/OpenDraft/actions/runs/41510996738)
passed all three jobs:

- Frontend typecheck, unit tests and production build.
- Android Rust type check (`aarch64-linux-android`). This does not compile Kotlin or package an APK.
- iOS Simulator app compilation, including the tracked Xcode project and native helpers, without `ios init` or project regeneration. This is an unsigned simulator build.

The local frontend suite passed 2,715 tests across 197 files. Controlled browser
recognition checks passed for activation privacy, settings, final-result handling,
focus, script changes and cancellation. These checks do not establish actual
microphone recognition, signing, notarization or physical-device behavior.

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

1. Enable Dictation and choose Device speech service. Test speech/microphone allow and deny flows. No text should enter the script until Insert is chosen.
2. Speak a phrase whose last words are easy to identify. Press Stop while speaking, wait for the final result, and verify the phrase ending is retained. Repeat several times; record the actual transcript.
3. Cancel while listening and while permission is pending; close/reopen and switch scripts. Confirm stale results are ignored and the microphone stops.
4. Play Table Read before dictation and after Stop, Cancel, Close and an error. Confirm playback remains audible; this checks restoration of the audio-session category, mode and options.
5. Background the app and interrupt it with another audio session. Confirm capture stops appropriately and the app can record again afterwards.
6. When on-device recognition is supported, test offline. When unavailable, confirm the UI notice and document the required connection rather than claiming an offline guarantee.
7. On iPad, open another window and confirm sessions and results remain isolated.

## Result record

For each run, record the source SHA, build/signature/notarization evidence,
OS/device/language, pass/fail for each applicable step, and any exact error or
failed transcript. Leave unperformed steps marked **not run**.

Current status: signed/notarized macOS microphone and physical iOS checks are
**not run**. The implementation workspace is Linux and has no Apple SDK,
Apple signing identity or attached iOS device. Simulator compilation is the
confirmed native result above.
