from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import audit, get_current_user
from ..models import AuditLog, OtpCode, User
from ..schemas import OtpRequest, OtpVerify, PasswordLogin, PasswordResetIn, RegisterIn, TokenOut, UserOut, UserUpdate, normalize_phone
from ..security import create_access_token, hash_password, hash_token, new_otp, verify_password
from ..services.sms import send_sms

router = APIRouter(prefix="/auth", tags=["auth"])
log = logging.getLogger("auth")


@router.post("/otp/request")
def request_otp(body: OtpRequest, request: Request, db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    recent = db.scalar(
        select(func.count(OtpCode.id)).where(OtpCode.phone == body.phone, OtpCode.created_at > now - timedelta(hours=1))
    )
    if recent and recent >= settings.otp_per_hour:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many OTP requests. Try again later.")
    code = new_otp()
    db.add(
        OtpCode(
            phone=body.phone,
            code_hash=hash_token(body.phone + code),
            expires_at=now + timedelta(seconds=settings.otp_ttl_seconds),
        )
    )
    audit(db, "otp.request", entity="phone", entity_id=body.phone[-4:], request=request)
    db.commit()
    result = send_sms(body.phone, f"Your Pushkar Sahayam OTP is {code}. Valid {settings.otp_ttl_seconds // 60} minutes.", template_vars={"OTP": code})
    if not result.delivered and not settings.dev_mode:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "SMS delivery failed. Please try again.")
    resp = {"sent": result.delivered, "ttl_seconds": settings.otp_ttl_seconds, "delivery": result.provider}
    if settings.dev_mode:
        resp["dev_otp"] = code  # DEV ONLY: never enabled in production
    return resp


def _consume_otp(db: Session, phone: str, code: str) -> None:
    """Check the latest unused OTP for this phone and mark it used. Raises 400/429 on failure."""
    now = datetime.now(timezone.utc)
    otp = db.scalar(
        select(OtpCode)
        .where(OtpCode.phone == phone, OtpCode.consumed_at.is_(None))
        .order_by(OtpCode.created_at.desc())
    )
    if not otp:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No OTP requested for this phone")
    exp = otp.expires_at if otp.expires_at.tzinfo else otp.expires_at.replace(tzinfo=timezone.utc)
    if exp < now:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "OTP expired")
    if otp.attempts >= 5:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts; request a new OTP")
    otp.attempts += 1
    if otp.code_hash != hash_token(phone + code):
        db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Incorrect OTP")
    otp.consumed_at = now


@router.post("/otp/verify", response_model=TokenOut)
def verify_otp(body: OtpVerify, request: Request, db: Session = Depends(get_db)):
    _consume_otp(db, body.phone, body.code)
    user = db.scalar(select(User).where(User.phone == body.phone))
    if not user:
        user = User(phone=body.phone, name=body.name, role="pilgrim")
        db.add(user)
        db.flush()
    elif body.name and not user.name:
        user.name = body.name
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account disabled")
    audit(db, "auth.otp_login", actor=user, request=request)
    db.commit()
    return TokenOut(access_token=create_access_token(user.id, user.role), user=UserOut.model_validate(user))


LOGIN_FAILS_PER_15_MIN = 10


@router.post("/login", response_model=TokenOut)
def password_login(body: PasswordLogin, request: Request, db: Session = Depends(get_db)):
    """Staff sign in with a username; pilgrims (and staff with a registered mobile) with their phone number.
    After 10 failed attempts for the same identifier in 15 minutes, further attempts are refused (429)."""
    ident = body.username.strip()
    user = db.scalar(select(User).where(User.username == ident))
    phone = None
    if not user:
        try:
            phone = normalize_phone(ident)
            user = db.scalar(select(User).where(User.phone == phone))
        except ValueError:
            user = None
    key = (phone or ident.lower())[-40:]
    since = datetime.now(timezone.utc) - timedelta(minutes=15)
    fails = db.scalar(select(func.count(AuditLog.id)).where(AuditLog.action == "auth.login_failed", AuditLog.entity_id == key, AuditLog.created_at > since))
    if fails and fails >= LOGIN_FAILS_PER_15_MIN:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many failed sign-in attempts. Try again in 15 minutes or reset your password.")
    if not user or not user.is_active or not verify_password(body.password, user.password_hash):
        audit(db, "auth.login_failed", entity="login", entity_id=key, request=request)
        db.commit()
        if user and user.is_active and not user.password_hash:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "No password is set for this account yet. Use 'Forgot password' to set one.")
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    audit(db, "auth.password_login", actor=user, request=request)
    db.commit()
    return TokenOut(access_token=create_access_token(user.id, user.role), user=UserOut.model_validate(user))


@router.post("/register", response_model=TokenOut, status_code=201)
def register(body: RegisterIn, request: Request, db: Session = Depends(get_db)):
    """Create a pilgrim account with a password; the OTP proves the caller owns the phone number."""
    _consume_otp(db, body.phone, body.code)
    user = db.scalar(select(User).where(User.phone == body.phone))
    if user and user.password_hash:
        db.commit()
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this number already exists. Sign in, or use 'Forgot password'.")
    if user and not user.is_active:
        db.commit()
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account disabled")
    if not user:
        user = User(phone=body.phone, name=body.name, role="pilgrim")
        db.add(user)
        db.flush()
    elif body.name and not user.name:
        user.name = body.name
    user.password_hash = hash_password(body.password)
    audit(db, "auth.register", actor=user, request=request)
    db.commit()
    return TokenOut(access_token=create_access_token(user.id, user.role), user=UserOut.model_validate(user))


@router.post("/password/reset", response_model=TokenOut)
def reset_password(body: PasswordResetIn, request: Request, db: Session = Depends(get_db)):
    """Forgot password: an OTP sent to the registered mobile proves ownership; set a new password and sign in."""
    _consume_otp(db, body.phone, body.code)
    user = db.scalar(select(User).where(User.phone == body.phone))
    if not user:
        db.commit()
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No account is registered with this number. Create an account instead.")
    if not user.is_active:
        db.commit()
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account disabled")
    user.password_hash = hash_password(body.new_password)
    audit(db, "auth.password_reset", actor=user, request=request)
    db.commit()
    return TokenOut(access_token=create_access_token(user.id, user.role), user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.patch("/me", response_model=UserOut)
def update_me(body: UserUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if body.name is not None:
        user.name = body.name
    if body.preferred_lang is not None:
        user.preferred_lang = body.preferred_lang
    db.commit()
    return user
