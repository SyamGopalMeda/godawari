# 9. Deployment, Operations and Cost Plan

## 9.1 What is real-time today and what is not

| Data | Real-time in this repository? | Becomes real-time when |
|---|---|---|
| Crowd level at ghats/gates | Only when staff post readings or a camera/RFID device posts counts; otherwise demo seed values, marked stale after 15 min | CCTV AI counters or RFID/turnstile counters are installed and registered as devices |
| Family last-seen | Only from manual QR scans by volunteers or simulated sightings (`backend/simulators/simulate.py`) | UHF readers + edge gateways are installed at checkpoints and wristbands are issued |
| Parking occupancy | Staff +/- updates and QR pass scans | Loop counters / barriers post deltas |
| Alerts, reports, SOS, routes, facilities | Fully real-time (software only) | — |
| OTP delivery | Dev mode prints OTP; no SMS is sent | SMS gateway configured and `PUSHKAR_DEV_MODE=false` |
| Push notifications | In-app via WebSocket only | FCM/Web Push integrated |

## 9.2 Infrastructure sizing

### Pilot (one site, ≤ 50k concurrent)
| Component | Spec | Qty |
|---|---|---|
| API (Uvicorn, 4 workers) | 4 vCPU / 8 GB | 2 |
| PostgreSQL 16 + PostGIS | 4 vCPU / 16 GB / 200 GB SSD, daily snapshots | 1 primary + 1 replica |
| Redis | 2 vCPU / 4 GB | 1 (+1 replica) |
| Nginx / ingress + TLS | 2 vCPU | 2 |
| Object storage | 50 GB | — |
| CDN | PWA + tiles | — |
| Bandwidth | ~1.5 TB / month | — |

### Full scale (all sites, 20–30 lakh concurrent, 5k sightings/s)
| Component | Spec | Qty |
|---|---|---|
| API pods | 4 vCPU / 8 GB, ~40k WS connections each | 60–80 (HPA 30–120) |
| Ingestion workers | 2 vCPU / 4 GB | 10–20 |
| PostgreSQL | 32 vCPU / 128 GB / 2 TB NVMe, PgBouncer | 1 primary + 2 replicas (+ cross-region standby) |
| Redis cluster | 6 nodes × 8 GB | 1 cluster |
| Object storage | 2 TB | — |
| CDN | 95 % of static/tiles | — |
| Observability | Prometheus/Grafana/Loki, 3 nodes | — |
| Egress | ~40 TB over festival | — |

### Per-site edge
| Item | Per checkpoint | Notes |
|---|---|---|
| UHF reader + 2–4 antennas | 1 | portal both sides of flow |
| Edge gateway (4G + Ethernet) | 1 per 2–4 readers | 24 h buffer |
| UPS 1 kVA | 1 | 4 h autonomy |
| 4G SIMs (two carriers) + fibre at control room | — | |
| Help-desk kiosk (tablet + QR scanner) | 1 per desk | |

## 9.3 Deployment steps

### Pilot with Docker Compose
```bash
cp backend/.env.example backend/.env         # set PUSHKAR_JWT_SECRET, DATABASE_URL (postgres), DEV_MODE=false
docker compose up -d --build                 # db, api, frontend (nginx)
docker compose exec api python -m app.cli import-locations data/site1_locations.csv   # Phase 1 tool
curl -s localhost:8080/health
```
Nginx serves the PWA and proxies `/api`, `/ws`, `/health`; TLS via Let's Encrypt or the department's certificates.

### Kubernetes outline (full scale)
Namespaces per environment; `api` Deployment + HPA (CPU 60 %, WS connections metric); `ingest-worker` Deployment consuming Redis Streams; managed Postgres and Redis; Ingress-Nginx with sticky sessions off (WS stateless via Redis pub/sub); CDN in front; secrets from the cloud secret manager; image tags pinned; rollout `maxUnavailable: 0`.

## 9.4 Configuration (`backend/app/config.py`, prefix `PUSHKAR_`)

