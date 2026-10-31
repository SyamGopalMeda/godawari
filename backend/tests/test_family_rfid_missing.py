import io


def _family(client, headers):
    fams = client.get("/api/v1/families/mine", headers=headers).json()
    if fams:
        return fams[0]
    r = client.post("/api/v1/families", json={"name": "Ravi family"}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def test_family_create_join_and_members(client, pilgrim, pilgrim2):
    h1, u1 = pilgrim
    h2, u2 = pilgrim2
    fam = _family(client, h1)
    assert fam["primary_user_id"] == u1["id"]
    assert len(fam["join_code"]) == 6
    r = client.post("/api/v1/families/join", json={"join_code": fam["join_code"].lower()}, headers=h2)
    assert r.status_code == 200
    assert any(m["user_id"] == u2["id"] for m in r.json()["members"])
    r = client.post(f"/api/v1/families/{fam['id']}/members", json={"display_name": "Chinnu", "age_group": "child", "relation": "son", "is_vulnerable": True}, headers=h1)
    assert r.status_code == 201
    # non-primary cannot add members
    r = client.post(f"/api/v1/families/{fam['id']}/members", json={"display_name": "X"}, headers=h2)
    assert r.status_code == 403


def test_tag_link_requires_consent_and_issued_tag(client, pilgrim):
    h1, _ = pilgrim
    fam = _family(client, h1)
    child = next(m for m in fam["members"] if m["display_name"] == "Chinnu")
    r = client.post(f"/api/v1/families/{fam['id']}/members/{child['id']}/tag", json={"tag_uid": "GP27-00010", "consent": False}, headers=h1)
    assert r.status_code == 400
    r = client.post(f"/api/v1/families/{fam['id']}/members/{child['id']}/tag", json={"tag_uid": "NOPE-1", "consent": True}, headers=h1)
    assert r.status_code == 404
    r = client.post(f"/api/v1/families/{fam['id']}/members/{child['id']}/tag", json={"tag_uid": "gp27-00010", "consent": True}, headers=h1)
    assert r.status_code == 200, r.text
    assert r.json()["rfid_tag_uid"] == "GP27-00010"
    assert r.json()["consent_given_at"]
    # same tag cannot be linked to a second person
    r = client.post(f"/api/v1/families/{fam['id']}/members/{fam['members'][0]['id']}/tag", json={"tag_uid": "GP27-00010", "consent": True}, headers=h1)
    assert r.status_code == 409


def test_rfid_sightings_dedupe_and_last_seen(client, pilgrim, pilgrim2, device_keys, locations):
    h1, _ = pilgrim
    h2, _ = pilgrim2
    fam = _family(client, h1)
    child = next(m for m in fam["members"] if m["display_name"] == "Chinnu")
    key = device_keys["rfid-gate-a"]
    r = client.post("/api/v1/rfid/sightings", json=[{"tag_uid": "GP27-00010", "rssi": -55, "direction": "in"}, {"tag_uid": "GP27-00010"}, {"tag_uid": "UNKNOWN-TAG"}], headers={"X-Device-Key": key})
    assert r.status_code == 202
    assert r.json() == {"stored": 1, "ignored": 2}  # duplicate within 30 s + unknown tag ignored
    r = client.post("/api/v1/rfid/sightings", json=[{"tag_uid": "GP27-00010", "direction": "in"}], headers={"X-Device-Key": device_keys["rfid-cp-2"]})
    assert r.json()["stored"] == 1
    r = client.get(f"/api/v1/families/{fam['id']}/members/{child['id']}/last-seen", headers=h2)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["consented"] is True
    assert body["last_checkpoint"]["location_code"] == "CP-2"
    assert len(body["recent"]) == 2
    assert body["nearest_help_desks"]
    # the family overview also carries last_seen
    fam = client.get(f"/api/v1/families/{fam['id']}", headers=h1).json()
    assert next(m for m in fam["members"] if m["id"] == child["id"])["last_seen"]["location_code"] == "CP-2"


def test_stranger_and_staff_access_rules(client, pilgrim, staff):
    h1, _ = pilgrim
    fam = _family(client, h1)
    child = next(m for m in fam["members"] if m["display_name"] == "Chinnu")
    # a third pilgrim cannot see this family
    r = client.post("/api/v1/auth/otp/request", json={"phone": "+919000000003"})
    tok = client.post("/api/v1/auth/otp/verify", json={"phone": "+919000000003", "code": r.json()["dev_otp"]}).json()
    h3 = {"Authorization": f"Bearer {tok['access_token']}"}
    assert client.get(f"/api/v1/families/{fam['id']}", headers=h3).status_code == 403
    assert client.get(f"/api/v1/families/{fam['id']}/members/{child['id']}/last-seen", headers=h3).status_code == 403
    # staff cannot look up without an open report
    r = client.get(f"/api/v1/families/{fam['id']}/members/{child['id']}/last-seen", headers=staff)
    assert r.status_code == 403


def test_missing_person_full_workflow(client, pilgrim, staff, volunteer, admin, locations):
    h1, u1 = pilgrim
    fam = _family(client, h1)
    child = next(m for m in fam["members"] if m["display_name"] == "Chinnu")
    photo = ("chinnu.png", io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"0" * 100), "image/png")
    r = client.post(
        "/api/v1/missing-reports",
        data={"subject_name": "Chinnu", "contact_phone": "9000000001", "age": "6", "gender": "male", "clothing": "red shirt", "member_id": str(child["id"]), "last_seen_location_id": str(locations["GHAT-PUSHKAR"]["id"]), "photo_consent": "true"},
        files={"photo": photo},
        headers=h1,
    )
    assert r.status_code == 201, r.text
    rep = r.json()
    assert rep["status"] == "open" and rep["has_photo"] is True and rep["site_id"] == locations["GHAT-PUSHKAR"]["site_id"]
    rid = rep["id"]
    # photo without consent is rejected
    r = client.post("/api/v1/missing-reports", data={"subject_name": "X", "contact_phone": "9000000001"}, files={"photo": ("a.png", io.BytesIO(b"x" * 10), "image/png")}, headers=h1)
    assert r.status_code == 400
    # reporter sees it, other pilgrim does not
    assert client.get(f"/api/v1/missing-reports/{rid}", headers=h1).status_code == 200
    r = client.post("/api/v1/auth/otp/request", json={"phone": "+919000000004"})
    tok = client.post("/api/v1/auth/otp/verify", json={"phone": "+919000000004", "code": r.json()["dev_otp"]}).json()
    h4 = {"Authorization": f"Bearer {tok['access_token']}"}
    assert client.get(f"/api/v1/missing-reports/{rid}", headers=h4).status_code == 404
    # staff can now look up the child's last seen (open report)
    r = client.get(f"/api/v1/families/{fam['id']}/members/{child['id']}/last-seen", headers=staff)
    assert r.status_code == 200
    # workflow transitions
    assert client.patch(f"/api/v1/missing-reports/{rid}", json={"status": "found"}, headers=staff).status_code == 409
    assert client.patch(f"/api/v1/missing-reports/{rid}", json={"status": "verified", "note": "Caller verified"}, headers=staff).status_code == 200
    assert client.patch(f"/api/v1/missing-reports/{rid}", json={"status": "searching"}, headers=volunteer).status_code == 200
    r = client.patch(f"/api/v1/missing-reports/{rid}", json={"status": "found", "note": "At help desk 2"}, headers=volunteer)
    assert r.status_code == 200
    assert r.json()["help_desk_location_id"] == locations["HELP-2"]["id"]  # volunteer's desk auto-filled
    board = client.get("/api/v1/missing-reports/board").json()
    entry = next(b for b in board if b["id"] == rid)
    assert entry["age_group"] == "child" and "subject_name" not in entry and entry["held_at"]["code"] == "HELP-2"
    # reporter can only close
    assert client.patch(f"/api/v1/missing-reports/{rid}", json={"status": "searching"}, headers=h1).status_code == 403
    r = client.patch(f"/api/v1/missing-reports/{rid}", json={"status": "closed", "note": "Reunited"}, headers=h1)
    assert r.status_code == 200 and r.json()["resolved_at"]
    events = client.get(f"/api/v1/missing-reports/{rid}/events", headers=h1).json()
    assert [e["event_type"] for e in events] == ["created", "status:verified", "status:searching", "status:found", "status:closed"]
    # audit trail recorded the staff lookup
    audit = client.get("/api/v1/admin/audit", params={"action": "family.last_seen_lookup"}, headers=admin).json()
    assert any(a["entity_id"] == str(child["id"]) and a["purpose"].startswith("missing report") for a in audit)
    # photo endpoint
    assert client.get(f"/api/v1/missing-reports/{rid}/photo", headers=staff).status_code == 200
    assert client.get(f"/api/v1/missing-reports/{rid}/photo", headers=h4).status_code == 404


