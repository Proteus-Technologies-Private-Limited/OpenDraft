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

The macOS `.dmg` is built via **GitHub Actions** (in `.github/workflows/release.yml`), same as Windows, Linux, and Android. It is signed and notarized automatically when the correct GitHub secrets are configured.

### GitHub Secrets for macOS

| Secret | Description |
|--------|-------------|
| `APPLE_CERTIFICATE` | Base64-encoded `.p12` file containing the Developer ID Application certificate + private key |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the `.p12` file |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Base Information Management Pvt. Ltd. (335RGMFDB6)` |
| `APPLE_ID` | Apple ID email for notarization |
| `APPLE_TEAM_ID` | `335RGMFDB6` |
| `APPLE_PASSWORD` | App-specific password from appleid.apple.com |

### How to export the certificate as `.p12`

1. Open Keychain Access, find `Developer ID Application: Base Information Management Pvt. Ltd.`
2. Right-click → Export Items → save as `.p12` with a password
3. Base64-encode: `base64 -i certificate.p12 | pbcopy`
4. Paste into the `APPLE_CERTIFICATE` GitHub secret

### Local build (optional)

`./build-desktop.sh` can still build a signed `.dmg` locally if you have Apple credentials in `.env`.

### Common mistakes to avoid

- **Never skip signing/notarization** — unsigned `.dmg` files trigger "damaged and can't be opened" on user machines
- Use **Developer ID Application** certificate for direct distribution (not "3rd Party Mac Developer" — that's for App Store only)
- The App Store build (`build-appstore.sh`) uses different certificates. Don't mix them up.

## Promotion & Articles

Promotion materials (blog posts, articles, social media content) go in `Promotion/posts/` in the project root — **not** in `docs/`.

---

## Release Process

See `docs/RELEASE.md` for the full checklist. Key points:
- Use `./release.sh X.Y.Z` to automate the full release
- GitHub Actions builds **all platforms**: macOS (.dmg), Windows (.exe/.msi), Linux (.deb/.AppImage), Android (.apk/.aab), iOS (.ipa)
- macOS builds are signed and notarized via Apple secrets in GitHub
- Update "What's New" content in MenuBar.tsx and user-manual before releasing

---

## Android Build

The Android `.apk` and `.aab` are built via **GitHub Actions** (in `.github/workflows/release.yml`, the `build-android` job). There is no local Android build — the CI runner provides the SDK, NDK, and Rust cross-compilation targets.

### How it works

1. CI runs `tauri android init` to generate the Gradle project (since `src-tauri/gen/` is gitignored)
2. Patches `tauri.conf.json` to remove `externalBin` (no Python sidecar on Android — the app uses local SQLite)
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

---

## iOS Build

The iOS `.ipa` is built via **GitHub Actions** (in `.github/workflows/release.yml`, the `build-ios` job). It runs on a macOS runner, builds the Tauri iOS app, and uploads to both the GitHub Release and App Store Connect.

### How it works

1. CI runs `tauri ios init` to generate the Xcode project (since `src-tauri/gen/` is gitignored)
2. Imports the Apple Distribution certificate and provisioning profile from GitHub secrets
3. Patches `tauri.conf.json` to remove `externalBin` (no Python sidecar on iOS — the app uses local SQLite)
4. Builds with `tauri ios build --export-method app-store-connect`
5. If App Store Connect API key is configured, uploads the IPA directly to App Store Connect
6. Uploads renamed artifact (`OpenDraft_X.Y.Z_ios.ipa`) to the GitHub Release

### GitHub Secrets for iOS

All secrets are required for the build to succeed:

| Secret | Description |
|--------|-------------|
| `IOS_CERTIFICATE` | Base64-encoded `.p12` containing the Apple Distribution certificate + private key |
| `IOS_CERTIFICATE_PASSWORD` | Password for the `.p12` file |
| `IOS_PROVISION_PROFILE` | Base64-encoded `.mobileprovision` file for the app |

For automatic App Store Connect upload (optional):

| Secret | Description |
|--------|-------------|
| `APPSTORE_API_KEY` | Base64-encoded App Store Connect API key (`.p8` file) |
| `APPSTORE_API_KEY_ID` | Key ID from App Store Connect (e.g., `XXXXXXXXXX`) |
| `APPSTORE_API_ISSUER_ID` | Issuer ID from App Store Connect |

### How to export the iOS certificate as `.p12`

1. Open Keychain Access, find `Apple Distribution: Base Information Management Pvt. Ltd. (335RGMFDB6)`
2. Right-click → Export Items → save as `.p12` with a password
3. Base64-encode: `base64 -i distribution.p12 | pbcopy`
4. Paste into the `IOS_CERTIFICATE` GitHub secret

### How to get the provisioning profile

1. Go to developer.apple.com → Certificates, Identifiers & Profiles → Profiles
2. Create or download an App Store provisioning profile for `com.proteus.opendraft`
3. Base64-encode: `base64 -i OpenDraft_AppStore.mobileprovision | pbcopy`
4. Paste into the `IOS_PROVISION_PROFILE` GitHub secret

### How to create an App Store Connect API key

1. Go to appstoreconnect.apple.com → Users and Access → Integrations → App Store Connect API
2. Click "+" to generate a new key with "App Manager" role
3. Download the `.p8` file (only available once!)
4. Base64-encode: `base64 -i AuthKey_XXXXXXXXXX.p8 | pbcopy`
5. Note the Key ID and Issuer ID shown on the page
6. Add all three values to GitHub secrets
