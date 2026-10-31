import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Activity, Info, OctagonAlert, RefreshCw, TriangleAlert } from 'lucide-react'
import { api, timeAgo, type Alert, type LiveEvent, type Location, type Overview } from '../../api'
import { useLang } from '../../i18n'
import { useLive, useStore } from '../../store'
import MapView from '../../components/MapView'
import { DensityChip, EmptyState, PageHead } from '../../components/ui'
import { LEVEL_ICON } from '../../components/icons'

const LIVE_TYPES = ['crowd.updated', 'parking.updated', 'alert.created', 'alert.expired', 'report.created', 'report.updated', 'sos.created', 'sos.updated', 'sighting']
const LEVELS = ['low', 'moderate', 'high', 'critical', 'unknown'] as const
const LEVEL_WORD: Record<(typeof LEVELS)[number], string> = { low: 'Light', moderate: 'Moderate', high: 'Heavy', critical: 'Very heavy', unknown: 'No recent data' }

function describe(e: LiveEvent): string {
  const d = e.data as Record<string, unknown>
  switch (e.type) {
    case 'crowd.updated': return `Crowd: ${d.code} → ${d.density_level}${d.current_count != null ? ` (${d.current_count})` : ''}${d.override ? ' [override]' : ''}`
    case 'parking.updated': return `Parking lot #${d.lot_id}: ${d.occupied_slots}/${d.total_slots} (${d.status})`
    case 'alert.created': return `Alert: ${d.title} [${d.severity}]`
    case 'alert.expired': return `Alert #${d.id} expired`
    case 'report.created': return `Missing-person report #${d.id} filed${d.vulnerable ? ' — VULNERABLE' : ''}`
    case 'report.updated': return `Report #${d.id} → ${d.status}`
    case 'sos.created': return `SOS #${d.id}: ${d.type}${d.phone ? ` from ${d.phone}` : ''}`
    case 'sos.updated': return `SOS #${d.id} → ${d.status}`
    case 'sighting': return `Sighting: ${d.display_name} at ${d.location_code}`
    default: return e.type
  }
}

const SEV_ICON = { info: Info, warning: TriangleAlert, critical: OctagonAlert } as const

