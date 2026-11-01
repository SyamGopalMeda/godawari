# 12. Video Crowd-Count Verification (temporary tool)

A control-room tool to verify the crowd-counting chain before live camera feeds are connected: upload a recorded clip, run the same person detector the camera pipeline will use, inspect per-frame counts and annotated frames, and optionally push the result through the live crowd-reading path.

It is deliberately **not** a live feed. Readings it produces carry `source = "video"` and are labelled "Recorded-video check" to pilgrims and staff, never "Live".

## 12.1 What it does

| Step | Detail |
|---|---|
| Upload | Staff or admin upload an MP4, MOV, AVI, MKV or WebM clip (default limit 300 MB; first 10 minutes analysed). Optional link to a ghat or gate, sample rate, confidence threshold, note. |
| Detection | Frames are sampled at `sample_fps` (default 2 per second). Each sampled frame runs through **YOLOv8n** (ultralytics, COCO class 0 "person"). **Standard** mode is one pass at 640 px. **Tiled** mode cuts the frame into overlapping 1280 px tiles at native resolution, detects each tile at full size and merges the boxes with non-maximum suppression; **Auto** (default) uses tiled mode when the long side is 1600 px or more. The count per frame is the number of person detections above the confidence threshold. |
| Tracking | A lightweight tracker (IoU, then centre distance relative to box size) links detections between sampled frames to give stable ids and an **approximate** "distinct people tracked" figure. It is labelled approximate everywhere: it degrades with low sample rates and with a moving camera. |
| Live analysis | While the job runs, the page polls the latest annotated frame (`live.jpg`) every second and shows the count in the latest frame, distinct people so far, progress and the detection mode. |
| Annotated video | Every source frame (thinned to at most about 30 fps for clips above that rate; boxes held between samples) is written with boxes, track ids and a running count banner to `output.mp4` (H.264, yuv420p, faststart, long side 1280 px) through ffmpeg at the matching frame rate, so the control room can play it in the browser with the count synced to playback. Without ffmpeg the page falls back to a still-frame scrubber. |
| Results | Per-frame: video frame index, timestamp, count, distinct-so-far, inference time, bounding boxes with confidence and track id. Summary: peak, 95th percentile, mean, median, minimum, peak time, detections total, unique tracks, detection mode and tile count, median inference time, processing time, output size, device, model. Every 5th sampled frame (up to 120) is saved as an annotated JPEG. |
| Review | The admin page shows detector status (tiling and ffmpeg availability), the live analysis card while running, KPI tiles, the tracking playback card (video player, synced count readout, "jump to peak", click-to-seek count chart), the annotated-stills gallery with zoom, a frame-by-frame table, and CSV / JSON downloads. |
| Pipeline check | "Send through the crowd pipeline" records the chosen statistic (p95 by default) as a crowd reading for a location via the same `record_reading` function real devices use, broadcasts the WebSocket update, then reads `/crowd/status` back and reports the count, source and time it sees. |

Counting is **occupancy per frame**, which is what density levels need and what gets published. The distinct-people figure is for the operator's intuition only and is never published as a reading.

## 12.2 Verified end-to-end run (2026-10-31)

Clip: a public stock video of a crowded hall (1920×1080, 25 fps, 13.6 s) from the earlier trail-3 uploads. Hardware: laptop with an NVIDIA GeForce MX550.

| Metric | Value |
|---|---|
| Frames sampled | 29 (2 per second) |
| People per frame | min 23 · median 28 · mean 27.5 · p95 33 · max 34 (at 2.4 s) |
| Detection time | 12.9 ms median per frame on the GPU (first frame includes CUDA warm-up); 45.8 ms when two instances shared the GPU |
| Total processing | 9.1 s for the whole clip |
| Model | yolov8n.pt (downloaded by ultralytics on first use, 6.2 MB) |

Pipeline check: publishing the p95 (33) to the demo ghat "Gowthami Ghat" created crowd reading #64; `/crowd/status` then showed count 33, source `video`, timestamp of the reading, and the history endpoint recorded it. The frontend labels that reading "Recorded-video check".

Visual check of the first annotated frame (29 detections): the detector finds almost every walking person. It misses two or three people standing in a tight group and one person cut off at the frame edge. This under-count in dense clusters is a known limit of the nano model and is the reason the pipeline uses safe-capacity ratios with margins rather than exact head counts. For dense ghat crowds, evaluate the medium model (`yolov8m.pt`) or a crowd-density model once real camera footage is available.

