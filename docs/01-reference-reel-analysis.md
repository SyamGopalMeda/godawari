# 1. Reference Reel Analysis Report

Analysis date: 2026-10-31. Four Instagram Reels were supplied as references for the Godavari Pushkaralu platform. This report records exactly what could be verified for each reel, what could not, and which concepts were adopted into the product. **Nothing below is inferred from a reel whose video could not be viewed.**

## 1.1 Method and access limitation

| Step | What was tried | Result |
|---|---|---|
| 1 | Direct fetch of each `instagram.com/reel/<id>/` page without a login | Reel 1 returned a partial logged-out page (caption, hashtags, like count, thumbnail alt-text, comments). Reels 2, 3 and 4 returned a page containing only the word "Instagram" (no caption, no media). |
| 2 | Fetch of the public embed endpoint `instagram.com/p/<id>/embed/` | Returned author handle, follower/post counts, like count and audio label for all four reels. No captions for reels 2–4; no video or description of visual content for any reel. |
| 3 | Web search for each reel id and author handle | No indexed copies, transcripts or news coverage of any of the four reels were found. |

**Why this happens.** Instagram serves full reel pages, captions and video only to logged-in sessions; its embed endpoint intentionally exposes just metadata. The video content is never available as text, so even a logged-in fetch would not yield a transcript. Search engines rarely index individual reels.

**Recommendation.** For a second pass, please share for each reel (a) a screenshot or screen recording, (b) the caption text, and (c) a short description of what the video shows. The analysis below will then be revised and any adopted features re-validated.

## 1.2 Reel-by-reel findings

### Reel 1 — `https://www.instagram.com/reel/De58_4wIUBv/`
| Item | Verified value |
|---|---|
| Author | `@shimeiliang3360` (11 posts, ~3K followers) |
| Caption | "Eliminate manual sheep counting errors on your farm" |
| Hashtags | #SheepFarm #SmartLivestock #AgricultureTech #FarmLife #LivestockCounting #SUNPN #PrecisionFarming |
| Engagement | ~25.2K likes, 123 comments; original audio; video credited to "Simone – Sales Consultant2026" |
| Thumbnail alt-text | "may be an image of sheep, calf and text" |
| Comments | Several ask where to buy "this device" and its price; one asks whether it works for cattle; one jokes about a "wallhack" (suggesting on-screen detection overlays). |
| Video content | **Not viewable.** |

**What can be concluded.** The reel markets a hardware product that counts livestock automatically as they move past a point, replacing manual counting. The counting technique (camera + computer vision versus RFID ear-tag gate reader) is **unverified**; the "wallhack" comment hints at visual overlays, which would point to vision-based counting, but this is a weak signal.

