# Open Issue Triage & Remediation Plan — August 2026

> **Status update (2026-08-12).** #65, #66, #67, #68 and #62 Phase 1 are
> implemented on `main`; see "Implementation notes" at the end of this document
> for what shipped and what still needs on-device verification. #64 needs no
> work — the parser fix is already on `main` and only awaits an App Store
> release. #63 is not implementable; see its section.

Snapshot taken 2026-08-12 from `Proteus-Technologies-Private-Limited/OpenDraft`.
**9 open issues**, none labelled except #59/#61, none milestoned.

Two reporters:

| Reporter | Issues | Platform |
|---|---|---|
| `burchland2-source` | #59, #61 | Desktop — Windows |
| `ServerBaby` | #62–#68 (7, all filed 2026-08-11) | iPad |

Six of the seven iPad issues are one person's first-run experience of the iPad
build. That is the signal worth acting on: **the iPad build has not had a
platform-specific pass**, and the issues cluster into three real defects
(safe area, toolbar overflow, no crash recovery) plus two feature asks.

---

## Group A — Close or unblock (no code)

### #61 — "[Bug]: #59 Redux" — Fade In import ruins formatting
Reporter confirmed on 2026-08-08: *"The format problem was perfectly resolved."*
The only outstanding ask in the thread — "create a new act on a new page" —
shipped in **v0.22.0** (commit `e271742`, forced page breaks).

**Action:** reply pointing at forced page breaks in v0.22.0, then close.

