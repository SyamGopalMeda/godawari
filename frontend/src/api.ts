/* Typed API client. Mirrors backend/app/schemas.py. */

export const API = '/api/v1'
const TOKEN_KEY = 'ps.token'

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}
export function setToken(t: string | null) {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY) } catch { /* private mode */ }
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

async function request<T>(method: string, path: string, body?: unknown, opts: { form?: FormData; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token && opts.auth !== false) headers['Authorization'] = `Bearer ${token}`
  let payload: BodyInit | undefined
  if (opts.form) payload = opts.form
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body) }
  const res = await fetch(API + path, { method, headers, body: payload })
  if (res.status === 204) return undefined as T
  const text = await res.text()
  let data: unknown = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!res.ok) {
    const detail = (data as { detail?: unknown })?.detail
    const msg = typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d: { msg?: string }) => d.msg).join(', ') : res.statusText
    throw new ApiError(res.status, msg)
  }
  return data as T
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b),
  postForm: <T>(p: string, f: FormData) => request<T>('POST', p, undefined, { form: f }),
  patch: <T>(p: string, b?: unknown) => request<T>('PATCH', p, b),
  put: <T>(p: string, b?: unknown) => request<T>('PUT', p, b),
  del: <T>(p: string) => request<T>('DELETE', p),
}

// ---- types
export type Lang = 'te' | 'hi' | 'en'
export type Level = 'low' | 'moderate' | 'high' | 'critical' | 'unknown'
export type Role = 'pilgrim' | 'volunteer' | 'staff' | 'admin'

export interface User { id: number; phone: string | null; name: string | null; role: Role; preferred_lang: Lang; site_id: number | null; help_desk_location_id: number | null }
export interface Site {
  id: number; code: string | null; name: string; name_te: string | null; name_hi: string | null; state: string | null; district: string | null
  center_lat: number; center_lng: number; emergency_contacts: Record<string, string>; source: string | null; source_ref: string | null
  citations: string[]; sort_order: number; ghats_total: number; ghats_mapped: number; facilities: number
}
/** official = confirmed by organisers/admin · source = position from OpenStreetMap, not yet confirmed · unverified = named, no verified position · unavailable = closed/removed · demo = synthetic */
export type Verification = 'official' | 'source' | 'unverified' | 'unavailable' | 'demo'

