"""Crowd density rules shared by the ingest endpoint, overrides, and status reads."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from ..broadcaster import broadcaster
from ..config import settings
from ..models import CrowdReading, Location

LEVELS = ["low", "moderate", "high", "critical"]
CROWD_MULTIPLIER = {"low": 1.0, "moderate": 1.3, "high": 2.0, "critical": None, "unknown": 1.15}
# reading sources: camera (live AI counter), rfid (gate counters), manual (staff), estimate, video (recorded-video verification)


def level_for(count: int, capacity: int | None) -> str:
    if not capacity or capacity <= 0:
        return "unknown"
    ratio = count / capacity
    if ratio < settings.crowd_low_max:
        return "low"
    if ratio < settings.crowd_moderate_max:
        return "moderate"
    if ratio < settings.crowd_high_max:
        return "high"
    return "critical"


def effective_level(loc: Location, now: datetime | None = None) -> tuple[str, bool]:
    """Returns (level, is_stale). A staff override wins while it is valid."""
    now = now or datetime.now(timezone.utc)
    if loc.override_level and loc.override_until and _aware(loc.override_until) > now:
        return loc.override_level, False
    if not loc.density_updated_at:
        return "unknown", True
    age = (now - _aware(loc.density_updated_at)).total_seconds()
    if age > settings.crowd_stale_seconds:
        return "unknown", True
    return loc.density_level or "unknown", False


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def record_reading(
    db: Session,
    loc: Location,
    count: int,
    source: str,
    *,
    device_id: int | None = None,
    user_id: int | None = None,
    recorded_at: datetime | None = None,
) -> CrowdReading:
    level = level_for(count, loc.capacity)
    reading = CrowdReading(
        location_id=loc.id,
        count=count,
        density_level=level,
        source=source,
        device_id=device_id,
        reported_by=user_id,
        recorded_at=recorded_at or datetime.now(timezone.utc),
    )
    db.add(reading)
    loc.current_count = count
    loc.density_level = level
    loc.density_source = source
    loc.density_updated_at = reading.recorded_at
    return reading


def publish_status(loc: Location) -> None:
    level, stale = effective_level(loc)
    broadcaster.publish(
        "crowd.updated",
        {
            "location_id": loc.id,
            "code": loc.code,
            "density_level": level,
            "current_count": loc.current_count,
            "capacity": loc.capacity,
            "source": loc.density_source,
            "is_stale": stale,
            "updated_at": loc.density_updated_at.isoformat() if loc.density_updated_at else None,
            "override": bool(loc.override_level and loc.override_until),
        },
        site_id=loc.site_id,
    )