**Relevance adopted.** The verifiable concept is *automated counting of moving bodies through a chokepoint*. This maps directly to counting pilgrims entering and leaving gates and ghats. The platform therefore ingests counts from either a camera AI counter (the user's existing YOLOv8 + ByteTrack prototype from earlier trials) or an RFID/turnstile counter, both posting to `POST /api/v1/crowd/readings` with a device key. The *source* of every count is shown to users. **Continuous individual tracking is not inferred from this reel** and is not claimed by the platform.

### Reel 2 — `https://www.instagram.com/reel/DfGMVpnDfmt/`
| Item | Verified value |
|---|---|
| Author | `@etvyuva` (ETV Yuva — a Telugu news/youth media channel; 567 posts, 83K followers) |
| Caption | None retrievable |
| Engagement | 24,325 likes; original audio |
| Video content | **Not viewable without login.** |

**Limitation.** No features can be identified. Because ETV Yuva is a Telugu news channel, the reel is *plausibly* Pushkaralu-related coverage (e.g. preparations, ghat works, official announcements) — this is an **assumption, not a verified fact**, and nothing in the product is based on it.

### Reel 3 — `https://www.instagram.com/reel/DZHogXXgFdo/`
| Item | Verified value |
|---|---|
| Author | `@wtech_ai_agency` (207 posts, ~3K followers; handle suggests an AI services agency) |
| Caption | None |
| Engagement | 65 likes; original audio |
| Video content | **Not viewable.** |

**Limitation.** Nothing is inferred. The handle alone does not indicate what the video demonstrates.

### Reel 4 — `https://www.instagram.com/reel/Db03NOvo6B0/`
| Item | Verified value |
|---|---|
| Author | `rammcodes_` (438 posts, 217K followers; a developer/creator account) |
| Caption / audio | Audio credit "Tao · Plage Coquillage (First Kiss Song)"; embed UI labels rendered in Telugu |
| Engagement | 5,481 likes |
| Video content | **Not viewable.** |

**Limitation.** Nothing is inferred about the app or technique shown.

## 1.3 What the product is actually based on

Since three of four reels are unverifiable, the design draws on (a) the one verifiable concept from Reel 1 and (b) publicly reported official plans for Godavari Pushkaralu 2027:

* The 12-day festival runs 26 June – 7 July 2027; nearly 10 crore devotees are expected, roughly 1 crore bathers per day at peak; 440 ghats (259 existing + 181 new) across six districts; officials list AI-based crowd analytics, CCTV monitoring, drones, QR-based vehicle identification, 30 temporary field hospitals, 2,697 rescue boats and 487 green buses — https://telanganatoday.com/ap-plans-high-tech-arrangements-for-godavari-pushkaralu-expects-10-crore-devotees
* The Chief Minister asked for AI-driven crowd management and real-time monitoring, and a model ghat at Rajamahendravaram — https://www.deccanchronicle.com/southern-states/andhra-pradesh/govt-plans-comprehensive-facilities-for-godavari-pushkaralu-2027-1970197 and https://www.deccanchronicle.com/amp/southern-states/andhra-pradesh/naidu-reviews-godavari-pushkaram-works-1932242
* Telangana police plan watchtowers, command-and-control centres, CCTV and drone surveillance, rapid response teams — https://www.deccanchronicle.com/southern-states/telangana/dgp-reviews-security-preparations-for-godavari-pushkaralu-2027-1974025
* 14,488 volunteers from 39 organisations planned for the Rajahmundry district — https://www.thehansindia.com/news/cities/rajahmundry/14488-volunteers-to-be-deployed-for-pushkaralu-1123537
* None of the sources mention RFID; the closest official plan is QR-based vehicle identification.

| Concept | Evidence | Platform feature | Needs |
|---|---|---|---|
| Automated counting at a chokepoint | Reel 1 (verified caption/hashtags) | Gate/ghat occupancy via `POST /crowd/readings` from camera AI or RFID counters; density level derived from capacity; staff manual fallback | Cameras + GPU or RFID portals (hardware) |
| AI crowd analytics / real-time monitoring | Official plans | Admin dashboard KPIs, live map, WebSocket `crowd.updated`, staff overrides, stale-data flag | CCTV feed access (official cooperation) |
| QR-based vehicle identification | Official plans | Digital parking pass with `qr_token`; scan at entry increments occupancy | Scanner phone at lot entry |
| Command-and-control, volunteers, help desks | Official plans | Staff mode (manual wristband scan, report queue, SOS queue), reunification workflow, non-identifying public board | Police/help-desk SOP integration |
| Field hospitals, medical camps | Official plans | Facility locator with medical/police/help-desk types, nearest posts in SOS response | Surveyed facility list |
| Family wristbands (RFID checkpoint model) | **Not from reels or official plans** — a product decision in the brief | Consent-gated tag linking, checkpoint sightings, last-seen lookup, QR fallback, GPS opt-in | UHF readers, wristbands, edge gateways (hardware) |

## 1.4 Explicit non-claims

* No reel was found to demonstrate RFID family tracking, parking occupancy, crowd heatmaps or navigation; those features come from the project brief, not from the references.
* The platform does not claim continuous person tracking; RFID gives presence at a reader only (see architecture §3.5.2).
