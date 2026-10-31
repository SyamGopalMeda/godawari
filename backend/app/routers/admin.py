from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..broadcaster import broadcaster
from ..db import get_db
from ..deps import audit, require_role
from ..models import AuditLog, Device, Location, MissingPersonReport, ParkingLot, SosRequest, TagSighting, User
from ..schemas import AuditOut, DeviceCreated, DeviceIn, DeviceOut, StaffUserIn, UserOut
from ..security import hash_password, hash_token, new_api_key
from ..services.crowd import effective_level

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/overview")
def overview(db: Session = Depends(get_db), _: User = Depends(require_role("volunteer")), site_id: int | None = None):
    now = datetime.now(timezone.utc)
    q = select(Location).where(Location.monitored.is_(True))
    if site_id:
        q = q.where(Location.site_id == site_id)
    by_level = {"low": 0, "moderate": 0, "high": 0, "critical": 0, "unknown": 0}
    stale = 0
    for loc in db.scalars(q):
        lvl, is_stale = effective_level(loc, now)
        by_level[lvl] += 1
        stale += int(is_stale)
    reports = dict(db.execute(select(MissingPersonReport.status, func.count()).group_by(MissingPersonReport.status)).all())
    sos = dict(db.execute(select(SosRequest.status, func.count()).group_by(SosRequest.status)).all())
    lots = db.scalars(select(ParkingLot)).all()
    parking = {"lots": len(lots), "total_slots": sum(l.total_slots for l in lots), "occupied": sum(l.occupied_slots for l in lots), "full": sum(1 for l in lots if l.status == "full")}
    devices_online = db.scalar(select(func.count(Device.id)).where(Device.status == "active", Device.last_seen_at > now - timedelta(minutes=10)))
    devices_total = db.scalar(select(func.count(Device.id)).where(Device.status == "active"))
    sightings_10m = db.scalar(select(func.count(TagSighting.id)).where(TagSighting.received_at > now - timedelta(minutes=10)))
    return {
        "crowd": {"by_level": by_level, "stale": stale},
        "reports": reports,
        "sos": sos,
        "parking": parking,
        "devices": {"online": devices_online or 0, "total": devices_total or 0},
        "ingestion": {"sightings_last_10m": sightings_10m or 0},
        "websocket": {"connections": broadcaster.connections, "messages_sent": broadcaster.sent},
        "generated_at": now,
    }


@router.get("/devices", response_model=list[DeviceOut])
def list_devices(db: Session = Depends(get_db), _: User = Depends(require_role("admin"))):
    return db.scalars(select(Device).order_by(Device.id)).all()


@router.post("/devices", response_model=DeviceCreated, status_code=201)
def create_device(body: DeviceIn, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    if body.location_id and not db.get(Location, body.location_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Location not found")
    key = new_api_key()
    d = Device(name=body.name, type=body.type, location_id=body.location_id, api_key_hash=hash_token(key))
    db.add(d)
    audit(db, "device.create", actor=user, entity="device")
    db.commit()
    return DeviceCreated(**DeviceOut.model_validate(d).model_dump(), api_key=key)  # key shown once


@router.delete("/devices/{device_id}", status_code=204)
def revoke_device(device_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    d = db.get(Device, device_id)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    d.status = "revoked"
    audit(db, "device.revoke", actor=user, entity="device", entity_id=d.id)
    db.commit()


@router.get("/users", response_model=list[UserOut])
def list_staff(db: Session = Depends(get_db), _: User = Depends(require_role("admin"))):
    return db.scalars(select(User).where(User.role != "pilgrim").order_by(User.role, User.username)).all()


@router.post("/users", response_model=UserOut, status_code=201)
def create_staff(body: StaffUserIn, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    if db.scalar(select(User).where(User.username == body.username)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Username taken")
    u = User(username=body.username, password_hash=hash_password(body.password), name=body.name, role=body.role, site_id=body.site_id, help_desk_location_id=body.help_desk_location_id, phone=body.phone)
    db.add(u)
    audit(db, "user.create_staff", actor=user, entity="user")
    db.commit()
    return u


@router.get("/audit", response_model=list[AuditOut])
def audit_log(db: Session = Depends(get_db), _: User = Depends(require_role("admin")), limit: int = 200, action: str | None = None):
    q = select(AuditLog)
    if action:
        q = q.where(AuditLog.action.like(f"{action}%"))
    return db.scalars(q.order_by(AuditLog.created_at.desc()).limit(min(limit, 1000))).all()


@router.get("/sightings/recent")
def recent_sightings(db: Session = Depends(get_db), _: User = Depends(require_role("admin")), limit: int = 50):
    rows = db.execute(
        select(TagSighting.tag_uid, TagSighting.location_id, Location.name, TagSighting.seen_at, TagSighting.method, TagSighting.device_id)
        .join(Location, Location.id == TagSighting.location_id)
        .order_by(TagSighting.received_at.desc())
        .limit(min(limit, 500))
    ).all()
    # tag UIDs are partially masked: ops needs ingestion health, not identities
    return [{"tag": r[0][:4] + "…" + r[0][-2:], "location_id": r[1], "location": r[2], "seen_at": r[3], "method": r[4], "device_id": r[5]} for r in rows]
