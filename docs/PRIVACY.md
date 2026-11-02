# Privacy Policy

**Last updated: November 2, 2026**

## Overview

OpenDraft is a screenwriting application developed by Proteus Technologies Private Limited, available on macOS, iOS, iPadOS, Windows, Linux, and Android. Your privacy is important to us.

## Data Collection

**Core writing runs on your device without telemetry.** Collaboration and add-ons can send data to services you choose; the network connections and dictation providers are described below.

Specifically:

- **No analytics or tracking** — We do not use any analytics services, crash reporters, or tracking tools.
- **No user accounts required** — No registration, login, or authentication is required for core functionality.
- **No cloud storage** — All your screenplays and project data are stored locally on your device.
- **No advertising** — OpenDraft does not display ads or use advertising identifiers.

## Network Connections

Core writing works offline. **Real-time collaboration** and enabled add-ons can use network connections. Collaboration requires connecting to a collaboration server. When using collaboration:

- You choose which server to connect to (self-hosted or the public demo server).
- Only your screenplay content and a display name are transmitted to the collaboration server during an active session.
- No data is retained on the collaboration server after the session ends.
- Collaboration is entirely optional — core writing features work without any network connection. Optional add-ons may connect to services described below.

### Optional add-ons

Some features are **add-ons** that you can choose to turn on in Settings → Add-ons — for example an AI writing assistant. Every add-on is off until you turn it on, and while it is off it does nothing and connects to nothing. Before you turn one on, OpenDraft shows what it sends off your device and where. An add-on that uses a service you configure (such as an AI server) talks only to that service, and only after you have turned it on. Turning an add-on off stops it at once and can delete the settings it stored, such as an API key.

**Dictation** is also off until enabled here. The engine is chosen before activation:

- **Local Whisper:** recorded audio stays on your device. First use downloads model assets from **huggingface.co**, which sees your IP address. Downloads can recur if the browser cache is cleared or unavailable. No audio is uploaded.
- **Browser speech service:** recorded voice may be sent to **Google, Apple or Microsoft**, depending on the browser.
- **Device speech service:** iOS requests on-device recognition when supported for the language; otherwise **Apple** may process audio remotely. Android requests offline recognition from the installed provider (usually **Google**); providers can ignore that preference.

Starting recognition requires a separate Start click. Engine, language and voice-command preferences are stored only on this device and can be deleted when turning the add-on off. Closing or disabling dictation stops capture and discards pending results.

OpenDraft never turns on an AI feature for you. Whether to use AI in your writing is your choice.

## Data Storage

Your screenplays, projects, and settings are stored locally on your device:

- **macOS:** `~/Library/Application Support/com.proteus.opendraft/`
- **iOS/iPadOS:** App sandbox (managed by iOS, accessible via Files app)
- **Windows:** `%APPDATA%\com.proteus.opendraft\`
- **Linux:** `~/.local/share/com.proteus.opendraft/`
- **Android:** App-private storage

This data stays on your device unless you explicitly export or share it, collaborate, or enable an add-on that sends it to a service as described above. You can delete it at any time by removing the application and its data folder.

## Third-Party Services

Core writing does not send data to third-party services. Optional add-ons can contact the providers disclosed before activation, including the dictation providers above. No SDKs from third-party analytics, advertising, or tracking providers are included in the application.

## Children's Privacy

OpenDraft does not collect any data from any users, including children under 13. The app is safe for use by all ages.

## Your Rights

Since OpenDraft does not collect personal data, there is no personal data to access, correct, or delete. Your screenplay files are entirely under your control on your device.

## Changes to This Policy

If we update this privacy policy, we will post the changes here with a revised date. Since OpenDraft does not collect data, we do not anticipate significant changes.

## Contact

If you have questions about this privacy policy, contact us at:

- GitHub: [github.com/Proteus-Technologies-Private-Limited/OpenDraft](https://github.com/Proteus-Technologies-Private-Limited/OpenDraft)
- Email: kandarp.baghar@proteustech.co
