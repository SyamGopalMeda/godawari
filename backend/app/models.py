"""SQLAlchemy models. See docs/04-database-and-api-spec.md for the narrative description."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    TypeDecorator,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UTCDateTime(TypeDecorator):
    """Timestamps are always UTC and always timezone-aware when read back.

    PostgreSQL keeps the offset, but SQLite returns naive datetimes; serialized without an offset they were
    read by browsers as local time (IST, +5:30), making fresh readings look hours old. Normalising here
    keeps every API timestamp unambiguous regardless of the database.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc) if value is not None else None

    def process_result_value(self, value, dialect):
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value


# --------------------------------------------------------------------------- identity
class Site(Base):
    """A bathing centre (town) on the Godavari, e.g. Rajamahendravaram or Bhadrachalam."""
    __tablename__ = "sites"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str | None] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    name_te: Mapped[str | None] = mapped_column(String(120))
    name_hi: Mapped[str | None] = mapped_column(String(120))
    state: Mapped[str | None] = mapped_column(String(80))
    district: Mapped[str | None] = mapped_column(String(80))
    center_lat: Mapped[float] = mapped_column(Float)
    center_lng: Mapped[float] = mapped_column(Float)
    emergency_contacts: Mapped[dict] = mapped_column(JSON, default=dict)
    source: Mapped[str | None] = mapped_column(String(120))
    source_ref: Mapped[str | None] = mapped_column(String(400))
    citations: Mapped[list] = mapped_column(JSON, default=list)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    phone: Mapped[str | None] = mapped_column(String(20), unique=True, index=True)
    name: Mapped[str | None] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(20), default="pilgrim")  # pilgrim|volunteer|staff|admin
    username: Mapped[str | None] = mapped_column(String(60), unique=True)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    preferred_lang: Mapped[str] = mapped_column(String(5), default="te")
    site_id: Mapped[int | None] = mapped_column(ForeignKey("sites.id"))
    help_desk_location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class OtpCode(Base):
    __tablename__ = "otp_codes"
    id: Mapped[int] = mapped_column(primary_key=True)
    phone: Mapped[str] = mapped_column(String(20), index=True)
    code_hash: Mapped[str] = mapped_column(String(128))
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime())
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    consumed_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class Device(Base):
    __tablename__ = "devices"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    type: Mapped[str] = mapped_column(String(30))  # rfid_reader|camera|parking_counter|kiosk
    api_key_hash: Mapped[str] = mapped_column(String(128), index=True)
    location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"))
    status: Mapped[str] = mapped_column(String(20), default="active")  # active|revoked
    last_seen_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


# --------------------------------------------------------------------------- places
class Location(Base):
    __tablename__ = "locations"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id"), index=True)
    type: Mapped[str] = mapped_column(String(30), index=True)
    name: Mapped[str] = mapped_column(String(160))
    name_te: Mapped[str | None] = mapped_column(String(160))
    name_hi: Mapped[str | None] = mapped_column(String(160))
    # coordinates are optional: a ghat named by a written source but not yet located has none (no map pin)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    capacity: Mapped[int | None] = mapped_column(Integer)
    is_accessible: Mapped[bool] = mapped_column(Boolean, default=False)
    is_open: Mapped[bool] = mapped_column(Boolean, default=True)
    monitored: Mapped[bool] = mapped_column(Boolean, default=False)  # appears in crowd status
    current_count: Mapped[int | None] = mapped_column(Integer)
    density_level: Mapped[str] = mapped_column(String(12), default="unknown")
    density_source: Mapped[str | None] = mapped_column(String(12))
    density_updated_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    override_level: Mapped[str | None] = mapped_column(String(12))
    override_until: Mapped[datetime | None] = mapped_column(UTCDateTime())
    override_reason: Mapped[str | None] = mapped_column(String(255))
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    # provenance & verification
    #   official   - confirmed by the organisers / an admin in the control room
    #   source     - position taken from a public map source (OpenStreetMap), not yet confirmed by organisers
    #   unverified - named by a written source, position not verified (no coordinates)
    #   unavailable- known to be closed / not usable / removed
    #   demo       - synthetic demo record (test and demo installations only)
    verification: Mapped[str] = mapped_column(String(16), default="unverified", index=True)
    source: Mapped[str | None] = mapped_column(String(160))
    source_ref: Mapped[str | None] = mapped_column(String(400))
    source_retrieved_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    verified_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    verified_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    verification_note: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (Index("ix_locations_site_type", "site_id", "type"),)


class CrowdReading(Base):
    __tablename__ = "crowd_readings"
    id: Mapped[int] = mapped_column(primary_key=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id"), index=True)
    count: Mapped[int] = mapped_column(Integer)
    density_level: Mapped[str] = mapped_column(String(12))
    source: Mapped[str] = mapped_column(String(12))
    device_id: Mapped[int | None] = mapped_column(ForeignKey("devices.id"))
    reported_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    recorded_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, index=True)

    __table_args__ = (Index("ix_crowd_readings_loc_time", "location_id", "recorded_at"),)


