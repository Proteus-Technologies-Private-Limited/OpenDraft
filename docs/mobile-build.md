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
# Note: --no-dev-server-wait skips waiting for the dev server
# Note: -c overrides externalBin since the Python sidecar is not needed on mobile
./frontend/node_modules/.bin/tauri ios dev "iPhone 16 Pro" \
  --no-dev-server-wait \
  -c '{"bundle":{"externalBin":[]},"build":{"beforeDevCommand":""}}'
```

## Architecture

On mobile, the Python backend sidecar is not available. Instead:

- **Storage**: Local SQLite database (`opendraft.db`) in the app's data directory
- **Assets**: Stored as files in the app's data directory under `assets/{projectId}/`
- **Versioning**: SQLite-based snapshots (replaces Git-based versioning on desktop)

The mobile storage layer (`mobile-storage.ts`) is dynamically imported only on mobile
devices and is tree-shaken out of web and desktop builds.

## Building for Release

```bash
./frontend/node_modules/.bin/tauri ios build \
  -c '{"bundle":{"externalBin":[]}}'
```

## Android (future)

```bash
# Initialize Android target (requires Android Studio + NDK)
./frontend/node_modules/.bin/tauri android init

# Run on emulator
./frontend/node_modules/.bin/tauri android dev \
  -c '{"bundle":{"externalBin":[]},"build":{"beforeDevCommand":""}}'
```
