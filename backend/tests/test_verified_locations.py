"""Verified-location dataset, provenance and the admin verification workflow."""
import json
import tempfile
from pathlib import Path

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import Alert, CrowdReading, Device, Location, Site
from app.seed_real import DATASET, seed_real
from app.services import osrm


# ----------------------------------------------------------------------------- the committed dataset itself
def test_dataset_is_sourced_and_has_no_invented_positions():
    d = json.loads(DATASET.read_text(encoding="utf-8"))
    assert len(d["centres"]) >= 10
    for c in d["centres"]:
        assert c["source_ref"].startswith("https://www.openstreetmap.org/"), c
        assert c["state"] in ("Telangana", "Andhra Pradesh"), c
    for loc in d["locations"]:
        assert loc["source"] and loc["source_ref"], loc
        if loc["verification"] == "source":
            assert loc["lat"] is not None and loc["source_ref"].startswith("https://www.openstreetmap.org/"), loc
        if loc["verification"] == "unverified":
            assert loc["lat"] is None and loc["lng"] is None, "unverified places must not carry coordinates"
    names = {(l["centre"], l["name"]) for l in d["locations"] if l["type"] == "ghat"}
    assert ("RAJAHMUNDRY", "Pushkar Ghat") in names and ("RAJAHMUNDRY", "Saraswathi Ghat") in names
    pushkar = next(l for l in d["locations"] if l["centre"] == "RAJAHMUNDRY" and l["name"] == "Pushkar Ghat")
    assert abs(pushkar["lat"] - 17.0084) < 0.001 and abs(pushkar["lng"] - 81.767) < 0.001  # OSM node 4115259593


def _fresh_session():
    tmp = Path(tempfile.mkdtemp(prefix="pushkar_real_"))
    eng = create_engine(f"sqlite:///{(tmp / 'real.db').as_posix()}")
    Base.metadata.create_all(eng)
    return sessionmaker(bind=eng)()


def test_real_seed_loads_without_fabricated_operational_data():
    db = _fresh_session()
    stats = seed_real(db)
    assert stats["centres"] >= 10 and stats["inserted"] > 50
    assert db.scalar(select(func.count(CrowdReading.id))) == 0, "no crowd readings may be invented"
    assert db.scalar(select(func.count(Alert.id))) == 0
    assert db.scalar(select(func.count(Device.id))) == 0
    ghats = db.scalars(select(Location).where(Location.type == "ghat")).all()
    assert all(g.capacity is None for g in ghats), "capacities come from the organisers"
    assert all(g.current_count is None for g in ghats)
    site = db.scalar(select(Site).where(Site.code == "RAJAHMUNDRY"))
    assert site.state == "Andhra Pradesh" and site.emergency_contacts["emergency"] == "112"


def test_reload_never_overwrites_admin_verified_records():
    db = _fresh_session()
    seed_real(db)
    g = db.scalar(select(Location).where(Location.code.like("GHAT-RAJAHMUNDRY-%")))
    g.verification, g.verified_by, g.name = "official", 1, "Pushkar Ghat (confirmed)"
    db.commit()
    stats = seed_real(db)
    db.refresh(g)
    assert g.name == "Pushkar Ghat (confirmed)" and g.verification == "official"
    assert stats["kept"] >= 1 and stats["inserted"] == 0


# ----------------------------------------------------------------------------- API (demo fixture + added records)
def _site_without_graph(client, admin):
    """A new bathing centre with no organiser walkway graph, plus one mapped and one unmapped ghat."""
    from app.db import SessionLocal
    db = SessionLocal()
    s = db.scalar(select(Site).where(Site.code == "TEST-TOWN"))
    if not s:
        s = Site(code="TEST-TOWN", name="Test Town", state="Andhra Pradesh", district="East Godavari District", center_lat=17.0, center_lng=81.78, emergency_contacts={})
        db.add(s)
        db.commit()
    sid = s.id
    db.close()
    mapped = client.post("/api/v1/locations", json={"code": "T-GHAT-MAPPED", "site_id": sid, "type": "ghat", "name": "Mapped Test Ghat", "lat": 17.0084, "lng": 81.7669, "verification": "source", "source": "OpenStreetMap", "source_ref": "https://www.openstreetmap.org/node/1"}, headers=admin)
    unmapped = client.post("/api/v1/locations", json={"code": "T-GHAT-UNMAPPED", "site_id": sid, "type": "ghat", "name": "Reported Test Ghat", "verification": "unverified", "source": "Test newspaper"}, headers=admin)
    def get(code, resp):
        if resp.status_code == 201:
            return resp.json()
        return next(l for l in client.get("/api/v1/locations", params={"q": code}).json() if l["code"] == code)

    return sid, get("T-GHAT-MAPPED", mapped), get("T-GHAT-UNMAPPED", unmapped)


def test_locations_without_coordinates_are_listed_but_never_routed(client, admin):
    sid, mapped, unmapped = _site_without_graph(client, admin)
    assert unmapped["lat"] is None
    r = client.get("/api/v1/locations", params={"site_id": sid, "has_coords": "false"})
    assert [l["code"] for l in r.json()] == ["T-GHAT-UNMAPPED"]
    r = client.get("/api/v1/routes", params={"from": "17.0,81.78", "to": unmapped["id"]})
    assert r.status_code == 409 and "not been verified" in r.json()["detail"]
    # distance-sorted search puts unmapped places last instead of crashing
    r = client.get("/api/v1/locations", params={"q": "test ghat", "near": "17.0,81.78"})
    assert r.status_code == 200 and r.json()[-1]["code"] == "T-GHAT-UNMAPPED" and r.json()[-1]["distance_m"] is None


