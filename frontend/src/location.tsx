/* One location source for the whole app.
   - Never prompts on page load: the browser prompt only appears after the user taps "Use my location".
   - If permission is already granted, a fix is taken silently and refreshed every 60 s while the app is visible
     (no continuous watchPosition, to save battery in a 12-hour bathing day).
   - Users who decline can pick "I am near ..." manually; nothing is ever faked. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { haversineM } from './geo'

export type Perm = 'granted' | 'denied' | 'prompt' | 'unsupported' | 'unknown'
export interface Pos { lat: number; lng: number; accuracy?: number; at: number; source: 'gps' | 'manual'; label?: string; locationId?: number }

interface Ctx {
  pos: Pos | null            // best available: fresh GPS, else manual choice, else null
  gps: Pos | null
  manual: Pos | null
  perm: Perm
  requesting: boolean
  lastError: 'denied' | 'timeout' | 'unavailable' | null
  requestGps: () => Promise<Pos | null>
  setManual: (loc: { id: number; lat: number | null; lng: number | null; name: string } | null) => void
  coords: [number, number] | null
  nearParam: string            // "&near=lat,lng" or ""
}

const LocCtx = createContext<Ctx | null>(null)
const MANUAL_KEY = 'ps.manualLoc'
const GPS_FRESH_MS = 10 * 60 * 1000

function readManual(): Pos | null { try { const v = localStorage.getItem(MANUAL_KEY); return v ? JSON.parse(v) : null } catch { return null } }

export function LocationProvider({ children }: { children: ReactNode }) {
  const [gps, setGps] = useState<Pos | null>(null)
  const [manual, setManualState] = useState<Pos | null>(readManual)
  const [perm, setPerm] = useState<Perm>(() => ('geolocation' in navigator ? 'unknown' : 'unsupported'))
  const [requesting, setRequesting] = useState(false)
  const [lastError, setLastError] = useState<Ctx['lastError']>(null)
  const inflight = useRef<Promise<Pos | null> | null>(null)

  const fix = useCallback((): Promise<Pos | null> => {
    if (!('geolocation' in navigator)) return Promise.resolve(null)
    if (inflight.current) return inflight.current
    inflight.current = new Promise<Pos | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (p) => {
          const v: Pos = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now(), source: 'gps' }
          setGps(v); setPerm('granted'); setLastError(null); resolve(v)
        },
        (e) => {
          setLastError(e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable')
          if (e.code === 1) setPerm('denied')
          resolve(null)
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
      )
    }).finally(() => { inflight.current = null })
    return inflight.current
  }, [])

  // learn the permission state without triggering a prompt
  useEffect(() => {
    let status: PermissionStatus | null = null
    const perms = (navigator as Navigator & { permissions?: Permissions }).permissions
    if (!perms?.query) return
    perms.query({ name: 'geolocation' as PermissionName }).then((s) => {
      status = s
      setPerm(s.state as Perm)
      if (s.state === 'granted') void fix()
      s.onchange = () => { setPerm(s.state as Perm); if (s.state === 'granted') void fix() }
    }).catch(() => { /* not supported */ })
    return () => { if (status) status.onchange = null }
  }, [fix])

  // gentle refresh while visible
  useEffect(() => {
    if (perm !== 'granted') return
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') void fix() }, 60000)
    return () => clearInterval(id)
  }, [perm, fix])

  const requestGps = useCallback(async () => { setRequesting(true); try { return await fix() } finally { setRequesting(false) } }, [fix])

  const setManual = useCallback((loc: { id: number; lat: number | null; lng: number | null; name: string } | null) => {
    const v: Pos | null = loc && loc.lat != null && loc.lng != null ? { lat: loc.lat, lng: loc.lng, at: Date.now(), source: 'manual', label: loc.name, locationId: loc.id } : null
    setManualState(v)
    try { v ? localStorage.setItem(MANUAL_KEY, JSON.stringify(v)) : localStorage.removeItem(MANUAL_KEY) } catch { /* ignore */ }
  }, [])

  const value = useMemo<Ctx>(() => {
    const gpsFresh = gps && Date.now() - gps.at < GPS_FRESH_MS ? gps : null
    const pos = gpsFresh ?? manual ?? null
    const coords: [number, number] | null = pos ? [pos.lat, pos.lng] : null
    return { pos, gps, manual, perm, requesting, lastError, requestGps, setManual, coords, nearParam: coords ? `&near=${coords[0].toFixed(6)},${coords[1].toFixed(6)}` : '' }
  }, [gps, manual, perm, requesting, lastError, requestGps, setManual])
  return <LocCtx.Provider value={value}>{children}</LocCtx.Provider>
}

export function useLocation2(): Ctx {
  const c = useContext(LocCtx)
  if (!c) throw new Error('LocationProvider missing')
  return c
}
export const useMyLocation = useLocation2

/** Distance in metres from the user's best position, or null when unknown. */
export function useDistance() {
  const { coords } = useLocation2()
  return useCallback((lat: number | null, lng: number | null) => (coords && lat != null && lng != null ? haversineM(coords[0], coords[1], lat, lng) : null), [coords])
}
