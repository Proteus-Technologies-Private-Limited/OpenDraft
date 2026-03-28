# OpenDraft Desktop Build Guide

## Architecture

The desktop app uses **Tauri 2** to wrap the web application in a native window.
The FastAPI backend is compiled into a standalone binary using **PyInstaller** and
bundled as a Tauri "sidecar" process.

```
Tauri Native Window
├── Frontend (served from Tauri's built-in asset protocol)
├── Backend Sidecar (PyInstaller binary on localhost:18321)
└── On exit → sidecar is killed automatically
```

User data is stored in the platform-specific app data directory:
- macOS: `~/Library/Application Support/com.opendraft.app/`
- Windows: `%APPDATA%/com.opendraft.app/`
- Linux: `~/.local/share/com.opendraft.app/`

## Prerequisites

- **Node.js** >= 18
- **Rust** (install via https://rustup.rs)
- **Python 3.12** with venv
- **PyInstaller** (installed automatically by the build script)

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

This runs all 5 steps automatically:
1. Builds the frontend with the Tauri API base URL
2. Copies frontend dist to `backend/static/`
3. Builds the backend sidecar with PyInstaller
4. Copies the sidecar binary to `src-tauri/binaries/`
5. Builds the Tauri desktop app

The final installer can be found in `src-tauri/target/release/bundle/`.

## Manual Build Steps

### 1. Build frontend

```bash
cd frontend
VITE_API_BASE="http://localhost:18321/api" npm run build
```

### 2. Copy frontend to backend static dir

```bash
rm -rf backend/static
cp -r frontend/dist backend/static
```

### 3. Build backend sidecar

```bash
cd backend
../venv/bin/pip install pyinstaller
../venv/bin/pyinstaller --noconfirm --clean opendraft-api.spec
```

### 4. Copy sidecar binary

```bash
TARGET_TRIPLE=$(rustc -vV | grep '^host:' | awk '{print $2}')
cp backend/dist/opendraft-api src-tauri/binaries/opendraft-api-$TARGET_TRIPLE
chmod +x src-tauri/binaries/opendraft-api-$TARGET_TRIPLE
```

### 5. Build Tauri app

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
- `cargo tauri dev` can launch the frontend in a native window but requires the backend to be running manually on port 8000.
- The sidecar binary does NOT exist during development — only created by `build-desktop.sh`.
- The frontend detects the API URL via the `VITE_API_BASE` environment variable, defaulting to `http://localhost:8000/api` for development.
