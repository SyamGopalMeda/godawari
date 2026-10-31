# 8. Testing Plan and Validation Results

## 8.1 Strategy

| Layer | Scope | Tooling | Where |
|---|---|---|---|
| Unit | density thresholds, routing cost, phone normalisation | pytest | `backend/tests` |
| API integration | every endpoint against a seeded SQLite DB through FastAPI `TestClient` | pytest | `backend/tests` |
| Workflow | end-to-end missing-person lifecycle, family linking → sighting → lookup, parking pass → scan → occupancy | pytest | `backend/tests` |
| Security / authorization | role gates, ownership, device keys, OTP limits, report limits, headers, consent | pytest | `backend/tests` |
| Real-time | WebSocket delivery of crowd deltas; family-scoped sightings not leaked to anonymous sockets | pytest (`websocket_connect`) | `backend/tests` |
| Frontend | type-check (`tsc -b`), production build, and 22 jsdom **integration smoke tests** that render every route (pilgrim, staff, admin) against the live API, including OTP login, family creation, role redirects and language switching | Vitest + Testing Library (`frontend/src/__tests__`) | `frontend` |
| Load | mixed read/write at N concurrent users | `loadtest/loadtest.py` (asyncio + httpx) | `loadtest` |
| Simulation | synthetic devices driving readers, cameras, parking | `backend/simulators/simulate.py` | manual |

Run: `cd backend && python -m pytest -q` · `cd frontend && npm run build` · with the API running on :8000, `cd frontend && npm test` (frontend tests skip themselves with a warning if the API is not reachable).

## 8.2 Traceability: workflow → tests

| Workflow | Test functions (`backend/tests/*.py`) |
|---|---|
| Crowd updates (thresholds, camera/staff readings, batch, stale, override, WS delta) | `test_level_thresholds`, `test_crowd_status_seeded`, `test_camera_reading_updates_status`, `test_batch_readings_by_code`, `test_pilgrim_cannot_post_readings`, `test_override_wins`, `test_websocket_receives_crowd_updates` |
| Recommendations | `test_recommendations_rank_low_first` |
| Facility navigation (near-me filter, crowd-aware route, accessible mode, invalid input) | `test_facilities_near_filter`, `test_route_avoids_critical_zone`, `test_route_accessible_mode`, `test_route_bad_input` |
| Parking availability (list, recommend, sensor deltas, full/open, pass issue/scan/reuse, my spot) | `test_parking_list_and_recommend`, `test_parking_sensor_and_full`, `test_parking_pass_and_spot` |
| Family linking (create/join, member roles, consent, issued tags, uniqueness, unlink, GPS self-only) | `test_family_create_join_and_members`, `test_tag_link_requires_consent_and_issued_tag`, `test_unlink_tag`, `test_gps_sharing_self_only` |
| RFID checkpoint detection (batch ingest, dedupe, unknown tag, last-seen, manual QR scan, tag lookup, device revoke) | `test_rfid_sightings_dedupe_and_last_seen`, `test_manual_qr_scan_and_tag_lookup`, `test_admin_overview_devices_and_users`, `test_websocket_family_scoped_sighting` |
| Missing-person reports (photo consent, visibility, transitions, desk auto-fill, board anonymity, reporter limits, timeline, audit, photo access, rate limit) | `test_missing_person_full_workflow`, `test_report_rate_limit` |
| Emergency assistance (SOS anonymous/authenticated, nearest posts, queue, acknowledge, contacts, alerts lifecycle) | `test_sos_anonymous_requires_phone`, `test_sos_queue_and_update`, `test_emergency_contacts`, `test_alerts_lifecycle` |
| Security (OTP flow, normalisation, wrong OTP, OTP rate limit, bad password, role enforcement, device keys, headers, stranger/staff access rules) | `test_health`, `test_otp_flow_and_me`, `test_phone_normalisation`, `test_wrong_otp_rejected`, `test_otp_rate_limit`, `test_bad_password_login`, `test_role_enforcement`, `test_invalid_device_key`, `test_security_headers`, `test_stranger_and_staff_access_rules` |
| Observability | `test_metrics`, `test_health` |
| Performance | `loadtest/loadtest.py` (see 8.4) |

## 8.3 Manual frontend checklist

