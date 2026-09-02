# Release Checklist

Step-by-step guide for publishing a new OpenDraft release.

---

## Automated release (recommended)

The `release.sh` script handles the entire process — version bumps, commit, and tag push (triggers CI for all platforms: macOS, Windows, Linux, Android).

```bash
./release.sh 0.4.0
```

**Before running**, manually update the "What's New" content (step 3 below) since that requires writing the changelog for the new version.

**What the script does:**
1. Updates version in all source files (tauri.conf.json, Cargo.toml, main.py, MenuBar.tsx, README, workflow, user manual)
2. Updates Cargo.lock
3. Commits and pushes to main
4. Creates and pushes the git tag (triggers GitHub Actions for all platform builds)

**Prerequisites:**
- GitHub CLI (`gh`) installed and authenticated
- Node.js in your environment (for frontend build)
- Apple signing secrets configured in GitHub (see below)
- No uncommitted changes in the working tree

**GitHub Secrets for macOS signing & notarization:**

| Secret | Description |
|--------|-------------|
| `APPLE_CERTIFICATE` | Base64-encoded `.p12` file (`base64 -i certificate.p12 \| pbcopy`) |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the `.p12` file |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Base Information Management Pvt. Ltd. (335RGMFDB6)` |
| `APPLE_ID` | Apple ID email for notarization |
| `APPLE_TEAM_ID` | `335RGMFDB6` |
| `APPLE_PASSWORD` | App-specific password from appleid.apple.com |

---

## The update manifest (`landing/updates.json`)

The in-app update notice reads this file from GitHub Pages. Nothing about it is
maintained by hand, and it is split in two because the two halves become true at
different times.

**Download channels** (`dmg`, `win`, `linux`, `apk`) are bumped by
`release.sh`, which calls `test-script/update_download_manifest.py`. These are
downloadable the instant CI publishes the release, and the edit reaches Pages
when the release PR merges — which `release.sh` already sequences *after* the
release is published, so the manifest and the README download links go live
together.

**Store channels** (`ios`, `mas`, `play`) are left alone at release time,
because Apple and Google are still reviewing. Naming the new version there would
send people to a listing still offering the build they already have. They are
moved later by the **Store Watch** workflow, which asks each store what it is
actually serving:

- Apple — the iTunes lookup API, no credentials. One record covers both the iOS
  and Mac App Store entries for this app id, so those two channels move together.
- Google — the Play Developer API, using the same
  `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64` secret `submit-stores.yml` uses. The
  track release's name is preferred; the versionCode is the fallback, decoded
  with Tauri's `major*1000000 + minor*1000 + patch`.

### Why the watch turns itself off

Neither store sends a webhook, so something has to ask more than once, and the
schedule is the only delay Actions offers. What it must not do is ask forever:

1. `publish-release` **enables** Store Watch and dispatches it. Enabling is a
   separate step because a disabled workflow ignores every trigger, including
   that one.
2. While enabled it wakes every 30 minutes.
3. Once every store channel has caught up it runs `gh workflow disable` on
   itself. A disabled workflow's schedule does not fire, so between releases it
   runs *zero* times.
4. If a submission is rejected the stores never catch up, so it also gives up
   after 14 days, opens an issue naming the channel, and disables itself.

**It ships disabled.** A new workflow with a `cron` starts firing as soon as it
lands on main, so it was switched off once by hand after merging. If you ever
need it back before a release, run it from the Actions tab — dispatching also
re-enables it.

**It pushes to main.** If branch protection refuses the `github-actions[bot]`
push, add that actor to the ruleset's bypass list, or the manifest will go stale
silently — the workflow is the only thing that moves the store channels.

---

## Manual release (step-by-step)

Use this if the script fails partway or you need more control.

### 1. Decide the new version

Choose the next version number following semver (e.g. `0.3.0` → `0.4.0`).

Throughout this guide, replace `X.Y.Z` with the new version.

**One number, every platform.** `src-tauri/tauri.conf.json` is the only place a
version is decided. Every store and download derives from it: Tauri writes it
into `CFBundleShortVersionString` for the App Store builds and into the Android
`versionName`, and `release.sh` seds it through the rest of the tree.

Never set a version by hand in App Store Connect, and never pass
`--app_version` to `submit-stores.yml` with anything but the number already in
`tauri.conf.json`. Doing that in the past left the App Store on 1.8 while every
other platform was on 0.26.3 — the same app, two numbers, so the version in
Help → About matched nothing a user could look up, bug reports were ambiguous,
and the in-app update check of issue #106 had nothing it could compare against.
Release 2.0.0 exists to put the two back together.

Two constraints on the number you pick:

- **Apple only goes up.** Each App Store version must sort strictly greater than
  the last published one, so after 2.0.0 there is no going back to `0.x`. This is
  why unification had to clear 1.8 rather than pull Apple down.
- **Android's `versionCode` only goes up too.** Tauri derives it as
  `major*1000000 + minor*1000 + patch`, so 0.26.3 was 26003 and 2.0.0 is
  2000000. Fine going forward, but it means minor and patch must stay under
  1000 and the major can never be lowered.

### 2. Update version in all source files

| # | File | What to change |
|---|------|----------------|
| 1 | `src-tauri/tauri.conf.json` | `"version": "X.Y.Z"` |
| 2 | `src-tauri/Cargo.toml` | `version = "X.Y.Z"` |
| 3 | `backend/app/main.py` | Three occurrences of `version="X.Y.Z"` (FastAPI app + two health endpoints) |
| 4 | `frontend/src/components/MenuBar.tsx` | `Version X.Y.Z` in the About dialog |
| 5 | `README.md` | Download link filenames (`.dmg`, `.exe`, `.msi`, `.deb`, `.AppImage`, `.rpm`) |
| 6 | `.github/workflows/release.yml` | Release body download table filenames |

After updating Cargo.toml, run `cargo generate-lockfile` in `src-tauri/` to sync `Cargo.lock`.

### 3. Update "What's New" content

Write the feature list / changelog for this version in:

| # | File | Section |
|---|------|---------|
| 1 | `frontend/src/components/MenuBar.tsx` | The "What's New in vX.Y.Z" list inside the About dialog (~line 571) |
| 2 | `user-manual/index.html` | The `<h2 id="whats-new">What's New in vX.Y.Z</h2>` section |
| 3 | `user-manual/search.js` | Update the search index entry for "What's New" |

