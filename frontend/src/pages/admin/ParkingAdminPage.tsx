import { useState } from 'react'
import { Pencil, QrCode, ScanLine } from 'lucide-react'
import { api, timeAgo, type ParkingLot } from '../../api'
import { useLang } from '../../i18n'
import { useStore } from '../../store'
import { Field, Meter, PageHead, Sheet } from '../../components/ui'

const LEVEL_FOR = { open: 'low', filling: 'moderate', full: 'critical', closed: 'unknown' } as const

export default function ParkingAdminPage() {
  const { parking, reload } = useStore()
  const { name } = useLang()
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const [edit, setEdit] = useState<ParkingLot | null>(null)
  const [total, setTotal] = useState('')
  const [status, setStatus] = useState('open')
  const [shuttle, setShuttle] = useState('')
  const [occFor, setOccFor] = useState<ParkingLot | null>(null)
  const [occ, setOcc] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    if (busy) return
    setBusy(true)
    try { await fn(); setMsg({ ok }); await reload() } catch (e) { setMsg({ err: (e as Error).message }) } finally { setBusy(false) }
  }
  const delta = (l: ParkingLot, d: number) => run(() => api.post(`/parking/${l.id}/occupancy`, { delta: d }), `${name(l.location)}: ${d > 0 ? '+' : ''}${d}`)
  const openEdit = (l: ParkingLot) => { setEdit(l); setTotal(String(l.total_slots)); setStatus(l.status); setShuttle(l.shuttle_info ?? '') }
  const saveEdit = () => edit && run(() => api.patch(`/parking/${edit.id}`, { total_slots: Number(total), status, shuttle_info: shuttle || null }), `${name(edit.location)} updated`).then(() => setEdit(null))
  const saveOcc = () => occFor && run(() => api.post(`/parking/${occFor.id}/occupancy`, { occupied: Number(occ) }), `${name(occFor.location)} occupancy set`).then(() => setOccFor(null))
  const scan = () => token && run(() => api.post(`/parking/passes/${token.trim()}/scan`), `Pass ${token.trim()} accepted`).then(() => setToken(''))
  const totals = parking.reduce((a, l) => ({ occ: a.occ + l.occupied_slots, tot: a.tot + l.total_slots, full: a.full + (l.status === 'full' ? 1 : 0) }), { occ: 0, tot: 0, full: 0 })

  return (
    <div className="stack loose">
      <PageHead back={false} title="Parking management" sub="Occupancy source per lot: sensor = loop counter or boom barrier, manual = staff update, pass_scan = QR pass scanned at entry." />
      {msg.err && <div className="err" role="alert">{msg.err}</div>}
      {msg.ok && <div className="ok" role="status">{msg.ok}</div>}
      <div className="kpis">
        <div className="kpi"><div className="v">{parking.length}</div><div className="l">Parking areas</div></div>
        <div className="kpi"><div className="v">{totals.occ.toLocaleString()}<span className="muted" style={{ fontSize: 'var(--fs-md)', fontWeight: 500 }}> / {totals.tot.toLocaleString()}</span></div><div className="l">Vehicles parked</div></div>
        <div className="kpi"><div className="v">{(totals.tot - totals.occ).toLocaleString()}</div><div className="l">Free spaces</div></div>
        <div className="kpi"><div className="v">{totals.full}</div><div className="l">Lots full</div></div>
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>Lot</th><th>Status</th><th>Occupied / total</th><th style={{ minWidth: 120 }}>Load</th><th>Nearest gate</th><th>Source</th><th>Updated</th><th>Actions</th></tr></thead>
            <tbody>
              {parking.map((l) => (
                <tr key={l.id}>
                  <td><b>{name(l.location)}</b><div className="muted xs">{l.vehicle_types.join(', ')}{l.shuttle_info ? ` · ${l.shuttle_info}` : ''}</div></td>
                  <td><span className={`chip ${l.status}`}>{l.status}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{l.occupied_slots.toLocaleString()} / {l.total_slots.toLocaleString()}<div className="muted xs">{l.free_slots} free</div></td>
                  <td><Meter level={LEVEL_FOR[l.status]} pct={l.occupancy_pct} label={`${l.occupancy_pct} %`} /><span className="muted xs">{l.occupancy_pct} %</span></td>
                  <td>{l.nearest_gate ? name(l.nearest_gate) : '—'}</td>
                  <td>{l.source ?? '—'}</td>
                  <td className="small" style={{ whiteSpace: 'nowrap' }}>{timeAgo(l.updated_at)}</td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <button className="btn sm" disabled={busy} onClick={() => void delta(l, -10)} aria-label="Remove 10 vehicles">−10</button>
                      <button className="btn sm" disabled={busy} onClick={() => void delta(l, -1)} aria-label="Remove 1 vehicle">−1</button>
                      <button className="btn sm" disabled={busy} onClick={() => void delta(l, 1)} aria-label="Add 1 vehicle">+1</button>
                      <button className="btn sm" disabled={busy} onClick={() => void delta(l, 10)} aria-label="Add 10 vehicles">+10</button>
                      <button className="btn sm tonal" onClick={() => { setOccFor(l); setOcc(String(l.occupied_slots)) }}>Set</button>
                      <button className="btn sm" onClick={() => openEdit(l)}><Pencil size={16} aria-hidden />Edit</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card" style={{ maxWidth: 640 }}>
        <div className="card-head"><h2 className="row" style={{ gap: 8 }}><QrCode size={18} aria-hidden />Scan digital parking pass</h2></div>
        <p className="muted small" style={{ marginBottom: 12 }}>Enter or scan the QR token on the pilgrim's pass. It marks the pass used and adds one vehicle to that lot.</p>
        <div className="row">
          <input className="input" aria-label="QR token" placeholder="QR token" value={token} onChange={(e) => setToken(e.target.value)} />
          <button className="btn primary" onClick={() => void scan()} disabled={!token || busy}><ScanLine size={18} aria-hidden />Scan</button>
        </div>
      </div>
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={`Edit ${edit ? name(edit.location) : ''}`}>
        <div className="stack">
          <Field label="Total slots"><input className="input" type="number" min={0} value={total} onChange={(e) => setTotal(e.target.value)} /></Field>
          <Field label="Status" hint={'Open, filling and full are re-derived from occupancy automatically; "closed" stays until changed.'}>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>{['open', 'filling', 'full', 'closed'].map((s) => <option key={s}>{s}</option>)}</select>
          </Field>
          <Field label="Shuttle info" optional><input className="input" value={shuttle} onChange={(e) => setShuttle(e.target.value)} /></Field>
          <button className="btn primary block" disabled={busy} onClick={() => void saveEdit()}>Save changes</button>
        </div>
      </Sheet>
      <Sheet open={!!occFor} onClose={() => setOccFor(null)} title={`Set occupancy: ${occFor ? name(occFor.location) : ''}`}>
        <div className="stack">
          <Field label="Occupied vehicles"><input className="input" type="number" min={0} value={occ} onChange={(e) => setOcc(e.target.value)} /></Field>
          <button className="btn primary block" disabled={busy} onClick={() => void saveOcc()}>Save</button>
        </div>
      </Sheet>
    </div>
  )
}
