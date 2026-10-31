from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..broadcaster import broadcaster
from ..db import get_db
from ..deps import audit, get_optional_user, require_role
from ..models import Alert, Location, Site, SosRequest, User
from ..schemas import AlertIn, AlertOut, SosIn, SosOut, SosPatch
from ..services import cache
from ..services.geo import haversine_m, parse_latlng
from .locations import to_out

router = APIRouter(tags=["alerts-emergency"])


@router.get("/alerts/active", response_model=list[AlertOut])
def active_alerts(db: Session = Depends(get_db), site_id: int | None = None):
    def load():
        now = datetime.now(timezone.utc)
        q = select(Alert).where(Alert.starts_at <= now, or_(Alert.expires_at.is_(None), Alert.expires_at > now))
        if site_id:
            q = q.where(or_(Alert.site_id.is_(None), Alert.site_id == site_id))
        return [AlertOut.model_validate(a) for a in db.scalars(q.order_by(Alert.created_at.desc()))]

    return cache.get_or_set(f"alerts:active:{site_id}", 5.0, load)


@router.post("/alerts", response_model=AlertOut, status_code=201)
def create_alert(body: AlertIn, request: Request, db: Session = Depends(get_db), user: User = Depends(require_role("staff"))):
    data = body.model_dump(exclude={"expires_in_minutes"})
    a = Alert(**data, created_by=user.id)
    if body.expires_in_minutes:
        a.expires_at = datetime.now(timezone.utc) + timedelta(minutes=body.expires_in_minutes)
    db.add(a)
    audit(db, "alert.create", actor=user, entity="alert", request=request)
    db.commit()
    cache.invalidate("alerts:")
    broadcaster.publish("alert.created", AlertOut.model_validate(a).model_dump(mode="json"), site_id=a.site_id)
    return a


@router.delete("/alerts/{alert_id}", status_code=204)
def expire_alert(alert_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("staff"))):
    a = db.get(Alert, alert_id)
    if not a:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alert not found")
    a.expires_at = datetime.now(timezone.utc)
    audit(db, "alert.expire", actor=user, entity="alert", entity_id=a.id)
    db.commit()
    cache.invalidate("alerts:")
    broadcaster.publish("alert.expired", {"id": a.id}, site_id=a.site_id)


@router.get("/emergency/contacts")
def emergency_contacts(db: Session = Depends(get_db), site_id: int | None = None, near: str | None = None):
    site = db.get(Site, site_id) if site_id else db.scalar(select(Site).order_by(Site.id))
    pt = parse_latlng(near)
    posts = db.scalars(select(Location).where(Location.type.in_(["medical", "police", "help_desk", "lost_found"]), Location.is_open.is_(True), Location.lat.is_not(None), Location.verification != "unavailable")).all()
    outs = [to_out(p, pt) for p in posts]
    if pt:
        outs.sort(key=lambda o: o.distance_m if o.distance_m is not None else 10**12)
    national = {"emergency": "112", "ambulance": "108", "police": "100", "fire": "101", "women_helpline": "181", "child_helpline": "1098"}
    return {"national": national, "site": site.emergency_contacts if site else {}, "nearest_posts": outs[:6]}


@router.post("/sos", response_model=dict, status_code=201)
def create_sos(body: SosIn, request: Request, db: Session = Depends(get_db), user: User | None = Depends(get_optional_user)):
    if not user and not body.phone:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Phone number required when not logged in")
    s = SosRequest(user_id=user.id if user else None, phone=body.phone or (user.phone if user else None), lat=body.lat, lng=body.lng, type=body.type, note=body.note)
    db.add(s)
    audit(db, "sos.create", actor=user, entity="sos", request=request)
    db.commit()
    broadcaster.publish("sos.created", SosOut.model_validate(s).model_dump(mode="json"), min_role="volunteer")
    type_map = {"medical": ["medical"], "police": ["police"], "lost_child": ["help_desk", "lost_found", "police"], "fire": ["police", "medical"], "other": ["help_desk", "medical", "police"]}
    posts = db.scalars(select(Location).where(Location.type.in_(type_map[body.type]), Location.is_open.is_(True), Location.lat.is_not(None), Location.verification != "unavailable")).all()
    if body.lat is not None and body.lng is not None:
        posts.sort(key=lambda p: haversine_m(body.lat, body.lng, p.lat, p.lng))
    ref = (body.lat, body.lng) if body.lat is not None and body.lng is not None else None
    return {"request": SosOut.model_validate(s).model_dump(mode="json"), "call": {"emergency": "112", "ambulance": "108", "police": "100"}, "nearest": [to_out(p, ref).model_dump(mode="json") for p in posts[:3]]}


@router.get("/sos", response_model=list[SosOut])
def list_sos(db: Session = Depends(get_db), _: User = Depends(require_role("volunteer")), status_: str | None = None):
    q = select(SosRequest)
    if status_:
        q = q.where(SosRequest.status.in_(status_.split(",")))
    else:
        q = q.where(SosRequest.status != "resolved")
    return db.scalars(q.order_by(SosRequest.created_at.desc()).limit(200)).all()


@router.patch("/sos/{sos_id}", response_model=SosOut)
def update_sos(sos_id: int, body: SosPatch, db: Session = Depends(get_db), user: User = Depends(require_role("volunteer"))):
    s = db.get(SosRequest, sos_id)
    if not s:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "SOS not found")
    s.status = body.status
    s.assigned_to = body.assigned_to if body.assigned_to is not None else (user.id if body.status in ("acknowledged", "dispatched") and not s.assigned_to else s.assigned_to)
    audit(db, "sos.update", actor=user, entity="sos", entity_id=s.id)
    db.commit()
    broadcaster.publish("sos.updated", SosOut.model_validate(s).model_dump(mode="json"), min_role="volunteer")
    if s.user_id:
        broadcaster.publish("sos.updated", SosOut.model_validate(s).model_dump(mode="json"), user_ids={s.user_id})
    return s
