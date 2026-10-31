export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000, r = (d: number) => (d * Math.PI) / 180
  const h = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
/** Walking minutes at a crowd-adjusted 3.5 km/h (2.5 km/h when accessible). */
export function walkMinutes(m: number, accessible = false): number {
  return Math.max(1, Math.round(m / 1000 / (accessible ? 2.5 : 3.5) * 60))
}
export function nearest<T extends { lat: number | null; lng: number | null }>(items: T[], from: [number, number] | null): (T & { d: number }) | null {
  if (!from || items.length === 0) return null
  let best: (T & { d: number }) | null = null
  for (const it of items) { if (it.lat == null || it.lng == null) continue; const d = haversineM(from[0], from[1], it.lat, it.lng); if (!best || d < best.d) best = { ...it, d } }
  return best
}
