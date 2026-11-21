# Store rating requests (iOS and Android)

OpenDraft asks for a store rating rarely, after a successful export, and only in
the iOS and Android apps. Nothing is asked on desktop builds or in the browser.

## How it asks

The request is the platform's own sheet, never a dialog of ours:

| Platform | API | Native code |
|----------|-----|-------------|
| iOS | `SKStoreReviewController requestReviewInScene:` | `ios_request_review` in `src-tauri/gen/apple/Sources/opendraft/FileHelpers.m` |
| Android | Google Play In-App Review (`com.google.android.play:review`) | `MainActivity.requestReview` in `src-tauri/android-src/MainActivity.kt` |

Both are reached through one Tauri command, `request_store_review`
(`src-tauri/src/lib.rs`). It answers `true` when a request was made. The
platform decides whether anything is actually shown and never says which way it
went, so `true` means "asked", not "the sheet appeared".

### Why there is no "Enjoying OpenDraft?" question first

- Apple guideline 5.6.1 asks apps to use the system API instead of a custom
  rating prompt.
- Both stores forbid sending only happy users to the rating and unhappy ones
  elsewhere. A sentiment gate in front of the sheet would be exactly that.

## When it asks (`frontend/src/services/storeReview.ts`)

All of these must hold, checked by `shouldRequestReview`:

- at least 4 launches and 5 days since first launch;
- at least 2 exports since the last request (`saveFile` in `utils/fileOps.ts`
  counts a finished export);
- no earlier request for this app version;
- at least 90 days since the last request, and no more than 3 requests ever.

The request goes out 4 seconds after the export, so a share sheet or the export
confirmation has finished, and only if the app is still in the foreground. A
failed request is logged to the console and never shown to the writer.

## Privacy

OpenDraft promises no tracking. The counters (`opendraft.storeReview.v1` in
localStorage) are launches, exports, the date of the last request and the
version that made it. They stay on the device.

## Help → Rate OpenDraft…

The phone apps' manual route, always available. It opens the store's review
page through the platform opener (`https://apps.apple.com/app/id6761807809?action=write-review`
on iOS, the Play Store page on Android). Hidden everywhere else.

## Release wiring

- The Play review library is added to the generated Android project by the
  "Configure Android dependencies" step in `.github/workflows/release.yml` and,
  for local builds, by `test-script/android_fold_build.py`. Keep the version in
  step in both; `test_android_fold_build.py` checks it.
- StoreKit is linked automatically by the `#import <StoreKit/StoreKit.h>` in
  `FileHelpers.m`.

## Testing it

- Logic: `cd frontend && npx vitest run src/services/storeReview.test.ts`.
- iOS shows the sheet only in an App Store build: it never appears in debug,
  simulator or TestFlight builds. To check the wiring, look for the log line
  `rating request skipped` (no foreground scene) or no error from the command.
- Android: Play shows the real sheet only for an install from Play (use an
  internal testing track). On a sideloaded build `requestReviewFlow` fails and
  `MainActivity` logs `review flow unavailable` under the `OpenDraft` tag.