def test_report_rate_limit(client):
    r = client.post("/api/v1/auth/otp/request", json={"phone": "+919000000005"})
    tok = client.post("/api/v1/auth/otp/verify", json={"phone": "+919000000005", "code": r.json()["dev_otp"]}).json()
    h = {"Authorization": f"Bearer {tok['access_token']}"}
    codes = [client.post("/api/v1/missing-reports", data={"subject_name": f"P{i}", "contact_phone": "9000000005"}, headers=h).status_code for i in range(4)]
    assert codes == [201, 201, 201, 429]


def test_manual_qr_scan_and_tag_lookup(client, volunteer, locations):
    r = client.post("/api/v1/rfid/manual-scan", json={"tag_uid": "GP27-00010", "location_id": locations["HELP-2"]["id"], "method": "qr"}, headers=volunteer)
    assert r.status_code == 201 and r.json()["method"] == "qr"
    r = client.get("/api/v1/rfid/tags/GP27-00010", headers=volunteer)
    assert r.status_code == 200
    assert r.json()["linked"] is True and r.json()["member"]["display_name"] == "Chinnu"
    assert r.json()["family_contact"] == "+919000000001"


def test_unlink_tag(client, pilgrim):
    h1, _ = pilgrim
    fam = _family(client, h1)
    child = next(m for m in fam["members"] if m["display_name"] == "Chinnu")
    r = client.delete(f"/api/v1/families/{fam['id']}/members/{child['id']}/tag", headers=h1)
    assert r.status_code == 200 and r.json()["rfid_tag_uid"] is None


def test_gps_sharing_self_only(client, pilgrim, pilgrim2):
    h1, u1 = pilgrim
    h2, u2 = pilgrim2
    fam = _family(client, h1)
    me2 = next(m for m in fam["members"] if m["user_id"] == u2["id"])
    # primary cannot toggle another member's gps sharing
    assert client.patch(f"/api/v1/families/{fam['id']}/members/{me2['id']}", json={"gps_sharing": True}, headers=h1).status_code == 403
    assert client.patch(f"/api/v1/families/{fam['id']}/members/{me2['id']}", json={"gps_sharing": True}, headers=h2).status_code == 200
    assert client.post(f"/api/v1/families/{fam['id']}/members/{me2['id']}/gps", json={"lat": 17.0, "lng": 81.77}, headers=h2).status_code == 204
    assert client.post(f"/api/v1/families/{fam['id']}/members/{me2['id']}/gps", json={"lat": 17.0, "lng": 81.77}, headers=h1).status_code == 403
    fam = client.get(f"/api/v1/families/{fam['id']}", headers=h1).json()
    assert next(m for m in fam["members"] if m["id"] == me2["id"])["gps"]["lat"] == 17.0
