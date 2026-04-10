#!/usr/bin/env bash
set -euo pipefail

# ── OpenDraft Collab Server — Deploy to Google Cloud Run ──
#
# Deploys the collaboration server to Cloud Run (free tier).
# Cloud Run provides HTTPS + WSS automatically (TLS terminated at load balancer).
#
# Prerequisites:
#   brew install google-cloud-sdk
#   gcloud auth login
#   gcloud auth application-default login
#
# Usage:
#   ./deploy-cloudrun.sh              # interactive (prompts for project ID)
#   ./deploy-cloudrun.sh my-project   # non-interactive

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  OpenDraft Collab Server — Cloud Run Deployment  ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ── Check prerequisites ──

if ! command -v gcloud &>/dev/null; then
  echo "ERROR: gcloud CLI not found."
  echo "  Install: brew install google-cloud-sdk"
  echo "  Then:    gcloud auth login"
  exit 1
fi

# ── GCP Project ──

if [ -n "${1:-}" ]; then
  PROJECT_ID="$1"
else
  CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null || true)
  if [ -n "$CURRENT_PROJECT" ]; then
    read -rp "GCP Project ID [$CURRENT_PROJECT]: " PROJECT_ID
    PROJECT_ID=${PROJECT_ID:-$CURRENT_PROJECT}
  else
    read -rp "GCP Project ID: " PROJECT_ID
  fi
fi

if [ -z "$PROJECT_ID" ]; then
  echo "ERROR: Project ID is required."
  exit 1
fi

gcloud config set project "$PROJECT_ID"

# ── Configuration ──

SERVICE_NAME="opendraft-collab"
REGION="us-central1"       # Free tier eligible region
REPO_NAME="opendraft"      # Artifact Registry repository
IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$REPO_NAME/$SERVICE_NAME"

echo ""
echo "Configuration:"
echo "  Project:  $PROJECT_ID"
echo "  Service:  $SERVICE_NAME"
echo "  Region:   $REGION"
echo "  Image:    $IMAGE"
echo ""

# ── Enable required APIs ──

echo "Enabling required APIs..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  --project="$PROJECT_ID" \
  --quiet

echo "  APIs enabled."

# ── Create Artifact Registry repo (if needed) ──

echo "Setting up Artifact Registry..."
if ! gcloud artifacts repositories describe "$REPO_NAME" \
  --location="$REGION" --project="$PROJECT_ID" &>/dev/null; then
  gcloud artifacts repositories create "$REPO_NAME" \
    --repository-format=docker \
    --location="$REGION" \
    --project="$PROJECT_ID" \
    --description="OpenDraft container images" \
    --quiet
  echo "  Repository '$REPO_NAME' created."
else
  echo "  Repository '$REPO_NAME' already exists."
fi

# ── Build container image using Cloud Build ──

echo ""
echo "Building container image with Cloud Build..."
echo "  (This uses the existing Dockerfile — no local Docker needed)"
echo ""

gcloud builds submit \
  --tag "$IMAGE" \
  --project="$PROJECT_ID" \
  --quiet

echo ""
echo "  Image built and pushed: $IMAGE"

# ── Generate JWT secret ──

JWT_SECRET=$(openssl rand -hex 32)
echo ""
echo "Generated JWT secret: ${JWT_SECRET:0:12}..."

# ── Deploy to Cloud Run ──

echo ""
echo "Deploying to Cloud Run..."
echo ""

gcloud run deploy "$SERVICE_NAME" \
  --image="$IMAGE" \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --memory=256Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=1 \
  --timeout=3600 \
  --session-affinity \
  --set-env-vars="NODE_ENV=production" \
  --set-env-vars="JWT_SECRET=$JWT_SECRET" \
  --set-env-vars="DB_TYPE=sqlite" \
  --set-env-vars="DATA_DIR=/app/data" \
  --set-env-vars="DOC_IDLE_TIMEOUT_MINUTES=30" \
  --set-env-vars="WS_MAX_CONNECTIONS_PER_IP=50" \
  --set-env-vars="WS_MAX_CONNECTIONS_PER_USER=10" \
  --set-env-vars="RATE_LIMIT_WINDOW_MS=900000" \
  --set-env-vars="RATE_LIMIT_MAX=100" \
  --quiet

# ── Get service URL ──

SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --format="value(status.url)")

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  Deployment complete!                            ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "  Service URL:  $SERVICE_URL"
echo "  Health check: $SERVICE_URL/health"
echo ""
echo "  HTTPS:  $SERVICE_URL  (automatic TLS)"
echo "  WSS:    ${SERVICE_URL/https:/wss:}  (automatic TLS)"
echo ""

# ── Update CORS to include the Cloud Run URL ──

echo "Updating CORS to include Cloud Run URL..."

# Include the demo frontend origin so browsers on the demo site can reach this collab server
DEMO_URL=$(gcloud run services describe opendraft-demo \
  --region="$REGION" --project="$PROJECT_ID" \
  --format="value(status.url)" 2>/dev/null || true)

CORS_ORIGINS="$SERVICE_URL,http://localhost:5173,http://localhost:3000,tauri://localhost,https://tauri.localhost"
if [ -n "$DEMO_URL" ]; then
  CORS_ORIGINS="$CORS_ORIGINS,$DEMO_URL"
fi

gcloud run services update "$SERVICE_NAME" \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --update-env-vars="CORS_ORIGINS=$CORS_ORIGINS" \
  --quiet

echo "  CORS updated."
echo ""
echo "Next steps:"
echo "  1. Test: curl $SERVICE_URL/health"
echo "  2. Update your app to use this collab server URL"
echo "  3. To add Google OAuth, run:"
echo "     gcloud run services update $SERVICE_NAME --region=$REGION \\"
echo "       --update-env-vars='GOOGLE_CLIENT_ID=xxx,GOOGLE_CLIENT_SECRET=yyy'"
echo ""
echo "Free tier limits (monthly):"
echo "  - 2 million requests"
echo "  - 360,000 GB-seconds of memory"
echo "  - 180,000 vCPU-seconds of compute"
echo "  - 1 GB egress to North America"
echo ""
echo "Note: SQLite data is ephemeral (lost on cold starts)."
echo "  For persistent data, upgrade to Cloud SQL PostgreSQL."
echo ""