| Variable | Default | Production |
|---|---|---|
| `DEV_MODE` | true | **false** |
| `DATABASE_URL` | sqlite | `postgresql+psycopg://…` |
| `JWT_SECRET` | dev string | 64+ random chars, rotated per event |
| `JWT_EXPIRY_HOURS` | 12 | 12 |
| `CORS_ORIGINS` | localhost | app domains only |
| `UPLOAD_DIR` | ./uploads | object storage mount or adapter |
| `SEED_ON_START` | true | **false** after onboarding |
| `BOOTSTRAP_ADMIN_USERNAME/PASSWORD` | admin/admin12345 | change, then disable |
| `CROWD_STALE_SECONDS` | 900 | 600 at peak |
| `OTP_PER_HOUR`, `OTP_TTL_SECONDS` | 5 / 300 | same |
| `OPEN_REPORTS_PER_USER` | 3 | 3 |
| `SIGHTING_DEDUPE_SECONDS` | 30 | 30–60 |
| `WALK_SPEED_KMH`, `ACCESSIBLE_WALK_SPEED_KMH` | 3.5 / 2.5 | tune from field |
| `SIGHTING_RETENTION_DAYS` | 30 | 30 |
| `SMS_PROVIDER` | console | `msg91` (India, DLT) or `twilio` / `http` |
| `SMS_API_KEY`, `SMS_SENDER_ID`, `SMS_TEMPLATE_ID` | empty / PSHKAR | MSG91 authkey, approved DLT header and OTP template id |
| `SMS_ACCOUNT_SID` | empty | Twilio only |
| `SMS_HTTP_URL` | empty | generic webhook provider only |
| `SEED_MODE` | real | `real` (verified dataset); `demo` only for tests; `none` after onboarding |
| `OSRM_FOOT_URL` | routing.openstreetmap.de | self-hosted OSRM (India extract) for the festival |
| `VIDEO_MODEL_PATH`, `VIDEO_MAX_MB`, `VIDEO_MAX_SECONDS`, `VIDEO_SAMPLE_FPS` | yolov8n.pt / 300 / 600 / 2 | video check tool (docs/12); optional dependency |
| `SMS_TIMEOUT_SECONDS` | 8 | 5–8; with `DEV_MODE=false` a failed send returns HTTP 503 to the caller |

Frontend build/dev variables (not `PUSHKAR_`-prefixed in the browser bundle):

| Variable | Default | Production |
|---|---|---|
| `VITE_TILE_URL` | public OpenStreetMap tiles | contracted or self-hosted tile server (public OSM tiles are not for festival-scale traffic) |
| `VITE_TILE_ATTR` | OpenStreetMap attribution | provider's required attribution |
| `PUSHKAR_API_PROXY` (dev server only) | `http://localhost:8000` | n/a; Nginx proxies `/api` and `/ws` in Docker |

## 9.5 Data onboarding (replacing the demo seed)

The import CLI exists: `python backend/scripts/import_site.py template <dir>` writes a sample bundle (site.json, locations.csv, parking.csv, walkway_nodes.csv, walkway_edges.csv, staff.csv, tags.txt) in the demo layout; `validate <dir>` checks codes, types, coordinates, capacities, graph references and passwords without writing; `import <dir>` upserts by code/label/username/UID (safe to re-run) and removes the demo site row once nothing references it.

1. Set `PUSHKAR_SEED_ON_START=false`; fill `site.json` (name in 3 languages, centre, emergency contacts).
2. Locations CSV: `code,type,name,name_te,name_hi,lat,lng,capacity,is_accessible,is_open,monitored,details_json` → `import_site.py import` (or `POST /locations` per row from the admin API).
3. Capacities: safe simultaneous occupancy per ghat/gate from the district engineer; required for density levels.
4. Walkway graph: nodes and edges (length, accessible, zone) from a field survey, GeoJSON → `walkway_nodes/edges`.
5. Parking lots with total slots, vehicle types, nearest gate, shuttle text.
6. Help desks, medical posts, police points with phone numbers and hours.
7. Staff accounts via `POST /admin/users` with site and help-desk assignment; distribute credentials in person.
8. Devices via `POST /admin/devices`; copy the key once into the gateway config; verify `last_seen_at` updates.
9. Issue wristband UIDs via `POST /rfid/tags` from the supplier's EPC list.
10. Verify with the checklist in doc 08 before go-live.

## 9.6 Operational runbooks

**R1 Surge at a ghat (level critical).** Control room: confirm source and age; set override on feeder gate(s); publish trilingual warning alert naming alternatives; notify police at the gate by radio; watch count every 5 min; clear override below 70 %.

**R2 Reader/gateway outage.** Alert "no sightings from device X for 10 min". Field tech checks power/4G; gateway buffers up to 24 h and backfills with original `seen_at`; help desk switches to QR manual scans; admin marks the device in the dashboard note.

**R3 API outage → static mode.** CDN serves a static page with last cached status, emergency numbers and help-desk map; mobile app shows offline banner with last data; SMS blast for critical alerts; restore API from replica (R5).

**R4 Missing child SOP (with police).** Report → volunteer verifies caller by phone → `verified` → assign nearest help desk → `searching`; staff last-seen lookup (audited); when a child is brought to a desk: scan wristband/QR → call family → `found` → guardian identity check per police SOP → `closed`. Children without wristband: board entry only, no photo.

**R5 Database failover.** Promote replica; update connection string via secret; restart API pods; verify `/health`; re-point replica; post-mortem.

**R6 Key rotation.** Rotate `JWT_SECRET` at 02:00 window (users re-login); revoke and reissue device keys per site; rotate SMS gateway keys; rotate admin passwords after the festival.

**R7 Abuse.** Spike in OTP requests or reports from one number → block at WAF, review audit, inform police if malicious.

## 9.7 Monitoring and alert rules

