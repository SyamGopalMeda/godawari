from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

PHONE_RE = re.compile(r"^\+?[1-9]\d{9,14}$")
Lang = Literal["te", "hi", "en"]
Level = Literal["low", "moderate", "high", "critical", "unknown"]


def normalize_phone(v: str) -> str:
    v = re.sub(r"[\s\-()]", "", v)
    if re.fullmatch(r"\d{10}", v):
        v = "+91" + v
    if not PHONE_RE.fullmatch(v):
        raise ValueError("Invalid phone number")
    return v if v.startswith("+") else "+" + v


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---- auth
class OtpRequest(BaseModel):
    phone: str
    lang: Lang = "te"

    @field_validator("phone")
    @classmethod
    def _p(cls, v: str) -> str:
        return normalize_phone(v)


class OtpVerify(BaseModel):
    phone: str
    code: str = Field(min_length=4, max_length=8)
    name: str | None = Field(default=None, max_length=120)

    @field_validator("phone")
    @classmethod
    def _p(cls, v: str) -> str:
        return normalize_phone(v)


class PasswordLogin(BaseModel):
    username: str = Field(min_length=1, max_length=120)  # staff username, or a pilgrim's mobile number
    password: str = Field(min_length=1, max_length=200)


def strong_password(v: str) -> str:
    if len(v) < 8 or not re.search(r"[A-Za-z]", v) or not re.search(r"\d", v):
        raise ValueError("Password must be at least 8 characters and contain a letter and a number")
    return v


class RegisterIn(BaseModel):
    phone: str
    code: str = Field(min_length=4, max_length=8)
    password: str = Field(max_length=200)
    name: str | None = Field(default=None, max_length=120)

    @field_validator("phone")
    @classmethod
    def _p(cls, v: str) -> str:
        return normalize_phone(v)

    @field_validator("password")
    @classmethod
    def _pw(cls, v: str) -> str:
        return strong_password(v)


class PasswordResetIn(BaseModel):
    phone: str
    code: str = Field(min_length=4, max_length=8)
    new_password: str = Field(max_length=200)

    @field_validator("phone")
    @classmethod
    def _p(cls, v: str) -> str:
        return normalize_phone(v)

    @field_validator("new_password")
    @classmethod
    def _pw(cls, v: str) -> str:
        return strong_password(v)


class UserOut(ORM):
    id: int
    phone: str | None
    name: str | None
    role: str
    preferred_lang: str
    site_id: int | None
    help_desk_location_id: int | None


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    preferred_lang: Lang | None = None


# ---- locations
class LocationOut(ORM):
    id: int
    code: str
    site_id: int
    type: str
    name: str
    name_te: str | None
    name_hi: str | None
    lat: float | None
    lng: float | None
    capacity: int | None
    is_accessible: bool
    is_open: bool
    monitored: bool
    current_count: int | None
    density_level: str
    density_source: str | None
    density_updated_at: datetime | None
    details: dict[str, Any]
    verification: str = "unverified"
    source: str | None = None
    source_ref: str | None = None
    source_retrieved_at: datetime | None = None
    verified_at: datetime | None = None
    verification_note: str | None = None
    distance_m: float | None = None
    is_stale: bool | None = None


VerificationLevel = Literal["official", "source", "unverified", "unavailable"]


class LocationIn(BaseModel):
    code: str = Field(max_length=40)
    site_id: int
    type: str
    name: str
    name_te: str | None = None
    name_hi: str | None = None
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    verification: VerificationLevel = "unverified"
    source: str | None = Field(default=None, max_length=160)
    source_ref: str | None = Field(default=None, max_length=400)
    verification_note: str | None = None
    capacity: int | None = None
    is_accessible: bool = False
    is_open: bool = True
    monitored: bool = False
    details: dict[str, Any] = {}


class LocationPatch(BaseModel):
    name: str | None = None
    name_te: str | None = None
    name_hi: str | None = None
    type: str | None = None
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    capacity: int | None = None
    is_accessible: bool | None = None
    is_open: bool | None = None
    monitored: bool | None = None
    details: dict[str, Any] | None = None


# ---- crowd
class CrowdReadingIn(BaseModel):
    location_id: int | None = None
    location_code: str | None = None
    count: int = Field(ge=0, le=5_000_000)
    source: Literal["camera", "rfid", "manual", "estimate", "video"] | None = None
    recorded_at: datetime | None = None


class VerificationIn(BaseModel):
    verification: VerificationLevel
    note: str = Field(min_length=3, max_length=1000)
    source: str | None = Field(default=None, max_length=160)
    source_ref: str | None = Field(default=None, max_length=400)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)


class CrowdStatusOut(BaseModel):
    location_id: int
    code: str
    name: str
    name_te: str | None
    name_hi: str | None
    type: str
    lat: float | None
    lng: float | None
    capacity: int | None
    current_count: int | None
    density_level: Level
    source: str | None
    updated_at: datetime | None
    is_stale: bool
    override: bool
    is_open: bool