### 4. Update user manual footer version

All HTML pages in `user-manual/` have a footer with the version:

```html
OpenDraft User Manual · vX.Y.Z · Made by Proteus Technologies
```

Update the version in the footer of every `.html` file in `user-manual/`.

### 5. Commit version bump

```bash
git add -A
git commit -m "Bump version to X.Y.Z"
git push origin main
```

### 6. Create the GitHub release

Tag and push:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

This triggers the GitHub Actions workflow (`.github/workflows/release.yml`) which builds all platforms:
- **macOS** (.dmg) — signed and notarized with Apple Developer certificate
- **Windows** (.exe, .msi) — optionally signed
- **Linux** (.deb, .AppImage)
- **Android** (.apk, .aab)

Wait for the workflow to complete successfully. Verify all platform assets are present on the release.

### 7. Post-release verification

- [ ] Download link from README works for each platform
- [ ] User manual "Download" header link goes to the release page
- [ ] User manual installation page links to the latest release
- [ ] About dialog in the app shows the new version and correct "What's New"

---

## Quick reference: files to touch per release

```
src-tauri/tauri.conf.json          # version
src-tauri/Cargo.toml               # version
backend/app/main.py                # version (3 places)
frontend/src/components/MenuBar.tsx # version + What's New
user-manual/index.html             # What's New + footer
user-manual/search.js              # search index
user-manual/*.html                 # footer version (all pages)
README.md                          # download link filenames
.github/workflows/release.yml      # release body filenames
```
