# ── Stage 1: Build frontend ──
FROM node:20-slim AS frontend-builder

WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Python backend ──
FROM python:3.12-slim

WORKDIR /app

# Install only pyinstaller-excluded deps (pyinstaller is for desktop builds only)
COPY backend/requirements.txt ./
RUN grep -v pyinstaller requirements.txt > requirements-docker.txt && \
    pip install --no-cache-dir -r requirements-docker.txt && \
    rm requirements-docker.txt

# Copy backend source
COPY backend/app ./app

# Copy built frontend into static directory
COPY --from=frontend-builder /frontend/dist ./static

# Create data directory for projects
RUN mkdir -p /app/data/projects

ENV OPENDRAFT_DATA_DIR=/app/data
ENV PORT=8080

# uvicorn sits behind a proxy (Caddy in compose, Google's front end on Cloud
# Run) and by default trusts X-Forwarded-For only from 127.0.0.1, so every
# visitor showed up as the proxy's address — sharing one sign-in rate limit,
# which signed people out once enough of them had renewed their tokens. Trust
# private-network hops only: the client's own address is the first untrusted
# one from the right, so a forged X-Forwarded-For cannot pick a new identity.
ENV FORWARDED_ALLOW_IPS="127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,169.254.0.0/16,fc00::/7"

EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
