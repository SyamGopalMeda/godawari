"""Video crowd-count verification: upload → sampled detection → per-frame results → publish into the crowd pipeline.

The detector is stubbed (no model download, no GPU) so the pipeline itself is what is tested; the real detector is
exercised by the manual end-to-end run documented in docs/12-video-crowd-count-verification.md.
"""
import io
import json
import time

import numpy as np
import pytest

from app.services import video_analysis as va

cv2 = pytest.importorskip("cv2")


def _synthetic_video(path: str, frames: int = 40, fps: float = 10.0, size=(96, 64)) -> None:
    w = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), fps, size)
    for i in range(frames):
        img = np.zeros((size[1], size[0], 3), dtype=np.uint8)
        cv2.rectangle(img, (i % 60, 10), (i % 60 + 20, 50), (40, 200, 40), -1)
        w.write(img)
    w.release()


class _FakeResult:
    def plot(self, **_):
        return np.zeros((64, 96, 3), dtype=np.uint8)


@pytest.fixture
def stub_detector(monkeypatch):
    """Counts grow with time so the summary statistics are checkable: frame k → k % 4 people."""
    calls = {"n": 0}

    def fake(frame, conf, mode="standard", model_path=None):
        k = calls["n"]
        calls["n"] += 1
        calls["mode"] = mode
        # distinct, stable boxes so the IoU tracker can follow them between frames
        return [[1.0 + 30 * i, 2.0, 20.0 + 30 * i, 40.0, 0.9] for i in range(k % 4)]

    monkeypatch.setattr(va, "detect_persons", fake)
    monkeypatch.setattr(va, "available", lambda: {"available": True, "cuda": False, "device": "cpu", "model_loaded": True})
    return calls


def _wait(client, headers, job_id, timeout=60):
    t0 = time.time()
    while time.time() - t0 < timeout:
        j = client.get(f"/api/v1/crowd/video/analyses/{job_id}", headers=headers).json()
        if j["status"] in ("done", "failed", "cancelled"):
            return j
        time.sleep(0.2)
    raise AssertionError("analysis did not finish")


def test_health_reports_detector_environment(client, staff, pilgrim):
    h, _ = pilgrim
    assert client.get("/api/v1/crowd/video/health", headers=h).status_code == 403
    r = client.get("/api/v1/crowd/video/health", headers=staff)
    assert r.status_code == 200
    body = r.json()
    assert "available" in body and body["limits"]["max_mb"] > 0


def test_upload_validation(client, staff, pilgrim, stub_detector):
    h, _ = pilgrim
    r = client.post("/api/v1/crowd/video/analyses", files={"file": ("x.mp4", io.BytesIO(b"000"), "video/mp4")}, headers=h)
    assert r.status_code == 403
    r = client.post("/api/v1/crowd/video/analyses", files={"file": ("notes.txt", io.BytesIO(b"000"), "text/plain")}, headers=staff)
    assert r.status_code == 415
    r = client.post("/api/v1/crowd/video/analyses", files={"file": ("x.mp4", io.BytesIO(b"000"), "video/mp4")}, data={"confidence": "2"}, headers=staff)
    assert r.status_code == 422
    r = client.post("/api/v1/crowd/video/analyses", files={"file": ("x.mp4", io.BytesIO(b"000"), "video/mp4")}, data={"location_id": "999999"}, headers=staff)
    assert r.status_code == 404


def test_corrupt_video_fails_cleanly(client, staff, stub_detector):
    r = client.post("/api/v1/crowd/video/analyses", files={"file": ("bad.mp4", io.BytesIO(b"not a video"), "video/mp4")}, headers=staff)
    assert r.status_code == 202
    j = _wait(client, staff, r.json()["id"])
    assert j["status"] == "failed" and j["error"]


