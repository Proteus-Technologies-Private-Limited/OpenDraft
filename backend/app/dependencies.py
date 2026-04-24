"""FastAPI dependencies for authentication.

Usage:
    from fastapi import Depends
    from app.dependencies import require_user, optional_user, require_verified_user

    @router.get("/me")
    def me(user = Depends(require_user)):
        ...
"""

from __future__ import annotations

from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.services.auth_service import (
    AuthUser,
    auth_user_from_payload,
    get_user_by_id,
    verify_access_token,
)

# auto_error=False so we can return our own 401 with a consistent body.
_bearer = HTTPBearer(auto_error=False)


def _extract_user(credentials: Optional[HTTPAuthorizationCredentials]) -> Optional[AuthUser]:
    if credentials is None or credentials.scheme.lower() != "bearer":
        return None
    payload = verify_access_token(credentials.credentials)
    if payload is None:
        return None
    user_id = str(payload["sub"])
    # Prefer the authoritative user record from the shared DB when co-located.
    user = get_user_by_id(user_id)
    if user is not None:
        return user
    # Fallback: trust the JWT payload only (email_verified will be False; any
    # endpoint requiring verification will reject). Good enough for read-only
    # identity — write endpoints should use require_verified_user.
    return auth_user_from_payload(payload)


def optional_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> Optional[AuthUser]:
    """Returns the authenticated user if a valid token is present, else None.

    Use this for endpoints that change behavior based on whether the caller is
    authenticated (e.g. endpoints that are allowed anonymously but richer when
    signed in).
    """
    return _extract_user(credentials)


def require_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> AuthUser:
    """Returns the authenticated user, or raises 401."""
    user = _extract_user(credentials)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def require_verified_user(
    user: AuthUser = Depends(require_user),
) -> AuthUser:
    """Returns the authenticated user whose email has been verified, or raises
    403. Used to gate save/collab operations behind the OTP flow."""
    if not user.email_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "email_not_verified", "message": "Verify your email to continue"},
        )
    return user


def client_ip(request: Request) -> str:
    """Best-effort client IP extraction for audit logging."""
    # Honour a forwarded header only if the server sits behind a trusted proxy
    # (configured via uvicorn --forwarded-allow-ips). Starlette sets request.client
    # correctly in that case.
    return request.client.host if request.client else "unknown"
