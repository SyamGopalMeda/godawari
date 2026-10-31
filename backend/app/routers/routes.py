from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..models import Location, WalkwayNode
from ..schemas import RouteOut
from ..services import osrm, routing
from ..services.geo import parse_latlng

router = APIRouter(tags=["routes"])


@router.get("/routes", response_model=RouteOut)
def get_route(
    db: Session = Depends(get_db),
    to: int = Query(..., description="destination location id"),
    from_: str = Query(..., alias="from", description="lat,lng"),
    accessible: bool = False,
    avoid_crowd: bool = True,
):
    """Walking route to a place.

    1. If the organisers have provided a walkway graph for the destination's centre, route over it
       (crowd-aware, closures and accessibility respected).
    2. Otherwise route over OpenStreetMap footpaths (OSRM). Crowd avoidance and step-free routing are not
       available for these routes and the response says so.
    """
    pt = parse_latlng(from_)
    if not pt:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "from must be lat,lng")
    dest = db.get(Location, to)
    if not dest:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Destination not found")
    if dest.lat is None or dest.lng is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This location's position has not been verified yet, so directions are unavailable")
    has_graph = db.scalar(select(func.count(WalkwayNode.id)).where(WalkwayNode.site_id == dest.site_id)) or 0
    if has_graph:
        res = routing.route(db, dest.site_id, pt[0], pt[1], dest, accessible=accessible, avoid_crowd=avoid_crowd)
        if not res:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "No walkable route found (closed or over-capacity zones)")
        return RouteOut(**res.__dict__, accessible=accessible, provider="walkways", attribution="Walkways published by the event organisers")
    try:
        r = osrm.foot_route(pt[0], pt[1], dest.lat, dest.lng)
    except osrm.RoutingUnavailable as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Walking directions are temporarily unavailable. Use your phone's maps app.") from e
    speed = settings.accessible_walk_speed_kmh if accessible else settings.walk_speed_kmh
    notes = ["Route follows public streets and footpaths from OpenStreetMap; festival barricades and one-way pedestrian flows are not included."]
    if avoid_crowd:
        notes.append("Crowd avoidance is not available on this route: the organisers have not published walkway data for this centre.")
    if accessible:
        notes.append("Step-free routing is not available on this route; check with staff at the entry.")
    return RouteOut(
        polyline=r["polyline"], distance_m=r["distance_m"], eta_min=round(r["distance_m"] / 1000 / speed * 60, 1),
        steps=r["steps"], crowd_notes=[], avoided_zones=[], accessible=accessible,
        provider="osrm", attribution=osrm.ATTRIBUTION, notes=notes,
    )
