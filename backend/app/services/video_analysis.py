"""Video-based crowd counting with tracking (verification tool for the crowd-monitoring pipeline).

An operator uploads a recorded video. Frames are sampled at `sample_fps`; each sampled frame is run through a
YOLOv8 person detector (COCO class 0). Dense or high-resolution footage (aerial 4K crowds) is detected
**tiled**: the frame is cut into overlapping tiles at native resolution, each tile is detected at full size and
the boxes are merged with non-maximum suppression. Downscaling a 4K frame to 640 px makes a person a few pixels
tall and the detector misses most of them; tiling fixes that.

Outputs per job (in <upload_dir>/video/<job>/):
  frames.json   per sampled frame: index, video frame, time, count, boxes [x1,y1,x2,y2,conf,track_id], infer ms
  fNNNNN.jpg    annotated stills (every `annotate_every`-th sampled frame)
  live.jpg      latest annotated frame while running (live preview)
  output.mp4    the whole clip with boxes, track ids and a running count burned in (H.264 via ffmpeg)

Track ids come from a lightweight IoU tracker over sampled frames; "unique people" from it is approximate and
is labelled as such. Counting for density = people per frame (occupancy).
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import statistics
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..config import settings
from ..db import SessionLocal
from ..models import VideoAnalysis

log = logging.getLogger("video")
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="video-analysis")
_cancel: set[int] = set()
_model_lock = threading.Lock()
_models: dict[str, Any] = {}
_model_info: dict[str, Any] = {}

BOX = (255, 196, 0)            # BGR: bright azure box, readable on any footage
BOX_TEXT = (255, 255, 255)
BANNER = (16, 26, 44)


# ----------------------------------------------------------------------------- environment
def ffmpeg_path() -> str | None:
    if settings.video_ffmpeg_path and os.path.exists(settings.video_ffmpeg_path):
        return settings.video_ffmpeg_path
    p = shutil.which("ffmpeg")
    if p:
        return p
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # noqa: BLE001
        return None


def available() -> dict[str, Any]:
    """Can we run detections? Does not load the model."""
    info: dict[str, Any] = {"available": False, "cuda": False, "device": "cpu", "model_path": settings.video_model_path, "ffmpeg": bool(ffmpeg_path())}
    try:
        import cv2  # noqa: F401
        import torch
        import ultralytics

        info.update({"available": True, "ultralytics": ultralytics.__version__, "torch": torch.__version__, "opencv": cv2.__version__, "cuda": bool(torch.cuda.is_available())})
        if info["cuda"]:
            info["device"] = torch.cuda.get_device_name(0)
    except Exception as e:  # noqa: BLE001
        info["error"] = f"{type(e).__name__}: {e}"
        info["install"] = "pip install -r backend/requirements-video.txt"
    info["model_loaded"] = bool(_models)
    info.update({k: v for k, v in _model_info.items() if k in ("model_name", "classes", "loaded_in_s")})
    return info


def _load_model(path: str | None = None):
    path = path or settings.video_model_path
    with _model_lock:
        if path not in _models:
            from ultralytics import YOLO

            t = time.time()
            _models[path] = YOLO(path)
            _model_info.update({"model_name": Path(path).name, "loaded_in_s": round(time.time() - t, 2), "classes": ["person"]})
            log.info("Loaded detector %s in %.1fs", path, time.time() - t)
    return _models[path]


def _device():
    import torch

    return 0 if torch.cuda.is_available() else "cpu"


# ----------------------------------------------------------------------------- detection
def tile_grid(w: int, h: int, tile: int, overlap: float) -> list[tuple[int, int]]:
    """Top-left corners of overlapping tiles covering a w×h frame."""
    step = max(1, int(tile * (1 - overlap)))
    xs = list(range(0, max(0, w - tile) + 1, step))
    ys = list(range(0, max(0, h - tile) + 1, step))
    if not xs or xs[-1] + tile < w:
        xs.append(max(0, w - tile))
    if not ys or ys[-1] + tile < h:
        ys.append(max(0, h - tile))
    return [(x, y) for y in sorted(set(ys)) for x in sorted(set(xs))]


def choose_mode(mode: str, w: int, h: int) -> tuple[str, int]:
    """Resolve 'auto' to standard or tiled; returns (mode, number_of_tiles)."""
    if mode == "auto":
        mode = settings.video_detection_mode
    if mode == "standard":
        return "standard", 1
    if mode == "tiled" or max(w, h) >= settings.video_auto_tile_min_px:
        return "tiled", len(tile_grid(w, h, settings.video_tile_px, settings.video_tile_overlap))
    return "standard", 1


def detect_persons(frame, conf: float, mode: str = "standard", model_path: str | None = None) -> list[list[float]]:
    """Return [[x1,y1,x2,y2,conf], ...] for persons in a BGR frame.

    standard: one pass at settings.video_imgsz.  tiled: native-resolution tiles merged with NMS.
    Module-level so tests can monkeypatch it without a model or a GPU.
    """
    model = _load_model(model_path)
    dev = _device()
    if mode != "tiled":
        res = model.predict(frame, classes=[0], conf=conf, imgsz=settings.video_imgsz, device=dev, verbose=False)[0]
        if res.boxes is None or not len(res.boxes):
            return []
        return [[round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1), round(c, 3)] for (x1, y1, x2, y2), c in zip(res.boxes.xyxy.tolist(), res.boxes.conf.tolist())]
    import torch
    from torchvision.ops import nms

    h, w = frame.shape[:2]
    T = min(settings.video_tile_px, max(w, h))
    grid = tile_grid(w, h, T, settings.video_tile_overlap)
    tiles = [frame[y:y + T, x:x + T] for x, y in grid]
    boxes, scores = [], []
    batch = max(1, settings.video_tile_batch)
    for i in range(0, len(tiles), batch):
        res = model.predict(tiles[i:i + batch], classes=[0], conf=conf, imgsz=T, device=dev, verbose=False)
        for r, (ox, oy) in zip(res, grid[i:i + batch]):
            if r.boxes is not None and len(r.boxes):
                b = r.boxes.xyxy.clone()
                b[:, [0, 2]] += ox
                b[:, [1, 3]] += oy
                boxes.append(b)
                scores.append(r.boxes.conf)
    if not boxes:
        return []
    b = torch.cat(boxes)
    s = torch.cat(scores)
    keep = nms(b, s, settings.video_tile_nms_iou)
    b, s = b[keep].tolist(), s[keep].tolist()
    return [[round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1), round(c, 3)] for (x1, y1, x2, y2), c in zip(b, s)]


# ----------------------------------------------------------------------------- tracking (lightweight IoU tracker)
def _iou(a: list[float], b: list[float]) -> float:
    ix1, iy1, ix2, iy2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    if inter <= 0:
        return 0.0
    ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / ua if ua > 0 else 0.0


class IouTracker:
    """Greedy association between consecutive sampled frames: by IoU first, then by centre distance relative to the
    box size (people move more than one box width between samples when the sample rate is low or the camera moves).
    Gives stable ids for display and an *approximate* unique-person count; not a substitute for a full multi-object
    tracker, and unreliable when the camera itself moves."""

    def __init__(self, iou_thresh: float = 0.3, max_age: int = 3, dist_factor: float = 1.0):
        self.iou_thresh, self.max_age, self.dist_factor = iou_thresh, max_age, dist_factor
        self.tracks: dict[int, tuple[list[float], int]] = {}  # id → (box, frames since last seen)
        self.next_id = 1
        self.seen: set[int] = set()

    @staticmethod
    def _score(tb: list[float], b: list[float], iou_thresh: float, dist_factor: float) -> float:
        v = _iou(tb, b)
        if v >= iou_thresh:
            return 1.0 + v
        size = 0.5 * ((tb[2] - tb[0] + tb[3] - tb[1]) / 2 + (b[2] - b[0] + b[3] - b[1]) / 2)
        d = (((tb[0] + tb[2]) - (b[0] + b[2])) ** 2 + ((tb[1] + tb[3]) - (b[1] + b[3])) ** 2) ** 0.5 / 2
        limit = dist_factor * size
        return (1.0 - d / limit) if (limit > 0 and d < limit) else 0.0

    def update(self, boxes: list[list[float]]) -> list[int]:
        ids = [0] * len(boxes)
        cands = []
        for tid, (tb, _) in self.tracks.items():
            for i, b in enumerate(boxes):
                sc = self._score(tb, b, self.iou_thresh, self.dist_factor)
                if sc > 0:
                    cands.append((sc, tid, i))
        cands.sort(reverse=True)
        matched_t, matched_b = set(), set()
        for sc, tid, i in cands:
            if tid in matched_t or i in matched_b:
                continue
            matched_t.add(tid)
            matched_b.add(i)
            ids[i] = tid
            self.tracks[tid] = (boxes[i], 0)
        for tid in list(self.tracks):
            if tid not in matched_t:
                b, age = self.tracks[tid]
                if age + 1 > self.max_age:
                    del self.tracks[tid]
                else:
                    self.tracks[tid] = (b, age + 1)
        for i, b in enumerate(boxes):
            if i not in matched_b:
                ids[i] = self.next_id
                self.tracks[self.next_id] = (b, 0)
                self.next_id += 1
        self.seen.update(ids)
        return ids


# ----------------------------------------------------------------------------- drawing
def draw(frame, boxes: list[list[float]], ids: list[int] | None, label: str, scale: float = 1.0):
    """Draw boxes (+ ids) and a banner on a copy of `frame` resized by `scale`."""
    import cv2

    img = cv2.resize(frame, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale != 1.0 else frame.copy()
    h, w = img.shape[:2]
    lw = max(1, int(round(min(w, h) / 500)))
    fs = max(0.35, min(w, h) / 1600)
    for k, b in enumerate(boxes):
        x1, y1, x2, y2 = (int(v * scale) for v in b[:4])
        cv2.rectangle(img, (x1, y1), (x2, y2), BOX, lw)
        if ids and ids[k]:
            tag = str(ids[k])
            (tw, th), _ = cv2.getTextSize(tag, cv2.FONT_HERSHEY_SIMPLEX, fs, 1)
            cv2.rectangle(img, (x1, max(0, y1 - th - 4)), (x1 + tw + 4, y1), BOX, -1)
            cv2.putText(img, tag, (x1 + 2, max(th + 1, y1 - 2)), cv2.FONT_HERSHEY_SIMPLEX, fs, (20, 20, 20), 1, cv2.LINE_AA)
    bfs = max(0.6, min(w, h) / 900)
    (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, bfs, 2)
    cv2.rectangle(img, (0, 0), (tw + 24, th + 20), BANNER, -1)
    cv2.putText(img, label, (12, th + 10), cv2.FONT_HERSHEY_SIMPLEX, bfs, BOX_TEXT, 2, cv2.LINE_AA)
    return img


class FfmpegWriter:
    """Pipe BGR frames to ffmpeg → H.264 MP4 (yuv420p, faststart) that browsers can play."""

    def __init__(self, path: Path, w: int, h: int, fps: float):
        exe = ffmpeg_path()
        if not exe:
            raise RuntimeError("ffmpeg not found")
        w, h = w - w % 2, h - h % 2
        self.size = (w, h)
        self.proc = subprocess.Popen(
            [exe, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}", "-r", f"{fps:.3f}", "-i", "-",
             "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(path)],
            stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        )

    def write(self, img) -> None:
        if img.shape[1] != self.size[0] or img.shape[0] != self.size[1]:
            img = img[: self.size[1], : self.size[0]]
        assert self.proc.stdin
        self.proc.stdin.write(img.tobytes())

    def close(self) -> None:
        if self.proc.stdin:
            self.proc.stdin.close()
        err = self.proc.stderr.read().decode(errors="ignore") if self.proc.stderr else ""
        if self.proc.wait() != 0:
            raise RuntimeError(f"ffmpeg failed: {err[-300:]}")


# ----------------------------------------------------------------------------- job lifecycle
def job_dir(job_id: int) -> Path:
    return Path(settings.upload_dir) / "video" / str(job_id)


def submit(job_id: int) -> None:
    _executor.submit(_run_safely, job_id)


def cancel(job_id: int) -> None:
    _cancel.add(job_id)


def _run_safely(job_id: int) -> None:
    try:
        _run(job_id)
    except Exception as e:  # noqa: BLE001 - recorded on the job
        log.exception("Video analysis %s failed", job_id)
        db = SessionLocal()
        try:
            job = db.get(VideoAnalysis, job_id)
            if job:
                job.status = "failed"
                job.error = f"{type(e).__name__}: {e}"[:1000]
                job.finished_at = datetime.now(timezone.utc)
                db.commit()
        finally:
            db.close()


def _run(job_id: int) -> None:
    import cv2

    db = SessionLocal()
    writer: FfmpegWriter | None = None
    try:
        job = db.get(VideoAnalysis, job_id)
        if not job or job.status == "cancelled":
            return
        job.status = "running"
        job.started_at = datetime.now(timezone.utc)
        env = available()
        job.device = env.get("device", "cpu")
        job.model_name = Path(settings.video_model_path).name
        db.commit()

        cap = cv2.VideoCapture(job.path)
        if not cap.isOpened():
            raise RuntimeError("Could not open video (unsupported codec or corrupt file)")
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        width, height = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        duration = total / fps if fps else 0.0
        max_frames = int(min(total, settings.video_max_seconds * fps)) if total else int(settings.video_max_seconds * fps)
        step = max(1, int(round(fps / job.sample_fps)))
        expected = max(1, max_frames // step)
        mode, n_tiles = choose_mode(job.detection_mode or "auto", width, height)
        job.detection_mode, job.tiles = mode, n_tiles
        job.video_fps, job.video_frames, job.video_width, job.video_height, job.video_duration_s = round(fps, 3), total, width, height, round(duration, 2)
        job.frames_expected = expected
        db.commit()

        out = job_dir(job_id)
        out.mkdir(parents=True, exist_ok=True)
        out_scale = min(1.0, settings.video_output_long_px / max(width, height))
        ow, oh = int(width * out_scale), int(height * out_scale)
        if settings.video_output and ffmpeg_path():
            try:
                writer = FfmpegWriter(out / "output.mp4", ow, oh, min(fps, 30.0))
            except Exception as e:  # noqa: BLE001
                log.warning("No annotated video for job %s: %s", job_id, e)
                writer = None
        tracker = IouTracker(iou_thresh=settings.video_track_iou, max_age=settings.video_track_max_age, dist_factor=settings.video_track_dist_factor)
        frames: list[dict[str, Any]] = []
        annotated = 0
        i = 0
        t0 = time.time()
        last_commit = t0
        cur_boxes: list[list[float]] = []
        cur_ids: list[int] = []
        cur_label = "analysing…"
        # write every original frame to the output (boxes held between samples) for smooth playback
        write_every = max(1, int(round(fps / 30.0)))
        while i < max_frames:
            ok, frame = cap.read()
            if not ok:
                break
            if i % step == 0:
                if job_id in _cancel:
                    job.status = "cancelled"
                    job.finished_at = datetime.now(timezone.utc)
                    db.commit()
                    _cancel.discard(job_id)
                    return
                t1 = time.time()
                cur_boxes = detect_persons(frame, job.confidence, mode)
                infer_ms = round((time.time() - t1) * 1000, 1)
                cur_ids = tracker.update(cur_boxes)
                n = len(cur_boxes)
                ts = round(i / fps, 3)
                cur_label = f"t={ts:.1f}s   people in frame: {n}   unique so far: {len(tracker.seen)}"
                rec: dict[str, Any] = {"index": len(frames), "frame": i, "t": ts, "count": n, "unique_so_far": len(tracker.seen), "infer_ms": infer_ms,
                                       "boxes": [b + [tid] for b, tid in zip(cur_boxes, cur_ids)]}
                img = draw(frame, cur_boxes, cur_ids, cur_label, out_scale)
                cv2.imwrite(str(out / "live.jpg"), img if max(ow, oh) <= 1280 else cv2.resize(img, None, fx=1280 / max(ow, oh), fy=1280 / max(ow, oh)), [int(cv2.IMWRITE_JPEG_QUALITY), 70])
                if len(frames) % settings.video_annotate_every == 0 and annotated < settings.video_max_annotated:
                    name = f"f{len(frames):05d}.jpg"
                    cv2.imwrite(str(out / name), img, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
                    rec["image"] = name
                    annotated += 1
                frames.append(rec)
                job.frames_processed = len(frames)
                job.last_count = n
                job.unique_tracks = len(tracker.seen)
                if time.time() - last_commit > 1.0:
                    db.commit()
                    last_commit = time.time()
                if writer:
                    writer.write(img)
            elif writer and i % write_every == 0:
                writer.write(draw(frame, cur_boxes, cur_ids, cur_label, out_scale))
            i += 1
        cap.release()
        if writer:
            writer.close()
            job.output_video = True
        counts = [f["count"] for f in frames]
        if not counts:
            raise RuntimeError("No frames could be decoded from the video")
        (out / "frames.json").write_text(json.dumps(frames), encoding="utf-8")
        peak = max(range(len(counts)), key=lambda k: counts[k])
        job.summary = {
            "frames_sampled": len(counts), "sample_fps": job.sample_fps, "confidence": job.confidence, "detection_mode": mode, "tiles": n_tiles,
            "count_max": max(counts), "count_min": min(counts), "count_mean": round(statistics.fmean(counts), 2),
            "count_median": statistics.median(counts), "count_p95": sorted(counts)[min(len(counts) - 1, int(0.95 * len(counts)))],
            "peak_t": frames[peak]["t"], "peak_frame": frames[peak]["frame"], "peak_image": frames[peak].get("image"),
            "detections_total": sum(counts), "unique_tracks": len(tracker.seen), "infer_ms_median": statistics.median(f["infer_ms"] for f in frames),
            "processing_s": round(time.time() - t0, 2), "annotated_frames": annotated, "output_video": bool(writer),
            "output_size": [ow, oh] if writer else None,
            "analysed_seconds": round(min(duration, settings.video_max_seconds), 2) if duration else None,
            "truncated": bool(total and max_frames < total),
        }
        job.status = "done"
        job.finished_at = datetime.now(timezone.utc)
        db.commit()
        log.info("Video analysis %s done (%s, %d tiles): %d frames, max %d, mean %.1f, unique≈%d, %.1fs", job_id, mode, n_tiles, len(counts), max(counts), job.summary["count_mean"], len(tracker.seen), job.summary["processing_s"])
    finally:
        if writer and writer.proc.poll() is None:
            try:
                writer.proc.kill()
            except Exception:  # noqa: BLE001
                pass
        db.close()


def load_frames(job_id: int) -> list[dict[str, Any]]:
    p = job_dir(job_id) / "frames.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else []


def remove_files(job_id: int) -> None:
    d = job_dir(job_id)
    if d.exists():
        shutil.rmtree(d, ignore_errors=True)
    db = SessionLocal()
    try:
        job = db.get(VideoAnalysis, job_id)
        if job and job.path and os.path.exists(job.path):
            os.remove(job.path)
    finally:
        db.close()
