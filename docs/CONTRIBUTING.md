# Contributing to OpenDraft

Thank you for your interest in contributing to OpenDraft! This document explains how to get started.

---

## Getting Started

1. **Fork** the repository on GitHub
2. **Clone** your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/OpenDraft.git
   cd OpenDraft
   ```
3. **Set up** the development environment:
   ```bash
   # Python backend
   python3.12 -m venv venv
   source venv/bin/activate
   pip install -r backend/requirements.txt

   # Frontend
   cd frontend && npm install && cd ..
   ```
4. **Create a branch** for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   ```

## Development Workflow

Run the backend and frontend dev servers in separate terminals:

```bash
# Terminal 1: Backend (with auto-reload)
./start_backend.sh

# Terminal 2: Frontend (with hot-reload)
./start_frontend.sh
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000

## Project Structure

| Directory | Language | Purpose |
|-----------|----------|---------|
| `frontend/` | TypeScript, React | Web UI and editor |
| `backend/` | Python, FastAPI | API server and file management |
| `collab-server/` | TypeScript, Node.js | Real-time collaboration |
| `src-tauri/` | Rust | Desktop app shell |

## Code Style

- **Python:** Follow PEP 8. Use type hints.
- **TypeScript/React:** Follow the existing ESLint configuration.
- **Rust:** Follow standard Rust formatting (`cargo fmt`).

## Submitting Changes

1. Make your changes on a feature branch
2. Test your changes locally
3. Commit with a clear, descriptive message
4. Push to your fork
5. Open a **Pull Request** against the `main` branch

### Pull Request Guidelines

- Keep PRs focused on a single change
- Include a description of what changed and why
- Add screenshots for UI changes
- Make sure existing functionality still works

## Reporting Bugs

Open a [GitHub Issue](https://github.com/Proteus-Technologies-Private-Limited/OpenDraft/issues/new) with:

- Steps to reproduce
- Expected vs. actual behavior
- Your OS and browser/app version
- Screenshots if applicable

## Feature Requests

Open a [GitHub Issue](https://github.com/Proteus-Technologies-Private-Limited/OpenDraft/issues/new) describing:

- The problem you're trying to solve
- Your proposed solution
- Any alternatives you've considered

## Questions?

Open a [Discussion](https://github.com/Proteus-Technologies-Private-Limited/OpenDraft/discussions) on GitHub.
