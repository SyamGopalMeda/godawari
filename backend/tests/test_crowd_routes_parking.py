from app.services.crowd import level_for


def test_level_thresholds():
    assert level_for(0, 100) == "low"
    assert level_for(39, 100) == "low"
    assert level_for(40, 100) == "moderate"
    assert level_for(70, 100) == "high"
    assert level_for(90, 100) == "critical"
    assert level_for(10, None) == "unknown"


def test_crowd_status_seeded(client):
    r = client.get("/api/v1/crowd/status")
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) >= 9
    by = {x["code"]: x for x in rows}
    # values untouched by other tests: Gowthami 2100/8000 (low), Gate B 3300/4000 (high)
    assert by["GATE-B"]["density_level"] == "high"
    assert by["GHAT-GOWTHAMI"]["density_level"] == "low"
    assert by["GHAT-PUSHKAR"]["is_stale"] is False


def test_camera_reading_updates_status(client, device_keys, locations):
    r = client.post("/api/v1/crowd/readings", json={"count": 1000, "source": "camera"}, headers={"X-Device-Key": device_keys["cam-pushkar"]})
    assert r.status_code == 202, r.text
    st = r.json()["status"][0]
    assert st["code"] == "GHAT-PUSHKAR"
    assert st["density_level"] == "low"
    assert st["source"] == "camera"
    hist = client.get(f"/api/v1/crowd/{locations['GHAT-PUSHKAR']['id']}/history").json()
    assert hist[-1]["count"] == 1000


def test_batch_readings_by_code(client, staff):
    body = [{"location_code": "GATE-A", "count": 2900}, {"location_code": "GATE-C", "count": 100}]
    r = client.post("/api/v1/crowd/readings", json=body, headers=staff)
    assert r.status_code == 202
    levels = {s["code"]: s["density_level"] for s in r.json()["status"]}
    assert levels == {"GATE-A": "critical", "GATE-C": "low"}


def test_pilgrim_cannot_post_readings(client, pilgrim):
    headers, _ = pilgrim
    r = client.post("/api/v1/crowd/readings", json={"location_code": "GATE-A", "count": 1}, headers=headers)
    assert r.status_code == 401


def test_override_wins(client, staff, locations):
    lid = locations["GHAT-GOWTHAMI"]["id"]
    r = client.post(f"/api/v1/crowd/{lid}/override", json={"level": "critical", "minutes": 10, "reason": "VIP movement"}, headers=staff)
    assert r.status_code == 200
    assert r.json()["density_level"] == "critical" and r.json()["override"] is True
    r = client.post(f"/api/v1/crowd/{lid}/override", json={"level": None, "minutes": 1, "reason": "clear"}, headers=staff)
    assert r.json()["override"] is False


def test_recommendations_rank_low_first(client):
    r = client.get("/api/v1/crowd/recommendations", params={"for": "ghat", "near": "17.0018,81.7762"})
    assert r.status_code == 200
    recs = r.json()
    assert recs, "no recommendations"
    assert recs[0]["location"]["density_level"] in ("low", "moderate")
    assert recs[0]["score"] <= recs[-1]["score"]


def test_route_avoids_critical_zone(client, locations, staff):
    # Pushkar ghat was set to low above by camera; set Kotilingala to critical and route north->Pushkar
    kot = locations["GHAT-KOTILINGALA"]["id"]
    client.post(f"/api/v1/crowd/{kot}/override", json={"level": "critical", "minutes": 10, "reason": "test"}, headers=staff)
    dest = locations["GHAT-PUSHKAR"]["id"]
    r = client.get("/api/v1/routes", params={"from": "17.0110,81.7860", "to": dest})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["distance_m"] > 0 and body["eta_min"] > 0
    assert len(body["polyline"]) >= 3
    assert body["steps"][-1]["instruction"].startswith("Arrive")
    # path goes along the promenade; the Kotilingala spur is a dead end so it is never used anyway,
    # but the critical status must not break routing
    client.post(f"/api/v1/crowd/{kot}/override", json={"level": None, "minutes": 1, "reason": "clear"}, headers=staff)


