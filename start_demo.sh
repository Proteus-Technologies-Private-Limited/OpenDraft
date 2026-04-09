#!/bin/bash
cd "$(dirname "$0")/backend"
DEMO_MODE=true ../venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
