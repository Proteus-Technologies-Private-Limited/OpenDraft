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
2. Builds frontend, backend sidecar, and Tauri app
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
- **Sign deepest binaries first** — sidecar before main binary before app bundle
- The App Store build (`build-appstore.sh`) uses different certificates ("3rd Party Mac Developer"). Don't mix them up.

## Release Process

See `docs/RELEASE.md` for the full checklist. Key points:
- Use `./release.sh X.Y.Z` to automate the full release
- macOS `.dmg` is built locally with signing + notarization, then uploaded to GitHub Release via `gh`
- GitHub Actions builds Windows + Linux only
- Update "What's New" content in MenuBar.tsx and user-manual before releasing
