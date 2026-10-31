# 10. UI/UX Redesign: Design System v3 (corporate, fully responsive)

> **v3, 2026-10-31.** After review the brief changed to a clean, premium, corporate look in the GloomDev brand, fully responsive with an optimized desktop UI. v3 replaces the mobile-only v2 layout. Sections 10.1 and 10.3–10.6 (audit, honesty rules, permissions, offline) still apply. Section 10.0 below describes v3, and 10.2 describes the v2 visual layer it supersedes.

## 10.0 Design system v3

**Problem with v2 on larger screens.** At 1440 px the app was a 720 px phone column with a floating bottom tab bar and empty space on both sides. Hexagon tiles, leather grain and decorative networks read as playful rather than corporate.

**Responsive shell** (`frontend/src/components/Shell.tsx`):

| Width | Navigation | Top bar |
|---|---|---|
| < 768 px (phones) | 5 bottom tabs: Home, Explore, Family, Services, Profile | brand, language, notifications, SOS |
| 768–1023 px (tablets) | 88 px icon rail with all destinations | live-data status, language, notifications, Emergency, account |
| ≥ 1024 px (desktop) | 256 px sidebar grouped as Overview / Services / Help / Account (+ Staff), GloomDev credit | page title, live-data status, language, notifications, Emergency, account |

Bottom sheets become centred dialogs from 768 px. Toasts move to the bottom-right corner. Content is capped at 1280 px with a 16 / 28 / 40 px gutter.

**Layout primitives** (`frontend/src/styles.css`):
- `.cols` gives 1, 2 or 3 columns.
- `.auto-grid` holds card collections.
- `.layout-aside` puts the main column beside a sticky 320–400 px aside from 1024 px.
- `.layout-split` puts a list beside a sticky map from 1024 px.
- `.narrow` limits forms to 680 or 480 px.
- Visibility helpers show or hide content per breakpoint, and the `useBreakpoint()` hook does the same in code.

**Screens on desktop:**
- **Home** is a dashboard: quick actions, a live-crowd card with stat tiles, and nearby facilities. The aside holds location, the map and alerts.
- **Explore, Crowd and Facilities** show the list and map side by side.
- **Parking, Family, Missing, Emergency and Profile** use a main column plus aside, or two columns of cards.
- **Onboarding and Login** are centred cards.
- **Staff mode and the admin control room** use the same system.

**Visual language:**
- **Surfaces.** White on warm grey (`#F6F4F2`) with hairline borders (`#E7E1DC`). Shadows appear only on floating layers.
- **Brand colour.** GloomDev espresso `#2C1A10` is reserved for primary actions, active navigation, the brand mark and selected states. Copper `#A65F2A` is the focus and accent colour.
- **Status colours.** Crowd status stays green, amber, orange and red, always with icon and words. Danger red is used only for emergency actions.
- **Shape.** Radii are 8–14 px.
- **Typography.** Inter for Latin, with Hind Guntur for Telugu and Hind for Devanagari, all with `display=swap`. The scale is 12 / 14 / 16 / 18 / 21 / 26 / 32 px, with titles at 26–32 px on desktop. Section headings use a 600–650 weight.
- **Icons.** One Lucide icon set everywhere. The app contains no emoji.
- **Touch.** Phones, tablets and any touch pointer get 44 px minimum targets. Mouse-driven desktop uses denser 36–42 px controls.
- **Map.** Faded warm-grey basemap, so crowd-status pins carry the colour. Category pins use brand neutrals only.
- **Dark mode.** A warm espresso theme. Primary fills invert to light with dark text.


This document records the audit of the first mobile UI, the v2 design system, the navigation model, how each screen behaves, and how the redesign was verified. It supersedes the visual parts of [05-user-journeys-and-ux.md](05-user-journeys-and-ux.md); the journeys there still apply.

Backend APIs, database, authentication and business rules were not changed. One dev-tooling change was made: the Vite proxy target is configurable with `PUSHKAR_API_PROXY`.

## 10.1 Audit of the v1 mobile UI

