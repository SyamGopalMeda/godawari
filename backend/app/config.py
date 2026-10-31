from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. Every value can be overridden with an environment variable."""

    model_config = SettingsConfigDict(env_file=".env", env_prefix="PUSHKAR_", extra="ignore")

    app_name: str = "Pushkar Sahayam API"
    dev_mode: bool = True  # when true, OTPs are returned in the API response and logged
    database_url: str = "sqlite:///./pushkar.db"
    jwt_secret: str = "dev-only-secret-change-me-in-production-0123456789"
    jwt_algorithm: str = "HS256"
    jwt_expiry_hours: int = 12
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000", "http://localhost:8080"]
    upload_dir: str = "./uploads"
    seed_on_start: bool = True
    # real = verified Godavari bathing centres + OpenStreetMap locations (data/godavari_locations.json)
    # demo = synthetic single-site demo (tests, offline demos); none = no data
    seed_mode: str = "real"
    # walking directions when no organiser walkway graph exists (OSRM foot profile, FOSSGIS public server)
    osrm_foot_url: str = "https://routing.openstreetmap.de/routed-foot"
    osrm_timeout_seconds: float = 8.0
    bootstrap_admin_username: str = "admin"
    bootstrap_admin_password: str = "admin12345"

    # Crowd rules
    crowd_stale_seconds: int = 15 * 60
    crowd_low_max: float = 0.40
    crowd_moderate_max: float = 0.70
    crowd_high_max: float = 0.90

    # SMS gateway (see services/sms.py)
    sms_provider: str = "console"  # console|msg91|twilio|http
    sms_api_key: str = ""
    sms_sender_id: str = "PSHKAR"  # DLT header (MSG91) or Twilio From number
    sms_template_id: str = ""  # MSG91 DLT-approved OTP template
    sms_account_sid: str = ""  # Twilio
    sms_http_url: str = ""  # generic webhook
    sms_timeout_seconds: float = 8.0

    # Video crowd-count verification (optional: needs requirements-video.txt)
    video_model_path: str = "yolov8n.pt"  # ultralytics downloads it on first use; or a local path
    video_max_mb: int = 300
    video_max_seconds: int = 600  # analyse at most the first 10 minutes
    video_sample_fps: float = 2.0
    video_imgsz: int = 640
    video_annotate_every: int = 5  # annotate every 5th sampled frame
    video_max_annotated: int = 120
    # dense / high-resolution footage: cut each frame into overlapping native-resolution tiles and merge with NMS
    video_detection_mode: str = "auto"  # auto | standard | tiled ; auto = tiled when the long side >= video_auto_tile_min_px
    video_auto_tile_min_px: int = 1600
    video_tile_px: int = 1280
    video_tile_overlap: float = 0.2
    video_tile_batch: int = 4
    video_tile_nms_iou: float = 0.5
    # tracking (lightweight IoU tracker over sampled frames → stable ids, approximate unique count)
    video_track_iou: float = 0.3
    video_track_max_age: int = 3
    video_track_dist_factor: float = 1.0  # also match when centres are closer than this × box size
    # annotated output video (boxes, ids and running count burned in) for playback in the control room
    video_output: bool = True
    video_output_long_px: int = 1280  # longest side of the output video / live preview
    video_ffmpeg_path: str | None = None  # default: ffmpeg on PATH, else the imageio-ffmpeg bundled binary

    # Abuse controls
    otp_per_hour: int = 5
    otp_ttl_seconds: int = 300
    open_reports_per_user: int = 3
    sighting_dedupe_seconds: int = 30

    # Routing
    walk_speed_kmh: float = 3.5
    accessible_walk_speed_kmh: float = 2.5

    # Privacy
    sighting_retention_days: int = 30


settings = Settings()
