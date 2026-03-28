"""Entry point for the PyInstaller-bundled desktop backend.

Launched by the Tauri shell as a sidecar process.  Accepts ``--port``
to override the default listen port (18321).
"""

import argparse
import os
import sys
import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(description="OpenDraft API server")
    parser.add_argument("--port", type=int, default=18321, help="Port to listen on")
    parser.add_argument("--data-dir", type=str, default=None, help="Data directory")
    args = parser.parse_args()

    # If --data-dir is provided, set the env var before importing anything
    # that reads it at module scope.
    if args.data_dir:
        os.environ["OPENDRAFT_DATA_DIR"] = args.data_dir

    from app.main import app  # noqa: F811

    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="info")


if __name__ == "__main__":
    main()
