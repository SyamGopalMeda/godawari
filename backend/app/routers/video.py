"""Video crowd-count verification API (staff and admin).

POST   /crowd/video/analyses              upload a video → queued job (multipart: file, location_id?, sample_fps?, confidence?, note?)
GET    /crowd/video/analyses              list jobs (newest first)
GET    /crowd/video/analyses/{id}         job + progress + summary
GET    /crowd/video/analyses/{id}/frames  per-frame counts and boxes (JSON) ; ?format=csv for a spreadsheet
GET    /crowd/video/analyses/{id}/frames/{name}   annotated JPEG
GET    /crowd/video/analyses/{id}/live.jpg  latest annotated frame while the job runs (live preview)
GET    /crowd/video/analyses/{id}/video     annotated output video (H.264 MP4, boxes + track ids + running count)
POST   /crowd/video/analyses/{id}/cancel
POST   /crowd/video/analyses/{id}/publish  push a statistic into the crowd-reading pipeline (source="video")
DELETE /crowd/video/analyses/{id}          delete job, video and frames
GET    /crowd/video/health                 detector availability, versions, device
"""
from __future__ import annotations

import csv
import io
import os
import re
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import audit, require_role
from ..models import Location, User, VideoAnalysis
from ..schemas import VideoAnalysisOut, VideoPublishIn
from ..services import cache, video_analysis as va
from ..services.crowd import publish_status, record_reading

router = APIRouter(prefix="/crowd/video", tags=["video-verification"])
ALLOWED_EXT = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"}


@router.get("/health")
def health(_: User = Depends(require_role("volunteer"))):
    env = va.available()
    env["limits"] = {"max_mb": settings.video_max_mb, "max_seconds": settings.video_max_seconds, "default_sample_fps": settings.video_sample_fps, "imgsz": settings.video_imgsz}
    env["tiling"] = {"default_mode": settings.video_detection_mode, "auto_min_px": settings.video_auto_tile_min_px, "tile_px": settings.video_tile_px, "overlap": settings.video_tile_overlap}
    env["output_video"] = bool(settings.video_output and env.get("ffmpeg"))
    return env


@router.post("/analyses", response_model=VideoAnalysisOut, status_code=202)
async def create_analysis(
    request: Request,
    file: UploadFile = File(...),
    location_id: int | None = Form(default=None),
    sample_fps: float = Form(default=None),
    confidence: float = Form(default=0.35),
    detection_mode: str = Form(default="auto"),
    note: str | None = Form(default=None, max_length=255),
    db: Session = Depends(get_db),
    user: User = Depends(require_role("staff")),
):
    env = va.available()
    if not env["available"]:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, f"Video analysis is not installed on this server: {env.get('error')}. {env.get('install')}")
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, f"Unsupported video type {ext or '(none)'}; use {', '.join(sorted(ALLOWED_EXT))}")
    if not (0.05 <= confidence <= 0.95):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "confidence must be between 0.05 and 0.95")
    sample_fps = sample_fps or settings.video_sample_fps
    if not (0.1 <= sample_fps <= 30):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "sample_fps must be between 0.1 and 30")
    if detection_mode not in ("auto", "standard", "tiled"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "detection_mode must be auto, standard or tiled")
    if location_id is not None and not db.get(Location, location_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Location not found")

    folder = os.path.join(settings.upload_dir, "video")
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, f"{secrets.token_hex(8)}{ext}")
    limit = settings.video_max_mb * 1024 * 1024
    size = 0
    with open(path, "wb") as fh:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > limit:
                fh.close()
                os.remove(path)
                raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"Video larger than {settings.video_max_mb} MB")
            fh.write(chunk)
    job = VideoAnalysis(
        created_by=user.id, location_id=location_id, filename=re.sub(r"[^\w.\- ]", "_", file.filename or "video")[:255], path=path, size_bytes=size,
        sample_fps=sample_fps, confidence=confidence, note=note, detection_mode=detection_mode,
    )
    db.add(job)
    db.flush()
    audit(db, "video.analysis.create", actor=user, entity="video_analysis", entity_id=job.id, purpose=f"{job.filename} {size} bytes", request=request)
    db.commit()
    va.submit(job.id)
    return job


@router.get("/analyses", response_model=list[VideoAnalysisOut])
def list_analyses(db: Session = Depends(get_db), _: User = Depends(require_role("volunteer")), limit: int = 50):
    return db.scalars(select(VideoAnalysis).order_by(VideoAnalysis.created_at.desc()).limit(min(limit, 200))).all()


def _get(db: Session, job_id: int) -> VideoAnalysis:
    job = db.get(VideoAnalysis, job_id)
    if not job:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Analysis not found")
    return job


