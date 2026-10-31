import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Copy, KeyRound, Plus, TriangleAlert } from 'lucide-react'
import { api, timeAgo, type Device, type Location } from '../../api'
import { useLang } from '../../i18n'
import { Field, PageHead, Sheet } from '../../components/ui'

interface RecentSighting { tag: string; location_id: number; location: string; seen_at: string; method: string; device_id: number | null }

export default function DevicesAdminPage() {
  const { name } = useLang()
  const [devices, setDevices] = useState<Device[]>([])
  const [locs, setLocs] = useState<Location[]>([])
  const [recent, setRecent] = useState<RecentSighting[]>([])
  const [f, setF] = useState({ name: '', type: 'rfid_reader', location_id: '' })
  const [created, setCreated] = useState<Device | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [revokeFor, setRevokeFor] = useState<Device | null>(null)

  const load = useCallback(async () => {
    try {
      const [d, r] = await Promise.all([api.get<Device[]>('/admin/devices'), api.get<RecentSighting[]>('/admin/sightings/recent?limit=50')])
      setDevices(d); setRecent(r); setErr(null)
    } catch (e) { setErr((e as Error).message) }
  }, [])
  useEffect(() => { void load(); api.get<Location[]>('/locations').then(setLocs).catch(() => undefined); const id = window.setInterval(() => void load(), 20000); return () => clearInterval(id) }, [load])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const d = await api.post<Device>('/admin/devices', { name: f.name, type: f.type, location_id: f.location_id ? Number(f.location_id) : null })
      setCreated(d); setCopied(false); setF({ name: '', type: f.type, location_id: '' }); await load()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const revoke = async (d: Device) => { try { await api.del(`/admin/devices/${d.id}`); setRevokeFor(null); await load() } catch (e) { setErr((e as Error).message) } }
  const online = (d: Device) => d.status === 'active' && d.last_seen_at && Date.now() - new Date(d.last_seen_at).getTime() < 10 * 60 * 1000
  const locName = (id: number | null) => { const l = locs.find((x) => x.id === id); return l ? name(l) : '—' }
  const key = created?.api_key ?? 'pk_xxx'

  return (
    <div className="stack loose">
      <PageHead back={false} title="Devices" sub="RFID readers, AI camera counters, parking counters and kiosks authenticate with a per-device key (hashed at rest, shown once at creation). Demo devices from the seed use fixed keys for the simulator — never do that in production." />
      {err && <div className="err" role="alert">{err}</div>}
      <div className="layout-aside">
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="card-head" style={{ padding: '20px 20px 0' }}><h2>Registry</h2><span className="chip neutral">{devices.length}</span></div>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th>Name</th><th>Type</th><th>Location</th><th>Status</th><th>Last seen</th><th></th></tr></thead>
              <tbody>
                {devices.map((d) => (
                  <tr key={d.id}>
                    <td><b>{d.name}</b><div className="muted xs">#{d.id}</div></td>
                    <td>{d.type}</td>
                    <td>{locName(d.location_id)}</td>
                    <td>{d.status === 'revoked' ? <span className="chip closed">revoked</span> : online(d) ? <span className="chip low">online</span> : <span className="chip unknown">offline</span>}</td>
                    <td className="small" style={{ whiteSpace: 'nowrap' }}>{timeAgo(d.last_seen_at)}</td>
                    <td>{d.status === 'active' && <button className="btn sm danger-outline" onClick={() => setRevokeFor(d)}>Revoke</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <aside className="stack">
          <form className="card stack" onSubmit={create}>
            <div className="card-head" style={{ marginBottom: 0 }}><h2>Register device</h2></div>
            <Field label="Name"><input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. rfid-gate-b-2" /></Field>
            <Field label="Type">
              <select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{['rfid_reader', 'camera', 'parking_counter', 'kiosk'].map((t) => <option key={t}>{t}</option>)}</select>
            </Field>
            <Field label="Location (default for its readings)" optional>
              <select className="input" value={f.location_id} onChange={(e) => setF({ ...f, location_id: e.target.value })}><option value="">— none —</option>{locs.map((l) => <option key={l.id} value={l.id}>{name(l)} ({l.code})</option>)}</select>
            </Field>
            <button className="btn primary block" disabled={busy}><Plus size={18} aria-hidden />Create &amp; issue key</button>
            {created?.api_key && (
              <div className="stack tight">
                <div className="notice warn"><TriangleAlert size={18} aria-hidden /><div className="grow">This key is shown only once. Store it on the device now.</div></div>
                <div className="qr" style={{ overflowWrap: 'anywhere' }}>{created.api_key}</div>
                <button type="button" className="btn sm tonal" onClick={() => { void navigator.clipboard?.writeText(created.api_key!); setCopied(true) }}><Copy size={16} aria-hidden />{copied ? 'Copied' : 'Copy key'}</button>
              </div>
            )}
          </form>
          <div className="card">
            <div className="card-head"><h2 className="row" style={{ gap: 8 }}><KeyRound size={18} aria-hidden />How to connect a device</h2></div>
            <pre className="xs" style={{ overflowX: 'auto', background: 'var(--surface-2)', padding: 12, borderRadius: 10, margin: 0, whiteSpace: 'pre' }}>{`# RFID reader / edge gateway: batch of sightings
curl -X POST ${location.origin}/api/v1/rfid/sightings \\
  -H "X-Device-Key: ${key}" -H "Content-Type: application/json" \\
  -d '[{"tag_uid":"GP27-00001","antenna":"A1","rssi":-52,"direction":"in","seen_at":"2027-06-26T05:10:00Z"}]'

# AI camera counter: people count for its location
curl -X POST ${location.origin}/api/v1/crowd/readings \\
  -H "X-Device-Key: ${key}" -H "Content-Type: application/json" \\
  -d '{"count": 4200, "source": "camera"}'

# Parking loop counter: +1 / -1
curl -X POST ${location.origin}/api/v1/parking/<lot_id>/occupancy \\
  -H "X-Device-Key: ${key}" -H "Content-Type: application/json" -d '{"delta": 1}'`}</pre>
            <div className="muted xs" style={{ marginTop: 8 }}>Edge gateways should dedupe repeats within 30 s and buffer while offline; the server also dedupes.</div>
          </div>
        </aside>
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="card-head" style={{ padding: '20px 20px 0', marginBottom: 4 }}><h2>Recent sightings (ingestion health)</h2></div>
        <div className="muted xs" style={{ padding: '0 20px 8px' }}>Tag UIDs are masked; this view is for pipeline health, not identity.</div>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>Tag</th><th>Location</th><th>Method</th><th>Device</th><th>Seen</th></tr></thead>
            <tbody>{recent.map((r, i) => <tr key={i}><td>{r.tag}</td><td>{r.location}</td><td>{r.method}</td><td>{r.device_id ?? 'staff'}</td><td className="small" style={{ whiteSpace: 'nowrap' }}>{timeAgo(r.seen_at)}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
      <Sheet open={!!revokeFor} onClose={() => setRevokeFor(null)} title={`Revoke ${revokeFor?.name ?? ''}?`}>
        <div className="stack">
          <p className="small">The device key stops being accepted immediately. Readers using it will need a new key.</p>
          <div className="row">
            <button className="btn danger grow" onClick={() => revokeFor && void revoke(revokeFor)}>Revoke key</button>
            <button className="btn grow" onClick={() => setRevokeFor(null)}>Cancel</button>
          </div>
        </div>
      </Sheet>
    </div>
  )
}
