from __future__ import annotations

import os
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..broadcaster import broadcaster
from ..config import settings
from ..db import get_db
from ..deps import ROLE_RANK, audit, get_current_user, require_role
from ..models import FamilyMember, Location, MissingPersonReport, ReportEvent, User
from ..schemas import BoardEntry, ReportEventOut, ReportOut, ReportPatch, normalize_phone
from .locations import to_out

router = APIRouter(prefix="/missing-reports", tags=["missing-persons"])

TRANSITIONS = {
    "open": {"verified", "rejected", "closed"},
    "verified": {"searching", "rejected", "closed"},
    "searching": {"found", "closed"},
    "found": {"closed", "searching"},
    "closed": set(),
    "rejected": set(),
}
ALLOWED_PHOTO = {"image/jpeg", "image/png", "image/webp"}
MAX_PHOTO = 5 * 1024 * 1024


def report_out(r: MissingPersonReport, *, staff: bool) -> ReportOut:
    out = ReportOut.model_validate(r)
    out.has_photo = bool(r.photo_path)
    if not staff:
        out.assigned_staff_id = None
    return out


def _is_staff(user: User) -> bool:
    return ROLE_RANK[user.role] >= ROLE_RANK["volunteer"]


def _can_view(r: MissingPersonReport, user: User) -> bool:
    return r.reporter_user_id == user.id or _is_staff(user)


