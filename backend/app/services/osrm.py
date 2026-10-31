"""Walking directions over OpenStreetMap footpaths (OSRM 'foot' profile).

Used when a bathing centre has no organiser walkway graph (services/routing.py). The default server is the
FOSSGIS community instance (routing.openstreetmap.de), which is fine for a pilot; for the festival, self-host
OSRM with the India extract and point PUSHKAR_OSRM_FOOT_URL at it (docs/09).

Steps are returned as structured maneuvers (type, modifier, street name, distance) so the app can phrase them
in Telugu, Hindi or English; `instruction` is an English fallback.
"""
from __future__ import annotations

import logging
import time

import httpx

from ..config import settings

log = logging.getLogger("osrm")
_cache: dict[str, tuple[float, dict]] = {}
_TTL = 120.0
UA = {"User-Agent": "PushkarSahayam/1.0 (Godavari Pushkaralu pilgrim assistance)"}
ATTRIBUTION = "Walking route: OSRM on OpenStreetMap data (© OpenStreetMap contributors)"


class RoutingUnavailable(Exception):
    pass


def _instruction(m: dict, name: str) -> str:
    t, mod = m.get("type", ""), (m.get("modifier") or "").replace("_", " ")
    onto = f" onto {name}" if name else ""
    if t == "depart":
        return f"Head {mod or 'out'}{onto}".strip()
    if t == "arrive":
        return "Arrive at your destination"
    if t in ("turn", "end of road", "fork", "on ramp", "off ramp"):
        return f"Turn {mod}{onto}".strip()
    if t in ("roundabout", "rotary"):
        return f"At the roundabout take exit {m.get('exit', '')}{onto}".strip()
    if t in ("continue", "new name", "notification"):
        return f"Continue {mod}{onto}".strip()
    return f"{t.capitalize()} {mod}{onto}".strip()


def foot_route(from_lat: float, from_lng: float, to_lat: float, to_lng: float) -> dict:
    key = f"{from_lat:.4f},{from_lng:.4f}>{to_lat:.5f},{to_lng:.5f}"
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < _TTL:
        return hit[1]
    url = f"{settings.osrm_foot_url.rstrip('/')}/route/v1/foot/{from_lng},{from_lat};{to_lng},{to_lat}"
    try:
        r = httpx.get(url, params={"overview": "full", "geometries": "geojson", "steps": "true"}, headers=UA, timeout=settings.osrm_timeout_seconds)
        data = r.json()
    except Exception as e:  # noqa: BLE001
        log.warning("OSRM unavailable: %s", e)
        raise RoutingUnavailable(str(e)) from e
    if r.status_code != 200 or data.get("code") != "Ok" or not data.get("routes"):
        raise RoutingUnavailable(data.get("message") or f"HTTP {r.status_code}")
    route = data["routes"][0]
    steps = []
    for leg in route.get("legs", []):
        for s in leg.get("steps", []):
            m = s.get("maneuver", {})
            name = s.get("name") or ""
            steps.append({
                "instruction": _instruction(m, name), "distance_m": round(s.get("distance", 0)),
                "maneuver": m.get("type"), "modifier": m.get("modifier"), "name": name or None, "zone_level": None,
            })
    out = {
        "polyline": [[lat, lng] for lng, lat in route["geometry"]["coordinates"]],
        "distance_m": round(route.get("distance", 0)),
        "steps": steps,
    }
    _cache[key] = (time.time(), out)
    return out
