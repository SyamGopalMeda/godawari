import { useCallback, useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { api, type AuditEntry } from '../../api'
import { PageHead } from '../../components/ui'

const PREFIXES = ['', 'family.', 'report.', 'rfid.', 'crowd.', 'auth.', 'device.', 'sos.']

export default function AuditAdminPage() {
  const [rows, setRows] = useState<AuditEntry[]>([])
  const [filter, setFilter] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const load = useCallback(async () => {
    try { setRows(await api.get<AuditEntry[]>(`/admin/audit?limit=200${filter ? `&action=${encodeURIComponent(filter)}` : ''}`)); setErr(null) } catch (e) { setErr((e as Error).message) }
  }, [filter])
  useEffect(() => { const t = window.setTimeout(() => void load(), 250); return () => clearTimeout(t) }, [load])

  return (
    <div className="stack loose">
      <PageHead back={false} title="Audit log" sub={<>Every access to personal data is recorded. Family last-seen lookups (<code>family.last_seen_lookup</code>) carry a purpose — family self-service or the missing-report number. Wristband lookups, report and photo views, crowd overrides, device keys and logins are recorded too. This is the evidence trail required under the DPDP Act for consent-based tracking.</>} />
      <div className="card stack">
        <div className="search" style={{ maxWidth: 420 }}>
          <Search size={18} aria-hidden />
          <input className="input" aria-label="Filter by action prefix" placeholder="Filter by action prefix, e.g. family. or report." value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <div className="tabs" role="group" aria-label="Quick filters">
          {PREFIXES.map((p) => <button key={p || 'all'} className={filter === p ? 'active' : ''} aria-pressed={filter === p} onClick={() => setFilter(p)}>{p || 'All'}</button>)}
        </div>
        <div className="muted small">{rows.length} entries</div>
      </div>
      {err && <div className="err" role="alert">{err}</div>}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Device</th><th>Entity</th><th>Entity id</th><th>Purpose</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="small" style={{ whiteSpace: 'nowrap' }}>{new Date(r.created_at).toLocaleString()}</td>
                  <td><code>{r.action}</code></td>
                  <td>{r.actor_id != null ? `user #${r.actor_id}` : '—'}</td>
                  <td>{r.device_id != null ? `device #${r.device_id}` : '—'}</td>
                  <td>{r.entity ?? '—'}</td>
                  <td style={{ overflowWrap: 'anywhere' }}>{r.entity_id ?? '—'}</td>
                  <td className="small">{r.purpose ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
