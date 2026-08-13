#!/usr/bin/env python3
"""Pull crash diagnostics for OpenDraft from App Store Connect.

App Store crash reports reach the API as "diagnostic signatures": Apple groups
the individual reports it receives into signatures (one per distinct crash
point), then exposes the symbolicated logs per signature, per build.

Usage:
    ASC_ISSUER_ID=<uuid> ./venv/bin/python test-script/fetch_appstore_crashes.py

Environment:
    ASC_ISSUER_ID   (required) Issuer ID from App Store Connect >
                    Users and Access > Integrations > App Store Connect API
    ASC_KEY_ID      (default 2XRNF3F3RQ) Key ID of the .p8
    ASC_KEY_PATH    (default ~/.private_keys/AuthKey_<KEY_ID>.p8)
    ASC_BUNDLE_ID   (default com.proteus.opendraft)
    ASC_BUILD_LIMIT (default 5) how many recent builds to inspect

Writes raw JSON logs to test-script/output/crashes/ and prints a summary.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

try:
    import jwt
    import requests
except ImportError as exc:  # pragma: no cover - dependency guard
    sys.exit(f"Missing dependency ({exc}). Install with: ./venv/bin/pip install pyjwt cryptography requests")

API = "https://api.appstoreconnect.apple.com/v1"
OUT_DIR = Path(__file__).resolve().parent / "output" / "crashes"


def make_token(issuer_id: str, key_id: str, key_path: Path) -> str:
    """Sign the short-lived ES256 JWT App Store Connect expects."""
    try:
        private_key = key_path.read_text()
    except OSError as exc:
        raise SystemExit(f"Cannot read private key at {key_path}: {exc}") from exc

    now = int(time.time())
    payload = {
        "iss": issuer_id,
        "iat": now,
        "exp": now + 19 * 60,  # Apple rejects anything over 20 minutes
        "aud": "appstoreconnect-v1",
    }
    try:
        return jwt.encode(payload, private_key, algorithm="ES256", headers={"kid": key_id, "typ": "JWT"})
    except Exception as exc:  # pragma: no cover - key format guard
        raise SystemExit(f"Could not sign the JWT (is {key_path} a valid ASC .p8?): {exc}") from exc


class ASC:
    def __init__(self, token: str) -> None:
        self.session = requests.Session()
        self.session.headers.update({"Authorization": f"Bearer {token}"})

    def get(self, path: str, **params) -> dict:
        url = path if path.startswith("http") else f"{API}/{path}"
        try:
            resp = self.session.get(url, params=params or None, timeout=60)
        except requests.RequestException as exc:
            raise SystemExit(f"Request to {url} failed: {exc}") from exc

        if resp.status_code == 401:
            raise SystemExit(
                "401 Unauthorized — the issuer ID, key ID and .p8 do not agree, "
                "or the key lacks access to this app."
            )
        if resp.status_code == 403:
            raise SystemExit(
                "403 Forbidden — the API key's role cannot read diagnostics. "
                "It needs Admin, App Manager or Developer."
            )
        if not resp.ok:
            raise SystemExit(f"{resp.status_code} from {url}: {resp.text[:500]}")

        try:
            return resp.json()
        except ValueError as exc:
            raise SystemExit(f"Non-JSON response from {url}: {resp.text[:200]}") from exc


def main() -> int:
    issuer_id = os.environ.get("ASC_ISSUER_ID", "").strip()
    if not issuer_id:
        return int(bool(sys.stderr.write(
            "ASC_ISSUER_ID is not set.\n"
            "Find it at App Store Connect > Users and Access > Integrations > "
            "App Store Connect API (it is a UUID shown above the key list).\n"
        )) )

    key_id = os.environ.get("ASC_KEY_ID", "2XRNF3F3RQ")
    key_path = Path(os.environ.get("ASC_KEY_PATH", Path.home() / ".private_keys" / f"AuthKey_{key_id}.p8"))
    bundle_id = os.environ.get("ASC_BUNDLE_ID", "com.proteus.opendraft")
    build_limit = int(os.environ.get("ASC_BUILD_LIMIT", "5"))

    api = ASC(make_token(issuer_id, key_id, key_path))

    apps = api.get("apps", **{"filter[bundleId]": bundle_id})["data"]
    if not apps:
        raise SystemExit(f"No app found for bundle id {bundle_id}. Keys are team-scoped — is this the right team?")
    app = apps[0]
    app_id = app["id"]
    print(f"App: {app['attributes']['name']} ({bundle_id}) id={app_id}\n")

    builds = api.get(
        "builds",
        **{"filter[app]": app_id, "limit": build_limit, "sort": "-uploadedDate"},
    )["data"]
    if not builds:
        print("No builds found.")
        return 0

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    total_signatures = 0

    for build in builds:
        version = build["attributes"].get("version")
        uploaded = build["attributes"].get("uploadedDate")
        print(f"Build {version}  uploaded {uploaded}  id={build['id']}")

        try:
            sigs = api.get(
                f"builds/{build['id']}/diagnosticSignatures",
                **{"filter[diagnosticType]": "DISK_WRITES,HANGS,CRASHES", "limit": 50},
            )["data"]
        except SystemExit as exc:
            # A build with no diagnostics at all can 404 rather than return []
            print(f"  (no diagnostics: {exc})")
            continue

        if not sigs:
            print("  no diagnostic signatures\n")
            continue

        for sig in sigs:
            total_signatures += 1
            attrs = sig["attributes"]
            print(
                f"  [{attrs.get('diagnosticType')}] weight={attrs.get('weight')} "
                f"insight={attrs.get('insight')} id={sig['id']}"
            )

            logs = api.get(f"diagnosticSignatures/{sig['id']}/logs", limit=50)["data"]
            out = OUT_DIR / f"build-{version}-{attrs.get('diagnosticType','UNKNOWN')}-{sig['id'][:12]}.json"
            out.write_text(json.dumps({"signature": sig, "logs": logs}, indent=2))
            print(f"      {len(logs)} log(s) -> {out.relative_to(Path.cwd()) if str(out).startswith(str(Path.cwd())) else out}")
        print()

    print(f"Done. {total_signatures} signature(s) across {len(builds)} build(s). JSON in {OUT_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
