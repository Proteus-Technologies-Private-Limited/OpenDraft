# Collab Server Deployment

## Current Production

The public collab server runs on a self-hosted VM behind Caddy as part of the
combined Docker image (see `deploy/docker-compose.combined.yml`).

| Protocol | URL |
|----------|-----|
| HTTPS | `https://collab.open-draft.com` |
| WSS | `wss://collab.open-draft.com` |
| Health | `https://collab.open-draft.com/health` |

Quick check:

```bash
curl https://collab.open-draft.com/health
curl https://collab.open-draft.com/auth/config
```

**Deploy the collab server before the app that offers Suggest invites.** A
collaborator invited to suggest is held to suggesting by their client and by
the server (`src/services/suggestionGuard.ts`), which refuses any change from
them that is not their own suggestion. A server older than the Suggest
permission accepts the role but checks nothing, so a new app against an old
server gets the role with no enforcement behind it — the client alone, which
anyone can change. The order is therefore always:

1. Deploy the new collab server image.
2. Then release or update the app.

The same server update makes Read Only connections read-only on the server
too, gives each suggester an id from their invite (so two people invited
under the same name cannot withdraw each other's suggestions), and lets a
suggester link a Beat Board beat to a scene. An old app against the new
server keeps working: suggestions without an id go by name, as before.

The id is worked out from the invite token, so it belongs to the invite, not
the person: everyone who joins with one shared link signs as one suggester,
and someone invited again with a new link cannot withdraw the suggestions
they made with the old one (the writer can still reject them).

While a suggester is connected, the server keeps a second copy of that
document in memory to try their changes on before applying them — budget
about twice the document's size for each document with a suggester in it.

The Cloud Run service below is an alternative deployment target — useful for
free-tier hosting or when you don't want to run a VM. Both layouts are
supported; pick whichever fits your operational model.

---

## Option A — Google Cloud Run

### URLs (legacy / fallback)

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
