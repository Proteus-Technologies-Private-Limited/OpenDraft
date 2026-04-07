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

## Manual release (step-by-step)

Use this if the script fails partway or you need more control.

### 1. Decide the new version

Choose the next version number following semver (e.g. `0.3.0` → `0.4.0`).

Throughout this guide, replace `X.Y.Z` with the new version.

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
