from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import audit, device_or_staff, require_role
from ..models import CrowdReading, Device, Location, User
from ..schemas import CrowdOverrideIn, CrowdReadingIn, CrowdStatusOut, RecommendationOut
from ..services import cache
from ..services.crowd import effective_level, publish_status, record_reading
from ..services.geo import distance_or_none, haversine_m, parse_latlng

router = APIRouter(prefix="/crowd", tags=["crowd"])

LEVEL_SCORE = {"low": 0.0, "moderate": 1.0, "high": 2.5, "critical": 10.0, "unknown": 1.5}


def status_out(loc: Location) -> CrowdStatusOut:
    lvl, stale = effective_level(loc)
    return CrowdStatusOut(
        location_id=loc.id,
        code=loc.code,
        name=loc.name,
        name_te=loc.name_te,
        name_hi=loc.name_hi,
        type=loc.type,
        lat=loc.lat,
        lng=loc.lng,
        capacity=loc.capacity,
        current_count=loc.current_count,
        density_level=lvl,
        source=loc.density_source,
        updated_at=loc.density_updated_at,
        is_stale=stale,
        override=bool(loc.override_level and loc.override_until and loc.override_until.replace(tzinfo=timezone.utc) > datetime.now(timezone.utc)),
        is_open=loc.is_open,
    )


@router.get("/status", response_model=list[CrowdStatusOut])
def crowd_status(db: Session = Depends(get_db), site_id: int | None = None, type: str | None = None):
    def load():
        q = select(Location).where(Location.monitored.is_(True))
        if site_id:
            q = q.where(Location.site_id == site_id)
        if type:
            q = q.where(Location.type == type)
        return [status_out(l) for l in db.scalars(q.order_by(Location.type, Location.name))]

    return cache.get_or_set(f"crowd:status:{site_id}:{type}", 3.0, load)


@router.get("/{location_id}/history")
def crowd_history(location_id: int, db: Session = Depends(get_db), hours: int = Query(default=6, ge=1, le=72)):
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    rows = db.scalars(
        select(CrowdReading)
        .where(CrowdReading.location_id == location_id, CrowdReading.recorded_at >= since)
        .order_by(CrowdReading.recorded_at)
    ).all()
    return [
        {"recorded_at": r.recorded_at, "count": r.count, "level": r.density_level, "source": r.source} for r in rows
    ]


@router.post("/readings", status_code=202)
def post_readings(
    body: CrowdReadingIn | list[CrowdReadingIn],
    request: Request,
    db: Session = Depends(get_db),
    auth: tuple[Device | None, User | None] = Depends(device_or_staff),
):
    device, user = auth
    items = body if isinstance(body, list) else [body]
    if len(items) > 500:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Max 500 readings per batch")
    accepted = []
    for item in items:
        loc = None
        if item.location_id:
            loc = db.get(Location, item.location_id)
        elif item.location_code:
            loc = db.scalar(select(Location).where(Location.code == item.location_code))
        elif device and device.location_id:
            loc = db.get(Location, device.location_id)
        if not loc:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Location not found for reading {item.model_dump()}")
        source = item.source or ("camera" if device and device.type == "camera" else "rfid" if device else "manual")
        r = record_reading(
            db,
            loc,
            item.count,
            source,
            device_id=device.id if device else None,
            user_id=user.id if user else None,
            recorded_at=item.recorded_at,
        )
        accepted.append((loc, r))
    audit(db, "crowd.reading", actor=user, device=device, entity="location", entity_id=",".join(str(l.id) for l, _ in accepted), request=request)
    db.commit()
    cache.invalidate("crowd:")
    cache.invalidate("locations:")
    for loc, _ in accepted:
        publish_status(loc)
    return {"accepted": len(accepted), "status": [status_out(l) for l, _ in accepted]}


@router.post("/{location_id}/override", response_model=CrowdStatusOut)
def override(
    location_id: int,
    body: CrowdOverrideIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("staff")),
):
    loc = db.get(Location, location_id)
    if not loc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Location not found")
    if body.level is None:
        loc.override_level = None
        loc.override_until = None
        loc.override_reason = None
    else:
        loc.override_level = body.level
        loc.override_until = datetime.now(timezone.utc) + timedelta(minutes=body.minutes)
        loc.override_reason = body.reason
    audit(db, "crowd.override", actor=user, entity="location", entity_id=loc.id, purpose=body.reason, request=request)
    db.commit()
    cache.invalidate("crowd:")
    cache.invalidate("locations:")
    publish_status(loc)
    return status_out(loc)


@router.get("/recommendations", response_model=list[RecommendationOut])
def recommendations(
    db: Session = Depends(get_db),
    type: str = Query(default="ghat", alias="for"),
    near: str | None = None,
    site_id: int | None = None,
    accessible: bool | None = None,
    limit: int = Query(default=5, le=20),
):
    """Rank open monitored locations of a type by crowd level, then by distance."""
    q = select(Location).where(Location.monitored.is_(True), Location.type == type, Location.is_open.is_(True))
    if site_id:
        q = q.where(Location.site_id == site_id)
    if accessible:
        q = q.where(Location.is_accessible.is_(True))
    pt = parse_latlng(near)
    out: list[RecommendationOut] = []
    for loc in db.scalars(q):
        so = status_out(loc)
        dist = distance_or_none(pt[0], pt[1], loc.lat, loc.lng) if pt else None
        score = LEVEL_SCORE[so.density_level] + (dist or 0) / 1000.0  # 1 km ≈ one crowd level
        reason = {
            "low": "Least crowded right now",
            "moderate": "Moderate crowd",
            "high": "Crowded - expect waiting",
            "critical": "Over capacity - avoid",
            "unknown": "No recent data",
        }[so.density_level]
        if dist is not None:
            reason += f", {round(dist / 1000, 1)} km away"
        out.append(RecommendationOut(location=so, distance_m=round(dist) if dist is not None else None, score=round(score, 2), reason=reason))
    out.sort(key=lambda r: r.score)
    return out[:limit]
