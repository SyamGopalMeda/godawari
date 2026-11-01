from __future__ import annotations

from datetime import datetime, timezone

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .models import AuditLog, Device, User
from .security import decode_access_token, hash_token

ROLE_RANK = {"pilgrim": 0, "volunteer": 1, "staff": 2, "admin": 3}


def _bearer(request: Request) -> str | None:
    auth = request.headers.get("authorization")
    if auth and auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return None


def get_optional_user(request: Request, db: Session = Depends(get_db)) -> User | None:
    token = _bearer(request)
    if not token:
        return None
    payload = decode_access_token(token)
    if not payload:
        return None
    user = db.get(User, int(payload["sub"]))
    if user and user.is_active:
        return user
    return None


def get_current_user(user: User | None = Depends(get_optional_user)) -> User:
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Login required")
    return user


def require_role(min_role: str):
    def _dep(user: User = Depends(get_current_user)) -> User:
        if ROLE_RANK.get(user.role, -1) < ROLE_RANK[min_role]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Requires role {min_role} or higher")
        return user

    return _dep


def get_device(
    x_device_key: str | None = Header(default=None), db: Session = Depends(get_db)
) -> Device | None:
    if not x_device_key:
        return None
    dev = db.scalar(select(Device).where(Device.api_key_hash == hash_token(x_device_key)))
    if not dev or dev.status != "active":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or revoked device key")
    dev.last_seen_at = datetime.now(timezone.utc)
    db.commit()
    return dev


def device_or_staff(
    device: Device | None = Depends(get_device), user: User | None = Depends(get_optional_user)
) -> tuple[Device | None, User | None]:
    """Endpoints that accept data from a registered device OR an authenticated volunteer/staff."""
    if device:
        return device, None
    if user and ROLE_RANK.get(user.role, -1) >= ROLE_RANK["volunteer"]:
        return None, user
    raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Device key or staff login required")


def audit(
    db: Session,
    action: str,
    *,
    actor: User | None = None,
    device: Device | None = None,
    entity: str | None = None,
    entity_id: str | int | None = None,
    purpose: str | None = None,
    request: Request | None = None,
) -> None:
    if purpose is not None:
        purpose = purpose[:255]  # String(255); PostgreSQL rejects longer values
    db.add(
        AuditLog(
            actor_id=actor.id if actor else None,
            device_id=device.id if device else None,
            action=action,
            entity=entity,
            entity_id=str(entity_id) if entity_id is not None else None,
            purpose=purpose,
            ip=request.client.host if request and request.client else None,
        )
    )
