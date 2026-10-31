from __future__ import annotations

import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..broadcaster import broadcaster
from ..db import get_db
from ..deps import audit, device_or_staff, get_current_user, require_role
from ..models import Device, Location, ParkingLot, ParkingPass, ParkingSpot, User
from ..schemas import (
    ParkingLotOut,
    ParkingOccupancyIn,
    ParkingPassIn,
    ParkingPassOut,
    ParkingPatch,
    ParkingSpotIn,
    ParkingSpotOut,
)
from ..services import cache
from ..services.geo import distance_or_none, haversine_m, parse_latlng
from .locations import to_out

router = APIRouter(prefix="/parking", tags=["parking"])


def lot_out(db: Session, lot: ParkingLot, near: tuple[float, float] | None = None) -> ParkingLotOut:
    loc = lot.location
    gate = db.get(Location, lot.nearest_gate_id) if lot.nearest_gate_id else None
    free = max(lot.total_slots - lot.occupied_slots, 0)
    pct = round(lot.occupied_slots / lot.total_slots * 100, 1) if lot.total_slots else 0.0
    return ParkingLotOut(
        id=lot.id,
        location=to_out(loc, near),
        total_slots=lot.total_slots,
        occupied_slots=lot.occupied_slots,
        free_slots=free,
        occupancy_pct=pct,
        vehicle_types=lot.vehicle_types or [],
        nearest_gate=to_out(gate) if gate else None,
        shuttle_info=lot.shuttle_info,
        status=lot.status,
        source=lot.source,
        updated_at=lot.updated_at,
        distance_m=(lambda d: round(d) if d is not None else None)(distance_or_none(near[0], near[1], loc.lat, loc.lng)) if near else None,
    )


def _derive_status(lot: ParkingLot) -> None:
    if lot.status == "closed":
        return
    if lot.total_slots == 0 or lot.occupied_slots >= lot.total_slots:
        lot.status = "full"
    elif lot.occupied_slots >= 0.8 * lot.total_slots:
        lot.status = "filling"
    else:
        lot.status = "open"


def _publish(lot: ParkingLot) -> None:
    cache.invalidate("parking:")
    broadcaster.publish(
        "parking.updated",
        {"lot_id": lot.id, "location_id": lot.location_id, "occupied_slots": lot.occupied_slots, "total_slots": lot.total_slots, "status": lot.status, "updated_at": lot.updated_at.isoformat() if lot.updated_at else None},
        site_id=lot.location.site_id,
    )


@router.get("", response_model=list[ParkingLotOut])
def list_lots(db: Session = Depends(get_db), site_id: int | None = None, near: str | None = None):
    pt = parse_latlng(near)

    def load():
        q = select(ParkingLot).join(Location, ParkingLot.location_id == Location.id)
        if site_id:
            q = q.where(Location.site_id == site_id)
        outs = [lot_out(db, l, None) for l in db.scalars(q)]
        return outs

    outs = cache.get_or_set(f"parking:list:{site_id}", 3.0, load)
    if pt:
        outs = [o.model_copy(update={"distance_m": (lambda d: round(d) if d is not None else None)(distance_or_none(pt[0], pt[1], o.location.lat, o.location.lng))}) for o in outs]
        outs.sort(key=lambda o: o.distance_m if o.distance_m is not None else 10**12)
    return outs


@router.get("/recommend", response_model=list[ParkingLotOut])
def recommend(
    db: Session = Depends(get_db),
    ghat: int | None = None,
    vehicle: str = "car",
    near: str | None = None,
    limit: int = Query(default=3, le=10),
):
    target = db.get(Location, ghat) if ghat else None
    pt = parse_latlng(near) or ((target.lat, target.lng) if target and target.lat is not None else None)
    lots = db.scalars(select(ParkingLot)).all()
    scored = []
    for lot in lots:
        if lot.status == "closed" or (lot.vehicle_types and vehicle not in lot.vehicle_types):
            continue
        o = lot_out(db, lot, pt)
        if o.free_slots <= 0:
            continue
        dist_km = (o.distance_m or 0) / 1000
        # prefer free slots and short walk; full-ish lots penalised
        score = dist_km + (o.occupancy_pct / 100) * 1.5
        scored.append((score, o))
    scored.sort(key=lambda s: s[0])
    return [o for _, o in scored[:limit]]