def test_route_accessible_mode(client, locations):
    dest = locations["GHAT-PADMAVATHI"]["id"]
    r = client.get("/api/v1/routes", params={"from": "16.9900,81.7850", "to": dest, "accessible": "true"})
    assert r.status_code == 200
    assert r.json()["accessible"] is True
    # Gowthami ghat spur is not accessible: accessible route must fail
    dest2 = locations["GHAT-GOWTHAMI"]["id"]
    r = client.get("/api/v1/routes", params={"from": "16.9900,81.7850", "to": dest2, "accessible": "true"})
    assert r.status_code == 404


def test_route_bad_input(client, locations):
    r = client.get("/api/v1/routes", params={"from": "abc", "to": locations["GHAT-PUSHKAR"]["id"]})
    assert r.status_code == 422


def test_facilities_near_filter(client):
    r = client.get("/api/v1/locations", params={"types": "restroom,water", "near": "17.0018,81.7762", "radius_m": 300})
    assert r.status_code == 200
    rows = r.json()
    assert rows and all(x["distance_m"] <= 300 for x in rows)
    assert rows == sorted(rows, key=lambda x: x["distance_m"])


def test_parking_list_and_recommend(client, locations):
    r = client.get("/api/v1/parking")
    assert r.status_code == 200
    lots = r.json()
    assert len(lots) == 4
    p2 = next(l for l in lots if l["location"]["code"] == "PARK-P2")
    assert p2["status"] == "filling"
    r = client.get("/api/v1/parking/recommend", params={"ghat": locations["GHAT-PUSHKAR"]["id"], "vehicle": "car"})
    recs = r.json()
    assert recs and all("car" in l["vehicle_types"] for l in recs)


def test_parking_sensor_and_full(client, device_keys):
    lots = client.get("/api/v1/parking").json()
    p1 = next(l for l in lots if l["location"]["code"] == "PARK-P1")
    r = client.post(f"/api/v1/parking/{p1['id']}/occupancy", json={"delta": 10}, headers={"X-Device-Key": device_keys["parking-p1"]})
    assert r.status_code == 200 and r.json()["occupied_slots"] == p1["occupied_slots"] + 10
    r = client.post(f"/api/v1/parking/{p1['id']}/occupancy", json={"occupied": 1500}, headers={"X-Device-Key": device_keys["parking-p1"]})
    assert r.json()["status"] == "full"
    r = client.post(f"/api/v1/parking/{p1['id']}/occupancy", json={"occupied": 100}, headers={"X-Device-Key": device_keys["parking-p1"]})
    assert r.json()["status"] == "open"


def test_parking_pass_and_spot(client, pilgrim, volunteer):
    headers, _ = pilgrim
    lots = client.get("/api/v1/parking").json()
    p4 = next(l for l in lots if l["location"]["code"] == "PARK-P4")
    r = client.post("/api/v1/parking/passes", json={"lot_id": p4["id"], "vehicle_number": "AP05 AB 1234", "vehicle_type": "bike"}, headers=headers)
    assert r.status_code == 201
    token = r.json()["qr_token"]
    assert r.json()["vehicle_number"] == "AP05AB1234"
    before = p4["occupied_slots"]
    r = client.post(f"/api/v1/parking/passes/{token}/scan", headers=volunteer)
    assert r.status_code == 200 and r.json()["status"] == "used"
    r = client.post(f"/api/v1/parking/passes/{token}/scan", headers=volunteer)
    assert r.status_code == 409
    after = client.get(f"/api/v1/parking/{p4['id']}").json()["occupied_slots"]
    assert after == before + 1
    r = client.put("/api/v1/parking/my-spot", json={"lot_id": p4["id"], "row_label": "Row C, pole 12"}, headers=headers)
    assert r.status_code == 200
    assert client.get("/api/v1/parking/my-spot", headers=headers).json()["row_label"] == "Row C, pole 12"


def test_timestamps_carry_utc_offset(client):
    """Regression: SQLite returned naive datetimes, serialised without an offset; browsers read them as
    local time (IST) and showed fresh readings as hours old."""
    import re
    rows = client.get("/api/v1/crowd/status").json()
    stamps = [r["updated_at"] for r in rows if r["updated_at"]]
    assert stamps and all(re.search(r"(Z|[+-]\d\d:\d\d)$", s) for s in stamps), stamps[:3]
    lots = client.get("/api/v1/parking").json()
    assert all(re.search(r"(Z|[+-]\d\d:\d\d)$", l["updated_at"]) for l in lots if l["updated_at"])
