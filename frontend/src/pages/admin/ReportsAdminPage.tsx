import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Briefcase, Camera, CheckCheck, ClipboardList, History, MapPin, Phone, Siren } from 'lucide-react'
import { API, api, getToken, timeAgo, type Location, type Report, type ReportEvent, type Sos } from '../../api'
import { useLang } from '../../i18n'
import { useLive } from '../../store'
import MapView from '../../components/MapView'
import { EmptyState, Field, PageHead, Sheet } from '../../components/ui'

const STATUSES: Report['status'][] = ['open', 'verified', 'searching', 'found', 'closed', 'rejected']
const STATUS_CHIP: Record<Report['status'], string> = { open: 'critical', verified: 'high', searching: 'moderate', found: 'low', closed: 'neutral', rejected: 'neutral' }
const STATUS_WORD: Record<Report['status'], string> = { open: 'Open', verified: 'Verified', searching: 'Searching', found: 'Found', closed: 'Closed', rejected: 'Rejected' }
const TRANSITIONS: Record<Report['status'], Report['status'][]> = {
  open: ['verified', 'rejected', 'closed'], verified: ['searching', 'rejected', 'closed'], searching: ['found', 'closed'], found: ['closed', 'searching'], closed: [], rejected: [],
}
const LABEL: Record<Report['status'], string> = { open: 'Open', verified: 'Verify', searching: 'Start search', found: 'Mark found', closed: 'Close', rejected: 'Reject' }
const SOS_CHIP: Record<string, string> = { new: 'critical', acknowledged: 'high', dispatched: 'moderate', resolved: 'low' }

