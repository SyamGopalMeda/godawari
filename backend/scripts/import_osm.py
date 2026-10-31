"""Build the verified location dataset for Godavari Pushkaralu bathing centres from OpenStreetMap.

    python scripts/import_osm.py              # writes data/godavari_locations.json
    python scripts/import_osm.py --dry-run    # print what would be written

What it does (all data comes from public, attributable sources - nothing is invented):
  1. Resolves each bathing centre (town) listed in CENTRES through Nominatim (OpenStreetMap geocoder) and
     records the OSM object id, coordinates, state and district reported by OSM.
  2. Fetches ghats / bathing places mapped in OSM within the centre radius (name contains Ghat / Revu / ఘాట్ /
     రేవు, or leisure=bathing_place). These become locations with verification="source".
  3. Adds ghats that reliable written sources name but OSM does not map (REPORTED_GHATS). These have NO
     coordinates and verification="unverified": the app lists them without a map pin until an admin validates
     a position.
  4. Fetches existing permanent facilities around each centre from OSM (hospitals/clinics, police, public
     toilets, drinking water, public parking, bus and railway stations), nearest first, capped per type.

Festival-specific infrastructure (2027 entry gates, festival parking zones, changing rooms, help desks, crowd
capacities) has not been published by the organisers; it is NOT generated here. Admins add it in the
control room as it is announced, marking it "official".

OSM data © OpenStreetMap contributors, ODbL 1.0. Usage policies: https://operations.osmfoundation.org/policies/
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

UA = {"User-Agent": "PushkarSahayam-data-import/1.0 (Godavari Pushkaralu pilgrim assistance)", "Accept": "application/json"}
NOMINATIM = "https://nominatim.openstreetmap.org/search"
OVERPASS = "https://overpass-api.de/api/interpreter"
OUT = Path(__file__).resolve().parents[1] / "data" / "godavari_locations.json"

WIKI = "https://en.wikipedia.org/wiki/Godavari_Maha_Pushkaram"
HANS_TS = "https://www.thehansindia.com/news/cities/hyderabad/govt-gears-up-for-godavari-pushkaralu-with-67-ghats-rs-1000-cr-plan-1109771"

# Bathing centres named by reliable sources. query = Nominatim free-text query; radius_m = search radius for ghats.
CENTRES = [
    # Telangana (upstream → downstream)
    {"code": "BASAR", "query": "Basar, Nirmal, Telangana", "name_hint": "Basar", "radius_m": 2500, "citations": [WIKI]},
    {"code": "SOAN", "query": "Soan, Nirmal, Telangana", "name_hint": "Soan", "radius_m": 2500, "citations": ["https://www.openstreetmap.org/node/4434889429"]},
    {"code": "DHARMAPURI", "query": "Dharmapuri, Jagtial, Telangana", "name_hint": "Dharmapuri", "radius_m": 2500, "citations": [WIKI]},
    {"code": "KOTILINGALA", "query": "Kotilingala, Jagtial, Telangana", "name_hint": "Kotilingala", "radius_m": 2500, "citations": [WIKI]},
    {"code": "MANTHANI", "query": "Manthani, Peddapalli, Telangana", "name_hint": "Manthani", "radius_m": 2500, "citations": [WIKI]},
    {"code": "KALESHWARAM", "query": "Kaleshwaram, Telangana", "name_hint": "Kaleshwaram", "radius_m": 2500, "citations": [WIKI]},
    {"code": "BHADRACHALAM", "query": "Bhadrachalam, Bhadradri Kothagudem, Telangana", "name_hint": "Bhadrachalam", "radius_m": 3000, "citations": [WIKI]},
    # Andhra Pradesh
    {"code": "RAJAHMUNDRY", "query": "Rajahmundry, East Godavari, Andhra Pradesh", "name_hint": "Rajahmundry", "radius_m": 4500, "citations": [WIKI, "https://eastgodavari.ap.gov.in/?p=3621"]},
    {"code": "KOVVUR", "query": "Kovvur, East Godavari, Andhra Pradesh", "name_hint": "Kovvur", "radius_m": 2500, "citations": [WIKI]},
    {"code": "DOWLESWARAM", "query": "Dowleswaram, Andhra Pradesh", "name_hint": "Dowleswaram", "radius_m": 2500, "citations": [WIKI]},
    {"code": "NARASAPURAM", "query": "Narasapuram, West Godavari, Andhra Pradesh", "name_hint": "Narasapuram", "radius_m": 2500, "citations": [WIKI]},
    {"code": "ANTARVEDI", "query": "Antarvedi, Andhra Pradesh", "name_hint": "Antarvedi", "radius_m": 2500, "citations": [WIKI]},
]

# Ghats named by reliable written sources but not mapped in OSM: listed without coordinates.
REPORTED_GHATS = [
    {"centre": "RAJAHMUNDRY", "code": "GHAT-RJY-KOTILINGALA", "name": "Kotilingala Ghat", "name_te": "కోటిలింగాల ఘాట్", "name_hi": "कोटिलिंगाला घाट",
     "source": "Deccan Chronicle, 23 May 2015", "source_ref": "https://www.deccanchronicle.com/150523/nation-current-affairs/article/temples-be-spruced"},
]

# OSM tag filter → app location type; per-type radius (m) around the centre and max kept (nearest first).
FACILITIES = [
    ("medical", '["amenity"~"^(hospital|clinic|doctors)$"]', 3500, 10),
    ("police", '["amenity"="police"]', 4000, 6),
    ("restroom", '["amenity"="toilets"]', 4000, 10),
    ("water", '["amenity"="drinking_water"]', 4000, 10),
    ("parking", '["amenity"="parking"]["access"!~"private|customers"]', 4000, 8),
    ("bus_stop", '["amenity"="bus_station"]', 6000, 4),
    ("railway_station", '["railway"="station"]', 8000, 3),
]
GENERIC = {
    "medical": ("Medical facility", "వైద్య కేంద్రం", "चिकित्सा केंद्र"),
    "police": ("Police station", "పోలీస్ స్టేషన్", "पुलिस स्टेशन"),
    "restroom": ("Public toilets", "పబ్లిక్ మరుగుదొడ్లు", "सार्वजनिक शौचालय"),
    "water": ("Drinking water", "తాగునీరు", "पेयजल"),
    "parking": ("Public parking", "పబ్లిక్ పార్కింగ్", "सार्वजनिक पार्किंग"),
    "bus_stop": ("Bus station", "బస్ స్టేషన్", "बस स्टेशन"),
    "railway_station": ("Railway station", "రైల్వే స్టేషన్", "रेलवे स्टेशन"),
}
GHAT_NAME = r"([Gg]hat|GHAT|[Rr]evu|ఘాట్|రేవు|స్నాన)"
STRICT_GHAT = r"([Gg]hat|GHAT|ఘాట్|స్నాన)"
NOT_GHAT_KEYS = ("place", "highway", "landuse", "boundary", "railway", "route", "building", "shop", "office")
NOT_GHAT_AMENITY = ("library", "childcare", "school", "college", "bank", "post_office", "hospital", "clinic", "grave_yard", "police")


def hav(a: float, b: float, c: float, d: float) -> float:
    r = math.radians
    h = math.sin(r(c - a) / 2) ** 2 + math.cos(r(a)) * math.cos(r(c)) * math.sin(r(d - b) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def osm_url(kind: str, oid: int) -> str:
    return f"https://www.openstreetmap.org/{ {'n': 'node', 'w': 'way', 'r': 'relation'}.get(kind, kind) }/{oid}"


def overpass(client: httpx.Client, q: str) -> list[dict]:
    for attempt in range(4):
        r = client.post(OVERPASS, data={"data": q}, headers=UA, timeout=180)
        if r.status_code == 200:
            return r.json()["elements"]
        time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"Overpass failed: {r.status_code} {r.text[:200]}")


def resolve_centre(client: httpx.Client, c: dict) -> dict:
    r = client.get(NOMINATIM, params={"q": c["query"], "format": "jsonv2", "addressdetails": 1, "namedetails": 1, "countrycodes": "in", "limit": 1}, headers=UA, timeout=60)
    r.raise_for_status()
    hits = r.json()
    if not hits:
        raise RuntimeError(f"Nominatim found nothing for {c['query']}")
    h = hits[0]
    a, nd = h.get("address", {}), h.get("namedetails", {})
    return {
        "code": c["code"],
        "name": nd.get("name:en") or c["name_hint"],
        "name_te": nd.get("name:te"), "name_hi": nd.get("name:hi"),
        "state": a.get("state"), "district": a.get("state_district") or a.get("county"),
        "lat": round(float(h["lat"]), 6), "lng": round(float(h["lon"]), 6),
        "source": "OpenStreetMap (Nominatim)", "source_ref": osm_url(h["osm_type"][0], int(h["osm_id"])),
        "osm_display_name": h.get("display_name"),
        "citations": c["citations"], "radius_m": c["radius_m"],
    }


def centre_of(e: dict) -> tuple[float, float]:
    c = e.get("center") or {"lat": e.get("lat"), "lon": e.get("lon")}
    return float(c["lat"]), float(c["lon"])


def fetch_centre_data(client: httpx.Client, cen: dict, retrieved: str) -> list[dict]:
    lat, lng, R = cen["lat"], cen["lng"], cen["radius_m"]
    parts = [f'nwr["name"~"{GHAT_NAME}"](around:{R},{lat},{lng});', f'nwr["leisure"="bathing_place"](around:{R},{lat},{lng});']
    for _, filt, rad, _ in FACILITIES:
        parts.append(f"nwr{filt}(around:{rad},{lat},{lng});")
    els = overpass(client, "[out:json][timeout:170];(" + "".join(parts) + ");out center tags;")
    out: list[dict] = []
    seen: set[str] = set()
    # ghats
    import re
    for e in els:
        t = e.get("tags", {})
        name = t.get("name") or ""
        is_bathing = t.get("leisure") == "bathing_place"
        if not (is_bathing or re.search(GHAT_NAME, name)):
            continue
        # "revu" (landing) alone is ambiguous - often a boat/ferry landing. Accept it only when OSM tags it as a
        # bathing/tourist place; names with Ghat / ఘాట్ / స్నాన qualify directly.
        if not is_bathing and not re.search(STRICT_GHAT, name) and not (t.get("tourism") or t.get("leisure") or t.get("amenity") == "place_of_worship"):
            continue
        if any(k in t for k in NOT_GHAT_KEYS) or t.get("amenity") in NOT_GHAT_AMENITY:
            continue
        la, lo = centre_of(e)
        key = f"{e['type'][0]}{e['id']}"
        seen.add(key)
        out.append({
            "code": f"GHAT-{cen['code']}-{e['type'][0].upper()}{e['id']}", "centre": cen["code"], "type": "ghat",
            "name": t.get("name:en") or name or "Bathing place", "name_te": t.get("name:te"), "name_hi": t.get("name:hi"),
            "lat": round(la, 6), "lng": round(lo, 6), "verification": "source",
            "source": "OpenStreetMap", "source_ref": osm_url(e["type"][0], e["id"]), "retrieved_at": retrieved,
            "details": {k: v for k, v in t.items() if k in ("tourism", "leisure", "wheelchair", "description", "wikidata", "wikipedia")},
        })
    # facilities: nearest N per type
    import re as _re
    for typ, filt, rad, cap in FACILITIES:
        cands = []
        for e in els:
            key = f"{e['type'][0]}{e['id']}"
            if key in seen:
                continue
            t = e.get("tags", {})
            ok = {
                "medical": t.get("amenity") in ("hospital", "clinic", "doctors"),
                "police": t.get("amenity") == "police",
                "restroom": t.get("amenity") == "toilets",
                "water": t.get("amenity") == "drinking_water",
                "parking": t.get("amenity") == "parking" and not _re.search("private|customers", t.get("access", "")),
                "bus_stop": t.get("amenity") == "bus_station",
                "railway_station": t.get("railway") == "station",
            }[typ]
            if not ok:
                continue
            la, lo = centre_of(e)
            d = hav(lat, lng, la, lo)
            if d <= rad:
                cands.append((d, e, la, lo))
        for d, e, la, lo in sorted(cands, key=lambda x: x[0])[:cap]:
            t = e.get("tags", {})
            key = f"{e['type'][0]}{e['id']}"
            seen.add(key)
            gen = GENERIC[typ]
            details = {k: v for k, v in t.items() if k in ("amenity", "healthcare", "emergency", "opening_hours", "phone", "contact:phone", "operator", "fee", "wheelchair", "capacity", "access", "unisex", "railway", "operator:type")}
            if "contact:phone" in details and "phone" not in details:
                details["phone"] = details.pop("contact:phone")
            out.append({
                "code": f"{typ.upper()}-{cen['code']}-{e['type'][0].upper()}{e['id']}", "centre": cen["code"], "type": typ,
                "name": t.get("name:en") or t.get("name") or gen[0], "name_te": t.get("name:te") or (None if t.get("name") else gen[1]),
                "name_hi": t.get("name:hi") or (None if t.get("name") else gen[2]),
                "lat": round(la, 6), "lng": round(lo, 6), "verification": "source",
                "source": "OpenStreetMap", "source_ref": osm_url(e["type"][0], e["id"]), "retrieved_at": retrieved,
                "is_accessible": t.get("wheelchair") == "yes",
                "details": details,
            })
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    retrieved = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    centres, locations = [], []
    with httpx.Client() as client:
        for c in CENTRES:
            cen = resolve_centre(client, c)
            print(f"centre {cen['code']:<13} {cen['lat']:.5f},{cen['lng']:.5f}  {cen['district']} / {cen['state']}  {cen['source_ref']}")
            centres.append(cen)
            time.sleep(1.2)  # Nominatim: max 1 request/second
        for cen in centres:
            got = fetch_centre_data(client, cen, retrieved)
            ghats = [g for g in got if g["type"] == "ghat"]
            print(f"  {cen['code']:<13} ghats={len(ghats)} ({', '.join(g['name'] for g in ghats)}) facilities={len(got) - len(ghats)}")
            locations.extend(got)
            time.sleep(2)
    for g in REPORTED_GHATS:
        locations.append({"code": g["code"], "centre": g["centre"], "type": "ghat", "name": g["name"], "name_te": g.get("name_te"), "name_hi": g.get("name_hi"),
                          "lat": None, "lng": None, "verification": "unverified", "source": g["source"], "source_ref": g["source_ref"], "retrieved_at": retrieved, "details": {}})
    data = {
        "generated_at": retrieved,
        "generator": "backend/scripts/import_osm.py",
        "license": "Location data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)",
        "notes": [
            "Official 2027 ghat lists with locations have not been published (AP: about 440 ghats planned; Telangana: 67 centres, per The Hans India).",
            "verification='source' = position from OpenStreetMap, not yet confirmed by the organisers; 'unverified' = named by a written source, no verified position.",
            "Festival entry gates, festival parking zones, changing rooms, help desks and capacities are not included until officially published.",
        ],
        "sources": [WIKI, HANS_TS, "https://www.openstreetmap.org"],
        "centres": centres,
        "locations": locations,
    }
    if args.dry_run:
        print(json.dumps({"centres": len(centres), "locations": len(locations)}))
        return
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {OUT} ({len(centres)} centres, {len(locations)} locations)")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