export interface Location {
  id: number; code: string; site_id: number; type: string; name: string; name_te: string | null; name_hi: string | null
  /** null when the position has not been verified: never place such a location on a map or route to it */
  lat: number | null; lng: number | null; capacity: number | null; is_accessible: boolean; is_open: boolean; monitored: boolean
  current_count: number | null; density_level: Level; density_source: string | null; density_updated_at: string | null
  details: Record<string, unknown>; distance_m?: number | null; is_stale?: boolean | null
  verification: Verification; source: string | null; source_ref: string | null; source_retrieved_at: string | null
  verified_at: string | null; verification_note: string | null
}
export interface CrowdStatus {
  location_id: number; code: string; name: string; name_te: string | null; name_hi: string | null; type: string; lat: number | null; lng: number | null
  capacity: number | null; current_count: number | null; density_level: Level; source: string | null; updated_at: string | null
  is_stale: boolean; override: boolean; is_open: boolean
}
export interface Recommendation { location: CrowdStatus; distance_m: number | null; score: number; reason: string }
export interface RouteStep { instruction: string; distance_m: number; zone_level: Level | null; maneuver?: string | null; modifier?: string | null; name?: string | null }
export interface Route {
  polyline: [number, number][]; distance_m: number; eta_min: number; steps: RouteStep[]; crowd_notes: string[]; avoided_zones: string[]; accessible: boolean
  /** walkways = organiser walkway graph (crowd-aware) · osrm = OpenStreetMap footpaths */
  provider: 'walkways' | 'osrm'; attribution: string | null; notes: string[]
}
export interface Nearby { location_id: number; has_coords: boolean; radius_m: number; groups: Record<string, Location[]> }
/** Mapped = has verified coordinates. */
export function hasCoords<T extends { lat: number | null; lng: number | null }>(l: T): l is T & { lat: number; lng: number } { return l.lat != null && l.lng != null }
/** Directions in the phone's maps app (origin = current location). */
export function externalDirections(lat: number, lng: number): string { return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking` }
export function osmLink(lat: number, lng: number): string { return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}` }
export interface ParkingLot {
  id: number; location: Location; total_slots: number; occupied_slots: number; free_slots: number; occupancy_pct: number
  vehicle_types: string[]; nearest_gate: Location | null; shuttle_info: string | null; status: 'open' | 'filling' | 'full' | 'closed'
  source: string | null; updated_at: string | null; distance_m?: number | null
}
export interface ParkingPass { id: number; lot_id: number; vehicle_number: string; vehicle_type: string; qr_token: string; status: string; issued_at: string; used_at: string | null }
export interface ParkingSpot { lot_id: number; row_label: string | null; note: string | null; saved_at: string }
export interface Sighting { location_id: number; location_name: string; location_code: string; lat: number; lng: number; seen_at: string; direction: string; method: string }
export interface Member {
  id: number; family_id: number; user_id: number | null; display_name: string; age_group: 'child' | 'adult' | 'senior'; relation: string | null
  is_vulnerable: boolean; phone: string | null; rfid_tag_uid: string | null; consent_given_at: string | null; gps_sharing: boolean
  last_seen: Sighting | null; gps: { lat: number; lng: number; at: string } | null
}
export interface Family { id: number; name: string; primary_user_id: number; join_code: string; created_at: string; members: Member[] }
export interface LastSeen { member_id: number; display_name: string; tag_uid: string | null; consented: boolean; last_checkpoint: Sighting | null; recent: Sighting[]; gps: { lat: number; lng: number; at: string } | null; nearest_help_desks: Location[] }
export interface Report {
  id: number; reporter_user_id: number; member_id: number | null; site_id: number | null; subject_name: string; age: number | null; gender: string | null
  description: string | null; clothing: string | null; has_photo: boolean; last_seen_location_id: number | null; last_seen_at: string | null; contact_phone: string | null
  status: 'open' | 'verified' | 'searching' | 'found' | 'closed' | 'rejected'; assigned_staff_id: number | null; help_desk_location_id: number | null
  created_at: string; updated_at: string; resolved_at: string | null
}
export interface ReportEvent { id: number; actor_id: number | null; event_type: string; note: string | null; created_at: string }
export interface BoardEntry { id: number; age_group: string; gender: string | null; clothing: string | null; held_at: Location | null; since: string }
export interface Alert { id: number; title: string; body: string; title_te: string | null; body_te: string | null; title_hi: string | null; body_hi: string | null; severity: 'info' | 'warning' | 'critical'; site_id: number | null; location_id: number | null; starts_at: string; expires_at: string | null; created_at: string }
export interface Sos { id: number; user_id: number | null; phone: string | null; lat: number | null; lng: number | null; type: string; note: string | null; status: string; assigned_to: number | null; created_at: string; updated_at: string }
export interface SosResponse { request: Sos; call: Record<string, string>; nearest: Location[] }
export interface EmergencyContacts { national: Record<string, string>; site: Record<string, string>; nearest_posts: Location[] }
export interface Device { id: number; name: string; type: string; location_id: number | null; status: string; last_seen_at: string | null; created_at: string; api_key?: string }
export interface Overview {
  crowd: { by_level: Record<Level, number>; stale: number }; reports: Record<string, number>; sos: Record<string, number>
  parking: { lots: number; total_slots: number; occupied: number; full: number }; devices: { online: number; total: number }
  ingestion: { sightings_last_10m: number }; websocket: { connections: number; messages_sent: number }; generated_at: string
}
export interface AuditEntry { id: number; actor_id: number | null; device_id: number | null; action: string; entity: string | null; entity_id: string | null; purpose: string | null; created_at: string }

export interface LiveEvent { type: string; data: Record<string, unknown>; ts?: string }

// ---- helpers
export function fmtDist(m?: number | null): string {
  if (m == null) return ''
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`
}
export function timeAgo(iso?: string | null): string {
  if (!iso) return '—'
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return new Date(iso).toLocaleDateString()
}
export function getPosition(timeoutMs = 8000): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null)
    navigator.geolocation.getCurrentPosition((p) => resolve(p), () => resolve(null), { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 })
  })
}
// Demo fallback position (centre of the demo site) when GPS is unavailable, e.g. on a desktop.
export const DEMO_POS: [number, number] = [17.0030, 81.7805]