export default function ReportsAdminPage() {
  const { name } = useLang()
  const [tab, setTab] = useState<'reports' | 'sos'>('reports')
  const [filter, setFilter] = useState<string[]>(['open', 'verified', 'searching', 'found'])
  const [reports, setReports] = useState<Report[]>([])
  const [sos, setSos] = useState<Sos[]>([])
  const [locs, setLocs] = useState<Location[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<number, string>>({})
  const [timeline, setTimeline] = useState<{ id: number; events: ReportEvent[] } | null>(null)
  const [photo, setPhoto] = useState<{ id: number; url: string } | null>(null)
  const [foundFor, setFoundFor] = useState<Report | null>(null)
  const [desk, setDesk] = useState<number | ''>('')
  const [mapSos, setMapSos] = useState<Sos | null>(null)
  const [busy, setBusy] = useState(false)

  const locById = useMemo(() => new Map(locs.map((l) => [l.id, l])), [locs])
  const desks = useMemo(() => locs.filter((l) => l.type === 'help_desk' || l.type === 'lost_found'), [locs])

  const load = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([
        api.get<Report[]>(`/missing-reports?status_=${filter.join(',') || 'open'}`),
        api.get<Sos[]>('/sos?status_=new,acknowledged,dispatched'),
      ])
      setReports(r); setSos(s); setErr(null)
    } catch (e) { setErr((e as Error).message) }
  }, [filter])
  useEffect(() => { void load() }, [load])
  useEffect(() => { api.get<Location[]>('/locations').then(setLocs).catch(() => undefined) }, [])
  useLive(['report.created', 'report.updated', 'sos.created', 'sos.updated'], () => void load())

  const guarded = async (fn: () => Promise<void>) => { if (busy) return; setBusy(true); try { await fn() } finally { setBusy(false) } }
  const patch = (r: Report, status: Report['status'], extra: Record<string, unknown> = {}) => guarded(async () => {
    try { await api.patch(`/missing-reports/${r.id}`, { status, note: notes[r.id] || undefined, ...extra }); setNotes((n) => ({ ...n, [r.id]: '' })); await load() } catch (e) { setErr((e as Error).message) }
  })
  const act = (r: Report, s: Report['status']) => { if (s === 'found') { setFoundFor(r); setDesk(r.help_desk_location_id ?? '') } else void patch(r, s) }
  const viewTimeline = async (r: Report) => { try { setTimeline({ id: r.id, events: await api.get<ReportEvent[]>(`/missing-reports/${r.id}/events`) }) } catch (e) { setErr((e as Error).message) } }
  const viewPhoto = async (r: Report) => {
    try {
      const res = await fetch(`${API}/missing-reports/${r.id}/photo`, { headers: { Authorization: `Bearer ${getToken() ?? ''}` } })
      if (!res.ok) throw new Error('Photo not available')
      setPhoto({ id: r.id, url: URL.createObjectURL(await res.blob()) })
    } catch (e) { setErr((e as Error).message) }
  }
  const sosPatch = (s: Sos, status: string) => guarded(async () => { try { await api.patch(`/sos/${s.id}`, { status }); await load() } catch (e) { setErr((e as Error).message) } })

  const sosLoc = (s: Sos): Location | null => s.lat == null || s.lng == null ? null : ({ id: -s.id, code: `SOS-${s.id}`, site_id: 0, type: 'other', name: `SOS #${s.id} (${s.type})`, name_te: null, name_hi: null, lat: s.lat, lng: s.lng, capacity: null, is_accessible: false, is_open: true, monitored: false, current_count: null, density_level: 'unknown', density_source: null, density_updated_at: null, details: {}, verification: 'official', source: 'SOS report', source_ref: null, source_retrieved_at: null, verified_at: null, verification_note: null })

  return (
    <div className="stack loose">
      <PageHead back={false} title="Missing persons & SOS" sub="Personal details are shown to staff only. Every status change is written to the report timeline; last-seen lookups are audited." />
      <div className="tabs" role="group" aria-label="Queue">
        <button className={tab === 'reports' ? 'active' : ''} aria-pressed={tab === 'reports'} onClick={() => setTab('reports')}><ClipboardList size={16} aria-hidden />Missing-person reports ({reports.length})</button>
        <button className={tab === 'sos' ? 'active' : ''} aria-pressed={tab === 'sos'} onClick={() => setTab('sos')}><Siren size={16} aria-hidden />SOS queue ({sos.length})</button>
      </div>
      {err && <div className="err" role="alert">{err}</div>}

      {tab === 'reports' && (
        <div className="stack">
          <div className="card stack">
            <div className="field-label" style={{ marginBottom: 0 }}>Show reports with status</div>
            <div className="tabs" role="group" aria-label="Status filter">
              {STATUSES.map((s) => {
                const on = filter.includes(s)
                return <button key={s} className={on ? 'active' : ''} aria-pressed={on} onClick={() => setFilter((f) => on ? f.filter((x) => x !== s) : [...f, s])}>{STATUS_WORD[s]}</button>
              })}
            </div>
            <div className="row wrap" style={{ gap: 8 }}>
              <span className="muted small">For an RFID last-seen lookup of a linked family member, use field mode.</span>
              <Link to="/staff" className="btn ghost sm"><Briefcase size={16} aria-hidden />Open field mode — wristband lookup</Link>
            </div>
          </div>
          {reports.length === 0 ? <div className="card"><EmptyState icon={ClipboardList} title="No reports match" body="Change the status filter to see other reports." /></div> : (
            <div className="list">
              {reports.map((r) => (
                <div key={r.id} className="card stack tight">
                  <div className="row between top wrap">
                    <div style={{ minWidth: 0 }}>
                      <div className="row wrap" style={{ gap: 6 }}>
                        <b style={{ overflowWrap: 'anywhere' }}>#{r.id} {r.subject_name}</b>
                        <span className={`chip ${STATUS_CHIP[r.status]}`}>{STATUS_WORD[r.status]}</span>
                        {(r.age != null && (r.age < 12 || r.age > 65)) && <span className="chip critical">vulnerable</span>}
                      </div>
                      <div className="small muted" style={{ overflowWrap: 'anywhere', marginTop: 2 }}>
                        {r.age != null ? `Age ${r.age}` : 'Age unknown'}{r.gender ? ` · ${r.gender}` : ''}{r.clothing ? ` · ${r.clothing}` : ''}
                        {r.last_seen_location_id && locById.get(r.last_seen_location_id) ? ` · last seen: ${name(locById.get(r.last_seen_location_id)!)}` : ''}
                        {r.last_seen_at ? ` (${timeAgo(r.last_seen_at)})` : ''}
                      </div>
                      {r.description && <div className="small" style={{ overflowWrap: 'anywhere' }}>{r.description}</div>}
                      <div className="small muted" style={{ overflowWrap: 'anywhere' }}>
                        Filed {timeAgo(r.created_at)}{r.assigned_staff_id ? ` · staff #${r.assigned_staff_id}` : ''}
                        {r.help_desk_location_id && locById.get(r.help_desk_location_id) ? ` · desk: ${name(locById.get(r.help_desk_location_id)!)}` : ''}
                        {r.member_id ? ' · linked family member (RFID lookup possible)' : ''}
                      </div>
                    </div>
                    <div className="row wrap" style={{ gap: 6 }}>
                      {r.contact_phone && <a className="btn sm tonal" href={`tel:${r.contact_phone}`}><Phone size={16} aria-hidden />{r.contact_phone}</a>}
                      <button className="btn sm" onClick={() => void viewTimeline(r)}><History size={16} aria-hidden />Timeline</button>
                      {r.has_photo && <button className="btn sm" onClick={() => void viewPhoto(r)}><Camera size={16} aria-hidden />Photo</button>}
                    </div>
                  </div>
                  {TRANSITIONS[r.status].length > 0 && (
                    <div className="row wrap" style={{ borderTop: '1px solid var(--line)', paddingTop: 12, gap: 8 }}>
                      <input className="input grow" style={{ minWidth: 180 }} aria-label={`Note for report ${r.id}`} placeholder="Note (optional)" value={notes[r.id] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} />
                      {TRANSITIONS[r.status].map((s) => <button key={s} disabled={busy} className={`btn sm ${s === 'found' ? 'primary' : s === 'rejected' ? 'danger-outline' : ''}`} onClick={() => act(r, s)}>{LABEL[s]}</button>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'sos' && (
        sos.length === 0 ? <div className="card"><EmptyState icon={Siren} title="No open SOS requests" body="New in-app requests from pilgrims appear here instantly." /></div> : (
          <div className="list">
            {sos.map((s) => (
              <div key={s.id} className="card stack tight">
                <div className="row between top wrap">
                  <div style={{ minWidth: 0 }}>
                    <div className="row wrap" style={{ gap: 6 }}><b>#{s.id} {s.type.toUpperCase()}</b><span className={`chip ${SOS_CHIP[s.status] ?? 'neutral'}`}>{s.status}</span></div>
                    <div className="small muted">{timeAgo(s.created_at)}{s.assigned_to ? ` · staff #${s.assigned_to}` : ''}{s.lat != null ? ` · ${s.lat.toFixed(5)}, ${s.lng?.toFixed(5)}` : ' · no location'}</div>
                    {s.note && <div className="small" style={{ overflowWrap: 'anywhere' }}>{s.note}</div>}
                  </div>
                  {s.phone ? <a className="btn sm tonal" href={`tel:${s.phone}`}><Phone size={16} aria-hidden />{s.phone}</a> : <span className="muted small">No phone</span>}
                </div>
                <div className="row wrap" style={{ borderTop: '1px solid var(--line)', paddingTop: 12, gap: 8 }}>
                  {s.lat != null && <button className="btn sm" onClick={() => setMapSos(s)}><MapPin size={16} aria-hidden />Show on map</button>}
                  {s.status === 'new' && <button className="btn sm tonal" disabled={busy} onClick={() => void sosPatch(s, 'acknowledged')}>Acknowledge</button>}
                  {(s.status === 'new' || s.status === 'acknowledged') && <button className="btn sm primary" disabled={busy} onClick={() => void sosPatch(s, 'dispatched')}>Dispatch team</button>}
                  <button className="btn sm" disabled={busy} onClick={() => void sosPatch(s, 'resolved')}><CheckCheck size={16} aria-hidden />Resolve</button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      <Sheet open={!!timeline} onClose={() => setTimeline(null)} title={`Report #${timeline?.id ?? ''} timeline`}>
        <div className="list grouped">
          {timeline?.events.map((e) => (
            <div key={e.id} className="small" style={{ padding: '10px 14px', overflowWrap: 'anywhere' }}>
              <span className="muted">{new Date(e.created_at).toLocaleString()}</span> · <b>{e.event_type}</b>{e.actor_id ? ` by user #${e.actor_id}` : ''}{e.note ? ` — ${e.note}` : ''}
            </div>
          ))}
        </div>
      </Sheet>
      <Sheet open={!!photo} onClose={() => { if (photo) URL.revokeObjectURL(photo.url); setPhoto(null) }} title={`Report #${photo?.id ?? ''} photo`}>
        <p className="muted small" style={{ marginBottom: 12 }}>Shown to authorised staff only; this view is audited.</p>
        {photo && <img src={photo.url} alt="Reported person" style={{ maxWidth: '100%', borderRadius: 12 }} />}
      </Sheet>
      <Sheet open={!!foundFor} onClose={() => setFoundFor(null)} title={`Mark #${foundFor?.id ?? ''} found`}>
        <div className="stack">
          <Field label="Held at help desk">
            <select className="input" value={desk} onChange={(e) => setDesk(e.target.value ? Number(e.target.value) : '')}>
              <option value="">— select —</option>{desks.map((d) => <option key={d.id} value={d.id}>{name(d)}</option>)}
            </select>
          </Field>
          <button className="btn primary block" disabled={desk === '' || busy} onClick={() => foundFor && void patch(foundFor, 'found', { help_desk_location_id: desk }).then(() => setFoundFor(null))}>Confirm found</button>
        </div>
      </Sheet>
      <Sheet open={!!mapSos} onClose={() => setMapSos(null)} title={`SOS #${mapSos?.id ?? ''} location`}>
        {mapSos && sosLoc(mapSos) && <div className="map-panel"><MapView center={[mapSos.lat!, mapSos.lng!]} zoom={17} locations={[sosLoc(mapSos)!]} height="320px" /></div>}
      </Sheet>
    </div>
  )
}