class ParkingLot(Base):
    __tablename__ = "parking_lots"
    id: Mapped[int] = mapped_column(primary_key=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id"), unique=True)
    total_slots: Mapped[int] = mapped_column(Integer)
    occupied_slots: Mapped[int] = mapped_column(Integer, default=0)
    vehicle_types: Mapped[list] = mapped_column(JSON, default=list)
    nearest_gate_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"))
    shuttle_info: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(12), default="open")  # open|filling|full|closed
    source: Mapped[str | None] = mapped_column(String(12))
    updated_at: Mapped[datetime | None] = mapped_column(UTCDateTime())

    location: Mapped[Location] = relationship(foreign_keys=[location_id])


class ParkingPass(Base):
    __tablename__ = "parking_passes"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    lot_id: Mapped[int] = mapped_column(ForeignKey("parking_lots.id"))
    vehicle_number: Mapped[str] = mapped_column(String(20))
    vehicle_type: Mapped[str] = mapped_column(String(12), default="car")
    qr_token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(12), default="issued")  # issued|used|cancelled
    issued_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    used_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class ParkingSpot(Base):
    __tablename__ = "parking_spots"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True)
    lot_id: Mapped[int] = mapped_column(ForeignKey("parking_lots.id"))
    row_label: Mapped[str | None] = mapped_column(String(40))
    note: Mapped[str | None] = mapped_column(String(255))
    saved_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


# --------------------------------------------------------------------------- families & rfid
class Family(Base):
    __tablename__ = "families"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    primary_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    join_code: Mapped[str] = mapped_column(String(8), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)

    members: Mapped[list["FamilyMember"]] = relationship(back_populates="family", cascade="all, delete-orphan")


class FamilyMember(Base):
    __tablename__ = "family_members"
    id: Mapped[int] = mapped_column(primary_key=True)
    family_id: Mapped[int] = mapped_column(ForeignKey("families.id"), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    display_name: Mapped[str] = mapped_column(String(120))
    age_group: Mapped[str] = mapped_column(String(10), default="adult")  # child|adult|senior
    relation: Mapped[str | None] = mapped_column(String(40))
    is_vulnerable: Mapped[bool] = mapped_column(Boolean, default=False)
    phone: Mapped[str | None] = mapped_column(String(20))
    rfid_tag_uid: Mapped[str | None] = mapped_column(ForeignKey("rfid_tags.uid"), unique=True)
    consent_given_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    consent_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    gps_sharing: Mapped[bool] = mapped_column(Boolean, default=False)
    last_lat: Mapped[float | None] = mapped_column(Float)
    last_lng: Mapped[float | None] = mapped_column(Float)
    last_gps_at: Mapped[datetime | None] = mapped_column(UTCDateTime())

    family: Mapped[Family] = relationship(back_populates="members")
    tag: Mapped["RfidTag | None"] = relationship(foreign_keys=[rfid_tag_uid])


class RfidTag(Base):
    __tablename__ = "rfid_tags"
    uid: Mapped[str] = mapped_column(String(64), primary_key=True)
    status: Mapped[str] = mapped_column(String(12), default="issued")  # issued|active|unlinked|lost
    issued_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    last_seen_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    last_location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"))


class TagSighting(Base):
    __tablename__ = "tag_sightings"
    id: Mapped[int] = mapped_column(primary_key=True)
    tag_uid: Mapped[str] = mapped_column(ForeignKey("rfid_tags.uid"), index=True)
    device_id: Mapped[int | None] = mapped_column(ForeignKey("devices.id"))
    reported_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id"), index=True)
    antenna: Mapped[str | None] = mapped_column(String(20))
    rssi: Mapped[float | None] = mapped_column(Float)
    direction: Mapped[str] = mapped_column(String(8), default="unknown")  # in|out|unknown
    method: Mapped[str] = mapped_column(String(8), default="rfid")  # rfid|qr|ble
    seen_at: Mapped[datetime] = mapped_column(UTCDateTime(), index=True)
    received_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)

    __table_args__ = (Index("ix_sightings_tag_time", "tag_uid", "seen_at"),)


