# Installation Guide

This guide covers all the ways to install and run OpenDraft.

---

## Option 1: Desktop App (Recommended for most users)

The easiest way to use OpenDraft. Download, install, and start writing.

### macOS

1. Go to the [Releases](https://github.com/Proteus-Technologies-Private-Limited/OpenDraft/releases/latest) page
2. Download **OpenDraft.dmg**
3. Open the `.dmg` file
4. Drag **OpenDraft** into your **Applications** folder
5. Double-click OpenDraft to launch

> **First launch on macOS:** You may see "OpenDraft can't be opened because it is from an unidentified developer." Right-click the app, select **Open**, then click **Open** in the dialog. You only need to do this once.

### Windows

1. Go to the [Releases](https://github.com/Proteus-Technologies-Private-Limited/OpenDraft/releases/latest) page
2. Download **OpenDraft.msi**
3. Double-click the installer and follow the prompts
4. Launch OpenDraft from the Start Menu or Desktop shortcut

### Linux

**Debian/Ubuntu (.deb):**
```bash
# Download from the Releases page, then:
sudo dpkg -i OpenDraft.deb
```

**AppImage (any Linux distro):**
```bash
# Download from the Releases page, then:
chmod +x OpenDraft.AppImage
./OpenDraft.AppImage
```

### What's included in the desktop app?

The desktop app is fully self-contained. It bundles:
- The OpenDraft editor (web frontend)
- The backend API server (runs automatically in the background)
- All required libraries and dependencies

No Python, Node.js, or internet connection required after installation.

Your screenplays are stored locally:
- **macOS:** `~/Library/Application Support/com.opendraft.desktop/`
- **Windows:** `%APPDATA%/com.opendraft.desktop/`
- **Linux:** `~/.local/share/com.opendraft.desktop/`

---

## Option 2: Browser (Self-Hosted)

Run OpenDraft in your web browser. Good for teams who want to host a shared instance, or if you prefer a browser-based workflow.

### Prerequisites

Install these before running the setup script:

| Requirement | Minimum Version | Download |
|-------------|----------------|----------|
| Python | 3.12+ | [python.org/downloads](https://www.python.org/downloads/) |
| Node.js | 18+ | [nodejs.org](https://nodejs.org/) |
| Git | Any recent | [git-scm.com/downloads](https://git-scm.com/downloads) |

#### Checking your versions

```bash
python3 --version   # Should print 3.12 or higher
node --version      # Should print v18 or higher
git --version       # Any version is fine
```

### Quick Setup (Automatic)

```bash
git clone https://github.com/Proteus-Technologies-Private-Limited/OpenDraft.git
cd OpenDraft
./setup.sh
```

The script will:
1. Verify your Python and Node.js versions
2. Create a Python virtual environment
3. Install all dependencies
4. Build the frontend
5. Start the server and open your browser

OpenDraft will be available at **http://localhost:8000**.

Press **Ctrl+C** to stop the server.

### Manual Setup (Step by Step)

If you prefer to set things up manually or the automatic script doesn't work:

#### 1. Clone the repository

```bash
git clone https://github.com/Proteus-Technologies-Private-Limited/OpenDraft.git
cd OpenDraft
```

#### 2. Set up Python environment

```bash
python3.12 -m venv venv
source venv/bin/activate        # macOS/Linux
# venv\Scripts\activate         # Windows

pip install -r backend/requirements.txt
```

#### 3. Install frontend dependencies

```bash
cd frontend
npm install
cd ..
```

#### 4. Build the frontend

```bash
cd frontend
npm run build
cd ..

# Deploy to backend
rm -rf backend/static
cp -r frontend/dist backend/static
```

#### 5. Start the server

```bash
source venv/bin/activate
cd backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Open **http://localhost:8000** in your browser.

### Running Again Later

After the initial setup, you only need:

```bash
cd OpenDraft
source venv/bin/activate
cd backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Or simply run `./setup.sh` again — it skips steps that are already done and starts the server.

---

## Option 3: Development Mode

For developers who want to contribute or modify OpenDraft. This gives you hot-reloading on both frontend and backend.

```bash
git clone https://github.com/Proteus-Technologies-Private-Limited/OpenDraft.git
cd OpenDraft

# Backend setup
python3.12 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt

# Frontend setup
cd frontend && npm install && cd ..

# Start backend (Terminal 1)
./start_backend.sh

# Start frontend (Terminal 2)
./start_frontend.sh
```

- Frontend dev server: **http://localhost:5173** (with hot-reload)
- Backend API: **http://localhost:8000**

---

## Troubleshooting

### "Python 3.12+ is required but not found"

Make sure Python 3.12+ is installed and on your PATH:
```bash
python3.12 --version
```

On macOS, you can install via Homebrew:
```bash
brew install python@3.12
```

### "Node.js 18+ is required but not found"

Install Node.js from [nodejs.org](https://nodejs.org/) (LTS recommended).

On macOS:
```bash
brew install node
```

### Port 8000 is already in use

Another process is using port 8000. Either stop it or use a different port:
```bash
source venv/bin/activate
cd backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8080
```

### macOS: "OpenDraft can't be opened"

Right-click the app icon, select **Open**, and click **Open** in the dialog. This is a macOS Gatekeeper check for apps not from the App Store.

### Frontend build fails with "out of memory"

Increase Node.js memory:
```bash
export NODE_OPTIONS="--max-old-space-size=4096"
cd frontend && npm run build
```

### Permission denied on setup.sh

```bash
chmod +x setup.sh
./setup.sh
```
