# Pushkar Sahayam — Godavari Pushkaralu 2027 Smart Crowd Management & Pilgrim Assistance Platform

A working, integrated platform (pilgrim PWA + field-staff mode + admin dashboard + API) for crowd status, crowd-aware navigation, parking, facilities, RFID-checkpoint family tracking, missing-person workflows, alerts and emergency assistance. Built for the 12-day Godavari Pushkaralu (26 June – 7 July 2027), where officials expect around 10 crore devotees across six districts.

> **Honesty note.** Everything in this repository runs today on a laptop with *demo* data. Crowd counts, RFID sightings and parking occupancy become *real* only when devices on site post to the ingestion endpoints. The table in [docs/03-system-architecture.md §3.8](docs/03-system-architecture.md) says exactly which features are software-only and which need hardware, external services or official cooperation. The seed data (ghat positions, capacities, facilities) is explicitly labelled demo and must be replaced by surveyed data before any field use.

## Deliverables map

| # | Deliverable | Where |
|---|---|---|
| 1 | Reference reel analysis | [docs/01-reference-reel-analysis.md](docs/01-reference-reel-analysis.md) |
| 2 | Product requirements document | [docs/02-product-requirements.md](docs/02-product-requirements.md) |
| 3 | System architecture + diagrams | [docs/03-system-architecture.md](docs/03-system-architecture.md) |
| 4 | Database schema + API specification | [docs/04-database-and-api-spec.md](docs/04-database-and-api-spec.md), live Swagger at `/docs` |
| 5 | User journeys + UI/UX | [docs/05-user-journeys-and-ux.md](docs/05-user-journeys-and-ux.md) |
| 6 | Technology stack + infrastructure recommendations | [docs/06-technology-stack.md](docs/06-technology-stack.md) |
| 7 | Phased roadmap | [docs/07-development-roadmap.md](docs/07-development-roadmap.md) |
| 8 | Working application | `backend/` (FastAPI) + `frontend/` (React PWA) |
| 9 | Testing plan + results | [docs/08-testing-plan-and-results.md](docs/08-testing-plan-and-results.md), `backend/tests/`, `loadtest/` |
| 10 | Deployment plan, infrastructure, costs | [docs/09-deployment-and-operations.md](docs/09-deployment-and-operations.md), `docker-compose.yml` |
| 11 | UI/UX redesign: audit, design system v3, verification | [docs/10-mobile-ux-redesign.md](docs/10-mobile-ux-redesign.md), [docs/screenshots/](docs/screenshots/) |
| 12 | Verified ghats, bathing centres and facilities (sources, coverage, admin validation) | [docs/11-verified-ghats-and-locations.md](docs/11-verified-ghats-and-locations.md) |
| 13 | Video crowd-count verification tool (temporary, before live cameras) | [docs/12-video-crowd-count-verification.md](docs/12-video-crowd-count-verification.md) |

## Quick start (local development)

Requirements: Python 3.11+, Node 20+.

```bash
# 1. API (SQLite, demo seed, OTP shown in response because PUSHKAR_DEV_MODE=true)
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
#    → http://localhost:8000/docs

# 2. Web app (pilgrim PWA + /staff + /admin), proxies /api and /ws to :8000
cd ../frontend
npm install
npm run dev
#    → http://localhost:5173

# 3. (optional) synthetic devices: cameras, RFID readers, parking counter
cd ../backend
python simulators/simulate.py --base http://localhost:8000
```

Demo accounts (seeded, dev only): `admin / admin12345` (admin), `staff1 / staff12345` (control room), `helpdesk2 / helpdesk12345` (volunteer at Help Desk 2). Pilgrims log in with any phone number; the OTP is returned in the response while `PUSHKAR_DEV_MODE=true`.

Demo wristbands `GP27-00001` … `GP27-00050` are pre-issued; link one to a family member in the app, then run the simulator (or `POST /api/v1/rfid/sightings` with a demo device key from `backend/app/seed.py`) to see live "last seen" updates.

### Docker (pilot-site layout: PostgreSQL + API + Nginx-served PWA)

```bash
docker compose up --build
# → http://localhost:8080  (API docs at /docs)
```

