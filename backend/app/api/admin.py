"""Admin routes, called by the collab server's admin console — never by browsers.

Authorisation is a short-lived token the collab server signs with the shared
JWT secret after it has checked the caller against ADMIN_EMAILS. It names one
account (`sub`), carries `type: admin_inventory` and the backend audience, and
lives about a minute. An ordinary sign-in token is refused here, and this token
is refused everywhere else: verify_access_token only accepts `type: access`,
and PyJWT rejects a token with an audience it was not asked to check.
"""

from __future__ import annotations

import logging

import jwt
from fastapi import APIRouter, Header, HTTPException, status

from app.config import COLLAB_JWT_SECRET
from app.services.admin_storage_service import account_inventory

logger = logging.getLogger(__name__)

router = APIRouter()

ADMIN_TOKEN_TYPE = "admin_inventory"
ADMIN_TOKEN_AUDIENCE = "opendraft-backend-admin"
# The collab server issues these for 60 s; refuse anything meant to live longer.
MAX_TOKEN_LIFETIME_SEC = 120


def _verify_admin_token(authorization: str | None, user_id: str) -> dict:
    if not COLLAB_JWT_SECRET:
        logger.error("admin inventory refused: COLLAB_JWT_SECRET is not configured")
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Backend has no shared JWT secret configured")
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin token required")
    token = authorization.split(None, 1)[1].strip()
    try:
        payload = jwt.decode(
            token,
            COLLAB_JWT_SECRET,
            algorithms=["HS256"],
            audience=ADMIN_TOKEN_AUDIENCE,
            options={"require": ["exp", "iat", "sub", "aud"]},
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin token expired")
    except jwt.InvalidTokenError as exc:
        logger.warning("admin inventory: rejected token: %s", exc)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid admin token")
    if payload.get("type") != ADMIN_TOKEN_TYPE:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid admin token")
    if int(payload["exp"]) - int(payload["iat"]) > MAX_TOKEN_LIFETIME_SEC:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin token lifetime too long")
    if str(payload["sub"]) != user_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin token is for a different account")
    return payload


@router.get("/accounts/{user_id}/inventory")
def get_account_inventory(user_id: str, authorization: str | None = Header(default=None)):
    """Projects and files stored for one account (metadata only)."""
    payload = _verify_admin_token(authorization, user_id)
    logger.info("admin inventory of account %s requested by %s", user_id, payload.get("admin", "unknown"))
    try:
        return account_inventory(user_id)
    except Exception as exc:
        logger.exception("admin inventory of account %s failed", user_id)
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Could not read the account's files: {exc}")
