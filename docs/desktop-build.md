# OpenDraft Desktop Build Guide

## Architecture

The desktop app uses **Tauri 2** to wrap the web application in a native window.
All data is stored locally in a **SQLite database** — no backend process is needed.

```
Tauri Native Window
├── Frontend (served from Tauri's built-in asset protocol)
├── Local SQLite database (opendraft.db)
└── Collaboration via remote WebSocket server (optional)
```

User data is stored in the platform-specific app data directory:
- macOS: `~/Library/Application Support/com.opendraft.app/`
- Windows: `%APPDATA%/com.opendraft.app/`
- Linux: `~/.local/share/com.opendraft.app/`

## Prerequisites

- **Node.js** >= 18
- **Rust** (install via https://rustup.rs)

### macOS additional requirements:
- Xcode Command Line Tools: `xcode-select --install`

### Windows additional requirements:
- WebView2 (usually pre-installed on Windows 10+)
- Visual Studio Build Tools with C++ workload

### Linux additional requirements:
- `sudo apt install libwebkit2gtk-4.1-dev build-essential libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev`

## Quick Build

```bash
./build-desktop.sh
```

This runs 2 steps:
1. Builds the frontend
2. Builds the Tauri desktop app (with signing + notarization on macOS)

The final installer can be found in `src-tauri/target/release/bundle/`.

## Manual Build Steps

### 1. Build frontend

```bash
cd frontend
npm run build
```

### 2. Build Tauri app

```bash
cd frontend
npx @tauri-apps/cli build
```

## Custom App Icon

Replace the placeholder icons with your own design:

```bash
# Provide a 1024x1024 RGBA PNG, then run:
cd frontend
npx @tauri-apps/cli icon path/to/your-icon.png
```

This generates all required icon sizes for macOS, Windows, and Linux.

## Development Notes

- For day-to-day development, use the existing web workflow (`start_backend.sh` + `npm run dev`).
- `cargo tauri dev` launches the frontend in a native window with local SQLite storage.
- The web version uses the Python backend over HTTP. The desktop app does not need it.
