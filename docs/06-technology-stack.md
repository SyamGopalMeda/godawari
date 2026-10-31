# 6. Technology Stack and Infrastructure Recommendations

Each choice lists the alternative considered and why it lost for this event (12 days, six districts, ~10 crore devotees, weak connectivity, government deployment with Indian data residency).

## 6.1 Pilgrim and staff client — Progressive Web App

**Chosen:** React 19 + Vite + TypeScript, Leaflet/react-leaflet with OpenStreetMap tiles, `vite-plugin-pwa` (Workbox) for installability and caching.

| Alternative | Why not (for v1) |
|---|---|
| React Native / Expo | Store review cycles (2–7 days) are risky during the festival when fixes must ship in hours; two binaries to QA; no instant share-by-link/QR at help desks. |
| Flutter | Same store constraints; smaller pool of Telugu-speaking devs; web build is heavy. |
| Native Android only | Excludes iOS pilgrims and desktop control rooms. |

**Store listing and push:** wrap the same build with **Capacitor** (Phase 1) to publish on Play Store/App Store and get **FCM** push via `@capacitor/push-notifications`; the PWA keeps Web Push for browsers. One codebase, hot-fixable via web deploy, native shell only for push and discoverability.

**Maps:** Leaflet is 40 KB, works offline with cached tiles, no API key. Google Maps SDK was rejected for cost at 10 crore sessions and key exposure; MapLibre GL was considered (vector tiles, nicer) but needs WebGL which fails on many low-end phones.

## 6.2 API — FastAPI (Python 3.12)

**Chosen:** FastAPI + Pydantic v2 + SQLAlchemy 2.0, Uvicorn workers behind Nginx. Reasons: typed contract auto-published at `/docs`, native WebSocket, the user's existing YOLOv8 counting pipeline is Python so one language across edge and cloud, fast enough for I/O-bound JSON (10–20k req/s per 4-core pod with caching).

| Alternative | Why not |
|---|---|
| Django + DRF | Heavier per request, Channels for WS adds Redis dependency from day one; admin UI not needed (custom dashboard). |
| Node/NestJS | Good WS story, but splits the team from the CV pipeline; no Pydantic-grade validation. |
| Go | Best raw throughput, but slower to iterate on a workflow-heavy product with a small team. |

## 6.3 Database — PostgreSQL 16 (+ PostGIS)

**Chosen:** PostgreSQL with PostGIS `geography` for nearest-facility queries, daily partitions for `tag_sightings` and `crowd_readings`, read replica for dashboards, PgBouncer pooling. SQLite is used only for local dev/tests (same SQLAlchemy models).

| Alternative | Why not |
|---|---|
| MongoDB | Workflow (reports, transitions, audit) is relational; need transactions and FK integrity for consent/tag uniqueness. |
| TimescaleDB | Attractive for readings; deferred — native partitioning is enough for 12 days. |
| Managed cloud DB | Fine, provided the region is in India (AWS ap-south-1, Azure Central India, GCP asia-south1). |

## 6.4 Redis

Roles: (1) cache for status/locations/parking (5–15 s TTL), (2) pub/sub to fan WebSocket events across API pods, (3) Streams as the ingestion queue for device batches with consumer-group workers, (4) rate-limit counters. Single-instance deployment in this repo uses in-process equivalents; the `Broadcaster` has a documented swap point.

## 6.5 Real-time delivery

| Option | Use |
|---|---|
| **WebSocket** (chosen for open app) | Bi-directional, 25 s ping; deltas only; per-site channels; proven at ~50k connections per pod with uvloop. |
| SSE | Simpler but one-way and poorly supported through some Indian telecom proxies; kept as fallback option. |
| **FCM / Web Push** (Phase 1) | For closed app: report status changes, critical alerts. Not for crowd deltas (volume). |
| SMS | Critical alerts and reunification calls when data is down. |

## 6.6 Routing

* **On-site:** curated walkway graph + crowd-weighted Dijkstra in-process (`services/routing.py`). Surveyors capture nodes/edges in a GeoJSON/CSV; closed edges toggled by staff.
* **City-scale (home → parking):** **self-hosted OSRM** with the Andhra Pradesh OSM extract (free, ~2 GB RAM for the region) versus Google Directions API (₹4–8 per 1,000 requests is fine, but quota approvals and key exposure in a public app are risks). Phase 1 uses deep links to the phone's maps app; OSRM is Phase 2.