@router.get("/analyses/{job_id}", response_model=VideoAnalysisOut)
def get_analysis(job_id: int, db: Session = Depends(get_db), _: User = Depends(require_role("volunteer"))):
    return _get(db, job_id)


@router.get("/analyses/{job_id}/frames")
def get_frames(job_id: int, db: Session = Depends(get_db), _: User = Depends(require_role("volunteer")), format: str = "json", boxes: bool = False):
    job = _get(db, job_id)
    frames = va.load_frames(job.id)
    if format == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["index", "frame", "t_seconds", "count", "infer_ms", "image"])
        for f in frames:
            w.writerow([f["index"], f["frame"], f["t"], f["count"], f["infer_ms"], f.get("image", "")])
        return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="video-analysis-{job.id}.csv"'})
    if not boxes:
        frames = [{k: v for k, v in f.items() if k != "boxes"} | {"detections": len(f.get("boxes", []))} for f in frames]
    return {"job_id": job.id, "status": job.status, "frames": frames}


@router.get("/analyses/{job_id}/frames/{name}")
def get_frame_image(job_id: int, name: str, db: Session = Depends(get_db), _: User = Depends(require_role("volunteer"))):
    job = _get(db, job_id)
    if not re.fullmatch(r"f\d{5}\.jpg", name):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Frame not found")
    p = va.job_dir(job.id) / name
    if not p.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Frame not found")
    return FileResponse(p, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


@router.get("/analyses/{job_id}/live.jpg")
def get_live_frame(job_id: int, db: Session = Depends(get_db), _: User = Depends(require_role("volunteer"))):
    """Latest annotated frame of a running (or finished) job. Not cached: the page polls it for a live preview."""
    job = _get(db, job_id)
    p = va.job_dir(job.id) / "live.jpg"
    if not p.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No frame analysed yet")
    return FileResponse(p, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@router.get("/analyses/{job_id}/video")
def get_output_video(job_id: int, db: Session = Depends(get_db), _: User = Depends(require_role("volunteer"))):
    """Annotated output video (H.264 MP4). FileResponse honours Range requests, so the player can seek."""
    job = _get(db, job_id)
    p = va.job_dir(job.id) / "output.mp4"
    if job.status != "done" or not p.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No annotated video for this analysis")
    return FileResponse(p, media_type="video/mp4", headers={"Cache-Control": "private, max-age=3600", "Content-Disposition": f'inline; filename="video-analysis-{job.id}-annotated.mp4"'})


@router.post("/analyses/{job_id}/cancel", response_model=VideoAnalysisOut)
def cancel_analysis(job_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("staff"))):
    job = _get(db, job_id)
    if job.status in ("queued", "running"):
        va.cancel(job.id)
        if job.status == "queued":
            job.status = "cancelled"
            job.finished_at = datetime.now(timezone.utc)
        audit(db, "video.analysis.cancel", actor=user, entity="video_analysis", entity_id=job.id)
        db.commit()
    return job


@router.post("/analyses/{job_id}/publish", response_model=VideoAnalysisOut)
def publish_analysis(job_id: int, body: VideoPublishIn, request: Request, db: Session = Depends(get_db), user: User = Depends(require_role("staff"))):
    """Push the analysed count into the crowd-reading pipeline exactly as a camera device would, but with
    source="video" so the app labels it as a recorded-video verification, not a live feed."""
    job = _get(db, job_id)
    if job.status != "done" or not job.summary:
        raise HTTPException(status.HTTP_409_CONFLICT, "Analysis has not finished")
    loc = db.get(Location, body.location_id)
    if not loc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Location not found")
    value = {"max": job.summary["count_max"], "mean": job.summary["count_mean"], "p95": job.summary["count_p95"], "median": job.summary["count_median"]}[body.statistic]
    reading = record_reading(db, loc, int(round(value)), "video", user_id=user.id)
    db.flush()
    job.published_reading_id = reading.id
    job.location_id = loc.id
    audit(db, "video.analysis.publish", actor=user, entity="location", entity_id=loc.id, purpose=f"analysis {job.id} {body.statistic}={value} {body.note or ''}"[:250], request=request)
    db.commit()
    cache.invalidate("crowd:")
    cache.invalidate("locations:")
    publish_status(loc)
    return job


@router.delete("/analyses/{job_id}", status_code=204)
def delete_analysis(job_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("staff"))):
    job = _get(db, job_id)
    if job.status in ("queued", "running"):
        va.cancel(job.id)
    va.remove_files(job.id)
    audit(db, "video.analysis.delete", actor=user, entity="video_analysis", entity_id=job.id)
    db.delete(job)
    db.commit()
