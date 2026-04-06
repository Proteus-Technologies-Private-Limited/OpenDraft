# Collab Server — Google Cloud Run Deployment

## Production URLs

| Protocol | URL |
|----------|-----|
| HTTPS | `https://opendraft-collab-267958344432.us-central1.run.app` |
| WSS | `wss://opendraft-collab-267958344432.us-central1.run.app` |
| Health | `https://opendraft-collab-267958344432.us-central1.run.app/health` |

## GCP Project

| Setting | Value |
|---------|-------|
| Project ID | `opendraft-app` |
| Project Number | `267958344432` |
| Billing Account | OpenDraft (`011A68-37FD6B-93D32A`) |
| Region | `us-central1` |
| Service Name | `opendraft-collab` |
| Image | `us-central1-docker.pkg.dev/opendraft-app/opendraft/opendraft-collab` |

## Cloud Run Configuration

| Setting | Value | Reason |
|---------|-------|--------|
| min-instances | 0 | Scale to zero (free tier) |
| max-instances | 1 | Cap costs |
| Memory | 256Mi | Minimum viable for Node.js |
| CPU | 1 | Single vCPU |
| Timeout | 3600s | WebSocket connections stay alive up to 1 hour |
| Session Affinity | Enabled | Sticky sessions for WebSocket |
| Auth | Allow unauthenticated | Public endpoint |

## Free Tier Limits (Monthly)

- 2 million requests
- 360,000 GB-seconds of memory
- 180,000 vCPU-seconds of compute
- 1 GB egress to North America

## Enabled APIs

- Cloud Run (`run.googleapis.com`)
- Cloud Build (`cloudbuild.googleapis.com`)
- Artifact Registry (`artifactregistry.googleapis.com`)

## Architecture

Cloud Run terminates TLS at the load balancer, so:
- Clients connect via `https://` and `wss://` (encrypted)
- The container receives plain `http://` and `ws://` on port 8080
- No `TLS_CERT` or `TLS_KEY` needed in the container

## Environment Variables

Set via Cloud Run service configuration:

| Variable | Value |
|----------|-------|
| NODE_ENV | production |
| JWT_SECRET | (auto-generated, stored in Cloud Run) |
| DB_TYPE | sqlite |
| DATA_DIR | /app/data |
| DOC_IDLE_TIMEOUT_MINUTES | 30 |
| WS_MAX_CONNECTIONS_PER_IP | 50 |
| WS_MAX_CONNECTIONS_PER_USER | 10 |
| RATE_LIMIT_WINDOW_MS | 900000 |
| RATE_LIMIT_MAX | 100 |
| CORS_ORIGINS | Cloud Run URL + localhost + Tauri origins |

## Data Persistence

SQLite data is **ephemeral** on Cloud Run — lost when the instance scales to zero. This is acceptable because:
- Collaboration sessions are temporary
- Documents are stored client-side (Tauri SQLite / browser)
- The collab server only holds in-flight Yjs state

For persistent data, upgrade to Cloud SQL PostgreSQL (set `DB_TYPE=postgresql`).

## Redeployment

From the `collab-server/` directory:

```bash
# Rebuild and deploy
gcloud builds submit \
  --tag us-central1-docker.pkg.dev/opendraft-app/opendraft/opendraft-collab \
  --project=opendraft-app --quiet

gcloud run deploy opendraft-collab \
  --image=us-central1-docker.pkg.dev/opendraft-app/opendraft/opendraft-collab \
  --region=us-central1 --project=opendraft-app --quiet
```

Or use the script:

```bash
./deploy-cloudrun.sh opendraft-app
```

## Adding Google OAuth

```bash
gcloud run services update opendraft-collab \
  --region=us-central1 --project=opendraft-app \
  --update-env-vars='GOOGLE_CLIENT_ID=xxx,GOOGLE_CLIENT_SECRET=yyy'
```

## Updating CORS Origins

When deploying a web frontend, add its URL to CORS:

```bash
gcloud run services update opendraft-collab \
  --region=us-central1 --project=opendraft-app \
  --env-vars-file=env.yaml
```

## Monitoring

```bash
# Health check
curl https://opendraft-collab-267958344432.us-central1.run.app/health

# View logs
gcloud run services logs read opendraft-collab \
  --region=us-central1 --project=opendraft-app --limit=50

# View service details
gcloud run services describe opendraft-collab \
  --region=us-central1 --project=opendraft-app
```