## Deploy on Render

`render.yaml` is a Render Blueprint. It creates a PostgreSQL database and one Docker web service (`Dockerfile.render`) that serves the web app, the REST API and the live WebSocket from one address.

1. In the Render dashboard choose **New > Blueprint** and select this GitHub repository (or open `https://render.com/deploy?repo=https://github.com/SyamGopalMeda/godawari`).
2. When asked, enter `PUSHKAR_BOOTSTRAP_ADMIN_PASSWORD`. This becomes the control-room `admin` password.
3. Click **Apply**. The first build takes about 5 minutes. The site is then at `https://pushkar-sahayam.onrender.com` (or the name Render shows).

Notes:
- The free plan sleeps after 15 minutes without traffic, and the free database expires after 30 days. Use paid plans for a pilot.
- `PUSHKAR_DEV_MODE=true` shows login codes on screen because no SMS gateway is configured. Set it to `false` after adding the SMS provider keys.
- The video crowd-count detector is not installed in this image (it needs more memory than small instances have). Its page says so. Uploaded files are not kept across deploys.

## Tests

```bash
cd backend && python -m pytest -q          # 71 API/workflow/security/real-time/video tests
cd .. && python loadtest/loadtest.py --users 100 --seconds 20
# with the API and `npm run dev` running:
cd frontend && npm test                      # 34 integration tests against the live API (set PUSHKAR_SEED_MODE=demo on that API)
node scripts/ux-audit.mjs --out ux-out       # phone-size screenshots + overflow/touch-target audit (te/hi/en)
```

If port 8000 is taken on your machine, run the API on another port and start the dev server with
`PUSHKAR_API_PROXY=http://localhost:8001 npm run dev` (and `PUSHKAR_API_BASE` for `npm test`, `--api` for the audit).

## Repository layout

```
backend/app/         FastAPI application (models, schemas, routers, services, seed, broadcaster)
backend/tests/       pytest suite (TestClient, SQLite temp DB, WebSocket tests)
backend/simulators/  synthetic device traffic (clearly labelled simulation)
frontend/src/        React + TypeScript PWA: pages/pilgrim, pages/staff, pages/admin, components
loadtest/            asyncio+httpx mixed-traffic load test
docs/                all written deliverables
docker-compose.yml   PostgreSQL + API + Nginx
```

## What is real vs. simulated (today)

| Capability | Status |
|---|---|
| Crowd status, recommendations, crowd-aware routing, parking, facilities, alerts, SOS, missing-person workflow, families, consent, audit log, WebSocket live updates | **Working end-to-end** (software) |
| Camera / RFID / parking-sensor inputs | **Ingestion API working**; inputs come from `simulators/simulate.py` or staff until real devices are installed |
| Video crowd-count check (admin → Video check) | **Working with the real YOLOv8 detector** on uploaded clips: tiled native-resolution detection for dense / 4K footage, live analysis preview, annotated tracking video with synced count; verified end to end (docs/12). Needs `pip install -r backend/requirements-video.txt` (includes ffmpeg for the annotated video); Docker image needs `--build-arg WITH_VIDEO=1` |
| Ghats, bathing centres, facilities | **Real data from OpenStreetMap + cited sources** (`backend/data/godavari_locations.json`); official 2027 ghat lists are not yet published, unverified places are marked and never routed to (docs/11) |
| SMS OTP | **Gateway adapter implemented** (`backend/app/services/sms.py`: MSG91, Twilio, generic webhook, console). Set `PUSHKAR_SMS_PROVIDER` and keys; needs an Indian DLT-registered template. Dev mode falls back to printing the OTP |
| Push notifications | Not implemented; in-app alerts arrive over WebSocket. FCM/Web Push is a Phase 1 item |
| Site data onboarding | `python backend/scripts/import_site.py template|validate|import <dir>` replaces the demo seed with surveyed CSV data (idempotent upsert) |
| Map tiles | OpenStreetMap public tiles (fine for dev; use MapTiler/self-hosted tiles for production load) |
| City-scale driving directions | Deep link to the phone's map app; on-site walking routes are computed by the platform |
