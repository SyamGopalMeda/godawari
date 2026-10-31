import { useEffect, useState, type FormEvent } from 'react'
import { Megaphone } from 'lucide-react'
import { api, type Alert, type Location } from '../../api'
import { useLang } from '../../i18n'
import { useStore } from '../../store'
import { EmptyState, Field, Notice, PageHead, Segmented } from '../../components/ui'
import { AlertCard } from './DashboardPage'

type Sev = 'info' | 'warning' | 'critical'

export default function AlertsAdminPage() {
  const { alerts, reload, site } = useStore()
  const { name } = useLang()
  const [locs, setLocs] = useState<Location[]>([])
  const [f, setF] = useState({ title: '', body: '', title_te: '', body_te: '', title_hi: '', body_hi: '', severity: 'info' as Sev, expires_in_minutes: 120, location_id: '' })
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.get<Location[]>('/locations').then(setLocs).catch(() => undefined) }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      await api.post('/alerts', { ...f, title_te: f.title_te || null, body_te: f.body_te || null, title_hi: f.title_hi || null, body_hi: f.body_hi || null, location_id: f.location_id ? Number(f.location_id) : null, site_id: site?.id ?? null })
      setMsg({ ok: 'Alert published to all connected apps' }); setF({ ...f, title: '', body: '', title_te: '', body_te: '', title_hi: '', body_hi: '' }); await reload()
    } catch (e) { setMsg({ err: (e as Error).message }) } finally { setBusy(false) }
  }
  const expire = async (id: number) => { try { await api.del(`/alerts/${id}`); await reload() } catch (e) { setMsg({ err: (e as Error).message }) } }
  const preview: Alert = { id: 0, title: f.title || 'Preview title', body: f.body || 'Preview message', title_te: null, body_te: null, title_hi: null, body_hi: null, severity: f.severity, site_id: null, location_id: null, starts_at: '', expires_at: null, created_at: '' }

  return (
    <div className="stack loose">
      <PageHead back={false} title="Alerts" sub="Alerts reach every open app instantly over the live connection and appear on the pilgrim home screen. Push notifications to closed apps need FCM / Web Push (not configured in this build)." />
      {msg.err && <div className="err" role="alert">{msg.err}</div>}
      {msg.ok && <div className="ok" role="status">{msg.ok}</div>}
      <div className="cols-2">
        <form className="card stack" onSubmit={submit}>
          <div className="card-head" style={{ marginBottom: 0 }}><h2>New alert</h2></div>
          <Field label="Title (English)"><input className="input" required maxLength={160} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Message (English)"><textarea className="input" required value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
          <Field label="Title (తెలుగు)" optional><input className="input" value={f.title_te} onChange={(e) => setF({ ...f, title_te: e.target.value })} /></Field>
          <Field label="Message (తెలుగు)" optional><textarea className="input" value={f.body_te} onChange={(e) => setF({ ...f, body_te: e.target.value })} /></Field>
          <Field label="Title (हिन्दी)" optional><input className="input" value={f.title_hi} onChange={(e) => setF({ ...f, title_hi: e.target.value })} /></Field>
          <Field label="Message (हिन्दी)" optional><textarea className="input" value={f.body_hi} onChange={(e) => setF({ ...f, body_hi: e.target.value })} /></Field>
          <div className="field">
            <div className="field-label">Severity</div>
            <Segmented label="Severity" value={f.severity} onChange={(v) => setF({ ...f, severity: v })} options={[{ value: 'info', label: 'Info' }, { value: 'warning', label: 'Warning' }, { value: 'critical', label: 'Critical' }]} />
          </div>
          <div className="grid2">
            <Field label="Expires in (minutes)"><input className="input" type="number" min={1} max={10080} value={f.expires_in_minutes} onChange={(e) => setF({ ...f, expires_in_minutes: Number(e.target.value) })} /></Field>
            <Field label="Related location" optional>
              <select className="input" value={f.location_id} onChange={(e) => setF({ ...f, location_id: e.target.value })}><option value="">— none —</option>{locs.map((l) => <option key={l.id} value={l.id}>{name(l)}</option>)}</select>
            </Field>
          </div>
          <div className="field"><div className="field-label">Preview</div><AlertCard a={preview} /></div>
          <button className="btn primary block" disabled={busy} aria-busy={busy || undefined}>{busy ? <span className="spin" aria-hidden /> : <Megaphone size={18} aria-hidden />}Publish alert</button>
        </form>
        <div className="card">
          <div className="card-head"><h2>Active alerts</h2><span className="chip neutral">{alerts.length}</span></div>
          {alerts.length === 0 ? <EmptyState icon={Megaphone} title="No active alerts" body="Published alerts stay here until they expire or you end them." /> : (
            <div className="list">
              {alerts.map((a) => (
                <AlertCard key={a.id} a={a}
                  action={<button className="btn sm" onClick={() => void expire(a.id)}>End now</button>}
                  extra={<>
                    {a.title_te && <div className="small muted" style={{ marginTop: 4, overflowWrap: 'anywhere' }}>{a.title_te} — {a.body_te}</div>}
                    {a.title_hi && <div className="small muted" style={{ marginTop: 4, overflowWrap: 'anywhere' }}>{a.title_hi} — {a.body_hi}</div>}
                    {a.location_id ? <div className="small muted" style={{ marginTop: 4 }}>Location: {locs.find((l) => l.id === a.location_id)?.name ?? `#${a.location_id}`}</div> : null}
                  </>} />
              ))}
            </div>
          )}
          <div style={{ marginTop: 12 }}><Notice>Telugu and Hindi texts are optional; the app falls back to English when a translation is missing.</Notice></div>
        </div>
      </div>
    </div>
  )
}