| # | Problem found | Effect on pilgrims | v2 fix |
|---|---|---|---|
| 1 | Emoji used as icons | Render differently per Android OEM and OS version; screen readers read "palm tree", "worried face" | One SVG icon set (Lucide), `aria-hidden`, words always next to icons |
| 2 | Home asked for GPS on first paint, then silently used a fake "demo position" | Unexplained permission prompt in a crowd; distances shown from a place the user is not at | Location is requested only after a tap, with the reason shown first. Declining offers "I am near…" (gate, ghat, help desk). Nothing is faked |
| 3 | Every page requested GPS separately | Battery drain, repeated prompts | One location provider, one fix refreshed every 60 s only while the app is visible |
| 4 | Header crammed brand + 3 language buttons + SOS | Overflow at 320 px in Telugu | Compact header: brand, one language button (sheet), notifications bell, SOS |
| 5 | Amber status text on amber background (2.6:1) | Unreadable in sunlight | All status pairs ≥ 4.5:1; sunlight (high-contrast) mode |
| 6 | Crowd status mostly colour-coded | Colour-blind users cannot tell levels apart | Every level = shape icon + words (circle-check / minus / triangle / octagon / question) on chips and map pins |
| 7 | Parking values had no staleness rule; times were English-only ("5 min ago") | Old counts looked current; English leaked into Telugu screens | `Freshness` component on every live value (live / staff update / delayed / not recent / no data), localized relative time |
| 8 | Nothing survived a reload without signal | Blank screen exactly when connectivity fails at the ghats | Last good snapshot persisted with its time; header bar says "Offline · showing data from 10:42" |
| 9 | SOS result said "Staff will contact you shortly" | Implies dispatch that the system cannot guarantee | Official numbers first; in-app request labelled "not a substitute for 112"; result says what actually happened |
| 10 | Missing-person report was one long form | Hard to complete under stress | 5 guided steps with validation, prefill from the family member, review before sending |
| 11 | Parking pass submit had no in-flight guard | Duplicate passes on flaky networks | `useSubmit` guard on every write; buttons show progress |
| 12 | Leaflet CSS loaded from a CDN; 556 kB single bundle including admin | Broken map offline; slow first load on mid-range phones | CSS bundled; map, staff and admin code split into lazy chunks |
| 13 | Crowd list fetched 6-hour history for every card | N requests per render | History fetched only when a place's detail opens |
| 14 | Leaflet popups for place details | Tiny touch targets on a phone | Tap a pin → bottom card with large actions |
| 15 | No onboarding, notifications inbox, services directory, list alternative to maps | Hard for first-time and elderly users | Added all four |

## 10.2 Design system

Defined once in `frontend/src/styles.css` as CSS custom properties; components in `frontend/src/components/ui.tsx`.

**Brand: GloomDev.** The theme follows the GloomDev identity (logo: espresso cloud with node network, dashed hexagon network, "Empowering Innovation Through Technology"). The event name "Pushkar Sahayam / Pushkaralu 2027" stays on the header; a "Designed & developed by GloomDev" credit with the official logo appears on the first launch screen and in Profile → About.

**Colour.** Primary is GloomDev espresso `#2C1A10`, sampled from the logo, with a scale from `#170C07` to `#FAF6F3`. It sits on white and warm off-white (`#FAF8F6`) surfaces with warm neutrals. Copper `#A65F2A` and sage `#4F5E2E` give category tiles some variety. Dark mode is a warm espresso theme with a separate "brand ink" token, so brand-coloured text stays readable on dark tints.

Crowd status colours are deliberately **not** brand colours. They stay green, amber, orange and red, always with icon and words, AA on white and on their tint:

| Level | Words (en) | Icon | Text | Fill |
|---|---|---|---|---|
| low | Light crowd | circle-check | `#1B7332` | `#2E9B4A` |
| moderate | Moderate crowd | circle-minus | `#835600` | `#E3A21A` |
| high | Heavy crowd | triangle-alert | `#B3300A` | `#E2531D` |
| critical | Very heavy – avoid | octagon-alert | `#9B1C1C` | `#C8241F` |
| unknown / stale | No recent data | circle-help | `#5F5A57` | `#948C87` |

On the map, category pins use only brand neutrals: espresso for amenities, gates and ghats without data, white with espresso for help points, and mocha for parking. Traffic-light colours therefore always mean crowd status. The basemap is muted to a warm grey so tile POIs do not compete with status pins.

**Brand motifs.** All are taken from the logo:
- The header is espresso with a subtle leather grain and a faint dashed-hexagon network.
- The brand mark and the quick-action icon tiles are hexagons.
- Section titles carry small copper hexagon markers.
- A dashed hexagon network sits behind the Home greeting and the onboarding screens.

All motifs are decorative, hidden from screen readers, and cost under 2 kB as inline SVG.

**Type.** Hind (Latin + Devanagari) and Hind Guntur (Telugu) by Indian Type Foundry: one humanist family across all three scripts, close to the GloomDev tagline lettering. Weights 400/600/700 load from Google Fonts with `display=swap`, so text renders immediately in the pre-installed Noto fonts and switches when the brand font arrives. The service worker caches the font files for a year, so they work offline after the first visit. Base size is 17 px with 1.5 line height for tall Telugu glyphs. "Large text" raises the base to 19.5 px.

**Spacing and shape.** 4 px grid (4–32), 16 px gutter on phones and 24 px from 720 px. Radii 10 / 14 / 20 / 28. Two shadow levels, no gradients.

