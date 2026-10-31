/* Field-staff mode: help-desk volunteers and on-site staff, phone-first, trilingual. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Ban, Gauge, MapPin, MonitorCog, Phone, Search, SearchCheck, Siren, Tags, Watch, type LucideIcon } from 'lucide-react'
import { api, timeAgo, type Location, type Report, type Sighting, type Sos } from '../../api'
import { useLang } from '../../i18n'
import { useLive, useStore } from '../../store'
import { DensityChip, EmptyState, Field, PageHead } from '../../components/ui'

interface TagInfo { uid: string; status: string; linked: boolean; member: { id: number; display_name: string; age_group: string; family_id: number; is_vulnerable: boolean } | null; family_contact: string | null; recent: Sighting[] }
type Tab = 'tag' | 'reports' | 'sos' | 'crowd' | 'issue'
const LEVEL_RATIO = { low: 0.2, moderate: 0.55, high: 0.8, critical: 0.95 } as const
const TRANSITIONS: Record<Report['status'], Report['status'][]> = { open: ['verified', 'rejected'], verified: ['searching'], searching: ['found', 'closed'], found: ['closed', 'searching'], closed: [], rejected: [] }

export default function StaffPage() {
  const { user, crowd, reload } = useStore()
  const { t, tr, name } = useLang()
  const [tab, setTab] = useState<Tab>('tag')
  const [locs, setLocs] = useState<Location[]>([])
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const [busy, setBusy] = useState(false)
  // tag
  const [uid, setUid] = useState('')
  const [tag, setTag] = useState<TagInfo | null>(null)
  const [scanLoc, setScanLoc] = useState<number | ''>(user?.help_desk_location_id ?? '')
  const [confirmLost, setConfirmLost] = useState(false)
  // reports/sos
  const [reports, setReports] = useState<Report[]>([])
  const [sos, setSos] = useState<Sos[]>([])
  // crowd
  const [crowdLoc, setCrowdLoc] = useState<number | ''>('')
  const [count, setCount] = useState('')
  // issue
  const [uids, setUids] = useState('')

  const desks = useMemo(() => locs.filter((l) => ['help_desk', 'lost_found', 'checkpoint', 'gate', 'medical', 'police'].includes(l.type)), [locs])
  const locById = useMemo(() => new Map(locs.map((l) => [l.id, l])), [locs])
  const myDesk = user?.help_desk_location_id ? locById.get(user.help_desk_location_id) : null

  const load = useCallback(async () => {
    try {
      const [all, s] = await Promise.all([api.get<Report[]>('/missing-reports?status_=open,verified,searching,found'), api.get<Sos[]>('/sos')])
      const mine = user?.help_desk_location_id
      setReports([...all].sort((a, b) => (b.help_desk_location_id === mine ? 1 : 0) - (a.help_desk_location_id === mine ? 1 : 0) || (a.status === 'open' ? -1 : 1)))
      setSos(s)
    } catch (e) { setMsg({ err: (e as Error).message }) }
  }, [user?.help_desk_location_id])
  useEffect(() => { void load(); api.get<Location[]>('/locations').then(setLocs).catch(() => undefined) }, [load])
  useLive(['report.created', 'report.updated', 'sos.created', 'sos.updated'], () => void load())

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    if (busy) return
    setBusy(true)
    try { await fn(); setMsg({ ok }) } catch (e) { setMsg({ err: (e as Error).message }) } finally { setBusy(false) }
  }
  const lookup = () => run(async () => setTag(await api.get<TagInfo>(`/rfid/tags/${encodeURIComponent(uid.trim().toUpperCase())}`)), tr({ te: 'ట్యాగ్ కనుగొనబడింది', hi: 'टैग मिला', en: 'Tag found' }))
  const refreshTag = async (u: string) => { try { setTag(await api.get<TagInfo>(`/rfid/tags/${encodeURIComponent(u)}`)) } catch { /* keep previous */ } }
  const recordScan = () => tag && scanLoc !== '' && run(() => api.post('/rfid/manual-scan', { tag_uid: tag.uid, location_id: scanLoc, method: 'qr' }), tr({ te: 'స్కాన్ నమోదైంది', hi: 'स्कैन दर्ज हुआ', en: 'Scan recorded' })).then(() => refreshTag(tag.uid))
  const markLost = () => tag && run(() => api.patch(`/rfid/tags/${tag.uid}/lost`), tr({ te: 'పోయినదిగా గుర్తించబడింది', hi: 'खोया हुआ चिह्नित', en: 'Marked lost' })).then(() => { setConfirmLost(false); void refreshTag(tag.uid) })
  const patchReport = (r: Report, status: Report['status']) => run(() => api.patch(`/missing-reports/${r.id}`, { status, help_desk_location_id: status === 'found' ? (user?.help_desk_location_id ?? undefined) : undefined }), `#${r.id} → ${status}`).then(load)
  const patchSos = (s: Sos, status: string) => run(() => api.patch(`/sos/${s.id}`, { status }), `SOS #${s.id} → ${status}`).then(load)
  const postCrowd = (c: number) => crowdLoc !== '' && run(() => api.post('/crowd/readings', { location_id: crowdLoc, count: Math.round(c), source: 'manual' }), tr({ te: 'రద్దీ నవీకరించబడింది', hi: 'भीड़ अपडेट हुई', en: 'Crowd updated' })).then(() => { setCount(''); void reload() })
  const issue = () => {
    const list = uids.split(/[\s,]+/).map((x) => x.trim().toUpperCase()).filter(Boolean)
    if (!list.length || busy) return
    setBusy(true)
    api.post<{ created: number }>('/rfid/tags', { uids: list })
      .then((r) => { setUids(''); setMsg({ ok: `${r.created} ${tr({ te: 'రిస్ట్‌బ్యాండ్లు జారీ', hi: 'रिस्टबैंड जारी', en: 'wristbands issued' })}` }) })
      .catch((e) => setMsg({ err: (e as Error).message }))
      .finally(() => setBusy(false))
  }
  const selCrowd = crowd.find((c) => c.location_id === crowdLoc)
  const STATUS_LABEL: Record<Report['status'], string> = {
    open: tr({ te: 'కొత్తది', hi: 'नया', en: 'Open' }), verified: tr({ te: 'ధృవీకరించు', hi: 'सत्यापित', en: 'Verify' }), searching: tr({ te: 'వెతుకుతున్నాం', hi: 'खोज जारी', en: 'Searching' }),
    found: tr({ te: 'దొరికారు', hi: 'मिल गया', en: 'Found' }), closed: tr({ te: 'మూసివేయి', hi: 'बंद', en: 'Close' }), rejected: tr({ te: 'తిరస్కరించు', hi: 'अस्वीकार', en: 'Reject' }),
  }

  const tabs: { k: Tab; icon: LucideIcon; label: string; count?: number }[] = [
    { k: 'tag', icon: Watch, label: tr({ te: 'రిస్ట్‌బ్యాండ్', hi: 'रिस्टबैंड', en: 'Wristband' }) },
    { k: 'reports', icon: SearchCheck, label: t('findMissing'), count: reports.length },
    { k: 'sos', icon: Siren, label: t('sos'), count: sos.length },
    { k: 'crowd', icon: Gauge, label: t('crowd') },
    { k: 'issue', icon: Tags, label: tr({ te: 'జారీ', hi: 'जारी करें', en: 'Issue tags' }) },
  ]

  return (
    <div className="stack loose">
      <PageHead back={false} title={t('staffMode')}
        sub={<span style={{ overflowWrap: 'anywhere' }}>{user?.name}{user?.role ? ` · ${user.role}` : ''}{myDesk ? ` · ${name(myDesk)}` : ''}</span>}
        actions={<Link to="/admin" className="btn ghost sm"><MonitorCog size={16} aria-hidden />{t('admin')}</Link>} />
      <div className="tabs" role="tablist" aria-label={t('staffMode')}>
        {tabs.map((x) => {
          const I = x.icon
          return (
            <button key={x.k} role="tab" aria-selected={tab === x.k} className={tab === x.k ? 'active' : ''} onClick={() => setTab(x.k)}>
              <I size={16} aria-hidden />{x.label}{x.count ? <span className="chip neutral" style={{ minHeight: 20, padding: '0 8px' }}>{x.count}</span> : null}
            </button>
          )
        })}
      </div>
      {msg.err && <div className="err" role="alert">{msg.err}</div>}
      {msg.ok && <div className="ok" role="status">{msg.ok}</div>}

      {tab === 'tag' && (
        <div className="layout-aside">
          <div className="card stack">
            <div className="card-head" style={{ marginBottom: 0 }}><h2 className="row" style={{ gap: 8 }}><Watch size={18} aria-hidden />{tr({ te: 'రిస్ట్‌బ్యాండ్ వెతకండి', hi: 'रिस्टबैंड खोजें', en: 'Wristband lookup' })}</h2></div>
            <Field label={t('tagUid')} htmlFor="uid" hint={tr({ te: 'రిస్ట్‌బ్యాండ్‌పై ముద్రించిన QR/నంబర్‌ను నమోదు చేయండి', hi: 'रिस्टबैंड पर छपा QR/नंबर दर्ज करें', en: 'Enter the number printed under the QR on the wristband' })}>
              <div className="row">
                <input id="uid" className="input" autoCapitalize="characters" placeholder="GP27-00001" value={uid} onChange={(e) => setUid(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter') void lookup() }} />
                <button className="btn primary" onClick={() => void lookup()} disabled={!uid.trim() || busy} aria-label={t('search')}><Search size={18} aria-hidden /><span className="hide-mobile">{t('search')}</span></button>
              </div>
            </Field>
          </div>
          <aside>
            {!tag ? (
              <div className="card"><EmptyState icon={Watch} title={tr({ te: 'ఫలితం ఇక్కడ కనిపిస్తుంది', hi: 'परिणाम यहाँ दिखेगा', en: 'The result appears here' })} body={tr({ te: 'లింక్ చేసిన వ్యక్తి, కుటుంబ సంప్రదింపు, చివరి చెక్‌పాయింట్లు.', hi: 'जुड़ा व्यक्ति, परिवार संपर्क, अंतिम चेकपॉइंट।', en: 'Linked person, family contact and the last checkpoints passed.' })} /></div>
            ) : (
              <div className="card stack">
                <div className="row between wrap"><b style={{ overflowWrap: 'anywhere' }}>{tag.uid}</b><span className={`chip ${tag.status === 'active' ? 'low' : tag.status === 'lost' ? 'critical' : 'neutral'}`}>{tag.status}</span></div>
                {tag.member ? (
                  <div className="stack tight">
                    <div className="row wrap" style={{ gap: 8 }}>
                      <span style={{ fontSize: 'var(--fs-xl)', fontWeight: 700 }}>{tag.member.display_name}</span>
                      {tag.member.is_vulnerable && <span className="chip critical">{tr({ te: 'ప్రత్యేక శ్రద్ధ', hi: 'विशेष ध्यान', en: 'Priority' })}</span>}
                    </div>
                    <div className="muted small">{tag.member.age_group}</div>
                    {tag.family_contact && <a className="btn primary block" href={`tel:${tag.family_contact}`}><Phone size={18} aria-hidden />{t('call')} {tag.family_contact}</a>}
                  </div>
                ) : <div className="muted">{tr({ te: 'ఈ ట్యాగ్ ఎవరికీ లింక్ కాలేదు', hi: 'यह टैग किसी से जुड़ा नहीं है', en: 'Not linked to anyone' })}</div>}
                <div>
                  <div className="field-label">{t('lastSeen')}</div>
                  {tag.recent.length === 0 && <div className="muted small">{t('neverSeen')}</div>}
                  {tag.recent.length > 0 && (
                    <div className="list grouped">
                      {tag.recent.map((s, i) => <div key={i} className="row small" style={{ padding: '10px 14px', gap: 8 }}><MapPin size={16} aria-hidden className="muted" /><span className="grow" style={{ overflowWrap: 'anywhere' }}>{s.location_name} · {timeAgo(s.seen_at)} · {s.method}{s.direction !== 'unknown' ? ` (${s.direction})` : ''}</span></div>)}
                    </div>
                  )}
                </div>
                <Field label={tr({ te: 'స్కాన్ స్థానం', hi: 'स्कैन स्थान', en: 'Scan location' })}>
                  <select className="input" value={scanLoc} onChange={(e) => setScanLoc(e.target.value ? Number(e.target.value) : '')}><option value="">—</option>{desks.map((d) => <option key={d.id} value={d.id}>{name(d)}</option>)}</select>
                </Field>
                <div className="grid2">
                  <button className="btn tonal" disabled={scanLoc === '' || busy} onClick={() => void recordScan()}><MapPin size={18} aria-hidden />{tr({ te: 'ఇక్కడ స్కాన్ నమోదు', hi: 'यहाँ स्कैन दर्ज करें', en: 'Record scan here' })}</button>
                  {!confirmLost
                    ? <button className="btn danger-outline" onClick={() => setConfirmLost(true)}><Ban size={18} aria-hidden />{tr({ te: 'పోయినదిగా గుర్తించు', hi: 'खोया चिह्नित करें', en: 'Mark lost' })}</button>
                    : <button className="btn danger" disabled={busy} onClick={() => void markLost()}>{tr({ te: 'నిర్ధారించు', hi: 'पुष्टि करें', en: 'Confirm: mark lost' })}</button>}
                </div>
                {confirmLost && <button className="btn ghost sm" onClick={() => setConfirmLost(false)}>{t('cancel')}</button>}
              </div>
            )}
          </aside>
        </div>
      )}

      {tab === 'reports' && (
        reports.length === 0 ? <div className="card"><EmptyState icon={SearchCheck} title={tr({ te: 'నివేదికలు లేవు', hi: 'कोई रिपोर्ट नहीं', en: 'No open reports' })} /></div> : (
          <div className="auto-grid">
            {reports.map((r) => {
              const mine = !!r.help_desk_location_id && r.help_desk_location_id === user?.help_desk_location_id
              return (
                <div key={r.id} className="card stack tight" style={mine ? { borderColor: 'var(--brand-700)', boxShadow: 'inset 0 0 0 1px var(--brand-700)' } : undefined}>
                  <div className="row between top" style={{ gap: 8 }}><b style={{ overflowWrap: 'anywhere' }}>#{r.id} {r.subject_name}</b><span className={`chip ${r.status === 'open' ? 'critical' : r.status === 'found' ? 'low' : 'moderate'}`}>{STATUS_LABEL[r.status]}</span></div>
                  {mine && <span className="chip brand" style={{ alignSelf: 'flex-start' }}>{tr({ te: 'నా కేంద్రం', hi: 'मेरा केंद्र', en: 'My desk' })}</span>}
                  <div className="small" style={{ overflowWrap: 'anywhere' }}>{r.age != null ? `${t('age')} ${r.age}` : ''}{r.gender ? ` · ${r.gender}` : ''}{r.clothing ? ` · ${r.clothing}` : ''}</div>
                  <div className="small muted" style={{ overflowWrap: 'anywhere' }}>{r.last_seen_location_id && locById.get(r.last_seen_location_id) ? `${t('lastSeenPlace')}: ${name(locById.get(r.last_seen_location_id)!)} · ` : ''}{timeAgo(r.created_at)}{r.help_desk_location_id && locById.get(r.help_desk_location_id) ? ` · ${name(locById.get(r.help_desk_location_id)!)}` : ''}</div>
                  <a className="btn sm tonal" style={{ alignSelf: 'flex-start' }} href={`tel:${r.contact_phone}`}><Phone size={16} aria-hidden />{r.contact_phone}</a>
                  {TRANSITIONS[r.status].length > 0 && <div className="row wrap" style={{ borderTop: '1px solid var(--line)', paddingTop: 12, gap: 8 }}>{TRANSITIONS[r.status].map((s) => <button key={s} disabled={busy} className={`btn sm ${s === 'found' ? 'primary' : s === 'rejected' ? 'danger-outline' : ''}`} onClick={() => void patchReport(r, s)}>{STATUS_LABEL[s]}</button>)}</div>}
                </div>
              )
            })}
          </div>
        )
      )}

      {tab === 'sos' && (
        sos.length === 0 ? <div className="card"><EmptyState icon={Siren} title={tr({ te: 'SOS అభ్యర్థనలు లేవు', hi: 'कोई SOS नहीं', en: 'No open SOS requests' })} /></div> : (
          <div className="auto-grid">
            {sos.map((s) => (
              <div key={s.id} className="card stack tight">
                <div className="row between"><b>#{s.id} {s.type.toUpperCase()}</b><span className={`chip ${s.status === 'new' ? 'critical' : 'moderate'}`}>{s.status}</span></div>
                <div className="small muted">{timeAgo(s.created_at)}</div>
                {s.note && <div className="small" style={{ overflowWrap: 'anywhere' }}>{s.note}</div>}
                <div className="row wrap" style={{ gap: 8 }}>
                  {s.phone && <a className="btn sm tonal" href={`tel:${s.phone}`}><Phone size={16} aria-hidden />{s.phone}</a>}
                  {s.lat != null && <a className="btn sm" href={`https://www.google.com/maps?q=${s.lat},${s.lng}`} target="_blank" rel="noreferrer"><MapPin size={16} aria-hidden />{s.lat.toFixed(4)}, {s.lng?.toFixed(4)}</a>}
                </div>
                <div className="row wrap" style={{ borderTop: '1px solid var(--line)', paddingTop: 12, gap: 8 }}>
                  {s.status === 'new' && <button className="btn sm primary" disabled={busy} onClick={() => void patchSos(s, 'acknowledged')}>{tr({ te: 'స్వీకరించాను', hi: 'स्वीकार', en: 'Acknowledge' })}</button>}
                  <button className="btn sm" disabled={busy} onClick={() => void patchSos(s, 'resolved')}>{tr({ te: 'పరిష్కరించబడింది', hi: 'हल हुआ', en: 'Resolve' })}</button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'crowd' && (
        <div className="card stack narrow" style={{ marginInline: 0 }}>
          <div className="card-head" style={{ marginBottom: 0 }}><h2 className="row" style={{ gap: 8 }}><Gauge size={18} aria-hidden />{tr({ te: 'రద్దీ నవీకరణ', hi: 'भीड़ अपडेट', en: 'Crowd update' })}</h2></div>
          <Field label={tr({ te: 'స్థానం', hi: 'स्थान', en: 'Location' })}>
            <select className="input" value={crowdLoc} onChange={(e) => setCrowdLoc(e.target.value ? Number(e.target.value) : '')}><option value="">—</option>{crowd.map((c) => <option key={c.location_id} value={c.location_id}>{name(c)}</option>)}</select>
          </Field>
          {selCrowd && (
            <>
              <div className="row between wrap"><DensityChip level={selCrowd.density_level} stale={selCrowd.is_stale} /><span className="muted small">{selCrowd.current_count ?? '—'} / {selCrowd.capacity ?? '—'} · {timeAgo(selCrowd.updated_at)}</span></div>
              <div className="grid2">
                {(['low', 'moderate', 'high', 'critical'] as const).map((lv) => <button key={lv} className="btn big" style={{ background: `var(--${lv}-soft)`, color: `var(--${lv})`, borderColor: `var(--${lv}-fill)` }} disabled={!selCrowd.capacity || busy} onClick={() => void postCrowd((selCrowd.capacity ?? 0) * LEVEL_RATIO[lv])}>{t(lv)}</button>)}
              </div>
              <div className="row">
                <input className="input" type="number" min={0} aria-label={tr({ te: 'ఖచ్చితమైన సంఖ్య', hi: 'सटीक संख्या', en: 'Exact count' })} placeholder={tr({ te: 'లేదా సంఖ్య', hi: 'या संख्या', en: 'or exact count' })} value={count} onChange={(e) => setCount(e.target.value)} />
                <button className="btn primary" disabled={count === '' || busy} onClick={() => void postCrowd(Number(count))}>{t('submit')}</button>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'issue' && (
        <div className="card stack narrow" style={{ marginInline: 0 }}>
          <div className="card-head" style={{ marginBottom: 0 }}><h2 className="row" style={{ gap: 8 }}><Tags size={18} aria-hidden />{tr({ te: 'రిస్ట్‌బ్యాండ్లు జారీ', hi: 'रिस्टबैंड जारी करें', en: 'Issue wristbands' })}</h2></div>
          <p className="muted small">{tr({ te: 'కొత్త రిస్ట్‌బ్యాండ్ నంబర్లను ఒక్కొక్కటి ఒక లైన్‌లో నమోదు చేయండి', hi: 'नए रिस्टबैंड नंबर, प्रति पंक्ति एक', en: 'Enter new wristband numbers, one per line. Families can then link issued tags in the app.' })}</p>
          <textarea className="input" aria-label={t('tagUid')} value={uids} onChange={(e) => setUids(e.target.value)} placeholder={'GP27-00101\nGP27-00102'} />
          <button className="btn primary" disabled={!uids.trim() || busy} onClick={issue}>{tr({ te: 'జారీ చేయి', hi: 'जारी करें', en: 'Issue' })}</button>
        </div>
      )}
    </div>
  )
}