# ---- my spot (declared before /{lot_id} so the literal path wins)
@router.put("/my-spot", response_model=ParkingSpotOut)
def save_spot(body: ParkingSpotIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not db.get(ParkingLot, body.lot_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Lot not found")
    spot = db.scalar(select(ParkingSpot).where(ParkingSpot.user_id == user.id))
    if not spot:
        spot = ParkingSpot(user_id=user.id, lot_id=body.lot_id)
        db.add(spot)
    spot.lot_id = body.lot_id
    spot.row_label = body.row_label
    spot.note = body.note
    spot.saved_at = datetime.now(timezone.utc)
    db.commit()
    return spot


@router.get("/my-spot", response_model=ParkingSpotOut | None)
def get_spot(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return db.scalar(select(ParkingSpot).where(ParkingSpot.user_id == user.id))


@router.get("/{lot_id}", response_model=ParkingLotOut)
def get_lot(lot_id: int, db: Session = Depends(get_db), near: str | None = None):
    lot = db.get(ParkingLot, lot_id)
    if not lot:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Lot not found")
    return lot_out(db, lot, parse_latlng(near))


@router.post("/{lot_id}/occupancy", response_model=ParkingLotOut)
def update_occupancy(
    lot_id: int,
    body: ParkingOccupancyIn,
    request: Request,
    db: Session = Depends(get_db),
    auth: tuple[Device | None, User | None] = Depends(device_or_staff),
):
    device, user = auth
    lot = db.get(ParkingLot, lot_id)
    if not lot:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Lot not found")
    if body.occupied is not None:
        lot.occupied_slots = min(body.occupied, lot.total_slots)
    elif body.delta is not None:
        lot.occupied_slots = max(0, min(lot.occupied_slots + body.delta, lot.total_slots))
    else:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Provide delta or occupied")
    lot.source = "sensor" if device else "manual"
    lot.updated_at = datetime.now(timezone.utc)
    _derive_status(lot)
    audit(db, "parking.occupancy", actor=user, device=device, entity="parking_lot", entity_id=lot.id, request=request)
    db.commit()
    _publish(lot)
    return lot_out(db, lot)


@router.patch("/{lot_id}", response_model=ParkingLotOut)
def patch_lot(lot_id: int, body: ParkingPatch, db: Session = Depends(get_db), user: User = Depends(require_role("staff"))):
    lot = db.get(ParkingLot, lot_id)
    if not lot:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Lot not found")
    data = body.model_dump(exclude_unset=True)
    if "total_slots" in data:
        lot.total_slots = data["total_slots"]
    if "shuttle_info" in data:
        lot.shuttle_info = data["shuttle_info"]
    if "status" in data and data["status"]:
        lot.status = data["status"]
    if lot.status != "closed":
        _derive_status(lot)
    lot.updated_at = datetime.now(timezone.utc)
    lot.source = "manual"
    audit(db, "parking.patch", actor=user, entity="parking_lot", entity_id=lot.id)
    db.commit()
    _publish(lot)
    return lot_out(db, lot)


# ---- passes
@router.post("/passes", response_model=ParkingPassOut, status_code=201)
def create_pass(body: ParkingPassIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    lot = db.get(ParkingLot, body.lot_id)
    if not lot or lot.status == "closed":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Lot not available")
    p = ParkingPass(
        user_id=user.id,
        lot_id=lot.id,
        vehicle_number=body.vehicle_number.upper().replace(" ", ""),
        vehicle_type=body.vehicle_type,
        qr_token=secrets.token_urlsafe(16),
    )
    db.add(p)
    db.commit()
    return p


@router.get("/passes/mine", response_model=list[ParkingPassOut])
def my_passes(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return db.scalars(select(ParkingPass).where(ParkingPass.user_id == user.id).order_by(ParkingPass.issued_at.desc())).all()


@router.post("/passes/{qr_token}/scan", response_model=ParkingPassOut)
def scan_pass(
    qr_token: str,
    request: Request,
    db: Session = Depends(get_db),
    auth: tuple[Device | None, User | None] = Depends(device_or_staff),
):
    device, user = auth
    p = db.scalar(select(ParkingPass).where(ParkingPass.qr_token == qr_token))
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pass not found")
    if p.status != "issued":
        raise HTTPException(status.HTTP_409_CONFLICT, f"Pass already {p.status}")
    p.status = "used"
    p.used_at = datetime.now(timezone.utc)
    lot = db.get(ParkingLot, p.lot_id)
    lot.occupied_slots = min(lot.occupied_slots + 1, lot.total_slots)
    lot.updated_at = p.used_at
    lot.source = "pass_scan"
    _derive_status(lot)
    audit(db, "parking.pass_scan", actor=user, device=device, entity="parking_pass", entity_id=p.id, request=request)
    db.commit()
    _publish(lot)
    return p


