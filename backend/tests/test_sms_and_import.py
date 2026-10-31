import csv
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import httpx

from app.config import settings
from app.services import sms


def test_sms_console_provider():
    r = sms.send_sms("+919000000001", "Your OTP is 123456")
    assert r.delivered and r.provider == "console"


def test_sms_http_provider_success_and_failure(monkeypatch):
    monkeypatch.setattr(settings, "sms_provider", "http")
    monkeypatch.setattr(settings, "sms_http_url", "https://sms.example/send")
    monkeypatch.setattr(settings, "sms_api_key", "k")
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers.get("authorization")
        seen["json"] = request.read()
        return httpx.Response(200 if b"+919000000001" in request.read() else 500, json={"ok": True})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    assert sms.send_sms("+919000000001", "hi", client=client).delivered is True
    assert seen["auth"] == "Bearer k"
    assert sms.send_sms("+919000000002", "hi", client=client).delivered is False


def test_sms_msg91_payload(monkeypatch):
    monkeypatch.setattr(settings, "sms_provider", "msg91")
    monkeypatch.setattr(settings, "sms_api_key", "authkey")
    monkeypatch.setattr(settings, "sms_template_id", "tpl")

    def handler(request: httpx.Request) -> httpx.Response:
        body = request.read().decode().replace(" ", "")
        assert request.headers["authkey"] == "authkey" and '"mobiles":"919000000001"' in body and '"OTP":"4321"' in body
        return httpx.Response(200, json={"type": "success"})

    r = sms.send_sms("+919000000001", "x", template_vars={"OTP": "4321"}, client=httpx.Client(transport=httpx.MockTransport(handler)))
    assert r.delivered


def test_sms_network_error_is_soft(monkeypatch):
    monkeypatch.setattr(settings, "sms_provider", "twilio")

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    r = sms.send_sms("+919000000001", "x", client=httpx.Client(transport=httpx.MockTransport(handler)))
    assert r.delivered is False and "down" in r.detail


def test_otp_request_reports_provider(client):
    r = client.post("/api/v1/auth/otp/request", json={"phone": "+919000000055"})
    assert r.status_code == 200 and r.json()["delivery"] == "console" and r.json()["sent"] is True


def _run(args: list[str], env: dict) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, "scripts/import_site.py", *args], cwd=Path(__file__).resolve().parents[1], env=env, capture_output=True, text=True, timeout=120)


def test_import_cli_template_validate_import():
    tmp = Path(tempfile.mkdtemp(prefix="pushkar_import_"))
    env = {**os.environ, "PUSHKAR_DATABASE_URL": f"sqlite:///{(tmp / 'import.db').as_posix()}", "PUSHKAR_SEED_ON_START": "false", "PYTHONIOENCODING": "utf-8"}
    bundle = tmp / "site-data"
    assert _run(["template", str(bundle)], env).returncode == 0
    assert (bundle / "locations.csv").exists() and (bundle / "walkway_edges.csv").exists()
    # template has placeholder passwords: validate must fail
    v = _run(["validate", str(bundle)], env)
    assert "set a real password" in v.stdout
    # fix passwords, add a bad row, validate catches it
    rows = list(csv.DictReader((bundle / "staff.csv").open(encoding="utf-8")))
    for r in rows:
        r["password"] = "pilot-secret-99"
    with (bundle / "staff.csv").open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=rows[0].keys())
        w.writeheader(); w.writerows(rows)
    with (bundle / "locations.csv").open("a", encoding="utf-8", newline="") as fh:
        fh.write("BAD-1,spaceport,Bad,,,999,81.7,,false,true,false,\n")
    v = _run(["validate", str(bundle)], env)
    assert "unknown type 'spaceport'" in v.stdout and "invalid lat/lng" in v.stdout
    # remove the bad row and import twice (idempotent upsert)
    lines = (bundle / "locations.csv").read_text(encoding="utf-8").splitlines()
    (bundle / "locations.csv").write_text("\n".join(l for l in lines if not l.startswith("BAD-1")) + "\n", encoding="utf-8")
    first = _run(["import", str(bundle)], env)
    assert first.returncode == 0, first.stdout + first.stderr
    assert "47 locations, 4 lots, 28 nodes, 30 edges, 2 staff, 50 new tags" in first.stdout
    second = _run(["import", str(bundle)], env)
    assert second.returncode == 0 and "0 new tags" in second.stdout and "47 locations" in second.stdout