- [ ] Language switch te/hi/en changes nav, tiles, chips, consent text; persists after reload
- [ ] Home shows ghat tiles with chips; values update live when `simulate.py` runs (header shows ● Live)
- [ ] Crowd page lists ghats/gates with source and "updated"; stale items grey after 15 min without readings
- [ ] Map renders markers by type; monitored markers coloured by level; popup → Directions draws route; route sheet shows distance/ETA/steps/crowd notes; accessible toggle changes route; `?to=` deep link works
- [ ] Facilities: filter chips, near-me ordering, phone links dial
- [ ] Parking: lots with free/total and status; recommend by ghat; my spot saved and shown; pass issued with QR token (after login)
- [ ] Login: OTP request → dev OTP shown only when `dev_mode` → verify → name saved
- [ ] Family: create, join with code on second phone, add member, link wristband requires consent checkbox, last seen updates live after a manual scan, unlink, GPS share toggle only on own card
- [ ] Missing: form validation, photo requires consent, my reports update live through verified/searching/found/closed; board shows no name/photo
- [ ] Emergency: SOS requires confirm; result shows 112/108/100 and nearest posts; anonymous SOS asks for phone
- [ ] Staff mode: scan wristband shows member + family contact; report queue transitions; SOS queue acknowledge; crowd quick update
- [ ] Admin: login, KPIs, crowd table override/clear, parking edit, reports detail + photo, alerts create/expire (appear on pilgrim home), devices create (key once)/revoke, audit filter
- [ ] Offline: airplane mode → app opens, banner shown, last data visible, map tiles cached for visited area
- [ ] Install as PWA on Android Chrome and iOS Safari; safe-area insets respected
- [ ] Accessibility: keyboard navigation, screen reader labels on icon buttons, 48 px targets, contrast in dark mode
- [ ] 320 px width layout has no horizontal scroll

## 8.4 Load-test plan

Script `loadtest/loadtest.py` (asyncio + httpx): N virtual users for D seconds against a base URL. Mix per user loop: 55 % `GET /crowd/status`, 15 % `GET /locations?near=`, 10 % `GET /parking`, 10 % `GET /routes`, 5 % `GET /alerts/active`, 5 % device writes (`POST /crowd/readings` or `POST /rfid/sightings` with demo device keys). Reports requests/s, error rate, p50/p95/p99 latency per endpoint. Pass criteria for the pilot cluster: p95 ≤ 300 ms reads, ≤ 800 ms routes, error rate < 0.1 % at 50k concurrent (run from ≥ 3 load generators). Local developer runs use 200–500 users against SQLite only to validate the harness, not to size production.

## 8.5 Results

<!-- RESULTS -->
### Run 1 — 2026-10-31, developer laptop (Windows 11, Python 3.13.7, Node 24.21, single `uvicorn` process, SQLite WAL, load generator on the same machine)

**Automated tests**

| Suite | Command | Result |
|---|---|---|
| Backend API / workflow / security / real-time | `cd backend && python -m pytest -q` | **40 passed**, 0 failed (3.8 s) |
| Frontend type-check + production build | `cd frontend && npm run build` | **OK** (tsc clean; bundle 556 kB JS / 165 kB gzip, PWA service worker generated) |
| Frontend integration smoke tests against live API | `cd frontend && npm test` | **22 passed**, 0 failed (≈37 s) |
| Device simulator | `python backend/simulators/simulate.py --rounds 2` | all camera/RFID/parking posts accepted (202/200); dedupe and unknown-tag rejection verified by tests |
| Docker Compose | `docker compose config` | file validates; **image build not run** (Docker daemon was not running on the build machine) |

**Load test** (`python loadtest/loadtest.py --base http://127.0.0.1:8000`)

| Users | Duration | Requests | Throughput | Client-side errors | p50 | p90 | p95 | p99 |
|---|---|---|---|---|---|---|---|---|
| 5 | 8 s | 913 | 113 rps | 3.6 % | 40 ms | 63 ms | 78 ms | 107 ms |
| 50 | 20 s | 3 858 | 188 rps | 1.0 % | 151 ms | 638 ms | 882 ms | 1 400 ms |
| 100 | 20 s | 1 529 | 71 rps | 0.3 % | 737 ms | 3 690 ms | 4 922 ms | 6 474 ms |
| 300 | 20 s | 1 778 | 80 rps | 1.5 % | 2 282 ms | 8 861 ms | 11 817 ms | 16 107 ms |