def test_full_pipeline_sampled_counts_frames_csv_images_and_publish(client, staff, admin, locations, tmp_path, stub_detector):
    path = str(tmp_path / "crowd.mp4")
    _synthetic_video(path, frames=40, fps=10.0)
    with open(path, "rb") as fh:
        r = client.post("/api/v1/crowd/video/analyses", files={"file": ("crowd.mp4", fh, "video/mp4")}, data={"sample_fps": "2", "confidence": "0.4", "note": "pipeline test"}, headers=staff)
    assert r.status_code == 202, r.text
    job = r.json()
    assert job["status"] == "queued" and job["sample_fps"] == 2 and job["confidence"] == 0.4 and job["note"] == "pipeline test"
    j = _wait(client, staff, job["id"])
    assert j["status"] == "done", j.get("error")
    # 40 frames @10 fps sampled at 2 fps → every 5th frame → 8 samples; stub gives counts 0,1,2,3,0,1,2,3
    s = j["summary"]
    assert j["video_frames"] == 40 and j["frames_processed"] == 8 and s["frames_sampled"] == 8
    assert s["count_max"] == 3 and s["count_min"] == 0 and s["count_mean"] == 1.5 and s["count_median"] == 1.5
    assert s["peak_t"] == 1.5 and s["annotated_frames"] >= 1 and s["processing_s"] >= 0
    assert j["video_width"] == 96 and j["video_height"] == 64 and j["device"] == "cpu"
    assert j["detection_mode"] == "standard" and j["tiles"] == 1 and stub_detector["mode"] == "standard"  # 96 px frame → no tiling
    assert j["last_count"] == 3 and j["unique_tracks"] == s["unique_tracks"] and 3 <= s["unique_tracks"] <= 8
    assert s["detection_mode"] == "standard"
    # live preview and annotated video
    r = client.get(f"/api/v1/crowd/video/analyses/{job['id']}/live.jpg", headers=staff)
    assert r.status_code == 200 and r.content[:2] == b"\xff\xd8"
    if va.ffmpeg_path():
        assert j["output_video"] is True and s["output_video"] is True
        r = client.get(f"/api/v1/crowd/video/analyses/{job['id']}/video", headers=staff)
        assert r.status_code == 200 and r.headers["content-type"] == "video/mp4" and len(r.content) > 500
        r = client.get(f"/api/v1/crowd/video/analyses/{job['id']}/video", headers=staff | {"Range": "bytes=0-99"})
        assert r.status_code == 206 and len(r.content) == 100
    else:
        assert j["output_video"] is False

    frames = client.get(f"/api/v1/crowd/video/analyses/{job['id']}/frames", headers=staff).json()["frames"]
    assert [f["count"] for f in frames] == [0, 1, 2, 3, 0, 1, 2, 3]
    assert [f["frame"] for f in frames] == [0, 5, 10, 15, 20, 25, 30, 35] and frames[1]["t"] == 0.5
    assert "boxes" not in frames[0] and frames[3]["detections"] == 3
    with_boxes = client.get(f"/api/v1/crowd/video/analyses/{job['id']}/frames", params={"boxes": "true"}, headers=staff).json()["frames"]
    assert len(with_boxes[3]["boxes"]) == 3 and with_boxes[3]["boxes"][0][4] == 0.9 and isinstance(with_boxes[3]["boxes"][0][5], int)  # track id
    csv_text = client.get(f"/api/v1/crowd/video/analyses/{job['id']}/frames", params={"format": "csv"}, headers=staff).text
    assert csv_text.splitlines()[0] == "index,frame,t_seconds,count,infer_ms,image" and len(csv_text.splitlines()) == 9

    img_name = next(f["image"] for f in frames if f.get("image"))
    r = client.get(f"/api/v1/crowd/video/analyses/{job['id']}/frames/{img_name}", headers=staff)
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg" and r.content[:2] == b"\xff\xd8"
    assert client.get(f"/api/v1/crowd/video/analyses/{job["id"]}/frames/..%2F..%2Fetc", headers=staff).status_code in (404, 422)  # traversal rejected

    # publish p95 into the crowd pipeline, labelled as a recorded-video source
    loc = locations["GHAT-GOWTHAMI"]
    r = client.post(f"/api/v1/crowd/video/analyses/{job['id']}/publish", json={"location_id": loc["id"], "statistic": "max", "note": "verification"}, headers=staff)
    assert r.status_code == 200 and r.json()["published_reading_id"] and r.json()["location_id"] == loc["id"]
    st = next(x for x in client.get("/api/v1/crowd/status").json() if x["location_id"] == loc["id"])
    assert st["current_count"] == 3 and st["source"] == "video"
    hist = client.get(f"/api/v1/crowd/{loc['id']}/history").json()
    assert hist[-1]["source"] == "video" and hist[-1]["count"] == 3
    audit = client.get("/api/v1/admin/audit", params={"action": "video.analysis"}, headers=admin).json()
    assert {a["action"] for a in audit} >= {"video.analysis.create", "video.analysis.publish"}

    # delete removes files and record
    assert client.delete(f"/api/v1/crowd/video/analyses/{job['id']}", headers=staff).status_code == 204
    assert client.get(f"/api/v1/crowd/video/analyses/{job['id']}", headers=staff).status_code == 404
    assert not va.job_dir(job["id"]).exists()


