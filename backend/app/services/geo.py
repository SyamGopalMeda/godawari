from __future__ import annotations

import math

EARTH_RADIUS_M = 6_371_000.0


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def parse_latlng(value: str | None) -> tuple[float, float] | None:
    if not value:
        return None
    try:
        lat_s, lng_s = value.split(",")
        lat, lng = float(lat_s), float(lng_s)
    except ValueError:
        return None
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return None
    return lat, lng


def bearing_to_words(lat1: float, lng1: float, lat2: float, lng2: float) -> str:
    y = math.sin(math.radians(lng2 - lng1)) * math.cos(math.radians(lat2))
    x = math.cos(math.radians(lat1)) * math.sin(math.radians(lat2)) - math.sin(math.radians(lat1)) * math.cos(
        math.radians(lat2)
    ) * math.cos(math.radians(lng2 - lng1))
    brg = (math.degrees(math.atan2(y, x)) + 360) % 360
    names = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"]
    return names[int((brg + 22.5) // 45) % 8]


def distance_or_none(lat1, lng1, lat2, lng2) -> float | None:
    """Distance in metres, or None when either point has no verified coordinates."""
    if None in (lat1, lng1, lat2, lng2):
        return None
    return haversine_m(lat1, lng1, lat2, lng2)


INF = float("inf")
