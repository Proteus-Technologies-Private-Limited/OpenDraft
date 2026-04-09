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

# Install system dependencies for PyMuPDF, lxml, etc.
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libffi-dev && \
    rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

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
