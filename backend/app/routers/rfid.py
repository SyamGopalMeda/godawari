from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..broadcaster import broadcaster
from ..config import settings
from ..db import get_db
from ..deps import audit, device_or_staff, get_device, require_role
from ..models import Device, FamilyMember, Location, RfidTag, TagSighting, User
from ..schemas import ManualScanIn, SightingIn, TagIssueIn
from .families import sighting_out

router = APIRouter(prefix="/rfid", tags=["rfid"])


def _ingest(db: Session, *, tag_uid: str, location: Location, seen_at: datetime, device: Device | None, user: User | None, direction: str = "unknown", antenna: str | None = None, rssi: float | None = None, method: str = "rfid") -> TagSighting | None:
    uid = tag_uid.strip().upper()
    tag = db.get(RfidTag, uid)
    if not tag:
        return None  # unknown tag: ignored (not issued by us)
    # dedupe: same tag at same location within the dedupe window
    last = db.scalar(
        select(TagSighting)
        .where(TagSighting.tag_uid == uid, TagSighting.location_id == location.id)
        .order_by(TagSighting.seen_at.desc())
    )
    if last:
        last_seen = last.seen_at if last.seen_at.tzinfo else last.seen_at.replace(tzinfo=timezone.utc)
        if abs((seen_at - last_seen).total_seconds()) < settings.sighting_dedupe_seconds and method == "rfid":
            return None
    s = TagSighting(
        tag_uid=uid,
        device_id=device.id if device else None,
        reported_by=user.id if user else None,
        location_id=location.id,
        antenna=antenna,
        rssi=rssi,
        direction=direction,
        method=method,
        seen_at=seen_at,
    )
    db.add(s)
    db.flush()  # so in-batch duplicates are visible to the dedupe query
    tag.last_seen_at = seen_at
    tag.last_location_id = location.id
    return s


def _notify(db: Session, s: TagSighting, loc: Location) -> None:
    m = db.scalar(select(FamilyMember).where(FamilyMember.rfid_tag_uid == s.tag_uid))
    if m and m.consent_given_at:
        broadcaster.publish(
            "sighting",
            {"member_id": m.id, "display_name": m.display_name, **sighting_out(s, loc).model_dump(mode="json")},
            family_id=m.family_id,
        )


@router.post("/sightings", status_code=202)
def post_sightings(
    body: list[SightingIn],
    request: Request,
    db: Session = Depends(get_db),
    device: Device | None = Depends(get_device),
):
    """Batch ingest from RFID readers / edge gateways (device key required)."""
    if not device:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Device key required")
    if len(body) > 1000:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Max 1000 sightings per batch")
    now = datetime.now(timezone.utc)
    stored: list[tuple[TagSighting, Location]] = []
    ignored = 0
    for item in body:
        loc_id = item.location_id or device.location_id
        loc = db.get(Location, loc_id) if loc_id else None
        if not loc:
            ignored += 1
            continue
        seen = item.seen_at or now
        if seen.tzinfo is None:
            seen = seen.replace(tzinfo=timezone.utc)
        if seen > now + timedelta(minutes=5):
            seen = now
        s = _ingest(db, tag_uid=item.tag_uid, location=loc, seen_at=seen, device=device, user=None, direction=item.direction, antenna=item.antenna, rssi=item.rssi)
        if s:
            stored.append((s, loc))
        else:
            ignored += 1
    audit(db, "rfid.batch", device=device, entity="sightings", entity_id=len(stored), request=request)
    db.commit()
    for s, loc in stored:
        _notify(db, s, loc)
    return {"stored": len(stored), "ignored": ignored}


@router.post("/manual-scan", status_code=201)
def manual_scan(
    body: ManualScanIn,
    request: Request,
    db: Session = Depends(get_db),
    auth: tuple[Device | None, User | None] = Depends(device_or_staff),
):
    """QR/BLE fallback: a volunteer scans the wristband at a help desk or checkpoint."""
    device, user = auth
    loc = db.get(Location, body.location_id)
    if not loc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Location not found")
    s = _ingest(db, tag_uid=body.tag_uid, location=loc, seen_at=datetime.now(timezone.utc), device=device, user=user, method=body.method)
    if not s:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown tag")
    audit(db, "rfid.manual_scan", actor=user, device=device, entity="tag", entity_id=s.tag_uid, request=request)
    db.commit()
    _notify(db, s, loc)
    return sighting_out(s, loc)


@router.post("/tags", status_code=201)
def issue_tags(body: TagIssueIn, db: Session = Depends(get_db), user: User = Depends(require_role("staff"))):
    created = 0
    for uid in body.uids:
        u = uid.strip().upper()
        if not db.get(RfidTag, u):
            db.add(RfidTag(uid=u))
            created += 1
    audit(db, "rfid.issue", actor=user, entity="tags", entity_id=created)
    db.commit()
    return {"created": created}


@router.get("/tags/{uid}")
def get_tag(uid: str, request: Request, db: Session = Depends(get_db), user: User = Depends(require_role("volunteer"))):
    tag = db.get(RfidTag, uid.strip().upper())
    if not tag:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown tag")
    m = db.scalar(select(FamilyMember).where(FamilyMember.rfid_tag_uid == tag.uid))
    audit(db, "rfid.tag_lookup", actor=user, entity="tag", entity_id=tag.uid, request=request)
    db.commit()
    rows = db.scalars(select(TagSighting).where(TagSighting.tag_uid == tag.uid).order_by(TagSighting.seen_at.desc()).limit(5)).all()
    return {
        "uid": tag.uid,
        "status": tag.status,
        "linked": m is not None,
        # Field staff see only what they need to reunite: name, age group, family contact.
        "member": {"id": m.id, "display_name": m.display_name, "age_group": m.age_group, "family_id": m.family_id, "is_vulnerable": m.is_vulnerable} if m else None,
        "family_contact": (db.get(User, db.get(FamilyMember, m.id).family.primary_user_id).phone if m else None),
        "recent": [sighting_out(s, db.get(Location, s.location_id)) for s in rows],
    }


@router.patch("/tags/{uid}/lost", status_code=204)
def mark_lost(uid: str, db: Session = Depends(get_db), user: User = Depends(require_role("volunteer"))):
    tag = db.get(RfidTag, uid.strip().upper())
    if not tag:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown tag")
    tag.status = "lost"
    audit(db, "rfid.mark_lost", actor=user, entity="tag", entity_id=tag.uid)
    db.commit()
