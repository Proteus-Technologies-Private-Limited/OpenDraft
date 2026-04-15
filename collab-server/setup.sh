#!/usr/bin/env bash
set -euo pipefail

# ── OpenDraft Collab Server — Interactive Setup ──

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   OpenDraft Collaboration Server Setup       ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

ENV_FILE=".env"

if [ -f "$ENV_FILE" ]; then
  echo "An existing .env file was found."
  read -rp "Overwrite it? [y/N]: " overwrite
  if [[ ! "$overwrite" =~ ^[Yy]$ ]]; then
    echo "Setup cancelled. Existing .env preserved."
    exit 0
  fi
  echo ""
fi

# ── Server port ──

read -rp "Server port [4000]: " PORT
PORT=${PORT:-4000}

# ── Backend URL ──

read -rp "Backend API URL [http://localhost:8008/api]: " BACKEND_URL
BACKEND_URL=${BACKEND_URL:-http://localhost:8008/api}

# ── Database ──

echo ""
echo "Select database type:"
echo "  1) SQLite   (default — file-based, zero config, good for <50 users)"
echo "  2) PostgreSQL (recommended for 50+ concurrent users)"
read -rp "Choice [1]: " db_choice
db_choice=${db_choice:-1}

DB_TYPE="sqlite"
DB_HOST="localhost"
DB_PORT="5432"
DB_NAME="opendraft_collab"
DB_USER="opendraft"
DB_PASSWORD=""

if [ "$db_choice" = "2" ]; then
  DB_TYPE="postgresql"
  echo ""
  echo "── PostgreSQL Configuration ──"
  read -rp "  Host [localhost]: " DB_HOST
  DB_HOST=${DB_HOST:-localhost}
  read -rp "  Port [5432]: " DB_PORT
  DB_PORT=${DB_PORT:-5432}
  read -rp "  Database name [opendraft_collab]: " DB_NAME
  DB_NAME=${DB_NAME:-opendraft_collab}
  read -rp "  Username [opendraft]: " DB_USER
  DB_USER=${DB_USER:-opendraft}
  read -rsp "  Password: " DB_PASSWORD
  echo ""

  # Test PostgreSQL connection
  echo ""
  echo "Testing PostgreSQL connection..."
  if command -v psql &>/dev/null; then
    if PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1;" &>/dev/null; then
      echo "  ✓ Connection successful!"
    else
      echo "  ✗ Connection failed. Please verify your PostgreSQL credentials."
      echo "    Make sure the database '$DB_NAME' exists and user '$DB_USER' has access."
      echo ""
      echo "    To create the database:"
      echo "      CREATE DATABASE $DB_NAME;"
      echo "      CREATE USER $DB_USER WITH PASSWORD '<password>';"
      echo "      GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"
      echo ""
      read -rp "Continue anyway? [y/N]: " continue_anyway
      if [[ ! "$continue_anyway" =~ ^[Yy]$ ]]; then
        echo "Setup cancelled."
        exit 1
      fi
    fi
  else
    echo "  ⚠ psql not found — skipping connection test."
    echo "    Make sure PostgreSQL is running and the database exists."
  fi
fi

# ── JWT Secret ──

echo ""
echo "── Security ──"
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" 2>/dev/null || openssl rand -hex 32)
echo "Generated JWT secret: ${JWT_SECRET:0:12}..."

# ── Document eviction ──

echo ""
echo "── Performance ──"
read -rp "Idle document eviction timeout in minutes (0=disabled) [30]: " DOC_IDLE_TIMEOUT_MINUTES
DOC_IDLE_TIMEOUT_MINUTES=${DOC_IDLE_TIMEOUT_MINUTES:-30}

# ── WebSocket limits ──

read -rp "Max WebSocket connections per IP (0=unlimited) [50]: " WS_MAX_CONNECTIONS_PER_IP
WS_MAX_CONNECTIONS_PER_IP=${WS_MAX_CONNECTIONS_PER_IP:-50}

read -rp "Max WebSocket connections per user (0=unlimited) [10]: " WS_MAX_CONNECTIONS_PER_USER
WS_MAX_CONNECTIONS_PER_USER=${WS_MAX_CONNECTIONS_PER_USER:-10}

# ── TLS ──

echo ""
echo "── TLS (optional) ──"
read -rp "TLS certificate path (leave empty to skip): " TLS_CERT
TLS_KEY=""
if [ -n "$TLS_CERT" ]; then
  read -rp "TLS private key path: " TLS_KEY
fi

# ── Google OAuth ──

echo ""
echo "── Google OAuth (optional) ──"
read -rp "Google Client ID (leave empty to skip): " GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET=""
if [ -n "$GOOGLE_CLIENT_ID" ]; then
  read -rp "Google Client Secret: " GOOGLE_CLIENT_SECRET
fi

# ── SMTP ──

echo ""
echo "── SMTP for email verification (optional) ──"
read -rp "SMTP host (leave empty to skip): " SMTP_HOST
SMTP_PORT="587"
SMTP_USER=""
SMTP_PASS=""
SMTP_FROM="noreply@opendraft.app"
if [ -n "$SMTP_HOST" ]; then
  read -rp "  SMTP port [587]: " SMTP_PORT
  SMTP_PORT=${SMTP_PORT:-587}
  read -rp "  SMTP username: " SMTP_USER
  read -rsp "  SMTP password: " SMTP_PASS
  echo ""
  read -rp "  From address [noreply@opendraft.app]: " SMTP_FROM
  SMTP_FROM=${SMTP_FROM:-noreply@opendraft.app}
fi

# ── CORS origins ──

echo ""
DEFAULT_CORS="http://localhost:5173,http://localhost:3000,tauri://localhost,https://tauri.localhost"
read -rp "CORS origins (comma-separated) [$DEFAULT_CORS]: " CORS_ORIGINS
CORS_ORIGINS=${CORS_ORIGINS:-$DEFAULT_CORS}

# ── Write .env file ──

cat > "$ENV_FILE" << ENVEOF
# OpenDraft Collaboration Server Configuration
# Generated by setup.sh on $(date -Iseconds 2>/dev/null || date)

PORT=$PORT
BACKEND_URL=$BACKEND_URL

JWT_SECRET=$JWT_SECRET
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

BCRYPT_ROUNDS=12
DATA_DIR=./data

# Database
DB_TYPE=$DB_TYPE
DB_HOST=$DB_HOST
DB_PORT=$DB_PORT
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD

# Document eviction
DOC_IDLE_TIMEOUT_MINUTES=$DOC_IDLE_TIMEOUT_MINUTES

# WebSocket limits
WS_MAX_CONNECTIONS_PER_IP=$WS_MAX_CONNECTIONS_PER_IP
WS_MAX_CONNECTIONS_PER_USER=$WS_MAX_CONNECTIONS_PER_USER

# TLS
TLS_CERT=$TLS_CERT
TLS_KEY=$TLS_KEY

# Google OAuth
GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET

# SMTP
SMTP_HOST=$SMTP_HOST
SMTP_PORT=$SMTP_PORT
SMTP_USER=$SMTP_USER
SMTP_PASS=$SMTP_PASS
SMTP_FROM=$SMTP_FROM

# Rate limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100

# CORS origins
CORS_ORIGINS=$CORS_ORIGINS
ENVEOF

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   Setup complete!                            ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "  .env file written."
echo "  Database: $DB_TYPE"
if [ "$DB_TYPE" = "postgresql" ]; then
  echo "  PostgreSQL: $DB_USER@$DB_HOST:$DB_PORT/$DB_NAME"
fi
echo ""
echo "Next steps:"
echo "  1. npm install"
echo "  2. npm run dev     (development)"
echo "     npm run build && npm start  (production)"
echo ""
