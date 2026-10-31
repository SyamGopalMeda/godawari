from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..broadcaster import broadcaster
from ..db import get_db
from ..deps import ROLE_RANK, audit, get_current_user
from ..models import Family, FamilyMember, Location, MissingPersonReport, RfidTag, TagSighting, User
from ..schemas import (
    FamilyCreate,
    FamilyJoin,
    FamilyOut,
    GpsIn,
    LastSeenOut,
    MemberIn,
    MemberOut,
    MemberPatch,
    SightingOut,
    TagLinkIn,
)
from ..security import new_join_code
from ..services.geo import INF, distance_or_none, haversine_m
from .locations import to_out

router = APIRouter(prefix="/families", tags=["families"])


def sighting_out(s: TagSighting, loc: Location) -> SightingOut:
    return SightingOut(
        location_id=loc.id,
        location_name=loc.name,
        location_code=loc.code,
        lat=loc.lat,
        lng=loc.lng,
        seen_at=s.seen_at,
        direction=s.direction,
        method=s.method,
    )


def last_sighting(db: Session, member: FamilyMember) -> SightingOut | None:
    if not member.rfid_tag_uid or not member.consent_given_at:
        return None
    s = db.scalar(
        select(TagSighting).where(TagSighting.tag_uid == member.rfid_tag_uid).order_by(TagSighting.seen_at.desc())
    )
    if not s:
        return None
    return sighting_out(s, db.get(Location, s.location_id))


def member_out(db: Session, m: FamilyMember) -> MemberOut:
    out = MemberOut.model_validate(m)
    out.last_seen = last_sighting(db, m)
    if m.gps_sharing and m.last_gps_at:
        out.gps = {"lat": m.last_lat, "lng": m.last_lng, "at": m.last_gps_at}
    return out


def family_out(db: Session, f: Family) -> FamilyOut:
    return FamilyOut(
        id=f.id,
        name=f.name,
        primary_user_id=f.primary_user_id,
        join_code=f.join_code,
        created_at=f.created_at,
        members=[member_out(db, m) for m in f.members],
    )


