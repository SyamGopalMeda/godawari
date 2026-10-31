# 7. Phased Development Roadmap

Today: 31 October 2026. Festival: 26 June – 7 July 2027. Working backwards, the full stack must be frozen by **1 June 2027** (code freeze + load test), hardware installed by **15 May 2027**, pilot live at one Rajamahendravaram site by **15 March 2027**.

```mermaid
gantt
    title Pushkar Sahayam delivery plan
    dateFormat  YYYY-MM-DD
    section Phase 0 (done)
    Architecture, API, PWA, tests, docs        :done, p0, 2026-10-01, 2026-10-31
    section Phase 1 Pilot
    Data onboarding & survey (site 1)          :p1a, 2026-11-10, 2026-12-20
    SMS, Postgres, Redis, CDN, Capacitor+FCM   :p1b, 2026-11-10, 2027-01-15
    Security review, DPDP review               :p1c, 2027-01-05, 2027-01-31
    Load test 50k concurrent                   :p1d, 2027-02-01, 2027-02-20
    Pilot live (site 1), field trial           :milestone, m1, 2027-03-15, 0d
    section Phase 2 Hardware
    RFID procurement & tag printing            :p2a, 2026-12-01, 2027-03-31
    Reader/gateway install site 1              :p2b, 2027-02-15, 2027-03-31
    Camera counters (YOLOv8) on CCTV           :p2c, 2027-01-15, 2027-04-15
    Parking counters & pass scanners           :p2d, 2027-02-01, 2027-04-15
    section Phase 3 Scale-out
    Multi-site data, k8s, per-site sharding    :p3a, 2027-03-15, 2027-05-15
    Hardware all sites                         :p3b, 2027-04-01, 2027-05-31
    Full-scale load test 30 lakh sessions      :p3c, 2027-05-15, 2027-05-31
    Code freeze                                :milestone, m2, 2027-06-01, 0d
    section Phase 4 Operations
    Staff training (14k volunteers)            :p4a, 2027-05-01, 2027-06-20
    War-room, festival                         :p4b, 2027-06-24, 2027-07-08
    Post-event analytics, data deletion        :p4c, 2027-07-08, 2027-08-07
```

## 7.1 Phase 0 — Foundation (complete, this repository)

Delivered: architecture and API contract; FastAPI backend with auth (OTP dev mode, staff passwords, device keys), crowd readings/overrides/recommendations, crowd-aware routing, parking lots/passes/spot, families/consent/tag linking/sightings/last-seen with audit, missing-person workflow with photo and public board, SOS and alerts, admin overview/devices/users/audit, WebSocket fan-out; PWA frontend (pilgrim, staff, admin) in te/hi/en; demo seed for a Rajamahendravaram site; 40 backend tests; simulators; docs 01–09.

## 7.2 Phase 1 — Pilot at one site (Nov 2026 – Mar 2027)

Team: 2 backend, 2 frontend, 1 DevOps, 1 QA, 1 PM/field liaison. ~16 weeks.

| Work item | Priority | Effort |
|---|---|---|
| Survey and onboard real data: ghats, gates, facilities, capacities, walkway graph (CSV/GeoJSON import tool) | Must | 3 wk (field) + 1 wk (tool) |
| PostgreSQL + PostGIS, Alembic migrations, partitioning | Must | 1 wk |
| Redis cache + pub/sub broadcaster + Streams ingestion workers | Must | 2 wk |
| SMS gateway (DLT templates), OTP in production mode | Must | 1 wk |
| Capacitor Android/iOS shells, FCM push for report/alert events; Web Push | Should | 2 wk |
| Object storage for photos with signed URLs and lifecycle | Must | 3 d |
| CDN + Nginx hardening + WAF rules | Must | 1 wk |
| Observability stack and alert rules | Must | 1 wk |
| Security review (OWASP ASVS L2), DPDP assessment, privacy notice in 3 languages | Must | 2 wk |
| Load test to 50k concurrent on pilot cluster | Must | 1 wk |
| Staff mode field trial with 20 volunteers; UX fixes | Must | 2 wk |

Exit criteria: pilot site live with manual crowd updates and QR fallback; p95 ≤ 300 ms at 50k concurrent; zero P0 security findings.

## 7.3 Phase 2 — Hardware integration (Dec 2026 – Apr 2027)

| Work item | Priority | Notes |
|---|---|---|
| Wristband procurement (UHF EPC Gen2, printed QR), tag issuing tool (`POST /rfid/tags` bulk) | Must | lead time 8–12 weeks |
| Reader + gateway firmware: dedupe, buffer, batch POST, health heartbeat | Must | 4 wk, 1 embedded engineer |
| Camera counters: productionise the YOLOv8 + ByteTrack prototype (earlier trials) as a service posting line-crossing counts every 30 s per camera | Should | 4 wk + GPU boxes |
| Parking loop counters / barrier integration; pass scanner mode in staff app | Should | 3 wk |
| BLE beacons at help desks | Could | 2 wk |
| Field calibration: read-rate tests in crowd simulations, antenna placement | Must | 2 wk on site |

## 7.4 Phase 3 — Multi-site scale-out (Mar – May 2027)

Kubernetes with HPA, per-site WebSocket channels, read replicas, regional CDN, multi-site admin (site switcher), data onboarding for all sites, OSRM for city routing, full-scale load test (30 lakh sessions, 5k sightings/s), chaos drills (DB failover, reader outage), static-mode page.

## 7.5 Phase 4 — Festival operations and post-event (May – Aug 2027)

Training kits (20-minute staff module in te/hi), war-room rota, daily release window 02:00–04:00 only for hot-fixes, incident runbooks (doc 09), post-event anonymised analytics, personal-data deletion by 7 Aug 2027 (festival + 30 days), lessons-learned report.

## 7.6 MoSCoW summary

| Must | Should | Could | Won't (2027) |
|---|---|---|---|
| Crowd status + overrides + recommendations; map + routing; facilities; parking status + my spot; family + consent + QR fallback; missing-person workflow + board; SOS + contacts; alerts; trilingual PWA; admin + audit; RFID checkpoints at pilot site | Camera counters; FCM push; parking passes at scale; OSRM; GPS self-share; history charts | BLE beacons; predictive surge; shuttle ETA; heat advisories | UWB live tracking; ANPR; ticketing; drone integration |

## 7.7 Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Surveyed data arrives late | High | Routing/recommendations wrong | Import tool + field app for surveyors; demo seed clearly labelled; ship with manual-only mode |
| RFID read rates poor in crowds | Medium | Family feature distrust | QR fallback mandatory; UI says "last checkpoint"; calibration trials |
| Network saturation on peak days | High | App unusable on site | PWA cache, deltas, SMS alerts, help-desk Wi-Fi, static mode |
| Wristband procurement delay | Medium | No RFID at launch | Order by Dec; QR-only wristbands as fallback (printing 2 weeks) |
| Store review delays | Medium | No push | PWA is primary; store wrapper is additive |
| Privacy incident | Low | Legal/trust | Audit, minimisation, retention automation, DPIA, access reviews |
| Volunteer misuse of lookups | Medium | Privacy | Lookup only with open report; audit; training; revocation |
| Vendor SMS outage | Medium | No OTP | Two gateways; staff-assisted login at help desks |
