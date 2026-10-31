"""SMS gateway adapter.

Provider is chosen by PUSHKAR_SMS_PROVIDER:
  console  - log only (default; dev)
  msg91    - MSG91 Flow API (India, DLT-registered template required)
  twilio   - Twilio Messages API
  http     - generic JSON webhook: POST {"to": ..., "text": ...} with a bearer token

All providers fail soft: a delivery failure is logged and reported back as delivered=False so the
API can tell the caller "SMS delivery failed, try again" instead of crashing the OTP flow.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from ..config import settings

log = logging.getLogger("sms")


@dataclass
class SmsResult:
    delivered: bool
    provider: str
    detail: str = ""


def send_sms(phone: str, text: str, *, template_vars: dict[str, str] | None = None, client: httpx.Client | None = None) -> SmsResult:
    provider = settings.sms_provider.lower()
    try:
        if provider == "console":
            log.info("SMS (console) to %s: %s", phone, text)
            return SmsResult(True, provider, "logged")
        own = client is None
        c = client or httpx.Client(timeout=settings.sms_timeout_seconds)
        try:
            if provider == "msg91":
                return _msg91(c, phone, template_vars or {"OTP": text})
            if provider == "twilio":
                return _twilio(c, phone, text)
            if provider == "http":
                return _http(c, phone, text)
        finally:
            if own:
                c.close()
        return SmsResult(False, provider, "unknown provider")
    except Exception as e:  # noqa: BLE001 - never let SMS failures break the request
        log.error("SMS delivery failed via %s: %s", provider, e)
        return SmsResult(False, provider, str(e))


def _msg91(c: httpx.Client, phone: str, variables: dict[str, str]) -> SmsResult:
    r = c.post(
        "https://control.msg91.com/api/v5/flow/",
        headers={"authkey": settings.sms_api_key, "Content-Type": "application/json"},
        json={"template_id": settings.sms_template_id, "sender": settings.sms_sender_id, "short_url": "0", "recipients": [{"mobiles": phone.lstrip("+"), **variables}]},
    )
    ok = r.status_code < 300 and r.json().get("type") == "success"
    return SmsResult(ok, "msg91", r.text[:200])


def _twilio(c: httpx.Client, phone: str, text: str) -> SmsResult:
    r = c.post(
        f"https://api.twilio.com/2010-04-01/Accounts/{settings.sms_account_sid}/Messages.json",
        auth=(settings.sms_account_sid, settings.sms_api_key),
        data={"From": settings.sms_sender_id, "To": phone, "Body": text},
    )
    return SmsResult(r.status_code < 300, "twilio", r.text[:200])


def _http(c: httpx.Client, phone: str, text: str) -> SmsResult:
    r = c.post(settings.sms_http_url, headers={"Authorization": f"Bearer {settings.sms_api_key}"}, json={"to": phone, "text": text})
    return SmsResult(r.status_code < 300, "http", r.text[:200])
