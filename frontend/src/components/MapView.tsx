/* Leaflet map: icon pins (status shape-badge on monitored places), tap-to-select, route polyline,
   "me" dot, optional non-interactive preview mode and thumb-reachable controls. */
import { useEffect, useMemo, type ReactNode } from 'react'
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { LocateFixed, Minus, Plus } from 'lucide-react'
import type { Location, Level } from '../api'
import { useLang, type Key } from '../i18n'
import { pinHtml, primeSvgCache } from './icons'

// runs when the map chunk is evaluated (outside any React render)
primeSvgCache()

// Default: public OSM tiles (fine for development). For festival-scale traffic set VITE_TILE_URL to a contracted or
// self-hosted tile server (see docs/06 and docs/09); public tile servers are not meant for crowds of this size.
export const TILE_URL: string = import.meta.env.VITE_TILE_URL ?? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
export const TILE_ATTR: string = import.meta.env.VITE_TILE_ATTR ?? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

function iconFor(l: Location, selected: boolean) {
  const level: Level | null = l.monitored ? (l.is_stale ? 'unknown' : l.density_level) : null
  const size = selected ? 46 : 36
  return L.divIcon({ className: '', html: pinHtml(l.type, { level, selected }), iconSize: [size, size], iconAnchor: [size / 2, size], popupAnchor: [0, -size + 4] })
}
const meIcon = L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [20, 20], iconAnchor: [10, 10] })

function FitTo({ bounds }: { bounds: L.LatLngBoundsExpression | null }) {
  const map = useMap()
  useEffect(() => { if (bounds) map.fitBounds(bounds, { padding: [48, 48], maxZoom: 17 }) }, [bounds, map])
  return null
}
function FocusOn({ focus }: { focus?: [number, number] | null }) {
  const map = useMap()
  useEffect(() => { if (focus) map.flyTo(focus, Math.max(map.getZoom(), 16), { duration: 0.5 }) }, [focus?.[0], focus?.[1]]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}
function ClickAway({ onClick }: { onClick: () => void }) { useMapEvents({ click: onClick }); return null }

/** Zoom and recenter buttons, placed where a thumb reaches them. Render as a child of <MapView/>. */
export function MapFabs({ me, bottom = 12 }: { me?: [number, number] | null; bottom?: number }) {
  const map = useMap()
  const { t } = useLang()
  return (
    <div className="map-fabs" style={{ bottom }}>
      <button className="fab" onClick={() => map.zoomIn()} aria-label="Zoom in"><Plus size={22} aria-hidden /></button>
      <button className="fab" onClick={() => map.zoomOut()} aria-label="Zoom out"><Minus size={22} aria-hidden /></button>
      {me && <button className="fab" onClick={() => map.flyTo(me, 17, { duration: 0.5 })} aria-label={t('myLocation')}><LocateFixed size={22} aria-hidden /></button>}
    </div>
  )
}

export interface MapViewProps {
  center: [number, number]
  zoom?: number
  locations: Location[]
  me?: [number, number] | null
  route?: [number, number][] | null
  fitRoute?: boolean
  /** legacy popup action (admin); ignored when onSelect is given */
  onDirections?: (l: Location) => void
  /** tap a pin → parent shows its own bottom card */
  onSelect?: (l: Location | null) => void
  selectedId?: number | null
  height?: string
  interactive?: boolean
  focus?: [number, number] | null
  fitLocations?: boolean
  children?: ReactNode
}

export default function MapView({ center, zoom = 15, locations, me, route, fitRoute, onDirections, onSelect, selectedId, height, interactive = true, focus, fitLocations, children }: MapViewProps) {
  const { name, t } = useLang()
  const bounds = useMemo<L.LatLngBoundsExpression | null>(() => {
    if (fitRoute && route && route.length > 1) return route as L.LatLngTuple[]
    const pts = locations.filter((l) => l.lat != null && l.lng != null)
    if (fitLocations && pts.length > 1) return pts.map((l) => [l.lat as number, l.lng as number] as L.LatLngTuple)
    return null
  }, [route, fitRoute, fitLocations, locations])
  const off = !interactive
  return (
    <div className="map-wrap" style={height ? { height } : undefined}>
      <MapContainer center={center} zoom={zoom} zoomControl={false} scrollWheelZoom={interactive} dragging={interactive} touchZoom={interactive} doubleClickZoom={interactive} boxZoom={interactive} keyboard={interactive} attributionControl style={{ height: '100%' }}>
        <TileLayer url={TILE_URL} attribution={TILE_ATTR} maxZoom={19} referrerPolicy="strict-origin-when-cross-origin" />
        <FitTo bounds={bounds} />
        <FocusOn focus={focus} />
        {onSelect && interactive && <ClickAway onClick={() => onSelect(null)} />}
        {locations.filter((l): l is Location & { lat: number; lng: number } => l.lat != null && l.lng != null).map((l) => {
          const sel = l.id === selectedId
          const status = l.monitored ? ` – ${t((l.is_stale ? 'unknown' : l.density_level) as Key)}` : ''
          return (
            <Marker key={l.id} position={[l.lat, l.lng]} icon={iconFor(l, sel)} zIndexOffset={sel ? 1000 : l.monitored ? 200 : 0} title={`${name(l)}${status}`} alt={`${name(l)}${status}`} interactive={!off}
              eventHandlers={onSelect ? { click: () => onSelect(l) } : undefined}>
              {!onSelect && !off && (
                <Popup>
                  <strong>{name(l)}</strong>{status && <div className="small">{status.slice(3)}</div>}
                  {onDirections && <button className="btn sm primary" style={{ marginTop: 6 }} onClick={() => onDirections(l)}>{t('directions')}</button>}
                </Popup>
              )}
            </Marker>
          )
        })}
        {me && <Marker position={me} icon={meIcon} interactive={false} />}
        {route && route.length > 1 && (
          <>
            <Polyline positions={route} pathOptions={{ color: '#ffffff', weight: 10, opacity: 0.9 }} />
            <Polyline positions={route} pathOptions={{ color: '#3E2719', weight: 6, opacity: 1 }} />
          </>
        )}
        {children}
      </MapContainer>
    </div>
  )
}
