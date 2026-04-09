#!/usr/bin/env bash
set -euo pipefail

# ── OpenDraft Demo Server — Deploy to Google Cloud Run ──
#
# Deploys the demo server (backend + compiled frontend) to Cloud Run.
# Uses the same GCP project as the collab server.
# The frontend is compiled into FastAPI's static directory at build time —
# no separate frontend server is needed.
#
# The demo server resets every hour (Cloud Run min-instances=0, data is ephemeral).
#
# Prerequisites:
#   brew install google-cloud-sdk
#   gcloud auth login
#   gcloud auth application-default login
#
# Usage:
#   ./deploy-demo-cloudrun.sh              # interactive (prompts for project ID)
#   ./deploy-demo-cloudrun.sh my-project   # non-interactive

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  OpenDraft Demo Server — Cloud Run Deployment    ║"
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

SERVICE_NAME="opendraft-demo"
REGION="us-central1"       # Free tier eligible region (same as collab server)
REPO_NAME="opendraft"      # Artifact Registry repository (shared with collab server)
IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$REPO_NAME/$SERVICE_NAME"

# Navigate to project root (Dockerfile context needs both frontend/ and backend/)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo ""
echo "Configuration:"
echo "  Project:      $PROJECT_ID"
echo "  Service:      $SERVICE_NAME"
echo "  Region:       $REGION"
echo "  Image:        $IMAGE"
echo "  Build context: $PROJECT_ROOT"
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
echo "  (Builds frontend + backend into a single container)"
echo ""

gcloud builds submit \
  --tag "$IMAGE" \
  --project="$PROJECT_ID" \
  --timeout=1200 \
  --gcs-source-staging-dir="gs://${PROJECT_ID}_cloudbuild/source" \
  "$PROJECT_ROOT" \
  --quiet

echo ""
echo "  Image built and pushed: $IMAGE"

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
  --memory=512Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=1 \
  --timeout=3600 \
  --set-env-vars="DEMO_MODE=true" \
  --set-env-vars="OPENDRAFT_DATA_DIR=/app/data" \
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
echo "  Demo URL:     $SERVICE_URL"
echo "  Health check: $SERVICE_URL/health"
echo "  Demo info:    $SERVICE_URL/api/demo-info"
echo ""

# ── Update CORS to include the Cloud Run URL ──

echo "Updating CORS to include Cloud Run URL..."

CORS_ORIGINS="$SERVICE_URL,http://localhost:5173,http://localhost:8000"

gcloud run services update "$SERVICE_NAME" \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --update-env-vars="CORS_ORIGINS=$CORS_ORIGINS" \
  --quiet

echo "  CORS updated."
echo ""
echo "Notes:"
echo "  - DEMO_MODE=true — users see a warning banner on first visit"
echo "  - Data is ephemeral (reset on cold starts / ~1 hour idle)"
echo "  - Frontend is compiled into the backend — single container, no separate server"
echo "  - Uses same GCP project and Artifact Registry as the collab server"
echo ""
echo "Free tier limits (monthly):"
echo "  - 2 million requests"
echo "  - 360,000 GB-seconds of memory"
echo "  - 180,000 vCPU-seconds of compute"
echo "  - 1 GB egress to North America"
echo ""
