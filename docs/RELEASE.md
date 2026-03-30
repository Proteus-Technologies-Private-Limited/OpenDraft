# Release Checklist

Step-by-step guide for publishing a new OpenDraft release.

---

## Automated release (recommended)

The `release.sh` script handles the entire process — version bumps, commit, local macOS build, tag push (triggers CI for Windows + Linux), and uploads the `.dmg` to the GitHub Release.

```bash
./release.sh 0.4.0
```

**Before running**, manually update the "What's New" content (step 3 below) since that requires writing the changelog for the new version.

**What the script does:**
1. Updates version in all source files (tauri.conf.json, Cargo.toml, main.py, MenuBar.tsx, README, workflow, user manual)
2. Updates Cargo.lock
3. Commits and pushes to main
4. Builds macOS `.dmg` locally (uses Apple Developer certificates on your machine)
5. Creates and pushes the git tag (triggers GitHub Actions for Windows + Linux builds)
6. Waits for CI to create the GitHub Release
7. Uploads the `.dmg` to the release via `gh release upload`

**Prerequisites:**
- GitHub CLI (`gh`) installed and authenticated
- Rust, Node.js, Python 3.12 in your environment
- Apple Developer certificates configured for code signing
- No uncommitted changes in the working tree

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

### 6. Build macOS desktop app locally

The macOS `.dmg` is built **locally** (not in GitHub Actions) because it requires Apple Developer certificates for signing and notarization.

```bash
./build-desktop.sh
```

The output `.dmg` will be in `src-tauri/target/release/bundle/dmg/`.

Verify the build:
- Open the `.dmg` and install the app
- Launch it and confirm the About dialog shows the correct version
- Test basic functionality (create project, write, save)

### 7. Create the GitHub release

Tag and push:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

This triggers the GitHub Actions workflow (`.github/workflows/release.yml`) which:
- Builds **Windows** (.exe, .msi) and **Linux** (.deb, .AppImage) installers
- Creates a GitHub Release with those assets attached

Wait for the workflow to complete successfully.

### 8. Upload macOS build to the release

```bash
gh release upload vX.Y.Z src-tauri/target/release/bundle/dmg/OpenDraft_X.Y.Z_aarch64.dmg \
  --repo Proteus-Technologies-Private-Limited/OpenDraft
```

Verify all platform assets are present on the release:
- `OpenDraft_X.Y.Z_aarch64.dmg` (macOS — manually uploaded)
- `OpenDraft_X.Y.Z_x64-setup.exe` (Windows)
- `OpenDraft_X.Y.Z_x64_en-US.msi` (Windows)
- `OpenDraft_X.Y.Z_amd64.deb` (Linux)
- `OpenDraft_X.Y.Z_amd64.AppImage` (Linux)

### 9. Post-release verification

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