Two earlier "test videos" in trail 3 were synthetic animations of green dots; the detector correctly found zero people in them. That is correct behaviour, not a failure.

### Dense 4K aerial footage (2026-10-31)

A user-supplied aerial clip (2160×3840 portrait, 31.6 fps, 9.2 s, 291 frames) of a dense crowd first gave **max 7 / mean 2.2 people**, which was wrong: at 640 px a person in that frame is a few pixels tall. Measurements on one frame of the clip, GPU MX550:

| Method | People found | Time per frame |
|---|---|---|
| One pass at 640 px (old default) | 6 | 4.4 s incl. warm-up (about 45 ms steady) |
| One pass at 1280 px | 107 | 44 ms |
| One pass at 1920 px | 151 | 307 ms |
| **Tiled, 1280 px tiles, 20 % overlap, 8 tiles (new auto default)** | **194** before border de-duplication, **153** after | 517 ms |
| Tiled, 960 px tiles, 15 tiles | 201 | 2.97 s |
| Tiled 1280 px with yolov8s | 201 | 1.2 s |

Full re-run of the clip in auto (tiled) mode, 2 samples per second, after the review fixes: 19 frames, **min 146 · mean 160 · p95 179 · max 179** people per frame, 570 ms detection per frame, 43 s total including the annotated 720×1280 H.264 output (9.21 s, same length as the source). Distinct people tracked about 382 (approximate; the drone camera moves and the sample rate is 2/s).

**Tile-border duplicates.** A first version of tiling reported about 190 per frame (max 211). Inspection showed that a person cut by a tile border was detected twice: once as a half-body sliver in one tile and once whole in the neighbouring tile. The two boxes overlap by less than the NMS threshold, so both were counted. On frame 100, 27 boxes were such slivers (all on tile borders, each next to the full box of the same person). The merge now drops a border-touching box when a larger box covers at least 70 % of it; an independent check (drop border boxes that another tile sees whole) gives the same result within 2 to 6 people per frame. Boxes that do not touch a tile border are never dropped, so people standing in front of each other are kept.

Remaining limits: people hidden under umbrellas or canopies, or fully overlapped, are still missed; the nano model saturates in very dense clusters. For ghat cameras evaluate `yolov8m.pt` or a crowd-density (head-count) model on real footage.

Screenshots: `docs/screenshots/video-tracking-desktop.png`, `video-tracking-mobile.png`.

## 12.3 API

All endpoints require a staff or admin login (`volunteer` can read).

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/crowd/video/health` | detector availability, versions, device, limits |
| POST | `/api/v1/crowd/video/analyses` | multipart `file`, optional `location_id`, `sample_fps`, `confidence`, `detection_mode` (auto, standard or tiled), `note` → 202 with the queued job |
| GET | `/api/v1/crowd/video/analyses` | list, newest first |
| GET | `/api/v1/crowd/video/analyses/{id}` | job, progress (`frames_processed / frames_expected`), summary |
| GET | `/api/v1/crowd/video/analyses/{id}/frames` | per-frame counts; `?boxes=true` includes boxes; `?format=csv` downloads a spreadsheet |
| GET | `/api/v1/crowd/video/analyses/{id}/frames/{name}` | annotated JPEG |
| GET | `/api/v1/crowd/video/analyses/{id}/live.jpg` | latest annotated frame while running (no-store; polled by the live card) |
| GET | `/api/v1/crowd/video/analyses/{id}/video` | annotated H.264 MP4 (supports Range requests for seeking and streaming) |
| POST | `/api/v1/crowd/video/analyses/{id}/media-token` | short-lived token (default 60 min) scoped to one job; the media routes above accept `?t=<token>` so the browser's `<video>` can stream with Range requests instead of downloading the whole file into memory |
| POST | `/api/v1/crowd/video/analyses/{id}/cancel` | queued: cancelled at once; running: `cancelling`, then `cancelled` at the next analysed frame (files released, partial video removed) |
| POST | `/api/v1/crowd/video/analyses/{id}/publish` | `{location_id, statistic: max|mean|p95|median, note}` → crowd reading with source `video` |
| DELETE | `/api/v1/crowd/video/analyses/{id}` | delete job, video file and frames; **409 while running** (cancel first) |

Jobs run on one worker thread per API process, so one video is processed at a time. Stop requests (cancel, shutdown) are read from the job's database row at every analysed frame, so a stale request can never hit a later upload, and SQLite never reuses a deleted job id. On start-up, jobs left `running` by a previous process are marked failed ("Interrupted by an API restart") and `queued` jobs are re-submitted. Run the API as a single process per database (`--workers 1`, as the Dockerfile does). Uploads larger than `VIDEO_MAX_MB` are refused with 413 while the body is still arriving, before it is spooled to disk. Progress is stored in the database and polled by the page every second (the live card fetches live.jpg on the same cadence). Every create, cancel, publish and delete is written to the audit log.

## 12.4 Installation

The detector stack is optional so the base API stays small.

```bash
cd backend
pip install -r requirements-video.txt      # ultralytics, opencv-python-headless, torch
# GPU: install the CUDA build of torch for your driver first (https://pytorch.org/get-started/locally/)
```

Install torch **and torchvision together from the same PyTorch index** (for example `pip install torch torchvision --index-url https://download.pytorch.org/whl/cu126`, or `.../whl/cpu`) before `pip install -r requirements-video.txt`. A torchvision from a different index cannot load its compiled ops, and tiled detection (which uses its NMS) then fails; the health check reports this as "not installed".

