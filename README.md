<p align="center">
  <img src="images/OpenDraft-1024x1024.png" alt="OpenDraft — Free Open Source Screenwriting Software" width="200">
</p>

<h1 align="center">OpenDraft — Free Open-Source Screenwriting Software</h1>

<p align="center">
  <strong>The free, open-source screenplay editor and screenwriting app for macOS, Windows, and Linux.</strong><br>
  A modern alternative to Final Draft and WriterSolo — professional screenplay formatting, real-time collaboration, and built-in version control. No subscription, no account required.
</p>

<p align="center">
  <a href="https://github.com/Proteus-Technologies-Private-Limited/OpenDraft/releases/latest">
    <img src="https://img.shields.io/github/v/release/Proteus-Technologies-Private-Limited/OpenDraft?label=Download&style=for-the-badge" alt="Download OpenDraft Screenwriting Software">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/github/license/Proteus-Technologies-Private-Limited/OpenDraft?style=for-the-badge" alt="MIT License">
  </a>
  <a href="https://github.com/Proteus-Technologies-Private-Limited/OpenDraft/stargazers">
    <img src="https://img.shields.io/github/stars/Proteus-Technologies-Private-Limited/OpenDraft?style=for-the-badge" alt="GitHub Stars">
  </a>
  <a href="https://github.com/Proteus-Technologies-Private-Limited/OpenDraft/releases/latest">
    <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue?style=for-the-badge" alt="Platform Support — macOS Windows Linux">
  </a>
</p>

---

## Why OpenDraft?

OpenDraft is built for screenwriters who want a **professional, free screenplay editor** without the cost of Final Draft or the limitations of free alternatives. Whether you're writing your first short film or collaborating on a feature-length screenplay, OpenDraft provides everything you need:

- **100% free and open source** — no trials, no subscriptions, no feature locks
- **Works offline** — desktop app runs entirely on your machine, your scripts stay private
- **Real-time collaboration** — co-write with your writing partner simultaneously
- **Built-in version control** — track every draft, compare changes, restore any version
- **Cross-platform** — native apps for macOS, Windows, and Linux, plus a self-hosted browser option

---

## Download Desktop App

Get the latest version for your operating system — no setup, no account, just install and write.

| Platform | Download |
|----------|----------|
| **macOS** (Apple Silicon) | [Download .dmg](https://github.com/Proteus-Technologies-Private-Limited/OpenDraft/releases/latest/download/OpenDraft_0.3.0_aarch64.dmg) |
| **Windows** (64-bit) | [Download .exe](https://github.com/Proteus-Technologies-Private-Limited/OpenDraft/releases/latest/download/OpenDraft_0.3.0_x64-setup.exe) |
| **Windows** (MSI) | [Download .msi](https://github.com/Proteus-Technologies-Private-Limited/OpenDraft/releases/latest/download/OpenDraft_0.3.0_x64_en-US.msi) |
| **Linux** (Debian/Ubuntu) | [Download .deb](https://github.com/Proteus-Technologies-Private-Limited/OpenDraft/releases/latest/download/OpenDraft_0.3.0_amd64.deb) |
| **Linux** (AppImage) | [Download .AppImage](https://github.com/Proteus-Technologies-Private-Limited/OpenDraft/releases/latest/download/OpenDraft_0.3.0_amd64.AppImage) |
| **Linux** (RPM/Fedora) | [Download .rpm](https://github.com/Proteus-Technologies-Private-Limited/OpenDraft/releases/latest/download/OpenDraft-0.3.0-1.x86_64.rpm) |

> After downloading, open the installer and follow the prompts. The app is fully standalone — everything you need is bundled inside.

For all versions and platforms, visit the [Releases](https://github.com/Proteus-Technologies-Private-Limited/OpenDraft/releases) page.

---

## Features

### Screenplay Editor
- **Industry-standard screenplay formatting** — Scene headings, action, character, dialogue, parenthetical, transition, and shot elements with proper formatting following Hollywood screenplay standards
- **Character Autocomplete** — Smart suggestions as you type character names
- **Search & Replace** — Find and replace across your entire screenplay
- **Spell Check** — Built-in spell checker with custom dictionary support
- **Import/Export** — Work with standard screenplay formats (Fountain, PDF)

### Story Planning & Organization
- **Beat Board & Index Cards** — Visual story planning with drag-and-drop scene organization
- **Scene Navigator** — Jump between scenes instantly
- **Project Management** — Organize multiple screenplays with metadata (genre, logline, synopsis)
- **Asset Management** — Attach reference images, research docs, and notes to your projects

### Collaboration & Version Control
- **Real-time Collaboration** — Multiple writers editing simultaneously with conflict-free merging (CRDT-based)
- **Version History** — Built-in Git-based version control with check-in, diff, and restore
- **No cloud lock-in** — All data stored locally, you own your work

### Cross-Platform
- **Desktop app** — Native apps for macOS, Windows, and Linux
- **Browser-based** — Self-host and access from any browser
- **Fully offline capable** — No internet connection required for the desktop app

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

## Comparison with Other Screenwriting Software

| Feature | OpenDraft | Final Draft | WriterSolo | Highland |
|---------|-----------|-------------|------------|----------|
| **Price** | Free | $249.99 | Free (limited) | $49.99 |
| **Open Source** | Yes (MIT) | No | No | No |
| **Real-time Collaboration** | Yes | No | No | No |
| **Version History** | Built-in (Git) | Manual saves | No | No |
| **Cross-platform** | macOS, Windows, Linux | macOS, Windows | Browser | macOS |
| **Offline Support** | Yes | Yes | No | Yes |
| **Self-hosted** | Yes | No | No | No |
| **Beat Board / Index Cards** | Yes | Yes | No | No |
| **No Account Required** | Yes | No | No | No |

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

OpenDraft is released under the [MIT License](LICENSE) — free for personal and commercial use.

---

## Keywords

screenwriting software, screenplay editor, screenwriting app, open source screenwriting, free screenplay software, Final Draft alternative, scriptwriting software, screenwriting tool, collaborative screenwriting, screenplay formatter, fountain editor, film writing software, TV writing software, script editor, writing app for screenwriters

---

<p align="center">
  Made with care by <a href="https://github.com/Proteus-Technologies-Private-Limited">Proteus Technologies</a>
</p>