## 6.7 RFID and location technologies

| Technology | What it gives | Cost (indicative, 2026) | Role here |
|---|---|---|---|
| **UHF passive RFID (EPC Gen2, 865–867 MHz India band)** wristbands | Presence at a reader portal, 3–8 m, hundreds of reads/s, no battery, waterproof silicone | ₹15–40 per wristband (volume), fixed reader ₹60k–1.5 L with 4 antennas, portal ₹1.5–3 L installed | Checkpoint sightings (`/rfid/sightings`) |
| Edge gateway (industrial PC / Raspberry Pi 5 + 4G) | Dedupe, buffer 24 h, batch POST | ₹15–40k | One per checkpoint cluster |
| **BLE beacons** | Proximity 1–10 m, needs phone app in foreground/background | ₹500–1,500 per beacon | Phase 2: help-desk enclosures, "near Help Desk 2" |
| **QR on wristband** | Manual scan by any volunteer phone | printed, ~₹0 | Fallback (`/rfid/manual-scan`) — always works |
| Phone GPS | 5–20 m outdoors, drains battery, adults only | ₹0 | Opt-in self-share (`/members/{id}/gps`) |
| NFC | 4 cm; needs tap | not useful at gates | — |
| Active RFID / UWB | Metres-level live tracking | ₹2–5k per tag | rejected: cost × 20 lakh tags |

Key physics: UHF reads drop in dense crowds (water in bodies absorbs 900 MHz) — mitigated by two-sided portals, antenna tilt, and the QR fallback. Expectation in UI is always "last checkpoint".

## 6.8 SMS OTP and messaging

Indian regulations require **DLT registration** (TRAI) of sender ID and message templates; transactional OTP templates typically cost ₹0.12–0.25 per SMS. Candidates: **MSG91**, **Exotel**, **Kaleyra**, AWS SNS (India), Twilio (higher cost). The code has a single `_send_sms` adapter in `routers/auth.py`. Dev mode returns the OTP in the API response and must be off in production.

## 6.9 Map tiles

OpenStreetMap's public tile servers prohibit heavy apps (usage policy). Pilot: OSM with aggressive caching. Scale: **MapTiler** or **Mapbox** raster tiles (≈ ₹25–40 per 1,000 tile loads beyond free tier; with PWA caching per device the 12-day cost is bounded) or self-hosted tiles (TileServer-GL with an AP extract) for zero per-request cost.

## 6.10 Storage, observability, deployment

* **Object storage** for report photos: S3-compatible (AWS S3 Mumbai / MinIO on-prem), private bucket, signed URLs, lifecycle delete at festival + 30 days.
* **Observability:** Prometheus scraping `/metrics` (extend to full `prometheus-fastapi-instrumentator`), Grafana per-site dashboards, Loki for logs, Alertmanager → on-call SMS/phone.
* **Deployment:** Docker Compose on one VM per pilot site; Kubernetes (EKS/AKS/GKE India regions, or NIC/MeghRaj cloud for government hosting) with HPA for full scale; Nginx ingress; CDN (CloudFront/Azure Front Door) for the PWA and tiles; WAF with rate rules.
* **Data residency:** all stores in Indian regions; backups in a second Indian region.

## 6.11 Software-only vs hardware vs permission

| Feature | Software only | Hardware | External service | Official permission/data |
|---|---|---|---|---|
| Crowd status (manual) | ✔ | | | staff rota |
| Crowd status (camera/RFID counters) | | ✔ cameras+GPU / readers | | CCTV access |
| Recommendations, routing, map | ✔ | | tiles | surveyed graph |
| Parking occupancy (manual / pass scan) | ✔ | phone | | operator adoption |
| Parking occupancy (automatic) | | ✔ loop counters/ANPR | | contractor |
| Family group, consent, QR scan | ✔ | | | wristband printing |
| RFID checkpoint sightings | | ✔ readers, tags, gateways, power, 4G | | checkpoint sites |
| GPS self-share | ✔ | | | |
| Missing-person workflow, board, audit | ✔ | | SMS OTP | SOP |
| SOS, emergency contacts | ✔ | | telephony | dispatch SOP |
| Alerts in-app | ✔ | | | control-room authority |
| Push notifications | | | FCM / Web Push / SMS | |
| Admin dashboard, devices, staff | ✔ | | | |