def _get_family_for(db: Session, family_id: int, user: User, *, primary_only: bool = False) -> Family:
    fam = db.get(Family, family_id)
    if not fam:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Family not found")
    is_member = fam.primary_user_id == user.id or any(m.user_id == user.id for m in fam.members)
    if primary_only and fam.primary_user_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the family's primary account can do this")
    if not is_member and ROLE_RANK[user.role] < ROLE_RANK["staff"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this family")
    return fam


def user_family_ids(db: Session, user_id: int) -> set[int]:
    ids = set(db.scalars(select(Family.id).where(Family.primary_user_id == user_id)))
    ids |= set(db.scalars(select(FamilyMember.family_id).where(FamilyMember.user_id == user_id)))
    return ids


@router.post("", response_model=FamilyOut, status_code=201)
def create_family(body: FamilyCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    code = new_join_code()
    while db.scalar(select(Family).where(Family.join_code == code)):
        code = new_join_code()
    fam = Family(name=body.name, primary_user_id=user.id, join_code=code)
    fam.members.append(
        FamilyMember(user_id=user.id, display_name=user.name or "Me", age_group="adult", relation="self", phone=user.phone)
    )
    db.add(fam)
    db.commit()
    return family_out(db, fam)


@router.post("/join", response_model=FamilyOut)
def join_family(body: FamilyJoin, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    fam = db.scalar(select(Family).where(Family.join_code == body.join_code.upper()))
    if not fam:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invalid join code")
    if not any(m.user_id == user.id for m in fam.members):
        fam.members.append(
            FamilyMember(user_id=user.id, display_name=body.display_name or user.name or user.phone or "Member", phone=user.phone)
        )
        db.commit()
    return family_out(db, fam)


@router.get("/mine", response_model=list[FamilyOut])
def my_families(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ids = user_family_ids(db, user.id)
    fams = db.scalars(select(Family).where(Family.id.in_(ids))).all() if ids else []
    return [family_out(db, f) for f in fams]


@router.get("/{family_id}", response_model=FamilyOut)
def get_family(family_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return family_out(db, _get_family_for(db, family_id, user))


@router.post("/{family_id}/members", response_model=MemberOut, status_code=201)
def add_member(family_id: int, body: MemberIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    fam = _get_family_for(db, family_id, user, primary_only=True)
    if len(fam.members) >= 15:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A family can have at most 15 members")
    m = FamilyMember(family_id=fam.id, **body.model_dump())
    db.add(m)
    db.commit()
    return member_out(db, m)


@router.patch("/{family_id}/members/{member_id}", response_model=MemberOut)
def patch_member(
    family_id: int, member_id: int, body: MemberPatch, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    fam = _get_family_for(db, family_id, user)
    m = db.get(FamilyMember, member_id)
    if not m or m.family_id != fam.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    is_self = m.user_id == user.id
    if fam.primary_user_id != user.id and not is_self:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the primary account or the member can edit")
    data = body.model_dump(exclude_unset=True)
    if "gps_sharing" in data and not is_self and m.user_id is not None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "GPS sharing can only be changed by the member")
    for k, v in data.items():
        setattr(m, k, v)
    db.commit()
    return member_out(db, m)


@router.delete("/{family_id}/members/{member_id}", status_code=204)
def delete_member(family_id: int, member_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    fam = _get_family_for(db, family_id, user)
    m = db.get(FamilyMember, member_id)
    if not m or m.family_id != fam.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    if fam.primary_user_id != user.id and m.user_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed")
    if m.rfid_tag_uid:
        tag = db.get(RfidTag, m.rfid_tag_uid)
        if tag:
            tag.status = "unlinked"
    db.delete(m)
    db.commit()


@router.post("/{family_id}/members/{member_id}/tag", response_model=MemberOut)
def link_tag(
    family_id: int,
    member_id: int,
    body: TagLinkIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not body.consent:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Consent is required to link a tag")
    fam = _get_family_for(db, family_id, user, primary_only=True)
    m = db.get(FamilyMember, member_id)
    if not m or m.family_id != fam.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    uid = body.tag_uid.strip().upper()
    tag = db.get(RfidTag, uid)
    if not tag:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tag not issued. Collect a wristband from a help desk.")
    if tag.status == "lost":
        raise HTTPException(status.HTTP_409_CONFLICT, "Tag reported lost")
    other = db.scalar(select(FamilyMember).where(FamilyMember.rfid_tag_uid == uid, FamilyMember.id != m.id))
    if other:
        raise HTTPException(status.HTTP_409_CONFLICT, "Tag already linked to another person")
    if m.rfid_tag_uid and m.rfid_tag_uid != uid:
        old = db.get(RfidTag, m.rfid_tag_uid)
        if old:
            old.status = "unlinked"
    m.rfid_tag_uid = uid
    m.consent_given_at = datetime.now(timezone.utc)
    m.consent_by_user_id = user.id
    tag.status = "active"
    audit(db, "family.tag_link", actor=user, entity="family_member", entity_id=m.id, purpose="consent recorded", request=request)
    db.commit()
    return member_out(db, m)


@router.delete("/{family_id}/members/{member_id}/tag", response_model=MemberOut)
def unlink_tag(family_id: int, member_id: int, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    fam = _get_family_for(db, family_id, user)
    m = db.get(FamilyMember, member_id)
    if not m or m.family_id != fam.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    if fam.primary_user_id != user.id and m.user_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed")
    if m.rfid_tag_uid:
        tag = db.get(RfidTag, m.rfid_tag_uid)
        if tag:
            tag.status = "unlinked"
    m.rfid_tag_uid = None
    m.consent_given_at = None
    audit(db, "family.tag_unlink", actor=user, entity="family_member", entity_id=m.id, request=request)
    db.commit()
    return member_out(db, m)


@router.post("/{family_id}/members/{member_id}/gps", status_code=204)
def post_gps(family_id: int, member_id: int, body: GpsIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    fam = _get_family_for(db, family_id, user)
    m = db.get(FamilyMember, member_id)
    if not m or m.family_id != fam.id or m.user_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only share your own position")
    if not m.gps_sharing:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Enable GPS sharing first")
    m.last_lat, m.last_lng, m.last_gps_at = body.lat, body.lng, datetime.now(timezone.utc)
    db.commit()
    broadcaster.publish("member.gps", {"member_id": m.id, "lat": body.lat, "lng": body.lng, "at": m.last_gps_at.isoformat()}, family_id=fam.id)


@router.get("/{family_id}/members/{member_id}/last-seen", response_model=LastSeenOut)
def last_seen(
    family_id: int,
    member_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    purpose: str | None = None,
):
    """Audited lookup. Allowed for the family, or for staff with an open report for this member."""
    fam = db.get(Family, family_id)
    m = db.get(FamilyMember, member_id)
    if not fam or not m or m.family_id != fam.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    is_family = fam.primary_user_id == user.id or any(x.user_id == user.id for x in fam.members)
    if not is_family:
        if ROLE_RANK[user.role] < ROLE_RANK["staff"]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed")
        open_report = db.scalar(
            select(MissingPersonReport).where(
                MissingPersonReport.member_id == m.id,
                MissingPersonReport.status.in_(["open", "verified", "searching"]),
            )
        )
        if not open_report:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Staff may only look up members with an open missing-person report")
        purpose = purpose or f"missing report #{open_report.id}"
    audit(db, "family.last_seen_lookup", actor=user, entity="family_member", entity_id=m.id, purpose=purpose or "family self-service", request=request)
    db.commit()

    recent: list[SightingOut] = []
    if m.rfid_tag_uid and m.consent_given_at:
        since = datetime.now(timezone.utc) - timedelta(hours=12)
        rows = db.scalars(
            select(TagSighting)
            .where(TagSighting.tag_uid == m.rfid_tag_uid, TagSighting.seen_at >= since)
            .order_by(TagSighting.seen_at.desc())
            .limit(10)
        ).all()
        recent = [sighting_out(s, db.get(Location, s.location_id)) for s in rows]
    anchor = recent[0] if recent else None
    gps = {"lat": m.last_lat, "lng": m.last_lng, "at": m.last_gps_at} if (m.gps_sharing and m.last_gps_at) else None
    ref = (anchor.lat, anchor.lng) if anchor else ((gps["lat"], gps["lng"]) if gps else None)
    desks = db.scalars(select(Location).where(Location.type.in_(["help_desk", "lost_found", "police"]), Location.is_open.is_(True))).all()
    if ref:
        desks.sort(key=lambda d: distance_or_none(ref[0], ref[1], d.lat, d.lng) or INF)
    return LastSeenOut(
        member_id=m.id,
        display_name=m.display_name,
        tag_uid=m.rfid_tag_uid,
        consented=bool(m.consent_given_at),
        last_checkpoint=anchor,
        recent=recent,
        gps=gps,
        nearest_help_desks=[to_out(d, ref) for d in desks[:3]],
    )
