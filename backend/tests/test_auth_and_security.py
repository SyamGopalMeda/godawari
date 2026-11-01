def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["db"] is True


def test_otp_flow_and_me(client, pilgrim):
    headers, user = pilgrim
    r = client.get("/api/v1/auth/me", headers=headers)
    assert r.status_code == 200
    assert r.json()["phone"] == "+919000000001"
    assert r.json()["role"] == "pilgrim"


def test_phone_normalisation(client):
    r = client.post("/api/v1/auth/otp/request", json={"phone": "98765 43210"})
    assert r.status_code == 200
    r = client.post("/api/v1/auth/otp/request", json={"phone": "12"})
    assert r.status_code == 422


def test_wrong_otp_rejected(client):
    client.post("/api/v1/auth/otp/request", json={"phone": "+919000000099"})
    r = client.post("/api/v1/auth/otp/verify", json={"phone": "+919000000099", "code": "000000"})
    assert r.status_code == 400


def test_otp_rate_limit(client):
    phone = "+919000000077"
    codes = [client.post("/api/v1/auth/otp/request", json={"phone": phone}).status_code for _ in range(6)]
    assert codes[:5] == [200] * 5
    assert codes[5] == 429


def test_bad_password_login(client):
    r = client.post("/api/v1/auth/login", json={"username": "admin", "password": "nope"})
    assert r.status_code == 401


def test_role_enforcement(client, pilgrim, staff):
    headers, _ = pilgrim
    assert client.get("/api/v1/admin/devices", headers=headers).status_code == 403
    assert client.get("/api/v1/admin/devices", headers=staff).status_code == 403
    assert client.get("/api/v1/admin/overview", headers=headers).status_code == 403
    assert client.get("/api/v1/admin/overview", headers=staff).status_code == 200
    assert client.get("/api/v1/admin/devices").status_code == 401


def test_invalid_device_key(client):
    r = client.post("/api/v1/rfid/sightings", json=[{"tag_uid": "GP27-00001"}], headers={"X-Device-Key": "bogus"})
    assert r.status_code == 401
    r = client.post("/api/v1/rfid/sightings", json=[{"tag_uid": "GP27-00001"}])
    assert r.status_code == 401


def test_security_headers(client):
    r = client.get("/health")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"


def test_default_admin_password_is_replaced_when_a_real_one_is_configured(client, monkeypatch):
    from app import main
    from app.config import settings
    from app.db import SessionLocal
    from app.models import User
    from app.security import hash_password, verify_password
    from sqlalchemy import select

    db = SessionLocal()
    try:
        u = User(username="bootadmin", password_hash=hash_password(main.DEFAULT_ADMIN_PASSWORD), name="Boot", role="admin")
        db.add(u)
        db.commit()
    finally:
        db.close()
    monkeypatch.setattr(settings, "bootstrap_admin_username", "bootadmin")
    monkeypatch.setattr(settings, "bootstrap_admin_password", "A-real-Secret-123")
    main._secure_bootstrap_admin()
    db = SessionLocal()
    try:
        h = db.scalar(select(User.password_hash).where(User.username == "bootadmin"))
    finally:
        db.close()
    assert verify_password("A-real-Secret-123", h) and not verify_password(main.DEFAULT_ADMIN_PASSWORD, h)



def _otp(client, phone):
    r = client.post("/api/v1/auth/otp/request", json={"phone": phone})
    assert r.status_code == 200, r.text
    return r.json()["dev_otp"]


def test_register_login_with_password_and_forgot_password(client):
    phone = "9811100001"
    # weak password rejected
    r = client.post("/api/v1/auth/register", json={"phone": phone, "code": "000000", "password": "short"})
    assert r.status_code == 422
    # wrong OTP rejected
    _otp(client, phone)
    assert client.post("/api/v1/auth/register", json={"phone": phone, "code": "000000", "password": "Godavari2027"}).status_code == 400
    code = _otp(client, phone)
    r = client.post("/api/v1/auth/register", json={"phone": phone, "code": code, "password": "Godavari2027", "name": "Sita"})
    assert r.status_code == 201, r.text
    assert r.json()["user"]["role"] == "pilgrim" and r.json()["user"]["name"] == "Sita"
    # sign in with the phone number in any common format
    for ident in (phone, "+91" + phone, "98111 00001"):
        assert client.post("/api/v1/auth/login", json={"username": ident, "password": "Godavari2027"}).status_code == 200
    assert client.post("/api/v1/auth/login", json={"username": phone, "password": "wrong-pass1"}).status_code == 401
    # registering again is refused
    code = _otp(client, phone)
    assert client.post("/api/v1/auth/register", json={"phone": phone, "code": code, "password": "Another2027"}).status_code == 409
    # forgot password: OTP + new password, old password stops working
    code = _otp(client, phone)
    r = client.post("/api/v1/auth/password/reset", json={"phone": phone, "code": code, "new_password": "NewPass2027"})
    assert r.status_code == 200 and r.json()["access_token"]
    assert client.post("/api/v1/auth/login", json={"username": phone, "password": "Godavari2027"}).status_code == 401
    assert client.post("/api/v1/auth/login", json={"username": phone, "password": "NewPass2027"}).status_code == 200
    # an OTP cannot be reused
    assert client.post("/api/v1/auth/password/reset", json={"phone": phone, "code": code, "new_password": "Again12345"}).status_code == 400


def test_reset_for_unknown_number_and_otp_only_account(client):
    code = _otp(client, "9811100002")
    assert client.post("/api/v1/auth/password/reset", json={"phone": "9811100002", "code": code, "new_password": "Godavari2027"}).status_code == 404
    # an account created by OTP sign-in has no password: login explains how to set one
    code = _otp(client, "9811100003")
    assert client.post("/api/v1/auth/otp/verify", json={"phone": "9811100003", "code": code}).status_code == 200
    r = client.post("/api/v1/auth/login", json={"username": "9811100003", "password": "anything1"})
    assert r.status_code == 401 and "Forgot password" in r.json()["detail"]


def test_password_login_locks_after_repeated_failures(client):
    for _ in range(10):
        assert client.post("/api/v1/auth/login", json={"username": "nosuchuser", "password": "x"}).status_code == 401
    assert client.post("/api/v1/auth/login", json={"username": "nosuchuser", "password": "x"}).status_code == 429