| Metric | Alert |
|---|---|
| Ingestion lag (received_at − seen_at) p95 | > 60 s for 5 min |
| Monitored locations stale % | > 20 % for 10 min |
| Devices without heartbeat | any reader > 10 min |
| HTTP 5xx rate | > 1 % for 5 min |
| p95 latency status endpoints | > 500 ms for 5 min |
| WS fan-out queue depth / send failures | > 1,000 / > 1 % |
| DB connections / replication lag | > 80 % pool / > 10 s |
| Open vulnerable reports older than 30 min without assignment | any |
| SOS `new` older than 3 min | any |
| Disk, CPU, memory | standard |

## 9.8 Backup and DR

Postgres: continuous WAL archiving + PITR, snapshots every 6 h during the festival, standby in a second Indian region; restore drill in May 2027. Object storage: versioning + cross-region replication. Redis: ephemeral (rebuildable). Config/IaC in git. RPO 5 min, RTO 30 min.

## 9.9 Security hardening checklist

- [ ] `DEV_MODE=false`; bootstrap admin password changed and account restricted
- [ ] TLS 1.2+, HSTS, security headers (already set: nosniff, DENY, no-referrer) + CSP
- [ ] CORS limited to app origins; WAF rate rules on `/auth/otp/*`, `/sos`, `/missing-reports`
- [ ] Device keys per device, revoked on loss; keys never in images or git
- [ ] Secrets in secret manager; DB users least privilege; no public DB
- [ ] Dependency scanning (pip-audit, npm audit) in CI; image scanning
- [ ] Penetration test before pilot; OWASP ASVS L2 review
- [ ] Admin access via VPN/IP allow-list and MFA (reverse-proxy level)
- [ ] Audit log shipped to immutable storage

## 9.10 Privacy / DPDP Act 2023 checklist

- [ ] Privacy notice in te/hi/en at login and before wristband/photo consent (purpose, retention, rights)
- [ ] Consent records kept (`consent_given_at`, `consent_by_user_id`, photo_consent)
- [ ] Minors linked only by guardian (primary account)
- [ ] Data minimisation: only phone, name, member names, optional photo
- [ ] Access control + audit for every personal-data lookup (implemented)
- [ ] Retention: sightings, reports, photos deleted festival + 30 days (automated job)
- [ ] Erasure/withdrawal request process at help desks
- [ ] Data processing agreement with cloud/SMS vendors; India residency
- [ ] Breach response plan and notification within statutory time
- [ ] DPIA signed off by the Data Fiduciary (event authority)

## 9.11 Estimated costs (INR, indicative, 2026 prices; excludes GST)

Assumptions: 2 months of prep environments + 12 festival days at full scale + 1 month wind-down; 20 lakh wristbands; 300 checkpoints; 6 sites; 1 crore OTP SMS over the event.

| Item | Basis | Estimate |
|---|---|---|
| Cloud compute (API, workers, k8s) | 80 pods × 12 days peak + small prep cluster 3 months | ₹18–25 lakh |
| Managed PostgreSQL + replicas + standby | 3 months, large instance only during festival | ₹8–12 lakh |
| Redis cluster | 3 months | ₹2–3 lakh |
| Object storage + egress 40 TB + CDN | | ₹6–10 lakh |
| Observability stack | | ₹1–2 lakh |
| SMS OTP + critical alerts | 1.2 crore SMS × ₹0.15–0.25 | ₹18–30 lakh |
| Map tiles | commercial tiles with caching, or self-host (~₹1 lakh) | ₹2–8 lakh |
| **RFID wristbands** | 20 lakh × ₹20–35 incl. printing | ₹4–7 crore |
| **Readers + antennas** | 300 × ₹1.2–2.5 lakh installed | ₹3.6–7.5 crore |
| Edge gateways + UPS + SIMs | 150 × ₹60k | ₹90 lakh |
| Help-desk tablets/scanners | 300 × ₹25k | ₹75 lakh |
| Camera counting GPU boxes | 60 × ₹2.5 lakh (CCTV existing) | ₹1.5 crore |
| Development & integration team | 8 people × 8 months | ₹1.6–2.4 crore |
| Field survey & data onboarding | 6 sites | ₹20–30 lakh |
| Security review, DPIA, penetration test | | ₹10–15 lakh |
| Operations war-room (12 days, 3 shifts) | | ₹15–20 lakh |
| **Total software + cloud + services** | | **≈ ₹2.5–3.5 crore** |
| **Total including RFID/camera hardware** | | **≈ ₹13–20 crore** |

The hardware line dominates; a QR-only wristband programme (printing ~₹3–5 per band, no readers) reduces the family-safety cost to ≈ ₹1 crore while keeping the manual-scan workflow, at the price of no automatic checkpoint detection. For context, the state allocated ₹899 crore for works and expects total spending above ₹4,000 crore (https://telanganatoday.com/ap-plans-high-tech-arrangements-for-godavari-pushkaralu-expects-10-crore-devotees).