class CrowdOverrideIn(BaseModel):
    level: Literal["low", "moderate", "high", "critical"] | None
    minutes: int = Field(default=30, ge=1, le=720)
    reason: str = Field(max_length=255)


class RecommendationOut(BaseModel):
    location: CrowdStatusOut
    distance_m: float | None
    score: float
    reason: str


# ---- routes
class RouteOut(BaseModel):
    polyline: list[list[float]]
    distance_m: float
    eta_min: float
    steps: list[dict]
    crowd_notes: list[str]
    avoided_zones: list[str]
    accessible: bool
    provider: str = "walkways"  # walkways = organiser walkway graph (crowd-aware); osrm = OpenStreetMap footpaths
    attribution: str | None = None
    notes: list[str] = []


# ---- parking
class ParkingLotOut(BaseModel):
    id: int
    location: LocationOut
    total_slots: int
    occupied_slots: int
    free_slots: int
    occupancy_pct: float
    vehicle_types: list[str]
    nearest_gate: LocationOut | None
    shuttle_info: str | None
    status: str
    source: str | None
    updated_at: datetime | None
    distance_m: float | None = None


class ParkingOccupancyIn(BaseModel):
    delta: int | None = Field(default=None, ge=-10_000, le=10_000)
    occupied: int | None = Field(default=None, ge=0)


class ParkingPatch(BaseModel):
    status: Literal["open", "filling", "full", "closed"] | None = None
    total_slots: int | None = Field(default=None, ge=0)
    shuttle_info: str | None = None


class ParkingPassIn(BaseModel):
    lot_id: int
    vehicle_number: str = Field(min_length=4, max_length=20)
    vehicle_type: Literal["car", "bike", "bus", "van"] = "car"


class ParkingPassOut(ORM):
    id: int
    lot_id: int
    vehicle_number: str
    vehicle_type: str
    qr_token: str
    status: str
    issued_at: datetime
    used_at: datetime | None


class ParkingSpotIn(BaseModel):
    lot_id: int
    row_label: str | None = Field(default=None, max_length=40)
    note: str | None = Field(default=None, max_length=255)


class ParkingSpotOut(ORM):
    lot_id: int
    row_label: str | None
    note: str | None
    saved_at: datetime


# ---- families
class FamilyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class FamilyJoin(BaseModel):
    join_code: str = Field(min_length=6, max_length=8)
    display_name: str | None = None


class MemberIn(BaseModel):
    display_name: str = Field(min_length=1, max_length=120)
    age_group: Literal["child", "adult", "senior"] = "adult"
    relation: str | None = Field(default=None, max_length=40)
    is_vulnerable: bool = False
    phone: str | None = None

    @field_validator("phone")
    @classmethod
    def _p(cls, v: str | None) -> str | None:
        return normalize_phone(v) if v else None


class MemberPatch(BaseModel):
    display_name: str | None = None
    age_group: Literal["child", "adult", "senior"] | None = None
    relation: str | None = None
    is_vulnerable: bool | None = None
    gps_sharing: bool | None = None


class TagLinkIn(BaseModel):
    tag_uid: str = Field(min_length=4, max_length=64)
    consent: bool


class GpsIn(BaseModel):
    lat: float
    lng: float


class SightingOut(BaseModel):
    location_id: int
    location_name: str
    location_code: str
    lat: float
    lng: float
    seen_at: datetime
    direction: str
    method: str


class LastSeenOut(BaseModel):
    member_id: int
    display_name: str
    tag_uid: str | None
    consented: bool
    last_checkpoint: SightingOut | None
    recent: list[SightingOut]
    gps: dict | None
    nearest_help_desks: list[LocationOut]


class MemberOut(ORM):
    id: int
    family_id: int
    user_id: int | None
    display_name: str
    age_group: str
    relation: str | None
    is_vulnerable: bool
    phone: str | None
    rfid_tag_uid: str | None
    consent_given_at: datetime | None
    gps_sharing: bool
    last_seen: SightingOut | None = None
    gps: dict | None = None


class FamilyOut(ORM):
    id: int
    name: str
    primary_user_id: int
    join_code: str
    created_at: datetime
    members: list[MemberOut]


# ---- rfid
class SightingIn(BaseModel):
    tag_uid: str = Field(min_length=4, max_length=64)
    antenna: str | None = None
    rssi: float | None = None
    direction: Literal["in", "out", "unknown"] = "unknown"
    seen_at: datetime | None = None
    location_id: int | None = None  # optional override for multi-location gateways


class ManualScanIn(BaseModel):
    tag_uid: str = Field(min_length=4, max_length=64)
    location_id: int
    method: Literal["qr", "rfid", "ble"] = "qr"