# --------------------------------------------------------------------------- missing persons, sos, alerts
class MissingPersonReport(Base):
    __tablename__ = "missing_person_reports"
    id: Mapped[int] = mapped_column(primary_key=True)
    reporter_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    member_id: Mapped[int | None] = mapped_column(ForeignKey("family_members.id"))
    site_id: Mapped[int | None] = mapped_column(ForeignKey("sites.id"))
    subject_name: Mapped[str] = mapped_column(String(120))
    age: Mapped[int | None] = mapped_column(Integer)
    gender: Mapped[str | None] = mapped_column(String(12))
    description: Mapped[str | None] = mapped_column(Text)
    clothing: Mapped[str | None] = mapped_column(String(255))
    photo_path: Mapped[str | None] = mapped_column(String(255))
    photo_consent: Mapped[bool] = mapped_column(Boolean, default=False)
    last_seen_location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"))
    last_seen_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    contact_phone: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(12), default="open", index=True)
    assigned_staff_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    help_desk_location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, onupdate=utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class ReportEvent(Base):
    __tablename__ = "report_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("missing_person_reports.id"), index=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    event_type: Mapped[str] = mapped_column(String(30))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class Alert(Base):
    __tablename__ = "alerts"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(160))
    body: Mapped[str] = mapped_column(Text)
    title_te: Mapped[str | None] = mapped_column(String(160))
    body_te: Mapped[str | None] = mapped_column(Text)
    title_hi: Mapped[str | None] = mapped_column(String(160))
    body_hi: Mapped[str | None] = mapped_column(Text)
    severity: Mapped[str] = mapped_column(String(10), default="info")  # info|warning|critical
    site_id: Mapped[int | None] = mapped_column(ForeignKey("sites.id"))
    location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"))
    starts_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class SosRequest(Base):
    __tablename__ = "sos_requests"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    phone: Mapped[str | None] = mapped_column(String(20))
    lat: Mapped[float | None] = mapped_column(Float)
    lng: Mapped[float | None] = mapped_column(Float)
    type: Mapped[str] = mapped_column(String(12), default="other")  # medical|police|lost_child|fire|other
    note: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(12), default="new")  # new|acknowledged|dispatched|resolved
    assigned_to: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, onupdate=utcnow)


# --------------------------------------------------------------------------- routing graph
class WalkwayNode(Base):
    __tablename__ = "walkway_nodes"
    id: Mapped[int] = mapped_column(primary_key=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id"), index=True)
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"))
    label: Mapped[str | None] = mapped_column(String(80))


class WalkwayEdge(Base):
    __tablename__ = "walkway_edges"
    id: Mapped[int] = mapped_column(primary_key=True)
    from_node: Mapped[int] = mapped_column(ForeignKey("walkway_nodes.id"), index=True)
    to_node: Mapped[int] = mapped_column(ForeignKey("walkway_nodes.id"), index=True)
    length_m: Mapped[float] = mapped_column(Float)
    is_accessible: Mapped[bool] = mapped_column(Boolean, default=True)
    is_closed: Mapped[bool] = mapped_column(Boolean, default=False)
    zone_location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"))


# --------------------------------------------------------------------------- audit
class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    device_id: Mapped[int | None] = mapped_column(ForeignKey("devices.id"))
    action: Mapped[str] = mapped_column(String(60), index=True)
    entity: Mapped[str | None] = mapped_column(String(40))
    entity_id: Mapped[str | None] = mapped_column(String(40))
    purpose: Mapped[str | None] = mapped_column(String(255))
    ip: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, index=True)


# --------------------------------------------------------------------------- video crowd-count verification
class VideoAnalysis(Base):
    """A recorded video run through the person detector to verify the crowd-counting pipeline.

    Results are kept separate from live crowd readings; an operator may explicitly publish the result as a
    reading with source="video" (never presented as a live camera feed).
    """
    __tablename__ = "video_analyses"
    id: Mapped[int] = mapped_column(primary_key=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"))
    filename: Mapped[str] = mapped_column(String(255))
    path: Mapped[str] = mapped_column(String(400))
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(12), default="queued", index=True)  # queued|running|done|failed|cancelled
    sample_fps: Mapped[float] = mapped_column(Float, default=2.0)
    confidence: Mapped[float] = mapped_column(Float, default=0.35)
    model_name: Mapped[str | None] = mapped_column(String(80))
    device: Mapped[str | None] = mapped_column(String(80))
    video_fps: Mapped[float | None] = mapped_column(Float)
    video_frames: Mapped[int | None] = mapped_column(Integer)
    video_width: Mapped[int | None] = mapped_column(Integer)
    video_height: Mapped[int | None] = mapped_column(Integer)
    video_duration_s: Mapped[float | None] = mapped_column(Float)
    frames_expected: Mapped[int] = mapped_column(Integer, default=0)
    frames_processed: Mapped[int] = mapped_column(Integer, default=0)
    detection_mode: Mapped[str | None] = mapped_column(String(12), default="auto")  # auto|standard|tiled (resolved when running)
    tiles: Mapped[int | None] = mapped_column(Integer)
    last_count: Mapped[int | None] = mapped_column(Integer)  # people in the latest analysed frame (live progress)
    unique_tracks: Mapped[int | None] = mapped_column(Integer)  # approximate distinct people seen so far (IoU tracker)
    output_video: Mapped[bool] = mapped_column(Boolean, default=False)
    summary: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(String(255))
    published_reading_id: Mapped[int | None] = mapped_column(ForeignKey("crowd_readings.id"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