Server-side `/metrics` after the runs: `pushkar_http_errors_total 0`, average server handling time 31 ms, cache hit ratio 5 898 / 6 442 ≈ 92 %. The "client-side errors" are httpx connection resets/timeouts from the load generator sharing one CPU with the server; the server logged no 5xx.

**Defect found and fixed during load testing.** The first 100-user run showed 56 % errors with 30 s stalls: the SQLAlchemy pool was sized 5 + 10 overflow while 40 handler threads competed for connections, so requests queued until the pool timeout. Fix: pool 30 + 60 overflow with a 10 s timeout, SQLite busy timeout 30 s, handler thread limit raised to 80, and a 3–5 s TTL cache with write-side invalidation on the hot read endpoints (`/crowd/status`, `/locations`, `/parking`, `/alerts/active`). Regression test: the 100-user run went from 56 % errors to 0 server errors.

**Interpretation.** A single Python process with SQLite saturates at roughly 100–200 requests/s on this laptop; latency grows linearly with concurrency beyond ~50 users because handlers are serialised through one process. This validates the harness and the application logic, not production capacity. Production sizing (docs/09): N stateless API pods behind a load balancer, PostgreSQL with PgBouncer, Redis for the cache and WebSocket fan-out, and the PWA + reference data on a CDN. The pass criteria in §8.4 must be re-run on that cluster from ≥ 3 load generators before the festival.

### Run 2 — 2026-10-31 (later the same day), pilot prep additions

| Check | Command | Result |
|---|---|---|
| Backend suite incl. SMS adapter (console / MSG91 / Twilio / webhook via mocked transport) and site-import CLI (template → validate catches bad type, bad lat/lng, placeholder passwords → idempotent import) | `cd backend && python -m pytest -q` | **46 passed** |
| Docker images | `docker compose build` | **both images built** (api: python 3.12-slim; web: node 22 build → nginx 1.27) |
| Docker stack: PostgreSQL 16 + API + Nginx | `docker compose up -d` | all three services healthy; `/health` db=true through Nginx on :8080; seed loaded into PostgreSQL; admin login OK |
| Frontend integration tests through the Docker stack | `PUSHKAR_API_BASE=http://localhost:8080 npm test` | **22 passed** |
| Site import CLI inside the API container | `docker compose exec api python scripts/import_site.py import /tmp/sd` | 47 locations, 4 lots, 28 nodes, 30 edges, 2 staff upserted; demo site row removed once unreferenced |

### Run 3 — 2026-10-31, mobile UI/UX redesign (v2)

| Check | Result |
|---|---|
| Backend suite (now includes a UTC-offset regression test) | **47 passed** |
| Frontend integration tests against the live API (rewritten for v2) | **29 passed** |
| Phone-size audit `frontend/scripts/ux-audit.mjs`, production Docker build, 16 screens × 3 languages at 360 px | **49/49 clean** (no overflow, no sub-40 px targets, no console errors) |
| Same audit at 320 px in Telugu and Hindi | **33/33 clean** |
| Offline reload | Saved snapshot shown with its timestamp |

Details, defects found and fixed: [10-mobile-ux-redesign.md §10.7](10-mobile-ux-redesign.md).

### Run 4 — 2026-10-31, verified locations + video crowd-count check

| Check | Result |
|---|---|
| Backend suite (now 63: + verified-location dataset/provenance/admin validation, + video analysis pipeline with a stubbed detector) | **63 passed** |
| Frontend integration tests (34: + `/ghats`, `/places/:id` mapped and unknown, `/admin/video`) | **34 passed** |
| Real detector end-to-end (stock crowd clip, GPU) | 29 frames, 23–34 people/frame, 12.9 ms/frame, published count reached `/crowd/status` as source `video` (docs/12) |

**Not yet tested.** Real RFID readers, CCTV counters and parking sensors (no hardware); SMS gateway and push notifications (adapters stubbed); multi-process WebSocket fan-out (needs Redis); browser-level visual/accessibility checks on real phones (manual checklist §8.3 is still open).
<!-- /RESULTS -->
