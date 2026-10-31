import os
import tempfile

import pytest

_tmp = tempfile.mkdtemp(prefix="pushkar_test_")
os.environ["PUSHKAR_DATABASE_URL"] = f"sqlite:///{os.path.join(_tmp, 'test.db').replace(os.sep, '/')}"
os.environ["PUSHKAR_UPLOAD_DIR"] = os.path.join(_tmp, "uploads")
os.environ["PUSHKAR_DEV_MODE"] = "true"
os.environ["PUSHKAR_SEED_ON_START"] = "true"
os.environ["PUSHKAR_SEED_MODE"] = "demo"  # synthetic fixture data; production uses the verified dataset

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.seed import DEMO_DEVICE_KEYS  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


def _login_pilgrim(client: TestClient, phone: str, name: str = "Test Pilgrim") -> dict:
    r = client.post("/api/v1/auth/otp/request", json={"phone": phone})
    assert r.status_code == 200, r.text
    otp = r.json()["dev_otp"]
    r = client.post("/api/v1/auth/otp/verify", json={"phone": phone, "code": otp, "name": name})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="session")
def pilgrim(client):
    tok = _login_pilgrim(client, "+919000000001", "Ravi")
    return {"Authorization": f"Bearer {tok['access_token']}"}, tok["user"]


@pytest.fixture(scope="session")
def pilgrim2(client):
    tok = _login_pilgrim(client, "+919000000002", "Lakshmi")
    return {"Authorization": f"Bearer {tok['access_token']}"}, tok["user"]


@pytest.fixture(scope="session")
def admin(client):
    r = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin12345"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="session")
def staff(client):
    r = client.post("/api/v1/auth/login", json={"username": "staff1", "password": "staff12345"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="session")
def volunteer(client):
    r = client.post("/api/v1/auth/login", json={"username": "helpdesk2", "password": "helpdesk12345"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="session")
def device_keys():
    return DEMO_DEVICE_KEYS


@pytest.fixture(scope="session")
def locations(client):
    r = client.get("/api/v1/locations")
    assert r.status_code == 200
    return {l["code"]: l for l in r.json()}
