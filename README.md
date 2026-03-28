<p align="center">
  <img src="images/OpenDraft-1024x1024.png" alt="OpenDraft Logo" width="200">
</p>

<h1 align="center">OpenDraft</h1>

<p align="center">
  <strong>A free, open-source screenwriting application</strong><br>
  Professional screenplay editing with real-time collaboration — no subscription required.
</p>

<p align="center">
  <a href="https://github.com/Proteus-Technologies-Private-Limited/OpenDraft/releases/latest">
    <img src="https://img.shields.io/github/v/release/Proteus-Technologies-Private-Limited/OpenDraft?label=Download&style=for-the-badge" alt="Download Latest Release">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/github/license/Proteus-Technologies-Private-Limited/OpenDraft?style=for-the-badge" alt="License">
  </a>
</p>

---

## Download Desktop App

Get the latest version for your operating system — no setup, no account, just install and write.

| Platform | Download |
|----------|----------|
| **macOS** (Apple Silicon & Intel) | [Download .dmg](https://github.com/Proteus-Technologies-Private-Limited/OpenDraft/releases/latest/download/OpenDraft.dmg) |
| **Windows** (64-bit) | [Download .msi](https://github.com/Proteus-Technologies-Private-Limited/OpenDraft/releases/latest/download/OpenDraft.msi) |
| **Linux** (Debian/Ubuntu) | [Download .deb](https://github.com/Proteus-Technologies-Private-Limited/OpenDraft/releases/latest/download/OpenDraft.deb) |
| **Linux** (AppImage) | [Download .AppImage](https://github.com/Proteus-Technologies-Private-Limited/OpenDraft/releases/latest/download/OpenDraft.AppImage) |

> After downloading, open the installer and follow the prompts. The app is fully standalone — everything you need is bundled inside.

For all versions and platforms, visit the [Releases](https://github.com/Proteus-Technologies-Private-Limited/OpenDraft/releases) page.

---

## Features

- **Industry-standard screenplay editor** — Scene headings, action, character, dialogue, parenthetical, transition, and shot elements with proper formatting
- **Beat Board & Index Cards** — Visual story planning with drag-and-drop scene organization
- **Scene Navigator** — Jump between scenes instantly
- **Character Autocomplete** — Smart suggestions as you type character names
- **Version History** — Built-in version control with check-in, diff, and restore
- **Project Management** — Organize multiple screenplays with metadata (genre, logline, synopsis, etc.)
- **Asset Management** — Attach reference images, research docs, and notes to your projects
- **Search & Replace** — Find and replace across your screenplay
- **Spell Check** — Built-in spell checker with custom dictionary support
- **Import/Export** — Work with standard screenplay formats
- **Real-time Collaboration** — Multiple writers editing simultaneously (requires collaboration server)
- **Cross-platform** — Desktop app (macOS, Windows, Linux) and browser-based

---

## Run in Browser (Self-Hosted)

If you prefer to run OpenDraft in your browser instead of the desktop app, use the one-line setup script:

### Quick Start

```bash
git clone https://github.com/Proteus-Technologies-Private-Limited/OpenDraft.git
cd OpenDraft
./setup.sh
```

That's it. The script installs dependencies, builds the app, and opens it in your browser at **http://localhost:8000**.

### Requirements

- **Python 3.12+** — [Download Python](https://www.python.org/downloads/)
- **Node.js 18+** — [Download Node.js](https://nodejs.org/)
- **Git** — [Download Git](https://git-scm.com/downloads)

> See [docs/INSTALLATION.md](docs/INSTALLATION.md) for detailed step-by-step instructions, troubleshooting, and manual setup.

---

## Screenshots

<p align="center">
  <em>Screenshots coming soon</em>
</p>

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite, TipTap editor |
| Backend | Python 3.12, FastAPI, Uvicorn |
| Desktop | Tauri 2 (Rust) with bundled Python backend |
| Collaboration | Hocuspocus WebSocket server, Yjs CRDT |
| State Management | Zustand |
| Version Control | Git (per-project, built-in) |

---

## Project Structure

```
OpenDraft/
├── frontend/          # React + TypeScript web UI
├── backend/           # FastAPI Python API server
├── collab-server/     # Real-time collaboration server (Node.js)
├── src-tauri/         # Tauri 2 desktop app shell (Rust)
├── docs/              # Documentation
├── images/            # Logos and assets
├── setup.sh           # One-click browser setup script
├── build.sh           # Web build script
└── build-desktop.sh   # Desktop app build script
```

---

## Contributing

We welcome contributions! See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for guidelines on:

- Setting up your development environment
- Code style and conventions
- Submitting pull requests
- Reporting bugs

---

## Development

For developers who want to work on OpenDraft:

```bash
# Clone and install
git clone https://github.com/Proteus-Technologies-Private-Limited/OpenDraft.git
cd OpenDraft

# Backend
python3.12 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt

# Frontend
cd frontend && npm install && cd ..

# Start development servers (in separate terminals)
./start_backend.sh    # API server on http://localhost:8000
./start_frontend.sh   # Dev server on http://localhost:5173
```

### Building Desktop App

```bash
./build-desktop.sh
# Output: src-tauri/target/release/bundle/
```

See [docs/desktop-build.md](docs/desktop-build.md) for detailed desktop build instructions.

---

## License

OpenDraft is open-source software. See [LICENSE](LICENSE) for details.

---

<p align="center">
  Made with care by <a href="https://github.com/Proteus-Technologies-Private-Limited">Proteus Technologies</a>
</p>
