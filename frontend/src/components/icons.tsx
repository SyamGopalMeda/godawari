/* Single source for icons. Lucide SVGs render identically on every Android OEM (unlike emoji),
   scale with text and are hidden from screen readers unless given a label. */
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import {
  Accessibility, Armchair, Bus, CircleCheck, CircleHelp, CircleMinus, DoorOpen, Droplet, HandHelping, HeartPulse, MapPin,
  OctagonAlert, RadioTower, SearchCheck, Shield, Shirt, SquareParking, Toilet, TrainFront, TriangleAlert, UtensilsCrossed, Waves,
  type LucideIcon,
} from 'lucide-react'
import type { Level } from '../api'

export type Tone = 'brand' | 'copper' | 'sage' | 'accent' | 'danger'
export type PinGroup = 'ghat' | 'gate' | 'parking' | 'help' | 'amenity' | 'transport' | 'other'

export const TYPE_META: Record<string, { icon: LucideIcon; tone: Tone; group: PinGroup }> = {
  ghat: { icon: Waves, tone: 'brand', group: 'ghat' },
  gate: { icon: DoorOpen, tone: 'brand', group: 'gate' },
  checkpoint: { icon: RadioTower, tone: 'brand', group: 'gate' },
  parking: { icon: SquareParking, tone: 'brand', group: 'parking' },
  help_desk: { icon: HandHelping, tone: 'accent', group: 'help' },
  medical: { icon: HeartPulse, tone: 'danger', group: 'help' },
  police: { icon: Shield, tone: 'accent', group: 'help' },
  lost_found: { icon: SearchCheck, tone: 'accent', group: 'help' },
  restroom: { icon: Toilet, tone: 'copper', group: 'amenity' },
  water: { icon: Droplet, tone: 'copper', group: 'amenity' },
  dressing_room: { icon: Shirt, tone: 'copper', group: 'amenity' },
  food: { icon: UtensilsCrossed, tone: 'sage', group: 'amenity' },
  rest_area: { icon: Armchair, tone: 'sage', group: 'amenity' },
  bus_stop: { icon: Bus, tone: 'brand', group: 'transport' },
  railway_station: { icon: TrainFront, tone: 'brand', group: 'transport' },
  shuttle: { icon: Bus, tone: 'brand', group: 'transport' },
  other: { icon: MapPin, tone: 'brand', group: 'other' },
}
export function typeMeta(type: string) { return TYPE_META[type] ?? TYPE_META.other }

export const LEVEL_ICON: Record<Level, LucideIcon> = {
  low: CircleCheck, moderate: CircleMinus, high: TriangleAlert, critical: OctagonAlert, unknown: CircleHelp,
}

export function TypeIcon({ type, size = 22 }: { type: string; size?: number }) {
  const I = typeMeta(type).icon
  return <I size={size} aria-hidden strokeWidth={2.2} />
}

/* ---- map marker HTML (Leaflet divIcon needs a string).
   SVG strings are rendered ONCE by primeSvgCache(), which MapView calls when its chunk loads - never during a
   React render (flushSync inside render is not allowed). pinHtml() only reads the cache. */
const svgCache = new Map<string, string>()
const keyOf = (I: LucideIcon, size: number) => `${I.displayName ?? I.name}:${size}`
function renderSvg(I: LucideIcon, size: number) {
  const key = keyOf(I, size)
  if (svgCache.has(key)) return
  const host = document.createElement('div')
  const root = createRoot(host)
  flushSync(() => root.render(<I size={size} strokeWidth={2.4} aria-hidden />))
  svgCache.set(key, host.innerHTML)
  root.unmount()
}
let primed = false
export function primeSvgCache() {
  if (primed || typeof document === 'undefined') return
  primed = true
  for (const m of Object.values(TYPE_META)) { renderSvg(m.icon, 18); renderSvg(m.icon, 22) }
  for (const I of Object.values(LEVEL_ICON)) renderSvg(I, 12)
}
function svgOf(I: LucideIcon, size: number): string {
  return svgCache.get(keyOf(I, size)) ?? `<svg width="${size}" height="${size}" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" fill="currentColor"/></svg>`
}

const pinCache = new Map<string, string>()
export function pinHtml(type: string, opts: { level?: Level | null; selected?: boolean; accessible?: boolean } = {}): string {
  const key = `${type}|${opts.level ?? ''}|${opts.selected ? 1 : 0}|${opts.accessible ? 1 : 0}`
  const hit = pinCache.get(key)
  if (hit) return hit
  const meta = typeMeta(type)
  const cls = opts.level ? opts.level : meta.group === 'amenity' ? 'amenity' : meta.group === 'help' ? 'help' : meta.group === 'parking' ? 'parking' : ''
  // monitored places carry a second, shape-coded status badge so colour is never the only signal
  const tag = opts.level ? `<span class="tag" style="color:var(--${opts.level === 'unknown' ? 'unknown' : opts.level})">${svgOf(LEVEL_ICON[opts.level], 12)}</span>` : ''
  const html = `<div class="pin ${cls} ${opts.selected ? 'sel' : ''}"><span>${svgOf(meta.icon, opts.selected ? 22 : 18)}</span>${tag}</div>`
  pinCache.set(key, html)
  return html
}
export const accessibleIcon = Accessibility
