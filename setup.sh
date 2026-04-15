#!/bin/bash
# ============================================================================
# OpenDraft Setup Script
# Sets up and launches OpenDraft in your browser.
# Usage: ./setup.sh
# ============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"

print_banner() {
    echo ""
    echo -e "${BLUE}${BOLD}"
    echo "  ╔═══════════════════════════════════════╗"
    echo "  ║         OpenDraft Setup                ║"
    echo "  ║   Professional Screenwriting App       ║"
    echo "  ╚═══════════════════════════════════════╝"
    echo -e "${NC}"
    echo ""
}

log_step() {
    echo -e "${GREEN}[✓]${NC} $1"
}

log_info() {
    echo -e "${BLUE}[i]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[!]${NC} $1"
}

log_error() {
    echo -e "${RED}[✗]${NC} $1"
}

# --- Check prerequisites ---------------------------------------------------

check_python() {
    for cmd in python3.12 python3 python; do
        if command -v "$cmd" &>/dev/null; then
            version=$("$cmd" --version 2>&1 | grep -oE '[0-9]+\.[0-9]+')
            major=$(echo "$version" | cut -d. -f1)
            minor=$(echo "$version" | cut -d. -f2)
            if [ "$major" -ge 3 ] && [ "$minor" -ge 12 ]; then
                PYTHON_CMD="$cmd"
                return 0
            fi
        fi
    done
    return 1
}

check_node() {
    if command -v node &>/dev/null; then
        version=$(node --version | grep -oE '[0-9]+' | head -1)
        if [ "$version" -ge 18 ]; then
            return 0
        fi
    fi
    return 1
}

check_prerequisites() {
    local missing=0

    log_info "Checking prerequisites..."
    echo ""

    if check_python; then
        log_step "Python: $($PYTHON_CMD --version)"
    else
        log_error "Python 3.12+ is required but not found"
        echo "       Download from: https://www.python.org/downloads/"
        missing=1
    fi

    if check_node; then
        log_step "Node.js: $(node --version)"
    else
        log_error "Node.js 18+ is required but not found"
        echo "       Download from: https://nodejs.org/"
        missing=1
    fi

    if command -v npm &>/dev/null; then
        log_step "npm: $(npm --version)"
    else
        log_error "npm is required but not found (installed with Node.js)"
        missing=1
    fi

    echo ""

    if [ "$missing" -ne 0 ]; then
        log_error "Please install the missing prerequisites and run this script again."
        exit 1
    fi
}

# --- Setup steps ------------------------------------------------------------

setup_python_env() {
    log_info "Setting up Python environment..."

    if [ ! -d "$PROJECT_ROOT/venv" ]; then
        "$PYTHON_CMD" -m venv "$PROJECT_ROOT/venv"
        log_step "Created virtual environment"
    else
        log_step "Virtual environment already exists"
    fi

    source "$PROJECT_ROOT/venv/bin/activate"

    pip install --quiet --upgrade pip
    pip install --quiet -r "$PROJECT_ROOT/backend/requirements.txt"
    log_step "Installed Python dependencies"
}

setup_frontend() {
    log_info "Setting up frontend..."

    cd "$PROJECT_ROOT/frontend"
    npm install --silent 2>/dev/null
    log_step "Installed frontend dependencies"
    cd "$PROJECT_ROOT"
}

build_for_browser() {
    log_info "Building application..."

    cd "$PROJECT_ROOT/frontend"
    npm run build --silent 2>/dev/null
    log_step "Built frontend"

    rm -rf "$PROJECT_ROOT/backend/static"
    cp -r "$PROJECT_ROOT/frontend/dist" "$PROJECT_ROOT/backend/static"
    log_step "Deployed to backend"
    cd "$PROJECT_ROOT"
}

open_browser() {
    local url="http://localhost:8008"
    sleep 2

    if command -v xdg-open &>/dev/null; then
        xdg-open "$url" 2>/dev/null &
    elif command -v open &>/dev/null; then
        open "$url" 2>/dev/null &
    elif command -v start &>/dev/null; then
        start "$url" 2>/dev/null &
    fi
}

start_server() {
    echo ""
    echo -e "${GREEN}${BOLD}════════════════════════════════════════════${NC}"
    echo -e "${GREEN}${BOLD}  OpenDraft is ready!${NC}"
    echo -e "${GREEN}${BOLD}════════════════════════════════════════════${NC}"
    echo ""
    echo -e "  Open your browser to: ${BOLD}http://localhost:8008${NC}"
    echo ""
    echo -e "  Press ${BOLD}Ctrl+C${NC} to stop the server."
    echo ""

    source "$PROJECT_ROOT/venv/bin/activate"
    cd "$PROJECT_ROOT/backend"

    open_browser &

    python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
}

# --- Main -------------------------------------------------------------------

print_banner
check_prerequisites
setup_python_env
setup_frontend
build_for_browser
start_server
