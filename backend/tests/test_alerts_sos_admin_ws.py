import json


def test_alerts_lifecycle(client, admin, pilgrim):
    r = client.get("/api/v1/alerts/active")
    assert r.status_code == 200 and len(r.json()) >= 1
    h, _ = pilgrim
    assert client.post("/api/v1/alerts", json={"title": "x", "body": "y"}, headers=h).status_code == 403
    r = client.post("/api/v1/alerts", json={"title": "Gate B closed", "body": "Use Gate A or C", "severity": "warning", "expires_in_minutes": 30}, headers=admin)
    assert r.status_code == 201
    aid = r.json()["id"]
    assert any(a["id"] == aid for a in client.get("/api/v1/alerts/active").json())
    assert client.delete(f"/api/v1/alerts/{aid}", headers=admin).status_code == 204
    assert not any(a["id"] == aid for a in client.get("/api/v1/alerts/active").json())


def test_sos_anonymous_requires_phone(client):
    assert client.post("/api/v1/sos", json={"type": "medical"}).status_code == 400
    r = client.post("/api/v1/sos", json={"type": "medical", "phone": "9000000011", "lat": 17.0018, "lng": 81.7762})
    assert r.status_code == 201
    body = r.json()
    assert body["call"]["ambulance"] == "108"
    assert body["nearest"] and body["nearest"][0]["type"] == "medical"


def test_sos_queue_and_update(client, pilgrim, volunteer):
    h, u = pilgrim
    r = client.post("/api/v1/sos", json={"type": "lost_child", "lat": 17.0, "lng": 81.778}, headers=h)
    sid = r.json()["request"]["id"]
    queue = client.get("/api/v1/sos", headers=volunteer).json()
    assert any(s["id"] == sid for s in queue)
    r = client.patch(f"/api/v1/sos/{sid}", json={"status": "acknowledged"}, headers=volunteer)
    assert r.status_code == 200 and r.json()["assigned_to"]
    assert client.get("/api/v1/sos", headers=h).status_code == 403


def test_emergency_contacts(client):
    r = client.get("/api/v1/emergency/contacts", params={"near": "17.0018,81.7762"})
    assert r.status_code == 200
    assert r.json()["national"]["emergency"] == "112"
    assert r.json()["nearest_posts"]


def test_admin_overview_devices_and_users(client, admin):
    ov = client.get("/api/v1/admin/overview", headers=admin).json()
    assert set(ov["crowd"]["by_level"]) == {"low", "moderate", "high", "critical", "unknown"}
    assert ov["devices"]["total"] >= 9
    r = client.post("/api/v1/admin/devices", json={"name": "test-reader", "type": "rfid_reader"}, headers=admin)
    assert r.status_code == 201
    key = r.json()["api_key"]
    assert key.startswith("pk_")
    did = r.json()["id"]
    # the key works for ingest, then is revoked
    r = client.post("/api/v1/rfid/sightings", json=[{"tag_uid": "GP27-00001", "location_id": 1}], headers={"X-Device-Key": key})
    assert r.status_code == 202
    assert client.delete(f"/api/v1/admin/devices/{did}", headers=admin).status_code == 204
    r = client.post("/api/v1/rfid/sightings", json=[{"tag_uid": "GP27-00001", "location_id": 1}], headers={"X-Device-Key": key})
    assert r.status_code == 401
    r = client.post("/api/v1/admin/users", json={"username": "vol9", "password": "password123", "name": "Vol", "role": "volunteer"}, headers=admin)
    assert r.status_code == 201
    assert client.post("/api/v1/auth/login", json={"username": "vol9", "password": "password123"}).status_code == 200
    rec = client.get("/api/v1/admin/sightings/recent", headers=admin).json()
    assert rec and "…" in rec[0]["tag"]


def test_websocket_receives_crowd_updates(client, device_keys):
    with client.websocket_connect("/ws/live") as ws:
        hello = json.loads(ws.receive_text())
        assert hello["type"] == "hello" and hello["data"]["authenticated"] is False
        r = client.post("/api/v1/crowd/readings", json={"count": 5000, "source": "camera"}, headers={"X-Device-Key": device_keys["cam-kotilingala"]})
        assert r.status_code == 202
        msg = json.loads(ws.receive_text())
        assert msg["type"] == "crowd.updated"
        assert msg["data"]["code"] == "GHAT-KOTILINGALA" and msg["data"]["density_level"] == "moderate"


def test_websocket_family_scoped_sighting(client, pilgrim, pilgrim2, device_keys):
    h1, _ = pilgrim
    fams = client.get("/api/v1/families/mine", headers=h1).json()
    fam = fams[0] if fams else client.post("/api/v1/families", json={"name": "WS family"}, headers=h1).json()
    child = next((m for m in fam["members"] if m["display_name"] == "Chinnu"), None)
    if child is None:
        child = client.post(f"/api/v1/families/{fam['id']}/members", json={"display_name": "Chinnu", "age_group": "child"}, headers=h1).json()
    client.post(f"/api/v1/families/{fam['id']}/members/{child['id']}/tag", json={"tag_uid": "GP27-00011", "consent": True}, headers=h1)
    tok = h1["Authorization"].split(" ")[1]
    with client.websocket_connect(f"/ws/live?token={tok}") as ws_fam, client.websocket_connect("/ws/live") as ws_anon:
        assert json.loads(ws_fam.receive_text())["data"]["authenticated"] is True
        ws_anon.receive_text()
        client.post("/api/v1/rfid/sightings", json=[{"tag_uid": "GP27-00011"}], headers={"X-Device-Key": device_keys["rfid-gate-c"]})
        msg = json.loads(ws_fam.receive_text())
        assert msg["type"] == "sighting" and msg["data"]["member_id"] == child["id"] and msg["data"]["location_code"] == "GATE-C"
        # anonymous socket must NOT get the sighting; trigger a public event and check it's the next thing it sees
        client.post("/api/v1/crowd/readings", json={"count": 10, "source": "camera"}, headers={"X-Device-Key": device_keys["cam-pushkar"]})
        nxt = json.loads(ws_anon.receive_text())
        assert nxt["type"] == "crowd.updated"


def test_metrics(client):
    r = client.get("/metrics")
    assert r.status_code == 200 and "pushkar_http_requests_total" in r.text