**Touch.** 48 px minimum for primary controls, 40 px for secondary chips; navigation in the bottom thumb zone; emergency in the header, outside the navigation arc.

**Modes.** Light (default for outdoor use), dark (system or forced), sunlight high-contrast, large text, vibration on/off. All are stored per device.

**Motion.** 180 ms page fade-in, 240 ms sheet slide-up, skeleton shimmer, success pop. `prefers-reduced-motion` disables all of them. Haptics are 10–20 ms taps on confirmations; a distinct pattern marks errors.

**Components.** StatusBadge, Freshness, Meter, PageHead, Section, ListRow, PlaceRow, Skeleton, EmptyState, ErrorState, Notice, Segmented, FilterChips, Avatar, Field, Stepper, SubmitButton with useSubmit, Sheet with focus handling, Toast, LanguagePicker, LoginGate, QrScanner, LazyMap and MapView with MapFabs.

## 10.3 Navigation

Bottom navigation with five destinations: **Home · Explore (map) · Family · Services · Profile**. Header: brand → Home, language sheet, notifications bell with an unread count, and an **SOS** button that opens the emergency screen; it never sends anything by itself.

| Task | Taps from Home |
|---|---|
| See crowd at my nearest gate | 0 (location card) |
| Find the nearest toilet | 1 (Facilities near me) or 0 (nearby list) |
| Walking route to a less crowded ghat | 1 (alternative → directions) |
| Where is my child's wristband last seen | 2 (Family → Find family member) |
| Call an ambulance | 2 (SOS → 108) |
| Report a missing person | 1 to start, 5 short steps |
| Find my vehicle | 1 (Find parking → card at the top) |

Deep links stay stable for staff messages and QR posters: `/map?to=<id>`, `/map?sel=<id>`, `/facilities?type=restroom,water&accessible=1`, `/missing?member=<id>`, `/login?next=`.

## 10.4 Honesty rules enforced in the UI

1. A crowd level is shown only if its reading is newer than 15 minutes (server rule). Older readings show "No recent data – last reading 42 min ago".
2. Every live value carries its source and age: Live (camera, RFID, sensor), Staff update (manual), Delayed (5–15 min), Not recent.
3. Waiting times are not shown anywhere, because no verified data source exists.
4. Alternative gates and ghats are suggested only when they are open, fresh and light or moderate.
5. Family tracking states are Current (≤ 15 min), Delayed (≤ 2 h), Not recent, Not yet detected and No wristband. A location is never shown without a detection. The screen explains that wristbands are read only at checkpoints.
6. Emergency separates official calls from the in-app control-room request. It states what location will be attached, and after sending it never says help has been dispatched.
7. Offline and paused states always show the time of the data on screen.
8. Seed data is labelled as demo on Home, on the map legend and in Profile.

## 10.5 Permissions

| Permission | Asked when | If declined |
|---|---|---|
| Location | Tap on "Use my location" (onboarding step 3, Home, Map, Emergency) | Choose "I am near…"; lists are sorted by name |
| Camera | Tap on "Scan" (parking zone QR, wristband QR) | Type the code |
| Notifications | Never (push not implemented) | In-app alerts over the live connection |

No feature requires an account to read crowd, map, facility, parking or emergency information. A phone OTP is needed only for family tracking, missing-person reports and parking passes, and each screen says why.

## 10.6 Performance and offline behaviour

- The Leaflet map, staff and admin screens are separate lazy chunks; the pilgrim core loads first.
- Reference data (all places) is fetched once per 10 minutes and shared by every screen; status is pushed over WebSocket, with 60 s polling only when the socket is down.
- The last good snapshot (status, places, alerts, parking) is kept on the device and shown immediately on open, labelled with its time.
- Map tiles are cache-first in the service worker (14 days); API reference data is network-first with a 4 s timeout.
- One GPS fix per minute while visible, never in the background.
- Writes cannot be double-submitted.

## 10.7 Verification

Automated phone-size audit (`frontend/scripts/ux-audit.mjs`): Chrome headless at 360×780 and 320×700, touch and mobile emulation, real API and seeded data. Every screen is rendered in Telugu, Hindi and English. The audit checks horizontal overflow, elements past the screen edge, interactive elements under 40 px, console errors, and offline rendering.

<!-- RESULTS -->
### Run — 2026-10-31