### #59 — "[Bug]: Two problems" — can't import Fade In; want Paste as Fountain
Both shipped in **v0.21.0** (commit `93c716a`, "Import Fade In files and add
Paste as Fountain"). The original reporter went quiet; `ServerBaby` then
commented "Does not appear to be resolved for me" — but ServerBaby is on iPad,
where the App Store build may lag main, and their real complaint is almost
certainly #64. A request for version/platform/screenshot is already pending.

**Action:** hold ~1 week for the reply. If nothing lands, close as fixed in
v0.21.0 and let #64 carry the iPad-specific defect.

### Release-hygiene item found while triaging
Tag `v0.22.0` is **not an ancestor of `main`**, and `src-tauri/tauri.conf.json`
on `main` still reads `0.21.0`. The version bump commit (`8834f4a`) lives only
on the tag. Left alone, the next `release.sh` run bumps from a stale base.

**Action:** reconcile the version on `main` before the next release.

---

## Group B — iPad defects (the real work)

### B1. #66 — iPadOS window controls overlap the File menu  ← root-caused, fix first

`frontend/index.html:6` sets the viewport meta **without `viewport-fit=cover`**,
and `frontend/src/main.tsx:13-18` adds it at runtime **for Android only**.
On iOS/iPadOS, `env(safe-area-inset-*)` resolves to `0` unless
`viewport-fit=cover` is set — so the entire `@supports (padding:
env(safe-area-inset-top))` block in `styles/screenplay.css:8623` is a no-op on
iPad. `.app-container` gets zero top/left inset and the MenuBar renders flush
into the corner the iPadOS window chrome occupies.

This is very likely the same root cause behind part of #65 and the general
"controls in the corner are unreachable" reports.

**Fix**
1. Add `viewport-fit=cover` to the static meta tag in `index.html` (it is inert
   where safe areas are zero, so it is safe for desktop and web).
2. Add an `html.ios` class in `main.tsx` alongside the existing `android` one,
   using the `getOS()` iPad detection already in `services/platform.ts:38-48`
   (iPadOS reports a "Macintosh" UA — `maxTouchPoints` disambiguates).
3. Give `.menu-bar` a leading gutter under `html.ios`. iPadOS window controls
   sit **inside** the window's top-leading corner and are *not* covered by
   `safe-area-inset-left`, so reserve a minimum gutter when the app is not
   full-screen — detect windowed mode by comparing `window.innerWidth` against
   `screen.width` rather than trusting the inset alone.

**Verify:** iPad simulator, full-screen / Split View 50-50 / Slide Over, both
orientations. See `CLAUDE.md` → *Local iOS Simulator Build*.

---

### B2. #67 — Toolbar controls disappear when the window is resized smaller

`styles/screenplay.css:8795` hides `.toolbar-desktop-only` with
`display: none !important` at `@media (max-width: 768px)` — which is exactly
what an iPad Split View or Slide Over pane hits.

An overflow ("…") mechanism **already exists** — `Toolbar.tsx:312-382` measures
each `[data-priority]` group and is written to treat zero-width (CSS-hidden)
groups as overflow candidates. So the reported symptom means the overflow path
is not firing on iPad. Two concrete suspects:

- `.toolbar-desktop-only { display: contents }` (`screenplay.css:604`) makes
  `offsetWidth` 0 for any wrapper that is not also `.toolbar-priority-block`,
  so the width bookkeeping in `measure()` is already unreliable.
- The `ResizeObserver` early-returns unless the *toolbar's* width changed
  (`Toolbar.tsx:372`). A Split View transition that crosses the 768px media
  breakpoint without changing toolbar `clientWidth` never re-measures.

**Fix:** reproduce at 320 / 375 / 507 / 768 pt widths on the simulator, then make
the overflow menu authoritative — drive group visibility from React state rather
than from a `!important` media query racing an inline `style.display`, and
re-measure on media-query change (`matchMedia().addEventListener('change')`),
not width alone. Confirm every priority group 1–5 is reachable in the "…" menu
at the narrowest supported width.

---

### B3. #68 — Autosave / crash recovery on iPad  ← highest user-value

Confirmed gap, two parts:

- `services/backupService.ts:1-8` is **explicitly desktop-only** ("Mobile
  sandboxes cannot hold a persistent handle to an arbitrary folder"). The
  automatic-backup feature the team pointed #61 at simply does not exist on iPad.
- Every autosave call site in `ScreenplayEditor.tsx` is gated on
  `currentProject && currentScriptId`. A screenplay that was imported but never
  saved into a project has **no persistence at all**, and nothing restores the
  last session on launch (no `lastOpened` key anywhere in the codebase).

On iPadOS the OS terminates suspended apps routinely, so this is a genuine
data-loss path, not a theoretical one.

**Fix** — a recovery snapshot that is deliberately separate from the user's
saved file, exactly as the issue asks:
1. Serialize the live document with the existing `serializeOdraft`
   (`utils/odraftFormat.ts`) into a dedicated recovery slot — local SQLite on
   mobile Tauri, `localStorage` on web.
2. Write it on the existing editor debounce **and** on `visibilitychange` →
   `hidden` and `pagehide`. iOS gives no reliable termination callback; those two
   events are the last guaranteed hook before suspension.
3. On startup, if a recovery snapshot is newer than the last explicit save,
   offer *"OpenDraft recovered unsaved changes from your last session"* — restore
   or discard. Never overwrite the saved file implicitly.
4. Clear the slot on a successful explicit save.

Ship on all platforms; it is not iPad-specific, iPad just exposes it.

---

### B4. #65 — Screens with no Back or Close control

Partly a false alarm and partly real. Audited: `SettingsPage.tsx:512` and
`TreatmentEditor.tsx:147-161` both **have** back buttons. So either the control
is rendering underneath the iPadOS window chrome (→ same cause as **B1**), or
the reporter hit a specific overlay not yet identified.

One real latent bug found: `SettingsPage` uses `navigate(-1)`, which is a no-op
when Settings is the first entry in the history stack (deep link, or launch
straight into settings) — leaving exactly the "force-quit to escape" trap
described.

**Fix**
1. Land **B1** first, then re-check on the simulator.
2. Replace bare `navigate(-1)` with a guarded version that falls back to `/`
   when there is no history entry to pop.
3. Audit every route in `App.tsx:26-40` plus every full-screen overlay
   (BeatBoard, IndexCards, ScriptStatistics, RelationshipMap, VersionHistory,
   AssetManager, DictionaryLibrary) on the iPad simulator, and confirm each
   exposes a Back/Close inside the safe area at the narrowest supported width.
4. Ask the reporter which screen trapped them — that shortcuts the audit.

---

### B5. #64 — `.fadein` import garbled on iPad

**Needs reproduction before any fix.** What the code says today:

- The iPad import path is `openTextOrBinaryFileBrowser`
  (`utils/fileOps.ts:353-383`), which correctly branches to
  `readAsArrayBuffer` for `.fadein` → `parseFadeIn` → JSZip
  (`utils/osfParser.ts:743-767`).
- Byte-level corruption would make JSZip fail outright, not produce readable
  structure. "Roughly the right page count, but the characters are wrong" points
  at **text decoding**, not archive handling — consistent with a build that
  predates the OSF text fixes.
- Two iOS-specific weak points worth checking regardless:
  `read_text_file` uses `to_string_lossy` on iOS (`src-tauri/src/lib.rs:637-639`),
  and `read_binary_file` (`lib.rs:646`) has **no** security-scoped fallback,
  unlike its text counterpart — so a `.fadein` opened via file association from
  the Files app can fail where a `.fountain` succeeds.

**Actions**
1. Ask the reporter for the exact App Store version — if it predates v0.21.0's
   parser work this may already be fixed and only needs a release.
2. Ask for a sample `.fadein` with the content replaced by dummy text (as was
   done successfully on #61).
3. Reproduce on the iPad simulator via both entry points (File ▸ Import, and
   "Open in OpenDraft" from Files) — they take different code paths.
4. Add a `read_binary_file` security-scoped fallback mirroring `read_text_file`.
5. Add a `.fadein` fixture to `osfParser.test.ts` for whatever the failure turns
   out to be.

---

## Group C — Feature requests (scope, then schedule)

### #62 — Open/save `.fadein`/FDX/Fountain in place from Files & Dropbox
The most valuable of the three, and the one that makes OpenDraft a real iPad
companion to Fade In. It is genuine iOS document-based-app work: today import
copies into the sandbox (`lib.rs:1462-1490`) and export goes out through the
share sheet (`fileOps.ts:89-103`) — there is no concept of an origin file to
save back to.

**Recommended scope split:**
- **Phase 1 (do this):** open-in-place + Save for **FDX and Fountain**.
  Needs `UIDocumentPickerViewController`, security-scoped bookmarks persisted
  across launches, and a "document has an origin file" model in the editor so
  ⌘S writes back instead of exporting. This delivers the reporter's stated
  "still very useful" outcome.
- **Phase 2 (separate issue):** `.fadein` round-trip. OpenDraft has **no
  `.fadein`/OSF writer** — `utils/` has fdx, fountain, docx and pdf exporters
  only. Writing one means round-tripping an undocumented format faithfully
  enough not to corrupt a writer's script; do not bundle it into Phase 1.

**Action:** split into two issues, commit to Phase 1, say so on the thread.

### #63 — Multiple scripts open simultaneously on iPad
True iPadOS multi-window needs `UISceneDelegate` support that Tauri's iOS
backend does not expose — this is not a small change, and it is not something
the app can work around at the web layer.

**Recommended answer:** decline real multi-window, offer the achievable
substitute — in-app document tabs plus a two-pane side-by-side view (the app
already has the diff/compare machinery in `ScriptDiffView` and
`CompareVersionPicker` to build on). Backlog, no near-term commitment.

---

## Suggested execution order

| # | Work | Issues | Effort |
|---|---|---|---|
| 1 | Triage replies + close #61; reconcile the v0.22.0 version on `main` | #59, #61 | ~1h |
| 2 | iOS safe-area fix (`viewport-fit=cover`, `html.ios`, menu-bar gutter) | #66, part of #65 | S |
| 3 | Toolbar overflow at narrow widths | #67 | S–M |
| 4 | Back/Close audit + `navigate(-1)` fallback | #65 | S |
| 5 | Session recovery snapshot + restore prompt | #68 | M |
| 6 | `.fadein` iPad reproduction, then fix | #64, #59 | M (blocked on repro) |
| 7 | Open/save in place, FDX + Fountain | #62 Phase 1 | L |
| 8 | Backlog / respond | #62 Phase 2, #63 | — |

Items 2–5 are all iPad chrome and data-safety, share the same test setup, and
are worth shipping together as a single **iPad polish release**.

## Housekeeping alongside the above

- Label #62–#68 (`bug` / `enhancement`, plus an `ipad` or `platform:ios` label —
  neither exists yet).
- Create an "iPad polish" milestone covering #64–#68.
- Add the `.fadein` sample files from #61 to `test-script/` as regression
  fixtures so the parser stops regressing between releases.

---

# Implementation notes (2026-08-12)

What was built, and what still needs a device to confirm.

## #66 — Safe area / iPadOS window controls  ✅

- `frontend/index.html` — `viewport-fit=cover` added to the static viewport tag.
  This is the fix: without it iOS resolves every `env(safe-area-inset-*)` to 0,
  so the existing `@supports` block in `screenplay.css` was dead code on iPad.
  It was being patched in at runtime for Android only, and too late — iOS reads
  the tag once at first layout.
- `frontend/src/main.tsx` — adds an `ios` root class, and tracks an
  `ios-windowed` class from `window.innerWidth` vs `screen.width/height`,
  because iPadOS exposes no "am I in a window" API and its window control is
  *not* covered by any inset. Gated to Tauri: a Split View Safari tab has
  browser chrome instead and must not get an indented menu bar.
- `frontend/src/styles/screenplay.css` — `html.ios` gets a bottom inset for the
  home indicator, and a `--ios-window-gutter` (76px, windowed only) on the menu
  bar.

## #67 — Toolbar controls vanishing at narrow widths  ✅

Three separate defects, all in the path between the `≤768px` media query and
the overflow menu:

- `Toolbar.tsx` — the `ResizeObserver` early-returns unless the toolbar's own
  width changed, so crossing the mobile breakpoint (rotation, a Split View drag
  landing on the same pane width) never re-measured. Now also re-measures on
  `matchMedia('(max-width: 768px)')` change.
- `Toolbar.tsx` — overflow contents were selected by *prefix*, so the zoom
  group's `2b` priority matched `2` and the narrow layout offered a duplicate
  Search & Go to. Now exact-matched, with zoom suppressed entirely when the
  narrow layout's own zoom button is on screen.
- `screenplay.css` — the "…" button itself could be pushed off the edge in a
  Slide Over pane, which is what made the controls *unreachable* rather than
  merely collapsed. The element selector now yields its width first and the
  overflow button cannot shrink.

`hasOverflow` is now derived from the menu's contents, so the "…" never opens
an empty popup.

## #65 — Screens with no way back  ✅

Partly a false alarm: `SettingsPage` and `TreatmentEditor` both already had back
buttons, and were most likely rendering *underneath* the window control (#66).
Two real fixes:

- `hooks/useGoBack.ts` (new) — `navigate(-1)` is a silent no-op when the screen
  is the first history entry (deep link, file association, cold launch). In a
  WebView there is no browser chrome to escape with, so the back button looked
  broken and force-quitting was the only way out. Now falls back to a real
  route. Applied in `SettingsPage` and the history-mode banner.
- `BeatBoard` — gained a close button. It replaces the script entirely, and the
  Tools menu that opened it is not an obvious way back on a touch device.
  `.panel-close-btn` / `.stats-close` share a 44px touch target.

**Still needed:** ask the reporter which screen trapped them, and audit the
remaining full-screen overlays on the simulator.

## #68 — Autosave / crash recovery  ✅

The gap was real and total on mobile: `backupService` is desktop-only by
construction, and every auto-save call site is gated on
`currentProject && currentScriptId`, so an imported-but-unsaved screenplay had
no persistence anywhere.

- `services/recoveryService.ts` (new) — a snapshot slot in `localStorage`,
  deliberately separate from the user's saved file. localStorage because it is
  synchronous, which is what makes the `pagehide` flush viable — iOS gives no
  async window during termination.
- `hooks/useRecoverySnapshot.ts` (new) — writes on a 10s interval plus on
  `visibilitychange`→hidden and `pagehide`. Clears rather than writes when the
  document matches the last save, so the prompt never offers work the user
  already saved.
- `components/RecoveryPromptDialog.tsx` (new) — "Recover unsaved changes?" on
  launch. Restoring is always explicit; a recovered draft can never silently
  overwrite a deliberately saved version.
- Cleared on explicit Save and on Save As.

Size-guarded at 3.5MB (below the ~5MB quota) so an oversized document cannot
take the existing snapshot down with it. Covered by
`services/recoveryService.test.ts`.

## #62 — Open/save in place from Files & Dropbox  ✅ Phase 1 (FDX/Fountain)

- `FileHelpers.m` — `ios_pick_document` (UIDocumentPickerViewController,
  `asCopy:NO`), `ios_read_bookmarked_file`, `ios_write_bookmarked_file`. The
  document's identity is a **security-scoped bookmark**, not a path: a picker
  path is only readable while its scope grant is held and the grant dies with
  the process. Reads and writes go through `NSFileCoordinator` so a provider
  like Dropbox can materialize and then upload the file.
- `lib.rs` — four commands. The poll result is a tagged enum, not
  `Option<Option<_>>`, which serde renders as `null` for both "pending" and
  "cancelled" — the frontend would have polled forever.
- `fileOps.ts` — `openDocumentInPlace()` / `saveDocumentInPlace()`.
- `editorStore` — `documentOrigin`. **Not persisted across launches**: a
  restored origin without its document would aim Save at the user's real file
  while the editor held a blank Untitled Screenplay.
- `MenuBar` — File ▸ "Open from Files…" (iOS only); Save writes back to the
  origin ahead of the project branch, and stays in the *error* state on failure
  rather than reporting a save that did not happen.
- `StatusBar` — shows the file Save will overwrite.

**Deliberately excluded:** `.fadein`. It is an OSF archive and OpenDraft has no
OSF writer, so `IN_PLACE_EDITABLE_EXTENSIONS` is `fdx`/`fountain`/`txt` and
picking a `.fadein` explains why rather than promising a Save it cannot honour.

**Data-loss guard:** `setImportedSource()` now also clears `documentOrigin` —
they are mutually exclusive answers to "where did this document come from", and
every document swap already routes through it. Without that an origin could
outlive its document and Save would write the *new* screenplay over the user's
original file. Pinned by `stores/documentOrigin.test.ts`.

**Follow-up:** `project.yml` still sets `LSSupportsOpeningDocumentsInPlace:
false`. That key governs the *Files-app tap* hand-off, not the in-app picker,
so Phase 1 works without it — but flipping it would let "Open in OpenDraft"
from Files edit in place too. Left alone because it changes the existing,
working file-association path and could not be tested here.

## #63 — Multiple scripts open at once  ⚠️ Implementable, blocked on a version pin

**Correction.** An earlier revision of this document said real iPadOS
multi-window was not achievable through Tauri. That is no longer true.

Tauri gained mobile multi-window in **2.11.0** (released 2026-04-30) via
[PR #14484](https://github.com/tauri-apps/tauri/pull/14484), merged 2026-03-23.
Verified: merge commit `093e2b47c` is an ancestor of `tauri-v2.11.0` and is not
in `2.10.3`. On iOS it is implemented with **UIScene** — genuine, tileable iPad
windows, exactly what the issue asks for. Requires iOS 13+. Latest Tauri is
2.11.5.

What it needs (per the Tauri docs):

- `src-tauri/Info.ios.plist` declaring `UIApplicationSceneManifest` with
  `UIApplicationSupportsMultipleScenes = true`.
- A `RunEvent::SceneRequested` handler that builds a new `WebviewWindow` —
  OpenDraft already has almost this exact code in `open_new_window` and the
  desktop warm-start branch of `RunEvent::Opened`.
- `core:webview:allow-create-webview-window` in the capability file, with
  `"windows": ["main", "main-*"]` to cover the dynamic labels.
- `app.supportsMultipleWindows` for a runtime availability check.

Note it is an iPad feature: on iPhone a new scene generally replaces the
current UI rather than tiling.

### The blocker — root-caused, fixed, and verified on device

**Correction.** An earlier revision of this document blamed the Android
cold-start crash on wry 0.55.0's missing ProGuard keep rule for
`WryActivity.getId()`. That upstream bug is real and wry 0.55.1 does fix it —
but it was **not** what crashed OpenDraft. Verified on an Infinix X6851B
(Android 15): with wry 0.55.1 and `getId` confirmed retained by R8, the app
still died instantly. The device log named the real cause in one line.

#### The actual cause

`tao 0.35` (tauri 2.11) **removed `ndk-context` entirely** — it is no longer
even a dependency. Multi-window means several activities, so a single global
context stopped making sense, and tao replaced it with a per-activity registry.

Nothing initializes ndk-context anymore, so `ndk_context::android_context()`
panics *unconditionally* with "android context was not initialized", and
`panic = "abort"` converts that to SIGABRT. Every JNI helper was affected — the
file picker, content-URI read/write, the share sheet, and the launching-intent
read — not just one path.

Backtrace that settled it:

```
#10 ndk_context::android_context   ← panic
#11 FnOnce::call_once
#12 tauri::app::setup              ← our setup() hook
```

#### Why it was so hard to see in May

`android_get_intent_data()` already carried a guard naming this exact panic:

```rust
let ctx = std::panic::catch_unwind(|| ndk_context::android_context()).ok()?;
```

**That guard never runs.** `[profile.release]` sets `panic = "abort"`, so the
process aborts before unwinding and `catch_unwind` is dead code in release
builds — while reading, in source, like protection. It works in debug (which
unwinds), which is precisely why the crash only ever appeared in release APKs
and looked unexplainable enough to be pinned around rather than fixed.

#### The fix

All six `ndk_context::android_context()` call sites now go through tao's
replacement, `main_android_context()`, which returns `Option<AndroidContext>`
carrying the same `java_vm` / `context_jobject` pointers and **returns None
instead of panicking**. Each helper is fallible rather than fatal.

Reached via `tauri::tao` — tauri's own re-export — rather than a separately
declared `tao` dependency, which could compile against a different instance of
the registry and always read empty.

`ndk-context` is removed from `Cargo.toml`, with a note explaining why it must
not be added back. The launching intent is also read lazily on the first
`get_opened_file` call rather than in `setup()`, since `setup()` runs before any
activity exists.

#### Verified on device

Infinix X6851B, Android 15, minified release APK:

- App alive 15s+ after cold start, zero panics/aborts in logcat
- Normal startup logged (SQLite init, frontend network call succeeded)
- UI renders correctly, including File ▸ "Open from Files…"
- R8 mapping confirms `getId` retained (the upstream fix is in too — it just
  was not the cause)

If the Android test fails, the fallback answer for #63 stands: in-app document
tabs plus a two-pane view, built on `ScriptDiffView` / `CompareVersionPicker`.

## Verification status

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| `vitest run` | 317 passed (24 files), +15 new |
| `npm run build` | clean |
| `cargo check` (host) | clean, 2 pre-existing warnings |
| `cargo check --target aarch64-apple-ios` | clean, 3 pre-existing warnings |
| `clang -fsyntax-only -fobjc-arc -Wall` vs iOS 15 SDK | clean |

**Not verified:** everything that needs a running iPad. No dev server was
running and the project convention is not to start one. Before release, on the
simulator and a device: full-screen / Split View 50-50 / Slide Over at 320, 375,
507 and 768pt, both orientations; the recovery prompt after a force-quit; and
an end-to-end Dropbox open → edit → Save → reopen in Fade In.

Also pending: a "What's New" entry and user-manual coverage for the recovery
prompt and Open from Files, per the release checklist in CLAUDE.md.

---

# Android parity (2026-08-13)

The iPad issues were reported on iPad, but most of the defects behind them were
never iOS-specific. Audit of how each fix reaches Android:

| Issue | Reaches Android? | Why |
|---|---|---|
| #67 toolbar overflow | **Yes, unchanged** | Pure CSS/JS driven by `@media (max-width: 768px)`. No platform gating at all — the same narrow-pane collapse happens in Android split-screen. |
| #68 crash recovery | **Yes, unchanged** | localStorage + `visibilitychange`/`pagehide`. No platform gating. Android also terminates backgrounded apps, so it was equally exposed. |
| #65 back/close | **Yes, plus an Android-only fix** | `useGoBack` and the Beat Board close button are platform-neutral. See below for the hardware Back button. |
| #66 safe area | **Yes, preserved** | `viewport-fit=cover` moved from a runtime patch (Android-only) into the static viewport tag, so Android keeps it and iOS gains it. `html.android` rules untouched. The `ios-windowed` menu-bar gutter stays iOS-only — it exists for the iPadOS window control, which has no Android equivalent. |
| #62 open in place | **Implemented separately** | Needed a different platform API. See below. |

## Android-only: the hardware Back button  (the #65 analogue)

`TauriActivity` sets `handleBackNavigation = false`, so `WryActivity` never
registers its `OnBackPressedCallback` and the system Back button fell through to
the default Activity handler — **which closes the app**. From Settings, the Beat
Board, or any secondary screen, the platform's primary back gesture quit
OpenDraft and discarded unsaved work.

That is the same trap #65 describes on iPad, reached by a different route, and
arguably worse: on iPad the user had to choose to force-quit, whereas on Android
the ordinary Back gesture did it.

Fixed in `src-tauri/android-src/MainActivity.kt` by overriding
`handleBackNavigation = true`. WryActivity then calls `goBack()` while the
WebView has history — OpenDraft is a single-page app, so router navigations are
history entries — and only exits at the first screen.

Note this pairs with #68: Back at the root still exits, but the recovery
snapshot now survives it.

## Android-only: open/save in place  (the #62 analogue)

iOS security-scoped bookmarks have a direct Android counterpart — a
`content://` URI with a permission persisted via
`takePersistableUriPermission()`. Both name the user's real file rather than a
sandbox copy, and both survive a relaunch.

Most of the plumbing already existed (`android_pick_file`, `read_content_uri`,
and a `takePersistableUriPermission` call for READ). What was missing:

- `android_pick_file` now adds `FLAG_GRANT_READ | WRITE | PERSISTABLE` to the
  picker intent. Without those flags there is nothing for
  `takePersistableUriPermission()` to persist.
- `MainActivity.onActivityResult` persists write as well as read. The two calls
  are separate on purpose: some providers grant read but not write, and asking
  for both at once fails the whole call, which would lose read access too.
- New `write_content_uri` Rust command — `ContentResolver.openOutputStream` in
  mode **`wt`**. Plain `"w"` does not truncate, so a screenplay that got shorter
  would keep the tail of the previous, longer version.
- `fileOps.ts` routes `openDocumentInPlace`/`saveDocumentInPlace` per platform;
  on Android the content URI *is* the bookmark, so the shared
  `documentOrigin` model, the Save routing and the status-bar indicator all work
  unchanged.
- `supportsOpenInPlace()` now returns true on both mobile platforms, so File ▸
  "Open from Files…" appears on Android too.

`.fadein` remains excluded on both platforms for the same reason: no OSF writer.

A provider that refuses a write grant will fail at Save time with a clear
message, and the editor stays in the error state rather than claiming a save
that did not happen.