@router.post("", response_model=ReportOut, status_code=201)
async def create_report(
    request: Request,
    subject_name: str = Form(..., max_length=120),
    contact_phone: str = Form(...),
    age: int | None = Form(default=None, ge=0, le=120),
    gender: str | None = Form(default=None, max_length=12),
    description: str | None = Form(default=None, max_length=2000),
    clothing: str | None = Form(default=None, max_length=255),
    last_seen_location_id: int | None = Form(default=None),
    last_seen_at: datetime | None = Form(default=None),
    member_id: int | None = Form(default=None),
    site_id: int | None = Form(default=None),
    photo_consent: bool = Form(default=False),
    photo: UploadFile | None = File(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    try:
        phone = normalize_phone(contact_phone)
    except ValueError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e
    open_count = db.scalar(
        select(func.count(MissingPersonReport.id)).where(
            MissingPersonReport.reporter_user_id == user.id,
            MissingPersonReport.status.in_(["open", "verified", "searching"]),
        )
    )
    if not _is_staff(user) and open_count >= settings.open_reports_per_user:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "You already have open reports. Contact a help desk.")
    member = None
    if member_id:
        member = db.get(FamilyMember, member_id)
        if not member or (member.family.primary_user_id != user.id and not any(m.user_id == user.id for m in member.family.members)):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Member does not belong to your family")
    if last_seen_location_id and not db.get(Location, last_seen_location_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Last-seen location not found")
    if site_id is None and last_seen_location_id:
        site_id = db.get(Location, last_seen_location_id).site_id

    photo_path = None
    if photo and photo.filename:
        if not photo_consent:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Photo requires consent")
        if photo.content_type not in ALLOWED_PHOTO:
            raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Photo must be JPEG, PNG or WebP")
        data = await photo.read()
        if len(data) > MAX_PHOTO:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Photo too large (max 5 MB)")
        os.makedirs(settings.upload_dir, exist_ok=True)
        ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}[photo.content_type]
        photo_path = os.path.join(settings.upload_dir, f"mp_{secrets.token_hex(12)}.{ext}")
        with open(photo_path, "wb") as fh:
            fh.write(data)

    r = MissingPersonReport(
        reporter_user_id=user.id,
        member_id=member.id if member else None,
        site_id=site_id,
        subject_name=subject_name,
        age=age,
        gender=gender,
        description=description,
        clothing=clothing,
        photo_path=photo_path,
        photo_consent=photo_consent,
        last_seen_location_id=last_seen_location_id,
        last_seen_at=last_seen_at,
        contact_phone=phone,
    )
    db.add(r)
    db.flush()
    db.add(ReportEvent(report_id=r.id, actor_id=user.id, event_type="created", note="Report submitted"))
    audit(db, "report.create", actor=user, entity="missing_report", entity_id=r.id, request=request)
    db.commit()
    broadcaster.publish("report.created", {"id": r.id, "status": r.status, "site_id": site_id, "vulnerable": bool(member and member.is_vulnerable) or (age is not None and (age < 12 or age > 65))}, min_role="volunteer")
    return report_out(r, staff=True)


@router.get("/mine", response_model=list[ReportOut])
def my_reports(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.scalars(select(MissingPersonReport).where(MissingPersonReport.reporter_user_id == user.id).order_by(MissingPersonReport.created_at.desc())).all()
    return [report_out(r, staff=False) for r in rows]


@router.get("/board", response_model=list[BoardEntry])
def public_board(db: Session = Depends(get_db), site_id: int | None = None):
    """Non-identifying list of persons currently held at help desks (status=found)."""
    q = select(MissingPersonReport).where(MissingPersonReport.status == "found")
    if site_id:
        q = q.where(MissingPersonReport.site_id == site_id)
    out = []
    for r in db.scalars(q.order_by(MissingPersonReport.updated_at.desc()).limit(100)):
        age_group = "unknown" if r.age is None else ("child" if r.age < 12 else "senior" if r.age > 65 else "adult")
        desk = db.get(Location, r.help_desk_location_id) if r.help_desk_location_id else None
        out.append(BoardEntry(id=r.id, age_group=age_group, gender=r.gender, clothing=r.clothing, held_at=to_out(desk) if desk else None, since=r.updated_at))
    return out


@router.get("", response_model=list[ReportOut])
def list_reports(
    db: Session = Depends(get_db),
    user: User = Depends(require_role("volunteer")),
    status_: str | None = None,
    site_id: int | None = None,
    help_desk: int | None = None,
    limit: int = 200,
):
    q = select(MissingPersonReport)
    if status_:
        q = q.where(MissingPersonReport.status.in_(status_.split(",")))
    if site_id:
        q = q.where(MissingPersonReport.site_id == site_id)
    if help_desk:
        q = q.where(MissingPersonReport.help_desk_location_id == help_desk)
    rows = db.scalars(q.order_by(MissingPersonReport.created_at.desc()).limit(limit)).all()
    return [report_out(r, staff=True) for r in rows]


@router.get("/{report_id}", response_model=ReportOut)
def get_report(report_id: int, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    r = db.get(MissingPersonReport, report_id)
    if not r or not _can_view(r, user):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Report not found")
    if _is_staff(user) and r.reporter_user_id != user.id:
        audit(db, "report.view", actor=user, entity="missing_report", entity_id=r.id, request=request)
        db.commit()
    return report_out(r, staff=_is_staff(user))


@router.get("/{report_id}/photo")
def get_photo(report_id: int, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    r = db.get(MissingPersonReport, report_id)
    if not r or not _can_view(r, user) or not r.photo_path or not os.path.exists(r.photo_path):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No photo")
    audit(db, "report.photo_view", actor=user, entity="missing_report", entity_id=r.id, request=request)
    db.commit()
    return FileResponse(r.photo_path)


@router.get("/{report_id}/events", response_model=list[ReportEventOut])
def report_events(report_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    r = db.get(MissingPersonReport, report_id)
    if not r or not _can_view(r, user):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Report not found")
    return db.scalars(select(ReportEvent).where(ReportEvent.report_id == r.id).order_by(ReportEvent.created_at)).all()


@router.patch("/{report_id}", response_model=ReportOut)
def update_report(report_id: int, body: ReportPatch, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    r = db.get(MissingPersonReport, report_id)
    if not r or not _can_view(r, user):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Report not found")
    staff = _is_staff(user)
    data = body.model_dump(exclude_unset=True)
    if not staff:
        # reporters can only withdraw
        if data.get("status") != "closed" or len([k for k in data if k not in ("status", "note")]) > 0:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Reporters may only close their own report")
    new_status = data.get("status")
    if new_status and new_status != r.status:
        if new_status not in TRANSITIONS[r.status]:
            raise HTTPException(status.HTTP_409_CONFLICT, f"Cannot move from {r.status} to {new_status}")
        r.status = new_status
        if new_status in ("closed", "rejected"):
            r.resolved_at = datetime.now(timezone.utc)
        if new_status == "searching" and staff and not r.assigned_staff_id:
            r.assigned_staff_id = user.id
        if new_status == "found" and staff and not r.help_desk_location_id and user.help_desk_location_id:
            r.help_desk_location_id = user.help_desk_location_id
    if "assigned_staff_id" in data and staff:
        r.assigned_staff_id = data["assigned_staff_id"]
    if "help_desk_location_id" in data and staff:
        r.help_desk_location_id = data["help_desk_location_id"]
    db.add(ReportEvent(report_id=r.id, actor_id=user.id, event_type=f"status:{r.status}" if new_status else "updated", note=data.get("note")))
    audit(db, "report.update", actor=user, entity="missing_report", entity_id=r.id, request=request)
    db.commit()
    broadcaster.publish("report.updated", {"id": r.id, "status": r.status, "help_desk_location_id": r.help_desk_location_id}, user_ids={r.reporter_user_id})
    broadcaster.publish("report.updated", {"id": r.id, "status": r.status, "help_desk_location_id": r.help_desk_location_id}, min_role="volunteer")
    return report_out(r, staff=staff)
