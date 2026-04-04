# OpenDraft Mobile Build Guide

## Prerequisites

- **Xcode** (with iOS Simulator)
- **CocoaPods**: `brew install cocoapods`
- **Xcode CLI tools pointing to full Xcode**: `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`

## One-time setup

```bash
# From the project root
cd /path/to/OpenDraft

# Initialize iOS target (already done)
./frontend/node_modules/.bin/tauri ios init
```

## Running on iOS Simulator

Make sure the frontend dev server is running first (in a separate terminal):

```bash
cd frontend && npm run dev
```

Then launch the iOS dev build:

```bash
# Boot a simulator (if not already running)
xcrun simctl boot "iPhone 16 Pro"

# Build and run on simulator
./frontend/node_modules/.bin/tauri ios dev "iPhone 16 Pro" \
  --no-dev-server-wait
```

## Architecture

All Tauri platforms (desktop + mobile) use the same local storage approach:

- **Storage**: Local SQLite database (`opendraft.db`) in the app's data directory
- **Assets**: Stored as files in the app's data directory under `assets/{projectId}/`
- **Versioning**: Delta-based SQLite commits (only changed scripts stored per version)
- **Collaboration**: Via remote WebSocket server (configurable in Settings)

The local storage layer (`local-storage.ts`) is dynamically imported on all Tauri
platforms and is tree-shaken out of web builds.

## Building for Release

```bash
./frontend/node_modules/.bin/tauri ios build
```

## Android

```bash
# Initialize Android target (requires Android Studio + NDK)
./frontend/node_modules/.bin/tauri android init

# Run on emulator
./frontend/node_modules/.bin/tauri android dev
```
