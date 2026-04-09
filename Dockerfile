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

EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