def test_publish_requires_finished_job(client, staff, locations, stub_detector):
    r = client.post("/api/v1/crowd/video/analyses", files={"file": ("bad.mp4", io.BytesIO(b"x"), "video/mp4")}, headers=staff)
    jid = r.json()["id"]
    _wait(client, staff, jid)
    r = client.post(f"/api/v1/crowd/video/analyses/{jid}/publish", json={"location_id": locations["GHAT-GOWTHAMI"]["id"]}, headers=staff)
    assert r.status_code == 409


def test_video_source_accepted_by_device_reading_endpoint(client, staff, locations):
    """A future live camera pipeline may also post 'video' readings; the enum accepts it."""
    r = client.post("/api/v1/crowd/readings", json={"location_code": "GATE-D", "count": 12, "source": "video"}, headers=staff)
    assert r.status_code == 202 and r.json()["status"][0]["source"] == "video"


def test_frames_json_persisted(tmp_path, monkeypatch):
    monkeypatch.setattr(va, "job_dir", lambda jid: tmp_path / str(jid))
    (tmp_path / "7").mkdir()
    (tmp_path / "7" / "frames.json").write_text(json.dumps([{"index": 0, "count": 2}]))
    assert va.load_frames(7)[0]["count"] == 2 and va.load_frames(8) == []


def test_detection_mode_validation_and_tiling_helpers(client, staff, stub_detector):
    r = client.post("/api/v1/crowd/video/analyses", files={"file": ("x.mp4", io.BytesIO(b"000"), "video/mp4")}, data={"detection_mode": "huge"}, headers=staff)
    assert r.status_code == 422
    # tile grid covers the frame with overlap and never leaves the edge uncovered
    grid = va.tile_grid(3840, 2160, 1280, 0.2)
    assert (0, 0) in grid and (3840 - 1280, 2160 - 1280) in grid and len(grid) == 8
    assert va.choose_mode("auto", 1280, 720) == ("standard", 1) and va.choose_mode("auto", 1920, 1080) == ("tiled", 2)
    assert va.choose_mode("auto", 2160, 3840)[0] == "tiled" and va.choose_mode("tiled", 640, 480) == ("tiled", 1)
    assert va.choose_mode("standard", 4000, 3000) == ("standard", 1)
    # IoU tracker keeps ids for overlapping boxes and assigns new ids to new ones
    t = va.IouTracker()
    a = t.update([[0, 0, 10, 10], [50, 50, 60, 60]])
    b = t.update([[1, 1, 11, 11], [100, 100, 110, 110]])
    assert a == [1, 2] and b == [1, 3] and t.seen == {1, 2, 3}
    h = client.get("/api/v1/crowd/video/health", headers=staff).json()
    assert h["tiling"]["tile_px"] > 0 and "output_video" in h
