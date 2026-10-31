"""Load the verified Godavari Pushkaralu location dataset (data/godavari_locations.json).

Idempotent upsert keyed by code:
  - new centres / locations are inserted;
  - existing records still marked 'source' or 'unverified' are refreshed from the dataset;
  - records an admin has verified or edited (verified_by set, or verification 'official'/'unavailable') are never
    overwritten - the control room is the authority once it has acted.
No crowd readings, alerts, devices, wristbands or festival infrastructure are created: those must come from
real devices and the organisers.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .models import Location, Site, User
from .security import hash_password

log = logging.getLogger("seed_real")
DATASET = Path(__file__).resolve().parents[1] / "data" / "godavari_locations.json"
NATIONAL = {"emergency": "112", "ambulance": "108", "police": "100", "fire": "101", "women_helpline": "181", "child_helpline": "1098"}
# upstream → downstream ordering for menus
ORDER = ["BASAR", "SOAN", "DHARMAPURI", "KOTILINGALA", "MANTHANI", "KALESHWARAM", "BHADRACHALAM", "RAJAHMUNDRY", "KOVVUR", "DOWLESWARAM", "NARASAPURAM", "ANTARVEDI"]


def _ts(v: str | None) -> datetime | None:
    return datetime.fromisoformat(v) if v else None


def load_dataset(path: Path = DATASET) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def seed_real(db: Session, path: Path = DATASET) -> dict:
    if not path.exists():
        log.warning("Dataset %s not found - run scripts/import_osm.py", path)
        _ensure_admin(db)
        return {"centres": 0, "inserted": 0, "updated": 0, "kept": 0}
    data = load_dataset(path)
    sites: dict[str, Site] = {}
    for c in data["centres"]:
        site = db.scalar(select(Site).where(Site.code == c["code"]))
        if not site:
            site = Site(code=c["code"], emergency_contacts=dict(NATIONAL))
            db.add(site)
        site.name, site.name_te, site.name_hi = c["name"], c.get("name_te"), c.get("name_hi")
        site.state, site.district = c.get("state"), c.get("district")
        site.center_lat, site.center_lng = c["lat"], c["lng"]
        site.source, site.source_ref, site.citations = c.get("source"), c.get("source_ref"), c.get("citations", [])
        site.sort_order = ORDER.index(c["code"]) if c["code"] in ORDER else 99
        sites[c["code"]] = site
    db.flush()
    inserted = updated = kept = 0
    for r in data["locations"]:
        site = sites.get(r["centre"])
        if not site:
            continue
        loc = db.scalar(select(Location).where(Location.code == r["code"]))
        if loc and (loc.verified_by is not None or loc.verification in ("official", "unavailable")):
            kept += 1
            continue
        if not loc:
            loc = Location(code=r["code"])
            db.add(loc)
            inserted += 1
        else:
            updated += 1
        loc.site_id = site.id
        loc.type = r["type"]
        loc.name, loc.name_te, loc.name_hi = r["name"], r.get("name_te"), r.get("name_hi")
        loc.lat, loc.lng = r.get("lat"), r.get("lng")
        loc.is_accessible = bool(r.get("is_accessible"))
        loc.is_open = True
        loc.monitored = r["type"] == "ghat"   # ghats can receive verified crowd readings; none exist yet
        loc.capacity = None                    # safe capacities are set by the organisers, not guessed
        loc.details = r.get("details", {})
        loc.verification = r["verification"]
        loc.source, loc.source_ref = r.get("source"), r.get("source_ref")
        loc.source_retrieved_at = _ts(r.get("retrieved_at"))
    _ensure_admin(db)
    db.commit()
    log.info("Real dataset loaded: %d centres, %d inserted, %d refreshed, %d kept (admin-verified)", len(sites), inserted, updated, kept)
    return {"centres": len(sites), "inserted": inserted, "updated": updated, "kept": kept}


def _ensure_admin(db: Session) -> None:
    if not db.scalar(select(User).where(User.username == settings.bootstrap_admin_username)):
        db.add(User(username=settings.bootstrap_admin_username, password_hash=hash_password(settings.bootstrap_admin_password), name="Administrator", role="admin"))
        db.commit()
