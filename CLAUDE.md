# OpenDraft — Claude Instructions

## Open-Core Architecture

OpenDraft is the **open-source core** (MIT license). A separate **OpenDraft-Pro** repo (private, at `../OpenDraft-Pro/`) extends it with commercial plugins.

### Plugin System

The core exposes a plugin architecture so Pro features can be added without modifying core code:

- **Frontend:** `frontend/src/plugins/registry.ts` — `pluginRegistry.register()` to add menu items, sidebar panels, routes, and editor extensions
- **Backend:** `backend/app/plugins.py` — `register_router()` and `register_hook()` for API routes and lifecycle hooks
- **Integration points:** MenuBar appends plugin menu items, App.tsx renders plugin routes, ScreenplayEditor renders plugin panels and editor extensions

### Key Rules

- **Never add commercial/Pro features to this repo** — they go in OpenDraft-Pro
- Plugin architecture changes (registry, hooks, extension points) belong HERE
- Bug fixes to existing features go HERE — they automatically flow to Pro via git submodule
- The `pluginRegistry` import in MenuBar, App.tsx, and ScreenplayEditor is how Pro injects features at runtime

### Repo Relationship

```
OpenDraft (this repo, public, MIT)     ← upstream
    ↑
OpenDraft-Pro (private, proprietary)   ← imports this as git submodule at core/
```

---

## macOS Desktop Build — Code Signing & Notarization

The macOS `.dmg` is built **locally** — never via GitHub Actions. It must be properly signed and notarized or macOS Gatekeeper will reject it as "damaged".

### Build command

```bash
./build-desktop.sh
```

### What the build does

1. Loads Apple credentials from `.env` in project root
2. Builds frontend and Tauri app (desktop uses local SQLite — no Python sidecar)
3. Signs with **Developer ID Application** certificate (not "3rd Party Mac Developer" — that's for App Store only)
4. Submits to Apple for **notarization** via `notarytool`
5. **Staples** the notarization ticket to the `.dmg`

### Requirements

- **Developer ID Application** certificate in keychain: `Developer ID Application: Base Information Management Pvt. Ltd. (335RGMFDB6)`
- **`.env` file** in project root with Apple credentials (gitignored):
  ```
  APPLE_ID=kandarp.baghar@proteustech.co
  APPLE_TEAM_ID=335RGMFDB6
  APPLE_PASSWORD=<app-specific-password from appleid.apple.com>
  ```

### Common mistakes to avoid

- **Never skip signing/notarization** — unsigned `.dmg` files trigger "damaged and can't be opened" on user machines
- **Never use `APPLE_SIGNING_IDENTITY="-"` for the final build** — that produces an unsigned app. It's only used as an intermediate step before re-signing
- The App Store build (`build-appstore.sh`) uses different certificates ("3rd Party Mac Developer"). Don't mix them up.

## Promotion & Articles

Promotion materials (blog posts, articles, social media content) go in `Promotion/posts/` in the project root — **not** in `docs/`.

---

## Release Process

See `docs/RELEASE.md` for the full checklist. Key points:
- Use `./release.sh X.Y.Z` to automate the full release
- macOS `.dmg` is built locally with signing + notarization, then uploaded to GitHub Release via `gh`
- GitHub Actions builds Windows, Linux, **and Android** (APK + AAB)
- Update "What's New" content in MenuBar.tsx and user-manual before releasing

---

## Android Build

The Android `.apk` and `.aab` are built via **GitHub Actions** (in `.github/workflows/release.yml`, the `build-android` job). There is no local Android build — the CI runner provides the SDK, NDK, and Rust cross-compilation targets.

### How it works

1. CI runs `tauri android init` to generate the Gradle project (since `src-tauri/gen/` is gitignored)
2. Patches `tauri.conf.json` to clear build commands for CI
3. If signing secrets are configured, patches `build.gradle.kts` with release signing config
4. Builds both `.apk` (sideloadable) and `.aab` (Play Store)
5. Uploads renamed artifacts (`OpenDraft_X.Y.Z_android.apk/aab`) to the GitHub Release

### GitHub Secrets for Android signing

For unsigned builds (testing), no secrets are needed. For signed/production builds, add these repository secrets:

| Secret | Description |
|--------|-------------|
| `ANDROID_KEYSTORE_BASE64` | Base64-encoded release keystore (`base64 -i release.keystore`) |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Key alias (e.g., `opendraft`) |
| `ANDROID_KEY_PASSWORD` | Key password |

### Generate a keystore (one-time)

```bash
keytool -genkey -v -keystore opendraft-release.keystore \
  -alias opendraft -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=OpenDraft, O=Proteus Technologies"
base64 -i opendraft-release.keystore | pbcopy  # copy to clipboard for GitHub secret
```

### Local Android development (optional)

Requires Android Studio (or SDK command-line tools), NDK 27, and Rust Android targets:
```bash
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
cd frontend && npx tauri android init && npx tauri android build --apk
```