def test_search_matches_all_languages_and_town(client):
    assert any(l["code"] == "GHAT-PUSHKAR" for l in client.get("/api/v1/locations", params={"q": "pushkar"}).json())
    assert any(l["code"] == "GHAT-PUSHKAR" for l in client.get("/api/v1/locations", params={"q": "పుష్కర"}).json())
    assert any(l["code"] == "GHAT-PUSHKAR" for l in client.get("/api/v1/locations", params={"q": "पुष्कर"}).json())


def test_sites_report_ghat_counts(client, admin):
    _site_without_graph(client, admin)
    from app.services import cache
    cache.invalidate("locations:")
    sites = {s["code"]: s for s in client.get("/api/v1/sites").json()}
    t = sites["TEST-TOWN"]
    assert t["ghats_total"] == 2 and t["ghats_mapped"] == 1 and t["state"] == "Andhra Pradesh"


def test_nearby_groups_facilities_and_reports_empty_groups(client):
    locs = {l["code"]: l for l in client.get("/api/v1/locations").json()}
    r = client.get(f"/api/v1/locations/{locs['GHAT-PUSHKAR']['id']}/nearby", params={"radius_m": 800})
    body = r.json()
    assert r.status_code == 200 and body["has_coords"] is True
    assert body["groups"]["help_desk"] and body["groups"]["help_desk"][0]["code"] == "HELP-2"
    assert "dressing_room" in body["groups"] and "railway_station" in body["groups"]  # empty groups still present
    dists = [l["distance_m"] for l in body["groups"]["restroom"]]
    assert dists == sorted(dists) and all(d <= 800 for d in dists)


def test_verification_workflow_requires_coordinates_and_is_audited(client, admin, staff, pilgrim):
    _, mapped, unmapped = _site_without_graph(client, admin)
    h, _ = pilgrim
    assert client.post(f"/api/v1/locations/{unmapped['id']}/verification", json={"verification": "official", "note": "x" * 5}, headers=h).status_code == 403
    r = client.post(f"/api/v1/locations/{unmapped['id']}/verification", json={"verification": "official", "note": "Confirmed on site"}, headers=staff)
    assert r.status_code == 422 and "coordinates" in r.json()["detail"]
    r = client.post(f"/api/v1/locations/{unmapped['id']}/verification", json={"verification": "official", "note": "Surveyed by district engineer", "lat": 17.0, "lng": 81.77, "source": "District survey"}, headers=staff)
    assert r.status_code == 200 and r.json()["verification"] == "official" and r.json()["lat"] == 17.0 and r.json()["verified_at"]
    # moving an official location sends it back for re-confirmation
    r = client.patch(f"/api/v1/locations/{unmapped['id']}", json={"lat": 17.001, "lng": 81.771}, headers=staff)
    assert r.json()["verification"] == "unverified"
    r = client.post(f"/api/v1/locations/{mapped['id']}/verification", json={"verification": "unavailable", "note": "Ghat closed for repairs"}, headers=staff)
    assert r.json()["verification"] == "unavailable" and r.json()["is_open"] is False
    audit = client.get("/api/v1/admin/audit", params={"action": "location.verify"}, headers=admin).json()
    assert {a["action"] for a in audit} >= {"location.verify.official", "location.verify.unavailable"}


def test_osrm_route_used_when_no_walkway_graph(client, admin, monkeypatch):
    _, mapped, _ = _site_without_graph(client, admin)
    # re-open in case another test marked it unavailable
    client.post(f"/api/v1/locations/{mapped['id']}/verification", json={"verification": "source", "note": "reopen for test", "lat": 17.0084, "lng": 81.7669}, headers=admin)
    client.patch(f"/api/v1/locations/{mapped['id']}", json={"is_open": True}, headers=admin)
    calls = {}

    def fake(fl, fg, tl, tg):
        calls["args"] = (fl, fg, tl, tg)
        return {"polyline": [[fl, fg], [tl, tg]], "distance_m": 1025, "steps": [{"instruction": "Head north", "distance_m": 1025, "maneuver": "depart", "modifier": "north", "name": None, "zone_level": None}]}

    monkeypatch.setattr(osrm, "foot_route", fake)
    r = client.get("/api/v1/routes", params={"from": "17.0,81.78", "to": mapped["id"]})
    body = r.json()
    assert r.status_code == 200 and body["provider"] == "osrm" and body["distance_m"] == 1025 and "OpenStreetMap" in body["attribution"]
    assert any("Crowd avoidance is not available" in n for n in body["notes"])
    assert calls["args"][2:] == (17.0084, 81.7669)

    def down(*a):
        raise osrm.RoutingUnavailable("down")

    monkeypatch.setattr(osrm, "foot_route", down)
    r = client.get("/api/v1/routes", params={"from": "17.0,81.78", "to": mapped["id"]})
    assert r.status_code == 503
