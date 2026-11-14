# Android APK foldable integration

Follow-up to #260 / #231 WP3. Merge #260 first. This runs the real Tauri app,
not the Robolectric Activity stand-in or a browser with injected fold snapshots.

`.github/workflows/test-android-fold-emulator.yml` builds debug and R8-minified
x86_64 APKs with the production frontend, tracked Kotlin and real Rust library.
Separate jobs install them on API 35 Google APIs Pixel Fold emulators with KVM.
The runtime image must report distinct closed, half-open and open states. The
runner discovers their IDs by name; it never assumes fixed state numbers.
Rotation is requested directly with WindowManager's `wm user-rotation lock`,
then verified against real native geometry and applied classes. A settings-key
write alone can leave the display unrotated and is not used as the control.
Missing folding features, a missing bridge or unavailable soft keyboard fail
the test, rather than silently skipping checks.

The checks cover cold cover startup, unfold, half-open, rotation, Android IME
show/hide and Android key-injected text while it is visible, a posture change
while backgrounded, foreground refresh, a real
extra Activity and returning to the main window, then folding back. At each
stage the original editor/document/selection and writing-pad node/draft/selection
must survive. The extra window has its own document marker and native bridge.
Native JSON and applied classes come from the app; no native signals, viewport
measurements or capability flags are supplied by the test.

## Disposable test APKs

`prepare.py` operates only on `src-tauri/gen/android` and the disposable checkout's
Tauri build hooks. It installs the same tracked sources and R8 rules as release
CI. The release build remains minified and its APK manifest stays non-debuggable;
both variants use the generated debug signing key. **WebView inspection is
explicitly enabled in the generated Activity hooks, including the minified
variant. These test APKs must not be distributed as releases.** The tracked
production Activities and CSP are unchanged. No signing secret is used.

`stage.mjs` requires the real x86_64 OpenDraft library and every extra Activity
in the APK, checks the manifest's debug flag, and requires the minified R8 map to
retain `FoldPostureBridge.snapshot`. APK SHA-256/build metadata accompanies the
one-day test artifacts. Runtime evidence (seven-day retention) includes phase
snapshots, synthetic screenshots, WebView provider, supported device states,
IME/Activity dumps and app/crash logs. Physical display IDs are explicit in
screenshots, whose PNG bytes/dimensions are validated. Failures retain the last
observed native/UI snapshot and WindowManager/display dumps. Only disposable
emulator data is used. IME composition is not covered by key injection.

## Run

Tool checks require Python 3 and Node 22+:

```sh
python3 -m unittest discover -s test-script/android-fold-emulator -p 'test_*.py'
node --test test-script/android-fold-emulator/*.test.mjs
```

For APK builds, follow the workflow's JDK 17, SDK 36 / NDK 27.0.12077973,
Rust x86_64 target, frontend build and Tauri init steps. Run `prepare.py` only
in a disposable checkout. `tauri android build --target x86_64 --apk --ci` builds
the minified variant; add `--debug` for debug. Then:

```sh
node test-script/android-fold-emulator/stage.mjs minified
node test-script/android-fold-emulator/run.mjs minified emulator-5554
```

Set `ANDROID_HOME` to the SDK. The runner accepts only an explicit `emulator-*`
serial and verifies `ro.kernel.qemu=1` before installing/clearing its app data.
It restores rotation/IME settings, resets the forced posture and removes ADB
forwards at the end. It does not operate on a physical device. The ADB client
has no macOS-specific SDK path.

The cloud workspace has no `/dev/kvm`; emulator execution is performed by the
GitHub workflow on Linux KVM runners. Passing proves these tested emulator/API,
WebView and APK combinations. It does not establish physical hinge/OEM behavior,
Pencil, assistive-technology or iPhone/macOS compatibility, nor IME behavior
beyond the emulator's installed input method.
