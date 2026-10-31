"""Site data onboarding CLI - replaces the demo seed with surveyed data.

  python scripts/import_site.py template ./site-data      # write sample files (from the demo layout)
  python scripts/import_site.py validate ./site-data      # check files, print counts, no DB writes
  python scripts/import_site.py import ./site-data        # upsert into PUSHKAR_DATABASE_URL

Bundle layout (UTF-8 CSV with header rows):
  site.json          {"name","name_te","name_hi","district","center_lat","center_lng","emergency_contacts":{}}
  locations.csv      code,type,name,name_te,name_hi,lat,lng,capacity,is_accessible,is_open,monitored,details_json
  parking.csv        location_code,total_slots,vehicle_types,nearest_gate_code,shuttle_info
  walkway_nodes.csv  label,lat,lng,location_code
  walkway_edges.csv  from_label,to_label,is_accessible,zone_location_code     (length is computed)
  staff.csv          username,password,name,role,help_desk_code,phone
  tags.txt           one wristband UID per line

Upserts are keyed by location code / node label / username / tag UID, so the import can be re-run.
Run with PUSHKAR_SEED_ON_START=false once real data is loaded.
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app import seed as demo  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.models import Alert, Location, MissingPersonReport, ParkingLot, RfidTag, Site, User, WalkwayEdge, WalkwayNode  # noqa: E402
from app.security import hash_password  # noqa: E402
from app.services.geo import haversine_m  # noqa: E402

TYPES = {"ghat", "gate", "parking", "checkpoint", "help_desk", "medical", "restroom", "water", "dressing_room", "food", "rest_area", "police", "lost_found", "bus_stop", "shuttle", "other"}
ROLES = {"volunteer", "staff", "admin"}


def _bool(v: str) -> bool:
    return str(v).strip().lower() in ("1", "true", "yes", "y")


def _read_csv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8-sig", newline="") as fh:
        return [{k.strip(): (v or "").strip() for k, v in row.items()} for row in csv.DictReader(fh)]


# ----------------------------------------------------------------------------- template
def write_template(d: Path) -> None:
    d.mkdir(parents=True, exist_ok=True)
    (d / "site.json").write_text(json.dumps({"name": "Rajamahendravaram Riverfront", "name_te": "రాజమహేంద్రవరం నదీతీరం", "name_hi": "राजमहेंद्रवरम नदी तट", "district": "East Godavari", "center_lat": 17.0005, "center_lng": 81.7785, "emergency_contacts": {"control_room": "+91-883-2400000", "lost_found": "+91-883-2400010", "medical": "108", "police": "100", "emergency": "112"}}, ensure_ascii=False, indent=2), encoding="utf-8")
    with (d / "locations.csv").open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["code", "type", "name", "name_te", "name_hi", "lat", "lng", "capacity", "is_accessible", "is_open", "monitored", "details_json"])
        for spec in demo.LOCATIONS:
            w.writerow([spec["code"], spec["type"], spec["name"], spec.get("name_te", ""), spec.get("name_hi", ""), spec["lat"], spec["lng"], spec.get("capacity", ""), spec.get("is_accessible", False), True, spec.get("monitored", False), json.dumps(spec.get("details", {}), ensure_ascii=False)])
    with (d / "parking.csv").open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["location_code", "total_slots", "vehicle_types", "nearest_gate_code", "shuttle_info"])
        for p in demo.PARKING:
            w.writerow([p["code"], p["total"], "|".join(p["types"]), p["gate"], p["shuttle"]])
    with (d / "walkway_nodes.csv").open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["label", "lat", "lng", "location_code"])
        for label, lat, lng, code in demo.NODES:
            w.writerow([label, lat, lng, code or ""])
    with (d / "walkway_edges.csv").open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["from_label", "to_label", "is_accessible", "zone_location_code"])
        for a, b, acc, zone in demo.EDGES:
            w.writerow([a, b, acc, zone or ""])
    with (d / "staff.csv").open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["username", "password", "name", "role", "help_desk_code", "phone"])
        w.writerow(["helpdesk2", "CHANGE-ME-12345", "Help Desk 2 volunteer", "volunteer", "HELP-2", ""])
        w.writerow(["staff1", "CHANGE-ME-12345", "Control room staff", "staff", "", ""])
    (d / "tags.txt").write_text("\n".join(f"GP27-{i:05d}" for i in range(1, 51)) + "\n", encoding="utf-8")
    print(f"Template written to {d}. Edit the files with surveyed data, then run: validate, import.")


# ----------------------------------------------------------------------------- validate
def load_bundle(d: Path) -> dict:
    errors: list[str] = []
    site = json.loads((d / "site.json").read_text(encoding="utf-8")) if (d / "site.json").exists() else None
    if not site:
        errors.append("site.json missing")
    locs = _read_csv(d / "locations.csv")
    codes: set[str] = set()
    for i, r in enumerate(locs, 2):
        if not r.get("code"):
            errors.append(f"locations.csv line {i}: code required")
        if r.get("code") in codes:
            errors.append(f"locations.csv line {i}: duplicate code {r['code']}")
        codes.add(r.get("code", ""))
        if r.get("type") not in TYPES:
            errors.append(f"locations.csv line {i}: unknown type {r.get('type')!r}")
        try:
            lat, lng = float(r["lat"]), float(r["lng"])
            if not (-90 <= lat <= 90 and -180 <= lng <= 180):
                raise ValueError
        except (KeyError, ValueError):
            errors.append(f"locations.csv line {i}: invalid lat/lng")
        if _bool(r.get("monitored", "")) and not r.get("capacity"):
            errors.append(f"locations.csv line {i}: monitored location {r.get('code')} needs a capacity")
        if r.get("details_json"):
            try:
                json.loads(r["details_json"])
            except ValueError:
                errors.append(f"locations.csv line {i}: details_json is not valid JSON")
    parking = _read_csv(d / "parking.csv")
    for i, r in enumerate(parking, 2):
        if r.get("location_code") not in codes:
            errors.append(f"parking.csv line {i}: unknown location_code {r.get('location_code')}")
        if r.get("nearest_gate_code") and r["nearest_gate_code"] not in codes:
            errors.append(f"parking.csv line {i}: unknown nearest_gate_code")
        if not r.get("total_slots", "").isdigit():
            errors.append(f"parking.csv line {i}: total_slots must be an integer")
    nodes = _read_csv(d / "walkway_nodes.csv")
    labels = {n.get("label") for n in nodes}
    for i, n in enumerate(nodes, 2):
        if n.get("location_code") and n["location_code"] not in codes:
            errors.append(f"walkway_nodes.csv line {i}: unknown location_code {n['location_code']}")
    edges = _read_csv(d / "walkway_edges.csv")
    for i, e in enumerate(edges, 2):
        if e.get("from_label") not in labels or e.get("to_label") not in labels:
            errors.append(f"walkway_edges.csv line {i}: unknown node label")
        if e.get("zone_location_code") and e["zone_location_code"] not in codes:
            errors.append(f"walkway_edges.csv line {i}: unknown zone_location_code")
    staff = _read_csv(d / "staff.csv")
    for i, s in enumerate(staff, 2):
        if s.get("role") not in ROLES:
            errors.append(f"staff.csv line {i}: role must be one of {sorted(ROLES)}")
        if len(s.get("password", "")) < 8 or "CHANGE-ME" in s.get("password", ""):
            errors.append(f"staff.csv line {i}: set a real password (>= 8 chars) for {s.get('username')}")
        if s.get("help_desk_code") and s["help_desk_code"] not in codes:
            errors.append(f"staff.csv line {i}: unknown help_desk_code")
    tags = [t.strip().upper() for t in (d / "tags.txt").read_text(encoding="utf-8").splitlines() if t.strip()] if (d / "tags.txt").exists() else []
    return {"site": site, "locations": locs, "parking": parking, "nodes": nodes, "edges": edges, "staff": staff, "tags": tags, "errors": errors}


def validate(d: Path) -> dict:
    b = load_bundle(d)
    print(f"locations={len(b['locations'])} parking={len(b['parking'])} nodes={len(b['nodes'])} edges={len(b['edges'])} staff={len(b['staff'])} tags={len(b['tags'])}")
    for e in b["errors"]:
        print("ERROR:", e)
    print("OK" if not b["errors"] else f"{len(b['errors'])} error(s)")
    return b


# ----------------------------------------------------------------------------- import
def do_import(d: Path) -> None:
    b = validate(d)
    if b["errors"]:
        sys.exit(1)
    Base.metadata.create_all(engine)
    db = SessionLocal()
    try:
        s = b["site"]
        site = db.scalar(select(Site).where(Site.name == s["name"]))
        if not site:
            site = Site(name=s["name"])
            db.add(site)
        for k in ("name_te", "name_hi", "district", "center_lat", "center_lng", "emergency_contacts"):
            if k in s:
                setattr(site, k, s[k])
        db.flush()

        by_code: dict[str, Location] = {}
        for r in b["locations"]:
            loc = db.scalar(select(Location).where(Location.code == r["code"]))
            if not loc:
                loc = Location(code=r["code"], site_id=site.id)
                db.add(loc)
            loc.site_id = site.id
            loc.type = r["type"]
            loc.name, loc.name_te, loc.name_hi = r["name"], r.get("name_te") or None, r.get("name_hi") or None
            loc.lat, loc.lng = float(r["lat"]), float(r["lng"])
            loc.capacity = int(r["capacity"]) if r.get("capacity") else None
            loc.is_accessible = _bool(r.get("is_accessible", ""))
            loc.is_open = _bool(r.get("is_open", "true"))
            loc.monitored = _bool(r.get("monitored", ""))
            loc.details = json.loads(r["details_json"]) if r.get("details_json") else {}
            by_code[loc.code] = loc
        db.flush()

        for r in b["parking"]:
            loc = by_code[r["location_code"]]
            lot = db.scalar(select(ParkingLot).where(ParkingLot.location_id == loc.id))
            if not lot:
                lot = ParkingLot(location_id=loc.id, total_slots=0)
                db.add(lot)
            lot.total_slots = int(r["total_slots"])
            lot.vehicle_types = [v for v in r.get("vehicle_types", "").split("|") if v]
            lot.nearest_gate_id = by_code[r["nearest_gate_code"]].id if r.get("nearest_gate_code") else None
            lot.shuttle_info = r.get("shuttle_info") or None

        # walkway graph for this site is replaced wholesale (edges reference node ids)
        old_nodes = db.scalars(select(WalkwayNode).where(WalkwayNode.site_id == site.id)).all()
        if old_nodes:
            ids = [n.id for n in old_nodes]
            for e in db.scalars(select(WalkwayEdge).where(WalkwayEdge.from_node.in_(ids))).all():
                db.delete(e)
            for n in old_nodes:
                db.delete(n)
            db.flush()
        by_label: dict[str, WalkwayNode] = {}
        for n in b["nodes"]:
            node = WalkwayNode(site_id=site.id, lat=float(n["lat"]), lng=float(n["lng"]), location_id=by_code[n["location_code"]].id if n.get("location_code") else None, label=n["label"])
            db.add(node)
            by_label[n["label"]] = node
        db.flush()
        for e in b["edges"]:
            a, c = by_label[e["from_label"]], by_label[e["to_label"]]
            db.add(WalkwayEdge(from_node=a.id, to_node=c.id, length_m=round(haversine_m(a.lat, a.lng, c.lat, c.lng)), is_accessible=_bool(e.get("is_accessible", "true")), zone_location_id=by_code[e["zone_location_code"]].id if e.get("zone_location_code") else None))

        for s_ in b["staff"]:
            u = db.scalar(select(User).where(User.username == s_["username"]))
            if not u:
                u = User(username=s_["username"], role=s_["role"])
                db.add(u)
            u.password_hash = hash_password(s_["password"])
            u.name, u.role, u.site_id = s_["name"], s_["role"], site.id
            u.help_desk_location_id = by_code[s_["help_desk_code"]].id if s_.get("help_desk_code") else None
            u.phone = s_.get("phone") or None

        # drop the demo site row once nothing references it any more
        for stale in db.scalars(select(Site).where(Site.id != site.id, Site.name.like("%(demo)"))).all():
            if db.scalar(select(Location.id).where(Location.site_id == stale.id).limit(1)):
                continue  # still has locations the bundle did not cover: keep it
            stale_nodes = db.scalars(select(WalkwayNode).where(WalkwayNode.site_id == stale.id)).all()
            if stale_nodes:
                ids = [n.id for n in stale_nodes]
                for e in db.scalars(select(WalkwayEdge).where(WalkwayEdge.from_node.in_(ids))).all():
                    db.delete(e)
                for n in stale_nodes:
                    db.delete(n)
            for u in db.scalars(select(User).where(User.site_id == stale.id)).all():
                u.site_id = site.id
            for a in db.scalars(select(Alert).where(Alert.site_id == stale.id)).all():
                a.site_id = site.id
            for r in db.scalars(select(MissingPersonReport).where(MissingPersonReport.site_id == stale.id)).all():
                r.site_id = site.id
            db.flush()
            db.delete(stale)
            print(f"Removed demo site row '{stale.name}'")

        new_tags = 0
        for uid in b["tags"]:
            if not db.get(RfidTag, uid):
                db.add(RfidTag(uid=uid))
                new_tags += 1
        db.commit()
        print(f"Imported site '{site.name}' (id {site.id}): {len(by_code)} locations, {len(b['parking'])} lots, {len(by_label)} nodes, {len(b['edges'])} edges, {len(b['staff'])} staff, {new_tags} new tags")
        print("Set PUSHKAR_SEED_ON_START=false and restart the API.")
    finally:
        db.close()


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in ("template", "validate", "import"):
        print(__doc__)
        sys.exit(2)
    cmd, path = sys.argv[1], Path(sys.argv[2])
    if cmd == "template":
        write_template(path)
    elif cmd == "validate":
        validate(path)
    else:
        do_import(path)
    sys.stdout.flush()
