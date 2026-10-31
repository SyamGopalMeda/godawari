import { useEffect, useMemo, useState } from 'react'
import { DoorClosed, DoorOpen, Gauge, Hash, ShieldAlert, X } from 'lucide-react'
import { api, timeAgo, type CrowdStatus, type Level } from '../../api'
import { useLang } from '../../i18n'
import { useStore } from '../../store'
import { DensityChip, Field, Meter, PageHead, Sheet } from '../../components/ui'

interface HistPoint { recorded_at: string; count: number; level: Level; source: string }
const LEVEL_WORD: Record<string, string> = { all: 'All levels', low: 'Light', moderate: 'Moderate', high: 'Heavy', critical: 'Very heavy', unknown: 'No data' }

function Sparkline({ points, capacity }: { points: HistPoint[]; capacity: number | null }) {
  if (points.length < 2) return <div className="muted small">Not enough history yet.</div>
  const w = 600, h = 120, pad = 8
  const max = Math.max(capacity ?? 0, ...points.map((p) => p.count), 1)
  const t0 = new Date(points[0].recorded_at).getTime(), t1 = new Date(points[points.length - 1].recorded_at).getTime() || t0 + 1
  const x = (p: HistPoint) => pad + ((new Date(p.recorded_at).getTime() - t0) / Math.max(t1 - t0, 1)) * (w - 2 * pad)
  const y = (c: number) => h - pad - (c / max) * (h - 2 * pad)
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(1)},${y(p.count).toFixed(1)}`).join(' ')
  const cap = capacity ? y(capacity) : null
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 120 }} role="img" aria-label="Crowd count over the last 6 hours">
      {cap != null && <line x1={pad} x2={w - pad} y1={cap} y2={cap} stroke="var(--critical-fill)" strokeDasharray="4 4" />}
      {capacity && [0.4, 0.7, 0.9].map((r) => <line key={r} x1={pad} x2={w - pad} y1={y(capacity * r)} y2={y(capacity * r)} stroke="var(--line)" />)}
      <path d={d} fill="none" stroke="var(--brand-600)" strokeWidth={3} />
      {points.map((p, i) => <circle key={i} cx={x(p)} cy={y(p.count)} r={3} fill={`var(--${p.level === 'unknown' ? 'unknown' : p.level}-fill)`} />)}
    </svg>
  )
}

export default function CrowdAdminPage() {
  const { crowd, reload } = useStore()
  const { name } = useLang()
  const [typeF, setTypeF] = useState('all')
  const [levelF, setLevelF] = useState('all')
  const [selected, setSelected] = useState<CrowdStatus | null>(null)
  const [hist, setHist] = useState<HistPoint[]>([])
  const [override, setOverride] = useState<CrowdStatus | null>(null)
  const [ovLevel, setOvLevel] = useState<string>('high')
  const [ovMin, setOvMin] = useState(30)
  const [ovReason, setOvReason] = useState('')
  const [countFor, setCountFor] = useState<CrowdStatus | null>(null)
  const [count, setCount] = useState('')
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const [busy, setBusy] = useState(false)

  const rows = useMemo(() => crowd.filter((c) => (typeF === 'all' || c.type === typeF) && (levelF === 'all' || c.density_level === levelF)), [crowd, typeF, levelF])
  const types = useMemo(() => Array.from(new Set(crowd.map((c) => c.type))), [crowd])

  useEffect(() => {
    if (!selected) return
    api.get<HistPoint[]>(`/crowd/${selected.location_id}/history?hours=6`).then(setHist).catch(() => setHist([]))
  }, [selected, crowd])

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    if (busy) return
    setBusy(true)
    try { await fn(); setMsg({ ok }); await reload() } catch (e) { setMsg({ err: (e as Error).message }) } finally { setBusy(false) }
  }
  const submitOverride = () => override && run(() => api.post(`/crowd/${override.location_id}/override`, { level: ovLevel === 'clear' ? null : ovLevel, minutes: ovMin, reason: ovReason || 'manual override' }), `Override applied to ${override.name}`).then(() => setOverride(null))
  const submitCount = () => countFor && run(() => api.post('/crowd/readings', { location_id: countFor.location_id, count: Number(count), source: 'manual' }), `Count recorded for ${countFor.name}`).then(() => { setCountFor(null); setCount('') })
  const toggleOpen = (c: CrowdStatus) => run(() => api.patch(`/locations/${c.location_id}`, { is_open: !c.is_open }), `${c.name} ${c.is_open ? 'closed' : 'opened'}`)

  return (
    <div className="stack loose">
      <PageHead back={false} title="Crowd management" sub="Thresholds: light under 40 %, moderate 40–70 %, heavy 70–90 %, very heavy 90 % and above of safe capacity." />
      <div className="card stack">
        <div className="tabs" role="group" aria-label="Zone type">
          {['all', ...types].map((t) => <button key={t} className={typeF === t ? 'active' : ''} aria-pressed={typeF === t} onClick={() => setTypeF(t)}>{t === 'all' ? 'All types' : t}</button>)}
        </div>
        <div className="tabs" role="group" aria-label="Crowd level">
          {['all', 'low', 'moderate', 'high', 'critical', 'unknown'].map((l) => <button key={l} className={levelF === l ? 'active' : ''} aria-pressed={levelF === l} onClick={() => setLevelF(l)}>{LEVEL_WORD[l]}</button>)}
        </div>
        <div className="muted small">{rows.length} zones</div>
      </div>
      {msg.err && <div className="err" role="alert">{msg.err}</div>}
      {msg.ok && <div className="ok" role="status">{msg.ok}</div>}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>Zone</th><th>Type</th><th>Level</th><th>Count / capacity</th><th style={{ minWidth: 120 }}>Load</th><th>Source</th><th>Updated</th><th>Actions</th></tr></thead>
            <tbody>
              {rows.map((c) => {
                const pct = c.capacity && c.current_count != null ? (c.current_count / c.capacity) * 100 : 0
                return (
                  <tr key={c.location_id} style={{ background: selected?.location_id === c.location_id ? 'var(--brand-50)' : undefined }}>
                    <td>
                      <button className="btn ghost sm" style={{ padding: '0 6px', marginLeft: -6, fontWeight: 650, justifyContent: 'flex-start', textAlign: 'left' }} onClick={() => setSelected(c)}>{name(c)}</button>
                      {!c.is_open && <span className="chip closed">closed</span>}
                    </td>
                    <td>{c.type}</td>
                    <td><DensityChip level={c.density_level} stale={c.is_stale} />{c.override && <div className="xs" style={{ color: 'var(--copper-700)', marginTop: 4 }}>Control-room override</div>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{c.current_count?.toLocaleString() ?? '—'} / {c.capacity?.toLocaleString() ?? '—'}</td>
                    <td><Meter level={c.density_level} pct={pct} label={`${Math.round(pct)} %`} /><span className="muted xs">{Math.round(pct)} %</span></td>
                    <td>{c.source ?? '—'}</td>
                    <td className="small" style={{ whiteSpace: 'nowrap' }}>{timeAgo(c.updated_at)}</td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <button className="btn sm tonal" onClick={() => { setCountFor(c); setCount(String(c.current_count ?? '')) }}><Hash size={16} aria-hidden />Set count</button>
                        <button className="btn sm" onClick={() => { setOverride(c); setOvReason('') }}><ShieldAlert size={16} aria-hidden />Override</button>
                        <button className="btn sm" onClick={() => void toggleOpen(c)} disabled={busy}>{c.is_open ? <DoorClosed size={16} aria-hidden /> : <DoorOpen size={16} aria-hidden />}{c.is_open ? 'Close' : 'Open'}</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      {selected && (
        <div className="card">
          <div className="card-head">
            <h2 className="row" style={{ gap: 8 }}><Gauge size={18} aria-hidden />{name(selected)} — last 6 hours</h2>
            <button className="btn icon sm ghost" onClick={() => setSelected(null)} aria-label="Close history"><X size={18} aria-hidden /></button>
          </div>
          <Sparkline points={hist} capacity={selected.capacity} />
          <div className="muted xs" style={{ marginTop: 6 }}>Dashed red line = safe capacity; grey lines = 40 / 70 / 90 % thresholds. {hist.length} readings.</div>
        </div>
      )}

      <Sheet open={!!override} onClose={() => setOverride(null)} title={`Override: ${override ? name(override) : ''}`}>
        <div className="stack">
          <p className="muted small">A control-room override replaces sensor and camera readings until it expires. Use it for incidents, VIP movement or sensor faults.</p>
          <Field label="Level">
            <select className="input" value={ovLevel} onChange={(e) => setOvLevel(e.target.value)}>
              {['low', 'moderate', 'high', 'critical'].map((l) => <option key={l} value={l}>{LEVEL_WORD[l]}</option>)}<option value="clear">Clear override</option>
            </select>
          </Field>
          <Field label="Minutes"><input className="input" type="number" min={1} max={720} value={ovMin} onChange={(e) => setOvMin(Number(e.target.value))} /></Field>
          <Field label="Reason"><input className="input" value={ovReason} onChange={(e) => setOvReason(e.target.value)} placeholder="e.g. barricade collapse near steps" /></Field>
          <button className="btn primary block" disabled={busy} onClick={() => void submitOverride()}>Apply override</button>
        </div>
      </Sheet>
      <Sheet open={!!countFor} onClose={() => setCountFor(null)} title={`Manual count: ${countFor ? name(countFor) : ''}`}>
        <div className="stack">
          <p className="muted small">Recorded as a staff update. Safe capacity {countFor?.capacity?.toLocaleString() ?? '—'}.</p>
          <Field label="People now"><input className="input" type="number" min={0} value={count} onChange={(e) => setCount(e.target.value)} /></Field>
          <button className="btn primary block" disabled={count === '' || busy} onClick={() => void submitCount()}>Record count</button>
        </div>
      </Sheet>
    </div>
  )
}
