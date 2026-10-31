# 2. Product Requirements Document — Pushkar Sahayam

Godavari Pushkaralu Smart Crowd Management & Pilgrim Assistance Platform. Version 1.0, 2026-10-31.

## 2.1 Vision

One trilingual mobile experience that tells every pilgrim *where it is safe to go now*, gets them there, keeps their family together, and connects them to help in one tap — while giving organisers a live, trustworthy picture of 440 ghats across six districts during 26 June – 7 July 2027, when nearly 10 crore devotees and up to 1 crore bathers per day are expected (https://telanganatoday.com/ap-plans-high-tech-arrangements-for-godavari-pushkaralu-expects-10-crore-devotees).

Success metrics: median time-to-reunite for missing-child reports < 45 min at pilot site; ≥ 30 % of pilgrims at pilot site route to a non-peak ghat when their first choice is `high/critical`; zero stale readings shown as live; 99.9 % API availability over the 12 days.

## 2.2 Personas

| Persona | Needs | Constraints |
|---|---|---|
| **Pilgrim (Raju, 34, from Vijayawada, arriving by car with 5 family members)** | Parking, which ghat is bathable now, toilets/water, how to get back to the car | Weak signal in crowd, one phone for the family, Telugu |
| **Elderly pilgrim (Subbamma, 72)** | Accessible ghat and gate, rest areas, medical post, large text | Low tech literacy, may not own a smartphone — relies on family primary |
| **Family primary (Lakshmi, 41)** | Link wristbands for her children and mother, see last checkpoint, report missing fast | Hindi/Telugu; consent for minors; privacy of family's movement |
| **Help-desk volunteer (Kiran, 22, NSS volunteer)** | Scan a lost child's wristband/QR, see family contact, mark found, close report | Shared tablet or own phone, 10-hour shifts, noisy environment |
| **Control-room staff (Inspector Rao)** | Site-wide crowd picture, overrides, alerts, SOS queue, missing-person queue | Must trust data provenance; needs stale indicators |
| **Admin (IT cell)** | Device registry/keys, staff accounts, audit, data onboarding | Multi-site, accountable under DPDP |
| **Parking operator (contractor)** | Live occupancy, mark lot full/closed, scan passes | Uses a phone at the boom barrier |
| **Device / edge gateway** | Batch-post RFID sightings, counts, occupancy with a device key; buffer when offline | Power, 4G, dedupe |

## 2.3 Roles and permissions

| Capability | Anonymous | Pilgrim | Volunteer | Staff | Admin | Device |
|---|---|---|---|---|---|---|
| Read crowd status, map, facilities, parking, alerts, board, emergency contacts | ✔ | ✔ | ✔ | ✔ | ✔ | – |
| SOS (anonymous requires phone) | ✔ | ✔ | ✔ | ✔ | ✔ | – |
| Family create/join, members, tag consent, GPS self-share, last-seen (own family) | – | ✔ | ✔ | ✔ | ✔ | – |
| Missing-person report, own reports, withdraw | – | ✔ | ✔ | ✔ | ✔ | – |
| Parking pass, "my spot" | – | ✔ | ✔ | ✔ | ✔ | – |
| Post crowd readings / parking occupancy / manual tag scan / pass scan | – | – | ✔ | ✔ | ✔ | ✔ (own location) |
| Report queue, status transitions, tag lookup, SOS queue, overview | – | – | ✔ | ✔ | ✔ | – |
| Last-seen for *non-family* member (only with open report, audited) | – | – | – | ✔ | ✔ | – |
| Crowd override, alerts, location edit, parking patch, issue tags | – | – | – | ✔ | ✔ | – |
| Devices, staff accounts, audit log, ingestion health | – | – | – | – | ✔ | – |
| RFID sighting batches | – | – | – | – | – | ✔ |

Role rank is linear (`pilgrim < volunteer < staff < admin`), implemented in `backend/app/deps.py`.

## 2.4 Functional requirements

Tags: **SW** software only · **HW** needs hardware · **EXT** needs external service · **OFF** needs official cooperation/data. Priority P0 = must have for pilot, P1 = should, P2 = later.

### A. Real-time crowd management
| ID | Requirement | Pri | Tag |
|---|---|---|---|
| FR-A1 | Show every monitored ghat/gate with density level (`low/moderate/high/critical/unknown`), count, capacity, source and age; mark stale after 15 min | P0 | SW |
| FR-A2 | Accept readings from camera AI counters, RFID/turnstile counters and staff, batch up to 500 | P0 | SW (manual) / HW (auto) |
| FR-A3 | Staff override of a level with reason and expiry; override wins over readings | P0 | SW |
| FR-A4 | Recommend less-crowded alternatives of the same type ranked by level then distance | P0 | SW |
| FR-A5 | Push deltas to all clients within 2 s via WebSocket; clients reconcile on reconnect | P0 | SW |
| FR-A6 | 6–72 h history per location for charts and post-event analysis | P1 | SW |
| FR-A7 | Automatic counts from CCTV via YOLOv8 pipeline posting to the API | P1 | HW, OFF |
| FR-A8 | Predictive surge warning (next 30 min) from trend | P2 | SW |

### B. RFID family tracking & missing-person assistance
| ID | Requirement | Pri | Tag |
|---|---|---|---|
| FR-B1 | Family group with join code; up to 15 members; primary account manages members | P0 | SW |
| FR-B2 | Link an issued wristband UID to a member only with recorded consent (who, when); unlink anytime | P0 | SW + HW (tags) |
| FR-B3 | Ingest reader sightings in batches with 30 s dedupe per tag/location; ignore unissued tags | P0 | HW |
| FR-B4 | Family sees each member's last checkpoint and last 12 h of sightings; live `sighting` event to family sockets only | P0 | HW |
| FR-B5 | QR/manual scan fallback by any volunteer when a reader is absent | P0 | SW |
| FR-B6 | Adult self opt-in GPS sharing (foreground, ~60 s) visible to family | P1 | SW |
| FR-B7 | Staff last-seen lookup only when an open report exists for that member; every lookup audited | P0 | SW |
| FR-B8 | Nearest help desks returned with every last-seen result | P0 | SW |
| FR-B9 | Retention: sightings deleted festival + 30 days | P0 | SW |
| FR-B10 | BLE beacon proximity at help-desk enclosures | P2 | HW |

### C. Smart parking
| ID | Requirement | Pri | Tag |
|---|---|---|---|
| FR-C1 | Lots with total/occupied/free, status `open/filling/full/closed`, nearest gate, shuttle info, distance | P0 | SW |
| FR-C2 | Occupancy from counters (`delta`/`occupied`) or staff | P0 | SW (manual) / HW (auto) |
| FR-C3 | Recommend lot by ghat/vehicle type with free slots and shortest walk | P0 | SW |
| FR-C4 | Digital parking pass with QR token; scan marks used and increments occupancy | P1 | SW (scanner phone) |
| FR-C5 | "Remember my spot" (lot, row, note) | P0 | SW |
| FR-C6 | Directions lot → gate → ghat on the site walkway graph | P0 | SW |
| FR-C7 | ANPR / RFID vehicle identification | P2 | HW, OFF |

### D. Facilities locator
| ID | Requirement | Pri | Tag |
|---|---|---|---|
| FR-D1 | Trilingual catalogue of ghats, gates, help desks, medical, police, lost & found, toilets, water, changing rooms, food, rest areas, shuttle stops with coordinates, accessibility, open/closed, phone/hours | P0 | SW, OFF (data) |
| FR-D2 | Filter by type, "near me" sorted by distance, radius, accessible-only | P0 | SW |
| FR-D3 | Map with typed markers, density-coloured monitored markers, popups with call/directions | P0 | SW, EXT (tiles) |
| FR-D4 | Availability status edited by staff | P1 | SW |

### E. Missing-person & emergency
| ID | Requirement | Pri | Tag |
|---|---|---|---|
| FR-E1 | Report with minimum fields (name, contact), optional age/gender/clothing/description/last-seen/photo with explicit photo consent; 5 MB, JPEG/PNG/WebP | P0 | SW |
| FR-E2 | Max 3 open reports per pilgrim account; OTP-verified phone | P0 | SW, EXT (SMS) |
| FR-E3 | Workflow `open→verified→searching→found→closed`, `rejected`; transitions enforced; immutable event timeline | P0 | SW, OFF (SOP) |
| FR-E4 | Reporter sees own reports and can only withdraw; staff see queue filtered by status/site/desk; found auto-fills the volunteer's help desk | P0 | SW |
| FR-E5 | Public board of found persons: age group, gender, clothing, held-at desk — no name, no photo | P0 | SW |
| FR-E6 | Photo served only to reporter/staff, viewing audited | P0 | SW |
| FR-E7 | One-tap SOS (medical/police/lost child/fire/other) with confirm; returns 112/108/100 and three nearest posts; staff queue with acknowledge/dispatch/resolve | P0 | SW, OFF (dispatch) |
| FR-E8 | Emergency contacts page: national numbers, site control room, nearest posts | P0 | SW |
| FR-E9 | Push notification to reporter on status change | P1 | EXT (FCM/Web Push) |

### F. Navigation & assistance
| ID | Requirement | Pri | Tag |
|---|---|---|---|
| FR-F1 | Crowd-aware walking route on curated walkway graph; avoids `critical` and closed edges; accessible mode excludes stairs; ETA at 3.5 / 2.5 km/h | P0 | SW, OFF (graph survey) |
| FR-F2 | Route card: distance, ETA, steps, crowd notes, avoided zones; polyline on map | P0 | SW |
| FR-F3 | Deep link to phone maps app for off-site road leg | P1 | SW |
| FR-F4 | Alerts (info/warning/critical) trilingual, scoped to site/location, expiring; live delivery | P0 | SW |
| FR-F5 | Telugu, Hindi, English switch persisted; all primary flows translated | P0 | SW |
| FR-F6 | Installable PWA; offline cache of tiles, locations, last status with "last updated" | P0 | SW |
| FR-F7 | Native store wrappers (Capacitor) with FCM push | P1 | EXT |

### G. Administration & operations
| ID | Requirement | Pri | Tag |
|---|---|---|---|
| FR-G1 | Overview KPIs: levels, stale count, reports, SOS, parking, devices online, ingestion rate, WS connections | P0 | SW |
| FR-G2 | Device registry with one-time key display and revocation | P0 | SW |
| FR-G3 | Staff accounts with role, site, help desk | P0 | SW |
| FR-G4 | Audit log of personal-data access and privileged actions; masked recent sightings for ingestion health | P0 | SW |
| FR-G5 | Location and parking management UI | P1 | SW |
| FR-G6 | Bulk data onboarding (CSV) | P1 | SW, OFF |

### H. Additional features (innovation backlog)
| ID | Feature | Pri | Rationale |
|---|---|---|---|
| FR-H1 | Bathing slot suggestions ("best time for Pushkar Ghat today") from history | P2 | spreads load |
| FR-H2 | Volunteer broadcast to nearby staff when a vulnerable missing report is filed (`report.created` with `vulnerable` flag — implemented) | P0 | reunite faster |
| FR-H3 | Shuttle bus live position & ETA | P2 | HW (GPS on buses) |
| FR-H4 | Water-level / weather warnings from IMD/CWC feeds | P2 | EXT |
| FR-H5 | Heat-stress advisories by time of day | P2 | SW |
| FR-H6 | Senior-citizen priority queue token at accessible gate | P2 | OFF |
| FR-H7 | Post-event anonymised analytics (flows, dwell, peaks per ghat) | P1 | SW |

## 2.5 Non-functional requirements

| Area | Requirement |
|---|---|
| Availability | 99.9 % for API and PWA during 26 Jun – 7 Jul 2027; read-only static mode when API is down |
| Latency | p95 ≤ 300 ms for status/locations/parking reads (cached); p95 ≤ 800 ms for route; WS delta delivery ≤ 2 s from ingest |
| Scale | 20–30 lakh concurrent app sessions across all sites at peak hours; 10 crore cumulative users; RFID ingest 5,000 sightings/s aggregate after edge dedupe; 500 readings/s |
| Offline | App opens and shows last data without network; writes queued with retry; edge gateways buffer 24 h |
| Accessibility | WCAG 2.1 AA; 48 px targets; 17 px base; contrast ≥ 4.5:1; screen-reader labels; reduced-motion respected |
| Languages | te, hi, en for all pilgrim flows; admin in English |
| Security | TLS, JWT 12 h, hashed device keys, PBKDF2 passwords, OTP 5/h, rate-limited reports, security headers, CORS allow-list, input validation |
| Privacy (DPDP Act 2023) | Purpose limitation, consent records, data minimisation, access logging, retention festival+30 days, erasure on request, Indian data residency |
| Observability | `/health`, `/metrics`, structured logs, dashboards per site, alert rules |
| Maintainability | Typed contracts (Pydantic/TS), automated tests, seed data clearly labelled demo |

## 2.6 Operational challenges

1. **Connectivity collapse in dense crowds** — cell towers saturate at ≥ 20k people/km². Mitigation: cached PWA, small payloads, deltas, SMS fallback for critical alerts, on-site Wi-Fi at help desks.
2. **RFID read reliability** — human bodies attenuate UHF; children carried on shoulders face away from antennas. Mitigation: portal antennas both sides, QR fallback, dense checkpoints, expectation-setting in UI ("last checkpoint", never "current position").
3. **Data provenance** — staff must not trust a number without knowing its source/age. Mitigation: source + timestamp everywhere; stale flag; overrides visible.
4. **False or malicious reports** — rate limits, OTP, verification step, audit.
5. **Staff turnover** — 14,488 volunteers; training must fit in 20 min. Mitigation: staff mode with three actions only.
6. **Multi-district governance** — six districts, different collectors. Mitigation: per-site partitioning, site-scoped staff.

## 2.7 Dependencies and assumptions

* Organisers provide surveyed coordinates, capacities, walkway graph and facility list per site (demo seed is a placeholder).
* An SMS gateway with DLT-registered templates is contracted before pilot.
* Police/help-desk SOP defines who may verify and close reports.
* Wristband procurement and distribution desks are organised by the event authority.
* CCTV feeds are made available for the camera counting pipeline.
* Map tile licence (OSM policy for pilot; commercial tiles for scale).

## 2.8 Open questions / missing information

| Question | Owner | Blocks |
|---|---|---|
| Surveyed GPS of ghats, gates, facilities; safe capacities | District administration | FR-A1, D1, F1 |
| Checkpoint placement and power/network at each | Police + IT cell | FR-B3 |
| Number of wristbands and distribution process | Event authority | FR-B2 |
| SMS gateway, sender ID, DLT templates | IT cell | FR-E2 |
| CCTV camera list and RTSP access | Police | FR-A7 |
| Missing-person SOP and legal custody rules for minors | Police / WCD | FR-E3 |
| App store publisher account, FCM project | IT cell | FR-F7 |
| Tile provider contract | IT cell | FR-D3 |

## 2.9 Out of scope (v1)

Ticketing/e-passes for darshan, donations, live streaming, drone control, ANPR integration, hotel booking, multi-event reuse (designed for but not configured).
