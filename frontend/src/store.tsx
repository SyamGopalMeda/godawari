/* Auth + live data store shared by all pages.
   - Hydrates instantly from the last successful snapshot (localStorage) and labels it with its time,
     so a pilgrim with no signal still sees the last known status - never presented as live.
   - Reference data (all places) is fetched once and refreshed every 10 min; status every reload.
   - WebSocket deltas keep crowd/parking/alerts current; when the socket is down we poll every 60 s. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, getToken, setToken, type Alert, type CrowdStatus, type LiveEvent, type Location, type ParkingLot, type Site, type User } from './api'

interface Snapshot { site: Site | null; crowd: CrowdStatus[]; parking: ParkingLot[]; alerts: Alert[]; locations: Location[]; at: number; locAt: number }

interface Store {
  user: User | null
  token: string | null
  loginWithToken: (token: string, user: User) => void
  logout: () => void
  refreshUser: () => Promise<void>
  site: Site | null
  crowd: CrowdStatus[]
  parking: ParkingLot[]
  alerts: Alert[]
  locations: Location[]
  /** locations with live crowd status merged in (use this for maps and lists) */
  places: Location[]
  online: boolean
  wsConnected: boolean
  syncing: boolean
  /** epoch ms of the last successful status fetch (null = never) */
  lastSync: number | null
  /** true while showing a stored snapshot that has not been refreshed in this session */
  fromCache: boolean
  lastEvent: LiveEvent | null
  reload: () => Promise<void>
  subscribe: (fn: (e: LiveEvent) => void) => () => void
  loadError: string | null
  unreadAlerts: number
  markAlertsSeen: () => void
}

const Ctx = createContext<Store | null>(null)
const SNAP_KEY = 'ps.snapshot.v2'
const SEEN_KEY = 'ps.seenAlerts'
const LOC_TTL = 10 * 60 * 1000

function readSnap(): Snapshot | null { try { const v = localStorage.getItem(SNAP_KEY); return v ? JSON.parse(v) : null } catch { return null } }
function writeSnap(s: Snapshot) { try { localStorage.setItem(SNAP_KEY, JSON.stringify(s)) } catch { /* quota or private mode */ } }
function readSeen(): number[] { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '[]') } catch { return [] } }

