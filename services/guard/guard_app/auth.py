"""Inter-service authentication middleware.

Inter-service calls use a shared API key in the X-Service-Key header.
A2A partner calls use a JWT signed by the calling org's secret.
"""
from __future__ import annotations

import os
from typing import Optional

from fastapi import Header, HTTPException, status
from jose import JWTError, jwt

INTER_SERVICE_KEY = os.environ.get("INTER_SERVICE_KEY", "")
JWT_ALGORITHM = "HS256"


def verify_service_key(x_service_key: Optional[str] = Header(default=None)) -> None:
    """Dependency: validate the internal service-to-service API key."""
    if not INTER_SERVICE_KEY:
        # If env var not set, allow (dev mode)
        return
    if x_service_key != INTER_SERVICE_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing X-Service-Key header",
        )


def verify_partner_jwt(
    authorization: Optional[str] = Header(default=None),
) -> dict:
    """Dependency: validate a JWT from a partner org.
    Partners sign their JWTs with their org's PARTNER_JWT_SECRET.
    In production replace with RS256 + public key per org.
    """
    partner_secret = os.environ.get("PARTNER_JWT_SECRET", "")
    if not partner_secret:
        # Dev mode — skip JWT validation
        return {"org_id": "unknown", "dev_mode": True}

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Bearer token",
        )
    token = authorization.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, partner_secret, algorithms=[JWT_ALGORITHM])
        return payload
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid partner token: {exc}",
        ) from exc