export function AlertCard({ a, extra, action }: { a: Alert; extra?: ReactNode; action?: ReactNode }) {
  const I = SEV_ICON[a.severity] ?? Info
  return (
    <div className={`alert ${a.severity}`}>
      <I size={20} className="a-ic" aria-hidden />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row between top" style={{ gap: 8 }}>
          <div className="a-title" style={{ overflowWrap: 'anywhere' }}>{a.title}</div>
          {action}
        </div>
        <div className="a-body" style={{ overflowWrap: 'anywhere' }}>{a.body}</div>
        {extra}
        <div className="muted xs" style={{ marginTop: 6, overflowWrap: 'anywhere' }}>{a.severity} · expires {a.expires_at ? new Date(a.expires_at).toLocaleString() : 'never'}</div>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const { crowd, alerts, site } = useStore()
  const { name } = useLang()
  const [ov, setOv] = useState<Overview | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [locs, setLocs] = useState<Location[]>([])
  const [feed, setFeed] = useState<{ at: string; text: string; type: string }[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    try { setOv(await api.get<Overview>('/admin/overview')); setErr(null) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }, [])
  useEffect(() => {
    void load()
    api.get<Location[]>('/locations').then(setLocs).catch(() => undefined)
    const id = window.setInterval(() => void load(), 15000)
    return () => clearInterval(id)
  }, [load])
  useLive(LIVE_TYPES, (e) => {
    setFeed((f) => [{ at: e.ts ?? new Date().toISOString(), text: describe(e), type: e.type }, ...f].slice(0, 20))
    if (e.type !== 'crowd.updated' && e.type !== 'sighting') void load()
  })

  const mapLocs = useMemo(() => {
    const byId = new Map(crowd.map((c) => [c.location_id, c]))
    return locs.map((l) => { const c = byId.get(l.id); return c ? { ...l, density_level: c.density_level, current_count: c.current_count, is_stale: c.is_stale, is_open: c.is_open } : l })
  }, [locs, crowd])
  const center: [number, number] = site ? [site.center_lat, site.center_lng] : [17.0005, 81.7785]
  const rep = ov?.reports ?? {}
  const sos = ov?.sos ?? {}
  const hot = crowd.filter((c) => !c.is_stale && (c.density_level === 'high' || c.density_level === 'critical'))

  return (
    <div className="stack loose">
      <PageHead back={false} title="Control room dashboard" sub={<span style={{ overflowWrap: 'anywhere' }}>{site?.name ?? '—'} · updated {ov ? timeAgo(ov.generated_at) : '—'} · auto-refresh every 15 s</span>}
        actions={<button className="btn sm" onClick={() => void load()} disabled={busy}><RefreshCw size={16} aria-hidden className={busy ? 'spin-icon' : ''} />Refresh</button>} />
      {err && <div className="err" role="alert">{err}</div>}

      {ov && (
        <div className="stack">
          <div className="card">
            <div className="card-head"><h2>Monitored zones by crowd level</h2><span className="muted small">{ov.crowd.stale} with no reading in 15 min</span></div>
            <div className="kpis">
              {LEVELS.map((lv) => {
                const I = LEVEL_ICON[lv]
                return (
                  <div key={lv} className="stat" style={{ padding: '4px 0' }}>
                    <span className="v">{ov.crowd.by_level[lv]}</span>
                    <span className={`status ${lv}`} style={{ alignSelf: 'flex-start' }}><I aria-hidden />{LEVEL_WORD[lv]}</span>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="kpis">
            <div className="kpi"><div className="v">{(rep.open ?? 0) + (rep.verified ?? 0) + (rep.searching ?? 0)}</div><div className="l">Active missing-person reports</div><div className="muted xs" style={{ marginTop: 6 }}>open {rep.open ?? 0} · verified {rep.verified ?? 0} · searching {rep.searching ?? 0} · found {rep.found ?? 0}</div></div>
            <div className="kpi"><div className="v" style={{ color: (sos.new ?? 0) > 0 ? 'var(--critical)' : undefined }}>{sos.new ?? 0}</div><div className="l">New SOS requests</div><div className="muted xs" style={{ marginTop: 6 }}>acknowledged {sos.acknowledged ?? 0} · dispatched {sos.dispatched ?? 0}</div></div>
            <div className="kpi"><div className="v">{ov.parking.occupied.toLocaleString()}<span className="muted" style={{ fontSize: 'var(--fs-md)', fontWeight: 500 }}> / {ov.parking.total_slots.toLocaleString()}</span></div><div className="l">Parking occupied</div><div className="muted xs" style={{ marginTop: 6 }}>{ov.parking.full} of {ov.parking.lots} lots full</div></div>
            <div className="kpi"><div className="v">{ov.devices.online}<span className="muted" style={{ fontSize: 'var(--fs-md)', fontWeight: 500 }}> / {ov.devices.total}</span></div><div className="l">Devices online (10 min)</div><div className="muted xs" style={{ marginTop: 6 }}>{ov.ingestion.sightings_last_10m} RFID sightings in 10 min</div></div>
            <div className="kpi"><div className="v">{ov.websocket.connections}</div><div className="l">Live connections</div><div className="muted xs" style={{ marginTop: 6 }}>{ov.websocket.messages_sent.toLocaleString()} messages sent</div></div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2>Site map</h2>
          <div className="legend">{LEVELS.map((lv) => <span key={lv} className="row" style={{ gap: 6 }}><span className={`dot ${lv}`} />{LEVEL_WORD[lv]}</span>)}</div>
        </div>
        <div className="map-panel"><MapView center={center} zoom={15} locations={mapLocs} height="420px" /></div>
        <div className="muted xs" style={{ marginTop: 8 }}>Demo coordinates — replace with surveyed facility data before deployment.</div>
      </div>

      <div className="cols-2">
        <div className="card">
          <div className="card-head"><h2>Live event feed</h2><Activity size={18} aria-hidden className="muted" /></div>
          {feed.length === 0
            ? <EmptyState icon={Activity} title="Waiting for events" body={<>Device and staff updates appear here as they happen. Run <code>backend/simulators/simulate.py</code> to generate demo traffic.</>} />
            : <div className="list grouped">{feed.map((f, i) => <div key={i} className="small" style={{ padding: '10px 14px', overflowWrap: 'anywhere' }}><span className="muted">{new Date(f.at).toLocaleTimeString()}</span> · {f.text}</div>)}</div>}
        </div>
        <div className="stack">
          <div className="card">
            <div className="card-head"><h2>Active alerts</h2><span className="chip neutral">{alerts.length}</span></div>
            {alerts.length === 0 ? <div className="muted small">None</div> : <div className="list">{alerts.map((a: Alert) => <AlertCard key={a.id} a={a} />)}</div>}
          </div>
          <div className="card">
            <div className="card-head"><h2>Zones over 70 % of capacity</h2><span className="chip neutral">{hot.length}</span></div>
            {hot.length === 0 ? <div className="muted small">None</div> : (
              <div className="list grouped">
                {hot.map((c) => <div key={c.location_id} className="row between wrap" style={{ padding: '10px 14px' }}><span className="strong small">{name(c)}</span><DensityChip level={c.density_level} stale={c.is_stale} /></div>)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