| Check | Environment | Result |
|---|---|---|
| Phone audit, 16 screens × Telugu / Hindi / English | Production Docker build (Nginx + service worker + PostgreSQL), 360×780 | **49 / 49 clean**: 0 horizontal overflow, 0 elements past the edge, 0 interactive elements under 40 px, 0 console errors |
| Phone audit, narrowest phones | Dev build, 320×700, Telugu and Hindi | **33 / 33 clean** |
| Offline | Load online, cut the network | Saved snapshot renders with "Offline · showing data from 04:35 pm" |
| Frontend integration tests (jsdom, live API) | `npm test` | **29 passed** (every route in Telugu, five-tab navigation, onboarding on first launch, no location prompt on load, map pins, language sheet, emergency wording, family creation, guided missing report, staff and admin routes, role redirect) |
| Backend tests | `pytest` | **47 passed** (46 existing + 1 new timezone regression test) |
| Type-check + production build | `npm run build` | Clean |

**First-load size for a pilgrim** (JS + CSS, gzip): **129 kB**, down from 165 kB. Leaflet (46 kB) loads only when a map is shown. Admin, staff, family, missing, parking, profile, login, onboarding and alerts are separate chunks, and all 39 chunks are precached by the service worker, so they still open offline after the first visit.

**Defects found by the audit and fixed during the redesign**

1. *Timestamps without a UTC offset (backend).* SQLite returned naive datetimes, so browsers read fresh readings as 5.5 hours old (IST). The status chip (server-computed) and the freshness label (client-computed) disagreed. Fixed with a UTC-aware column type in `backend/app/models.py`; a regression test was added. PostgreSQL output now also ends in `Z`.
2. *Map pins rendered a nested React root during render.* This produced React errors on every map. SVGs are now pre-rendered once when the map chunk loads.
3. *Letter-by-letter wrapping* of names inside flex rows was caused by `overflow-wrap: anywhere`. It is now `break-word`.
4. *Header brand overlapping the language button.* The brand text now truncates and uses a short title ("Pushkaralu 2027").
5. *Emergency call buttons* split words and phone numbers in a two-column grid. They are now full-width.
6. *Route to an over-capacity ghat* showed a generic "no route" message. It now says the ghat is over its safe capacity, offers verified light or moderate alternatives, and does not request a route the server will refuse.
7. *Race:* the route was requested before place data arrived. It now waits.
8. *Basemap:* CARTO tiles showed an "API key required" watermark, so the default was reverted to OpenStreetMap. `VITE_TILE_URL` selects a contracted tile provider for the event.
9. *Header brand link* was 39 px tall; it is now 44 px.

Screenshots: [docs/screenshots/](screenshots/) (English and Telugu at 360 px, Hindi crowd status, Telugu at 320 px, offline state). The full machine-readable report is `docs/screenshots/ux-audit-report.json`.

### Re-run after applying the GloomDev theme — 2026-10-31

| Check | Result |
|---|---|
| Phone audit, production build, 16 screens × te / hi / en at 360 px | **49 / 49 clean** |
| Telugu at 320 px | **17 / 17 clean** |
| Frontend integration tests | **29 passed** |

The theme review found one safety issue: copper and gold category pins looked like the amber and orange crowd levels. Category pins now use brand neutrals only, and the basemap is muted. The audit harness now uses a fresh test phone and fresh wristbands per run, because repeated runs had hit the API's OTP abuse limit, which is working as designed.

### Verification of v3 — 2026-10-31

Production Docker build (Nginx + service worker + PostgreSQL). Each render checks horizontal overflow, elements past the edge, undersized targets, console errors, and that the right navigation shows at that width. The minimum target is 40 px below 1024 px and 32 px for mouse-driven desktop; touch layouts render 44 px controls.

| Pass | Viewports | Screens | Result |
|---|---|---|---|
| English | 360×780, 390×844, 768×1024, 1024×768, 1440×900, 1920×1080 | 21 pilgrim, staff and admin screens + offline | **127 / 127 clean** |
| Telugu | 360×780, 1440×900 | same | **43 / 43 clean** |
| Hindi | 390×844, 1024×768 | same | **43 / 43 clean** |
| Frontend integration tests | jsdom against the live API | 29 | **29 passed** |
| Backend tests | pytest | 47 | **47 passed** |

Defects found during the v3 audit and fixed:
- Filter chips, segmented controls and language buttons were 36–38 px on touch screens. They are now 44 px.
- Staff and admin screens still used emoji icons, 24 px status filters and 17 px text links as actions. They now use Lucide icons, 44 px toggles and real buttons.
- An admin dashboard alert row overflowed phone screens. Alerts now stack.
- The deprecated emoji icon map was deleted. No emoji remain in the app.

**Not verified here.** Real Android devices (only Chrome mobile emulation), TalkBack screen-reader walkthroughs, real outdoor sunlight readability, and QR scanning with a physical camera (BarcodeDetector exists only on real Chrome for Android) still need checking. The manual checklist in [08](08-testing-plan-and-results.md) §8.3 covers these.
<!-- /RESULTS -->
