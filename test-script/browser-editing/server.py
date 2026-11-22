"""Isolated loopback backend for the synthetic saved-editing benchmark.

Uses the real API, auth and storage implementation. Never point it at user data.
"""
import argparse
import json
import os
from pathlib import Path
import secrets
import sqlite3
import sys
import time

import jwt
import uvicorn

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument(
    "state_dir", type=Path,
    help="A NEW directory for disposable data and auth.json",
)
parser.add_argument("--port", type=int, default=8137)
args = parser.parse_args()
root = args.state_dir.resolve()
# Refuse existing directories, so a run cannot overwrite another user's data.
root.mkdir(mode=0o700)
secret = secrets.token_hex(32)
db = root / "users.sqlite"
with sqlite3.connect(db) as conn:
    conn.execute(
        "CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, "
        "email_verified INTEGER, display_name TEXT)"
    )
    conn.execute("INSERT INTO users VALUES (?, ?, ?, ?)", (
        "browser-bench", "browser-bench@example.invalid", 1, "Synthetic benchmark",
    ))
os.environ.update(
    OPENDRAFT_DATA_DIR=str(root / "data"),
    COLLAB_DB_PATH=str(db),
    COLLAB_JWT_SECRET=secret,
    FREE_PLAN_FILE_LIMIT="1000",
)
auth = {
    "accessToken": jwt.encode({
        "sub": "browser-bench", "email": "browser-bench@example.invalid",
        "type": "access", "exp": int(time.time()) + 86400,
    }, secret, algorithm="HS256"),
    "refreshToken": None,
    "user": {
        "id": "browser-bench", "email": "browser-bench@example.invalid",
        "emailVerified": True, "displayName": "Synthetic benchmark",
    },
}
with open(
    root / "auth.json", "x",
    opener=lambda path, flags: os.open(path, flags, 0o600),
) as auth_file:
    json.dump(auth, auth_file)
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
from app.main import app  # noqa: E402

print(f"Synthetic fixture credentials: {root / 'auth.json'}", flush=True)
uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