Docker: `docker compose build --build-arg WITH_VIDEO=1` installs CPU-only torch and torchvision, keeps the headless OpenCV build (the GUI build that ultralytics pulls in needs libGL, which the slim image lacks) and fails the build if the stack does not import. It adds about 1 GB to the image. The bundled nginx accepts video uploads up to 310 MB on `/api/v1/crowd/video/` (6 MB elsewhere); any other proxy in front of the API needs a matching limit. For GPU inference run the API outside Docker or switch the base image to `nvidia/cuda`. Without the stack, the page shows "not installed" with the install command and uploads are refused with HTTP 503.

Settings (prefix `PUSHKAR_`): `VIDEO_MODEL_PATH` (default `yolov8n.pt`), `VIDEO_MAX_MB` (300), `VIDEO_MAX_SECONDS` (600), `VIDEO_SAMPLE_FPS` (2), `VIDEO_IMGSZ` (640), `VIDEO_ANNOTATE_EVERY` (5), `VIDEO_MAX_ANNOTATED` (120); tiling `VIDEO_DETECTION_MODE` (auto), `VIDEO_AUTO_TILE_MIN_PX` (1600), `VIDEO_TILE_PX` (1280), `VIDEO_TILE_OVERLAP` (0.2), `VIDEO_TILE_BATCH` (4), `VIDEO_TILE_NMS_IOU` (0.5); tracking `VIDEO_TRACK_IOU` (0.3), `VIDEO_TRACK_MAX_AGE` (3), `VIDEO_TRACK_DIST_FACTOR` (1.0); output `VIDEO_OUTPUT` (true), `VIDEO_OUTPUT_LONG_PX` (1280), `VIDEO_FFMPEG_PATH` (default: `ffmpeg` on PATH, else the `imageio-ffmpeg` bundled binary, which `requirements-video.txt` installs).

## 12.5 From recorded clips to live cameras

The live camera pipeline (docs/03 §3.5.1) will reuse `detect_persons()` from `backend/app/services/video_analysis.py` on an RTSP stream and post counts with a device key:

```http
POST /api/v1/crowd/readings
X-Device-Key: <key issued in Devices>
{"count": 27, "source": "camera"}
```

What this tool proves: the detector runs on this server, the counts are plausible on real footage, the reading path accepts the value, the WebSocket fan-out delivers it, and the pilgrim app displays it with the right source label. What it does not prove: camera placement, lens coverage, night performance, and the mapping from people-in-frame to people-in-zone. Those need on-site trials with the actual cameras.

## 12.6 Tests

`backend/tests/test_video_analysis.py` (detector stubbed, synthetic 40-frame video): health and role checks, upload validation (type, confidence, location, detection mode), corrupt-file failure, full pipeline with sampled frame indices and timestamps, summary statistics, track ids in the JSON, live preview JPEG, annotated MP4 with Range support (when ffmpeg is present), tile-grid and auto-mode helpers, the tracker's id assignment, CSV, annotated image bytes, path-traversal rejection, publish into `/crowd/status` and history, audit entries, delete. `frontend/src/__tests__/pages.test.tsx` renders `/admin/video` for a staff user and checks the detector status and upload form.
