"""Middleware that pushes the authenticated user ID into a ContextVar.

This lets services resolve per-user paths via app.config.get_projects_dir()
without having to thread user_id through every service function signature.
The middleware never raises on missing/invalid auth — it simply leaves the
context unset. Endpoints that require auth use the `require_user` dependency
which will reject the request after this middleware runs.
"""

from __future__ import annotations

import logging

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.config import current_user_id
from app.services.auth_service import verify_access_token

logger = logging.getLogger(__name__)


class UserContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        token_var = None
        auth_header = request.headers.get("authorization")
        if auth_header and auth_header.lower().startswith("bearer "):
            token = auth_header.split(None, 1)[1].strip()
            payload = verify_access_token(token)
            if payload is not None:
                token_var = current_user_id.set(str(payload["sub"]))
        try:
            return await call_next(request)
        finally:
            if token_var is not None:
                current_user_id.reset(token_var)
