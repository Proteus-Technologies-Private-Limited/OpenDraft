"""Report what a writer does with their projects to the collab server's audit log.

The collab server owns accounts, the audit_log table and the admin console;
this backend owns the files. So that support sees one timeline per account —
sign-ins next to "deleted the project Night Shift" — the backend sends each
project, script, file and version event to the collab server's internal audit
endpoint.

Each call carries a token signed with the shared JWT secret: type
``backend_audit``, the collab audience, the account in ``sub``, alive one
minute. Only this backend can sign it, so a client cannot write audit rows.

Sending never blocks or fails the request that caused it. Events go out on a
background task; if the collab server cannot be reached the event is written
to this process's log instead, so it is never lost silently. Only names, ids
and sizes are sent — never screenplay text.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any

import httpx
import jwt

from app.config import AUDIT_TO_COLLAB, COLLAB_JWT_SECRET, COLLAB_SERVER_URL, current_user_id

logger = logging.getLogger(__name__)

AUDIT_TOKEN_TYPE = "backend_audit"
AUDIT_TOKEN_AUDIENCE = "opendraft-collab-audit"
TOKEN_LIFETIME_SEC = 60
SEND_TIMEOUT_SEC = 5.0
# Keep one event's detail small: it is a support note, not a payload.
MAX_TEXT = 200


@dataclass(frozen=True)
class RequestMeta:
    ip: str | None
    device_id: str | None
    user_agent: str | None


# Set per request by UserContextMiddleware.
current_request_meta: ContextVar[RequestMeta | None] = ContextVar("current_request_meta", default=None)

# Strong references so pending sends are not garbage-collected mid-flight.
_pending: set[asyncio.Task] = set()
_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=SEND_TIMEOUT_SEC)
    return _client


def _clip(value: Any) -> Any:
    if isinstance(value, str) and len(value) > MAX_TEXT:
        return value[: MAX_TEXT - 1] + "…"
    return value


def _sign(user_id: str) -> str:
    now = int(time.time())
    return jwt.encode(
        {"sub": user_id, "type": AUDIT_TOKEN_TYPE, "aud": AUDIT_TOKEN_AUDIENCE,
         "iat": now, "exp": now + TOKEN_LIFETIME_SEC},
        COLLAB_JWT_SECRET,
        algorithm="HS256",
    )


async def _send(user_id: str, event: dict) -> None:
    try:
        resp = await _get_client().post(
            f"{COLLAB_SERVER_URL}/internal/audit",
            json=event,
            headers={"Authorization": f"Bearer {_sign(user_id)}"},
        )
        if resp.status_code >= 300:
            logger.warning(
                "audit event not accepted by collab server (%s %s): user=%s event=%s",
                resp.status_code, resp.text[:200], user_id, json.dumps(event),
            )
    except Exception as exc:  # network, DNS, timeout — never surfaces to the writer
        logger.warning(
            "audit event could not be sent to %s (%s): user=%s event=%s",
            COLLAB_SERVER_URL, exc, user_id, json.dumps(event),
        )


def project_name(project_id: str) -> str:
    """The project's display name for an event, falling back to its id."""
    try:
        from app.services import project_service
        return project_service.get_project(project_id).get("name") or project_id
    except Exception:
        return project_id


def _spawn(user_id: str, event: dict) -> None:
    task = asyncio.get_running_loop().create_task(_send(user_id, event))
    _pending.add(task)
    task.add_done_callback(_pending.discard)


def record(action: str, **detail: Any) -> None:
    """Queue one audit event for the signed-in account of this request.

    ``detail`` holds names and ids (project, projectId, script, scriptId …).
    Safe to call from async code and from worker threads; a request without a
    signed-in account records nothing.
    """
    try:
        user_id = current_user_id.get()
        if not user_id:
            return
        meta = current_request_meta.get()
        clean = {k: _clip(v) for k, v in detail.items() if v is not None and v != ""}
        event = {
            "action": action,
            "detail": clean,
            "ip": meta.ip if meta else None,
            "deviceId": meta.device_id if meta else None,
            "userAgent": _clip(meta.user_agent) if meta else None,
        }
        if not AUDIT_TO_COLLAB:
            return
        if not COLLAB_JWT_SECRET:
            logger.info("audit event (no shared secret, not sent): user=%s event=%s", user_id, json.dumps(event))
            return
        try:
            asyncio.get_running_loop()
            _spawn(user_id, event)
        except RuntimeError:
            # Called from a worker thread (run_in_threadpool): hand the send to
            # the event loop without waiting for it.
            from anyio import from_thread
            from_thread.run_sync(_spawn, user_id, event)
    except Exception:
        logger.exception("audit event %s could not be queued", action)


async def flush(timeout: float = SEND_TIMEOUT_SEC) -> None:
    """Wait for queued events (shutdown, tests)."""
    if _pending:
        await asyncio.wait(list(_pending), timeout=timeout)


async def close() -> None:
    global _client
    await flush()
    if _client is not None:
        await _client.aclose()
        _client = None
