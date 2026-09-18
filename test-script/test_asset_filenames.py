"""Assets with non-ASCII filenames must download, not 500.

HTTP header values are latin-1. `download_asset` used to interpolate the
uploaded file's original name straight into Content-Disposition, so the first
file whose name was not pure ASCII took the endpoint down with

    UnicodeEncodeError: 'latin-1' codec can't encode character '\\u202f'

and it did not take an exotic name to hit it: every macOS screenshot has a
narrow no-break space (U+202F) before the AM/PM. The image was uploaded fine,
so the document held a valid reference — but every fetch of the bytes failed,
and the storyboard frame it had been dropped into came back empty.

Run from project root:
    venv/bin/python test-script/test_asset_filenames.py
"""

from __future__ import annotations

import os
import shutil
import sqlite3
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

# The API is behind the same bearer auth the running server uses, so the test
# stands up a one-user collab DB and signs its own token — same shape as
# test_quota.py, which is the existing pattern for this.
_tmp = Path(tempfile.mkdtemp(prefix="opendraft-assets-"))
_data_dir = _tmp / "backend_data"
_data_dir.mkdir()
_collab_db = _tmp / "collab.sqlite3"
_now = time.strftime("%Y-%m-%dT%H:%M:%S")

_conn = sqlite3.connect(_collab_db)
_conn.executescript(
    """
    CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT,
        email_verified INTEGER,
        password_hash TEXT,
        google_sub TEXT,
        display_name TEXT,
        created_at TEXT,
        updated_at TEXT
    );
    """
)
_conn.execute(
    "INSERT INTO users VALUES (?,?,?,?,?,?,?,?)",
    ("alice", "alice@ex.com", 1, None, None, "Alice", _now, _now),
)
_conn.commit()
_conn.close()

os.environ["OPENDRAFT_DATA_DIR"] = str(_data_dir)
os.environ["COLLAB_JWT_SECRET"] = "sekret"
os.environ["COLLAB_DB_PATH"] = str(_collab_db)

import jwt  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.api.assets import content_disposition  # noqa: E402


def _auth() -> dict[str, str]:
    tok = jwt.encode(
        {"sub": "alice", "email": "alice@ex.com", "type": "access", "exp": int(time.time()) + 300},
        "sekret",
        algorithm="HS256",
    )
    return {"Authorization": f"Bearer {tok}"}

# A one-pixel PNG, so the upload has real bytes with a real mime type.
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c6300010000050001" "0d0a2db4" "0000000049454e44ae426082"
)

# Every one of these has broken the header at some point, or would have.
NAMES = [
    "Screenshot 2026-09-18 at 12.25.22 PM.png",  # the reported crash
    "résumé shot.jpg",                       # accents
    "镜头.png",                                 # nothing foldable to ASCII
    "\U0001f3ac slate.png",                             # emoji
    'bad"name\\x.png',                                  # would close the quoted-string
    "line\nbreak.png",                                  # would end the header
    "plain.png",                                        # the boring case still works
]


def test_header_builder() -> None:
    """The header is latin-1 encodable and carries the real name in filename*."""
    from urllib.parse import quote

    for name in NAMES:
        header = content_disposition("inline", name)
        # This is the encode Starlette does, and what used to raise.
        header.encode("latin-1")
        assert header.startswith("inline; filename=")
        assert f"filename*=UTF-8''{quote(name, safe='')}" in header
        # The ASCII fallback must not contain anything that ends the header or
        # the quoted-string early.
        fallback = header.split('filename="', 1)[1].split('"', 1)[0]
        assert "\n" not in fallback and "\r" not in fallback and "\\" not in fallback
        print(f"  ok: {name!r}")

    # The macOS screenshot case folds to something a human still recognises.
    assert 'filename="Screenshot 2026-09-18 at 12.25.22 PM.png"' in content_disposition(
        "inline", NAMES[0]
    )
    # Accents fold to base letters rather than to underscores.
    assert 'filename="resume shot.jpg"' in content_disposition("inline", NAMES[1])
    print("  ok: folded fallbacks stay readable")


def test_roundtrip_through_the_api() -> None:
    """Upload under each name, then fetch the bytes back."""
    from app.main import app

    client = TestClient(app)

    r = client.post("/api/projects/", json={"name": "Assets", "author": "T"}, headers=_auth())
    assert r.status_code in (200, 201), r.text
    project_id = r.json()["id"]

    for name in NAMES:
        r = client.post(
            f"/api/projects/{project_id}/assets/upload",
            files={"file": (name, PNG, "image/png")},
            data={"tags": "av-storyboard"},
            headers=_auth(),
        )
        assert r.status_code in (200, 201), f"upload of {name!r} failed: {r.text}"
        asset_id = r.json()["id"]

        r = client.get(
            f"/api/projects/{project_id}/assets/{asset_id}",
            params={"disposition": "inline"},
            headers=_auth(),
        )
        assert r.status_code == 200, f"download of {name!r} gave {r.status_code}: {r.text}"
        assert r.content == PNG, f"bytes came back wrong for {name!r}"
        assert "filename*=UTF-8''" in r.headers["content-disposition"]
        print(f"  ok: round-tripped {name!r}")


def main() -> None:
    print("Content-Disposition header:")
    test_header_builder()
    print("Upload / download round trip:")
    test_roundtrip_through_the_api()


if __name__ == "__main__":
    print("Running asset filename tests…")
    try:
        main()
        print("All tests passed.")
    finally:
        shutil.rmtree(_tmp, ignore_errors=True)
