"""Places API: bathing centres (sites), ghats and facilities with provenance and verification.

Verification levels (see models.Location): official · source · unverified · unavailable · demo.
Coordinates are optional - a ghat named by a written source but not yet located has none and is never
placed on a map or routed to until an admin validates a position.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import audit, require_role
from ..models import Location, Site, User
from ..schemas import LocationIn, LocationOut, LocationPatch, SiteOut, VerificationIn
from ..services import cache
from ..services.crowd import effective_level
from ..services.geo import distance_or_none, parse_latlng
from ..services.routing import invalidate

router = APIRouter(tags=["locations"])

FACILITY_TYPES = ["medical", "police", "help_desk", "lost_found", "restroom", "water", "dressing_room", "food", "rest_area", "parking", "bus_stop", "railway_station", "gate", "checkpoint"]


def to_out(loc: Location, near: tuple[float, float] | None = None) -> LocationOut:
    out = LocationOut.model_validate(loc)
    lvl, stale = effective_level(loc)
    out.density_level = lvl
    out.is_stale = stale
    if near:
        d = distance_or_none(near[0], near[1], loc.lat, loc.lng)
        out.distance_m = round(d) if d is not None else None
    return out


def _sort_by_distance(outs: list[LocationOut]) -> list[LocationOut]:
    return sorted(outs, key=lambda o: (o.distance_m is None, o.distance_m or 0, o.name))


# ----------------------------------------------------------------------------- sites (bathing centres)
@router.get("/sites", response_model=list[SiteOut])
def list_sites(db: Session = Depends(get_db), state: str | None = None):
    def load():
        q = select(Site)
        if state:
            q = q.where(Site.state == state)
        sites = db.scalars(q.order_by(Site.sort_order, Site.id)).all()
        counts = {
            (sid, typ, mapped): n
            for sid, typ, mapped, n in db.execute(
                select(Location.site_id, Location.type, Location.lat.is_not(None), func.count(Location.id)).group_by(Location.site_id, Location.type, Location.lat.is_not(None))
            ).all()
        }
        out = []
        for s in sites:
            o = SiteOut.model_validate(s)
            o.ghats_total = sum(n for (sid, typ, _), n in counts.items() if sid == s.id and typ == "ghat")
            o.ghats_mapped = sum(n for (sid, typ, m), n in counts.items() if sid == s.id and typ == "ghat" and m)
            o.facilities = sum(n for (sid, typ, _), n in counts.items() if sid == s.id and typ != "ghat")
            out.append(o)
        return out

    return cache.get_or_set(f"locations:sites:{state}", 10.0, load)


@router.get("/sites/{site_id}", response_model=SiteOut)
def get_site(site_id: int, db: Session = Depends(get_db)):
    for s in list_sites(db=db):
        if s.id == site_id:
            return s
    raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")


# ----------------------------------------------------------------------------- locations
@router.get("/locations", response_model=list[LocationOut])
def list_locations(
    db: Session = Depends(get_db),
    type: str | None = None,
    types: str | None = Query(default=None, description="comma separated"),
    site_id: int | None = None,
    state: str | None = None,
    q: str | None = Query(default=None, max_length=80, description="search names (en/te/hi), codes and town names"),
    verification: str | None = Query(default=None, description="comma separated: official,source,unverified,unavailable,demo"),
    has_coords: bool | None = None,
    near: str | None = Query(default=None, description="lat,lng"),
    radius_m: float | None = Query(default=None, ge=1),
    accessible: bool | None = None,
    open: bool | None = None,
    limit: int = Query(default=500, le=3000),
):
    def load():
        stmt = select(Location)
        if type:
            stmt = stmt.where(Location.type == type)
        if types:
            stmt = stmt.where(Location.type.in_([t.strip() for t in types.split(",") if t.strip()]))
        if site_id:
            stmt = stmt.where(Location.site_id == site_id)
        if state:
            stmt = stmt.where(Location.site_id.in_(select(Site.id).where(Site.state == state)))
        if verification:
            stmt = stmt.where(Location.verification.in_([v.strip() for v in verification.split(",") if v.strip()]))
        if has_coords is not None:
            stmt = stmt.where(Location.lat.is_not(None) if has_coords else Location.lat.is_(None))
        if accessible is not None:
            stmt = stmt.where(Location.is_accessible == accessible)
        if open is not None:
            stmt = stmt.where(Location.is_open == open)
        if q:
            like = f"%{q.strip().lower()}%"
            site_ids = select(Site.id).where(or_(func.lower(Site.name).like(like), func.lower(Site.name_te).like(like), func.lower(Site.name_hi).like(like)))
            stmt = stmt.where(or_(
                func.lower(Location.name).like(like), func.lower(Location.name_te).like(like), func.lower(Location.name_hi).like(like),
                func.lower(Location.code).like(like), Location.site_id.in_(site_ids),
            ))
        rows = db.scalars(stmt.order_by(Location.type, Location.name).limit(limit)).all()
        return [to_out(r, None) for r in rows]

    key = f"locations:list:{type}:{types}:{site_id}:{state}:{q}:{verification}:{has_coords}:{accessible}:{open}:{limit}"
    outs = cache.get_or_set(key, 3.0, load)
    pt = parse_latlng(near)
    if pt:
        outs = [o.model_copy(update={"distance_m": (lambda d: round(d) if d is not None else None)(distance_or_none(pt[0], pt[1], o.lat, o.lng))}) for o in outs]
        if radius_m:
            outs = [o for o in outs if o.distance_m is not None and o.distance_m <= radius_m]
        outs = _sort_by_distance(outs)
    return outs


@router.get("/locations/{location_id}", response_model=LocationOut)
def get_location(location_id: int, db: Session = Depends(get_db), near: str | None = None):
    loc = db.get(Location, location_id)
    if not loc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Location not found")
    return to_out(loc, parse_latlng(near))


@router.get("/locations/{location_id}/nearby")
def nearby(
    location_id: int,
    db: Session = Depends(get_db),
    types: str | None = Query(default=None, description="comma separated; default = all facility types"),
    radius_m: float = Query(default=2500, ge=50, le=20000),
    per_type: int = Query(default=5, ge=1, le=30),
):
    """Facilities around a place, nearest first, grouped by type. Empty groups are returned so the UI can say
    'not published / none mapped nearby' instead of silently hiding a category."""
    loc = db.get(Location, location_id)
    if not loc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Location not found")
    wanted = [t.strip() for t in types.split(",")] if types else FACILITY_TYPES
    if loc.lat is None:
        return {"location_id": loc.id, "has_coords": False, "radius_m": radius_m, "groups": {t: [] for t in wanted}}
    rows = db.scalars(select(Location).where(Location.type.in_(wanted), Location.id != loc.id, Location.lat.is_not(None), Location.verification != "unavailable")).all()
    groups: dict[str, list] = {t: [] for t in wanted}
    for r in rows:
        d = distance_or_none(loc.lat, loc.lng, r.lat, r.lng)
        if d is not None and d <= radius_m:
            o = to_out(r)
            o.distance_m = round(d)
            groups[r.type].append(o)
    for t in groups:
        groups[t] = sorted(groups[t], key=lambda o: o.distance_m)[:per_type]
    return {"location_id": loc.id, "has_coords": True, "radius_m": radius_m, "groups": groups}


@router.post("/locations", response_model=LocationOut, status_code=201)
def create_location(body: LocationIn, request: Request, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    if db.scalar(select(Location).where(Location.code == body.code)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Code already exists")
    if not db.get(Site, body.site_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    if (body.lat is None) != (body.lng is None):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Provide both latitude and longitude, or neither")
    if body.verification == "official" and body.lat is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "An official location needs coordinates")
    data = body.model_dump()
    loc = Location(**data)
    if body.verification == "official":
        loc.verified_by, loc.verified_at = user.id, datetime.now(timezone.utc)
    db.add(loc)
    db.flush()
    audit(db, "location.create", actor=user, entity="location", entity_id=loc.id, purpose=f"{body.verification}: {body.verification_note or ''}"[:250], request=request)
    db.commit()
    invalidate()
    cache.invalidate("locations:")
    return to_out(loc)


@router.patch("/locations/{location_id}", response_model=LocationOut)
def patch_location(location_id: int, body: LocationPatch, request: Request, db: Session = Depends(get_db), user: User = Depends(require_role("staff"))):
    loc = db.get(Location, location_id)
    if not loc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Location not found")
    data = body.model_dump(exclude_unset=True)
    if ("lat" in data) != ("lng" in data):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Update latitude and longitude together")
    moved = "lat" in data and (data["lat"] != loc.lat or data["lng"] != loc.lng)
    for k, v in data.items():
        setattr(loc, k, v)
    if moved and loc.verification == "official":
        # a moved official location must be re-confirmed
        loc.verification, loc.verified_by, loc.verified_at = "unverified", None, None
    elif data:
        loc.verified_by = loc.verified_by or user.id  # an admin has edited it: the dataset loader will not overwrite it
    audit(db, "location.update", actor=user, entity="location", entity_id=loc.id, purpose=",".join(sorted(data))[:250], request=request)
    db.commit()
    invalidate()
    cache.invalidate("locations:")
    cache.invalidate("crowd:")
    return to_out(loc)


@router.post("/locations/{location_id}/verification", response_model=LocationOut)
def set_verification(location_id: int, body: VerificationIn, request: Request, db: Session = Depends(get_db), user: User = Depends(require_role("staff"))):
    """Control-room workflow: confirm a position (official), mark a source position, flag as unverified, or mark
    a place unavailable. Every change is recorded with the actor and note in the audit log."""
    loc = db.get(Location, location_id)
    if not loc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Location not found")
    if (body.lat is None) != (body.lng is None):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Provide both latitude and longitude, or neither")
    if body.lat is not None:
        loc.lat, loc.lng = body.lat, body.lng
    if body.verification in ("official", "source") and loc.lat is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Add coordinates before marking this location verified")
    loc.verification = body.verification
    loc.verification_note = body.note
    if body.source is not None:
        loc.source = body.source
    if body.source_ref is not None:
        loc.source_ref = body.source_ref
    loc.verified_by, loc.verified_at = user.id, datetime.now(timezone.utc)
    if body.verification == "unavailable":
        loc.is_open = False
    audit(db, f"location.verify.{body.verification}", actor=user, entity="location", entity_id=loc.id, purpose=body.note[:250], request=request)
    db.commit()
    invalidate()
    cache.invalidate("locations:")
    cache.invalidate("crowd:")
    return to_out(loc)