class TagIssueIn(BaseModel):
    uids: list[str] = Field(min_length=1, max_length=1000)


# ---- missing persons
class ReportOut(ORM):
    id: int
    reporter_user_id: int
    member_id: int | None
    site_id: int | None
    subject_name: str
    age: int | None
    gender: str | None
    description: str | None
    clothing: str | None
    has_photo: bool = False
    last_seen_location_id: int | None
    last_seen_at: datetime | None
    contact_phone: str | None
    status: str
    assigned_staff_id: int | None
    help_desk_location_id: int | None
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None


class ReportPatch(BaseModel):
    status: Literal["open", "verified", "searching", "found", "closed", "rejected"] | None = None
    assigned_staff_id: int | None = None
    help_desk_location_id: int | None = None
    note: str | None = Field(default=None, max_length=1000)


class ReportEventOut(ORM):
    id: int
    actor_id: int | None
    event_type: str
    note: str | None
    created_at: datetime


class BoardEntry(BaseModel):
    id: int
    age_group: str
    gender: str | None
    clothing: str | None
    held_at: LocationOut | None
    since: datetime


# ---- alerts / sos
class AlertIn(BaseModel):
    title: str = Field(max_length=160)
    body: str
    title_te: str | None = None
    body_te: str | None = None
    title_hi: str | None = None
    body_hi: str | None = None
    severity: Literal["info", "warning", "critical"] = "info"
    site_id: int | None = None
    location_id: int | None = None
    expires_in_minutes: int | None = Field(default=120, ge=1, le=7 * 24 * 60)


class AlertOut(ORM):
    id: int
    title: str
    body: str
    title_te: str | None
    body_te: str | None
    title_hi: str | None
    body_hi: str | None
    severity: str
    site_id: int | None
    location_id: int | None
    starts_at: datetime
    expires_at: datetime | None
    created_at: datetime


class SosIn(BaseModel):
    type: Literal["medical", "police", "lost_child", "fire", "other"] = "other"
    lat: float | None = None
    lng: float | None = None
    phone: str | None = None
    note: str | None = Field(default=None, max_length=500)

    @field_validator("phone")
    @classmethod
    def _p(cls, v: str | None) -> str | None:
        return normalize_phone(v) if v else None


class SosOut(ORM):
    id: int
    user_id: int | None
    phone: str | None
    lat: float | None
    lng: float | None
    type: str
    note: str | None
    status: str
    assigned_to: int | None
    created_at: datetime
    updated_at: datetime


class SosPatch(BaseModel):
    status: Literal["new", "acknowledged", "dispatched", "resolved"]
    assigned_to: int | None = None


# ---- admin
class DeviceIn(BaseModel):
    name: str = Field(max_length=120)
    type: Literal["rfid_reader", "camera", "parking_counter", "kiosk"]
    location_id: int | None = None


class DeviceOut(ORM):
    id: int
    name: str
    type: str
    location_id: int | None
    status: str
    last_seen_at: datetime | None
    created_at: datetime


class DeviceCreated(DeviceOut):
    api_key: str


class StaffUserIn(BaseModel):
    username: str = Field(min_length=3, max_length=60)
    password: str = Field(min_length=8, max_length=128)
    name: str
    role: Literal["volunteer", "staff", "admin"]
    site_id: int | None = None
    help_desk_location_id: int | None = None
    phone: str | None = None


class AuditOut(ORM):
    id: int
    actor_id: int | None
    device_id: int | None
    action: str
    entity: str | None
    entity_id: str | None
    purpose: str | None
    created_at: datetime


class SiteOut(ORM):
    id: int
    code: str | None = None
    name: str
    name_te: str | None
    name_hi: str | None
    state: str | None = None
    district: str | None
    center_lat: float
    center_lng: float
    emergency_contacts: dict
    source: str | None = None
    source_ref: str | None = None
    citations: list = []
    sort_order: int = 0
    ghats_total: int = 0
    ghats_mapped: int = 0
    facilities: int = 0


# ---- video crowd-count verification
class VideoAnalysisOut(ORM):
    id: int
    created_by: int | None
    location_id: int | None
    filename: str
    size_bytes: int
    status: str
    sample_fps: float
    confidence: float
    model_name: str | None
    device: str | None
    video_fps: float | None
    video_frames: int | None
    video_width: int | None
    video_height: int | None
    video_duration_s: float | None
    frames_expected: int
    frames_processed: int
    detection_mode: str | None = None
    tiles: int | None = None
    last_count: int | None = None
    unique_tracks: int | None = None
    output_video: bool | None = False  # None on rows created before the column existed
    summary: dict
    error: str | None
    note: str | None
    published_reading_id: int | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class VideoPublishIn(BaseModel):
    location_id: int
    statistic: Literal["max", "mean", "p95", "median"] = "p95"
    note: str | None = Field(default=None, max_length=255)