export function StoreProvider({ children }: { children: ReactNode }) {
  const snap0 = useRef(readSnap()).current
  const [token, setTok] = useState<string | null>(getToken())
  const [user, setUser] = useState<User | null>(null)
  const [site, setSite] = useState<Site | null>(snap0?.site ?? null)
  const [crowd, setCrowd] = useState<CrowdStatus[]>(snap0?.crowd ?? [])
  const [parking, setParking] = useState<ParkingLot[]>(snap0?.parking ?? [])
  const [alerts, setAlerts] = useState<Alert[]>(snap0?.alerts ?? [])
  const [locations, setLocations] = useState<Location[]>(snap0?.locations ?? [])
  const [lastSync, setLastSync] = useState<number | null>(snap0?.at ?? null)
  const [fromCache, setFromCache] = useState<boolean>(!!snap0)
  const [online, setOnline] = useState(navigator.onLine)
  const [wsConnected, setWs] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [lastEvent, setLastEvent] = useState<LiveEvent | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [seen, setSeen] = useState<number[]>(readSeen)
  const listeners = useRef(new Set<(e: LiveEvent) => void>())
  const locAt = useRef<number>(snap0?.locAt ?? 0)
  const busy = useRef(false)

  const reload = useCallback(async () => {
    if (busy.current) return
    busy.current = true; setSyncing(true)
    try {
      const needLocs = Date.now() - locAt.current > LOC_TTL
      const [sites, c, p, a, l] = await Promise.all([
        api.get<Site[]>('/sites'), api.get<CrowdStatus[]>('/crowd/status'), api.get<ParkingLot[]>('/parking'), api.get<Alert[]>('/alerts/active'),
        needLocs ? api.get<Location[]>('/locations?limit=2000') : Promise.resolve(null),
      ])
      const now = Date.now()
      if (l) { locAt.current = now; setLocations(l) }
      setSite(sites[0] ?? null); setCrowd(c); setParking(p); setAlerts(a); setLastSync(now); setFromCache(false); setLoadError(null)
      setLocations((prevL) => { writeSnap({ site: sites[0] ?? null, crowd: c, parking: p, alerts: a, locations: l ?? prevL, at: now, locAt: locAt.current }); return l ?? prevL })
    } catch (e) {
      setLoadError((e as Error).message)
    } finally { busy.current = false; setSyncing(false) }
  }, [])

  const refreshUser = useCallback(async () => {
    if (!getToken()) { setUser(null); return }
    try { setUser(await api.get<User>('/auth/me')) } catch (e) {
      // only drop the session for a real auth failure, not for a dropped connection
      if ((e as { status?: number }).status === 401) { setToken(null); setTok(null); setUser(null) }
    }
  }, [])

  const loginWithToken = useCallback((t: string, u: User) => { setToken(t); setTok(t); setUser(u) }, [])
  const logout = useCallback(() => { setToken(null); setTok(null); setUser(null) }, [])

  useEffect(() => { void reload(); void refreshUser() }, [reload, refreshUser])
  useEffect(() => {
    const on = () => { setOnline(true); void reload() }
    const off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [reload])

  // polling fallback when the live socket is unavailable
  useEffect(() => {
    if (wsConnected || !online) return
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') void reload() }, 60000)
    return () => clearInterval(id)
  }, [wsConnected, online, reload])

  // live socket with backoff reconnect; applies deltas and fans out to subscribers
  useEffect(() => {
    let ws: WebSocket | null = null
    let closed = false
    let timer: number | undefined
    let attempt = 0
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const url = `${proto}://${location.host}/ws/live${token ? `?token=${encodeURIComponent(token)}` : ''}`
      try { ws = new WebSocket(url) } catch { return }
      ws.onopen = () => { attempt = 0; setWs(true); void reload() }
      ws.onclose = () => { setWs(false); if (!closed) { attempt += 1; timer = window.setTimeout(connect, Math.min(30000, 2000 * attempt)) } }
      ws.onerror = () => ws?.close()
      ws.onmessage = (m) => {
        let ev: LiveEvent
        try { ev = JSON.parse(m.data) } catch { return }
        if (ev.type === 'ping') { ws?.send('ping'); return }
        if (ev.type === 'crowd.updated') {
          const d = ev.data as unknown as { location_id: number; density_level: CrowdStatus['density_level']; current_count: number | null; source: string | null; is_stale: boolean; updated_at: string | null; override: boolean }
          setCrowd((prev) => prev.map((c) => c.location_id === d.location_id ? { ...c, density_level: d.density_level, current_count: d.current_count, source: d.source, is_stale: d.is_stale, updated_at: d.updated_at, override: d.override } : c))
          setLastSync(Date.now())
        } else if (ev.type === 'parking.updated') {
          const d = ev.data as unknown as { lot_id: number; occupied_slots: number; total_slots: number; status: ParkingLot['status']; updated_at: string | null }
          setParking((prev) => prev.map((p) => p.id === d.lot_id ? { ...p, occupied_slots: d.occupied_slots, total_slots: d.total_slots, free_slots: Math.max(d.total_slots - d.occupied_slots, 0), occupancy_pct: d.total_slots ? Math.round(d.occupied_slots / d.total_slots * 1000) / 10 : 0, status: d.status, updated_at: d.updated_at } : p))
        } else if (ev.type === 'alert.created') {
          setAlerts((prev) => [ev.data as unknown as Alert, ...prev.filter((a) => a.id !== (ev.data as { id: number }).id)])
        } else if (ev.type === 'alert.expired') {
          setAlerts((prev) => prev.filter((a) => a.id !== (ev.data as { id: number }).id))
        }
        if (ev.type !== 'pong' && ev.type !== 'hello') setLastEvent(ev)
        listeners.current.forEach((fn) => fn(ev))
      }
    }
    connect()
    return () => { closed = true; if (timer) clearTimeout(timer); ws?.close() }
  }, [token, reload])

  const subscribe = useCallback((fn: (e: LiveEvent) => void) => { listeners.current.add(fn); return () => { listeners.current.delete(fn) } }, [])

  const places = useMemo(() => {
    const byId = new Map(crowd.map((c) => [c.location_id, c]))
    return locations.map((l) => {
      const c = byId.get(l.id)
      return c ? { ...l, density_level: c.density_level, current_count: c.current_count, is_stale: c.is_stale, density_source: c.source, density_updated_at: c.updated_at, is_open: c.is_open } : l
    })
  }, [locations, crowd])

  const unreadAlerts = useMemo(() => alerts.filter((a) => !seen.includes(a.id)).length, [alerts, seen])
  const markAlertsSeen = useCallback(() => {
    const ids = Array.from(new Set([...seen, ...alerts.map((a) => a.id)])).slice(-200)
    setSeen(ids)
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(ids)) } catch { /* ignore */ }
  }, [alerts, seen])

  const value = useMemo<Store>(() => ({ user, token, loginWithToken, logout, refreshUser, site, crowd, parking, alerts, locations, places, online, wsConnected, syncing, lastSync, fromCache, lastEvent, reload, subscribe, loadError, unreadAlerts, markAlertsSeen }),
    [user, token, loginWithToken, logout, refreshUser, site, crowd, parking, alerts, locations, places, online, wsConnected, syncing, lastSync, fromCache, lastEvent, reload, subscribe, loadError, unreadAlerts, markAlertsSeen])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStore(): Store {
  const c = useContext(Ctx)
  if (!c) throw new Error('StoreProvider missing')
  return c
}

/** Subscribe to live events of given types; handler is called with the event. */
export function useLive(types: string[], handler: (e: LiveEvent) => void) {
  const { subscribe } = useStore()
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => subscribe((e) => { if (types.includes(e.type)) ref.current(e) }), [subscribe, types.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
}
