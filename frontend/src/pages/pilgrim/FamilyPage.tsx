/* Family tracker. RFID gives "last checkpoint passed", never a live position: every status here is
   derived from a real detection time, and nothing is shown when there is no detection. */
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CircleCheck, CircleHelp, Clock3, History, Info, Link2, Link2Off, MapPin, Navigation, Plus, QrCode, Satellite, Share2, Siren,
  Trash2, UserSearch, Users, Watch, type LucideIcon,
} from 'lucide-react'
import { api, type Family, type LastSeen, type Location, type Member, type Sighting } from '../../api'
import { useLang } from '../../i18n'
import { useLive, useStore } from '../../store'
import LazyMap from '../../components/LazyMap'
import QrScanner, { qrSupported } from '../../components/QrScanner'
import {
  Avatar, EmptyState, ErrorState, Field, LoginGate, Notice, PageHead, PlaceRow, Sheet, Skeleton, SubmitButton, useNow, useSubmit, useToast, type Fresh,
} from '../../components/ui'

type Tri = { te: string; hi: string; en: string }
type Track = 'current' | 'delayed' | 'old' | 'never' | 'notag'

function trackOfTime(iso: string): Exclude<Track, 'never' | 'notag'> {
  const age = (Date.now() - new Date(iso).getTime()) / 60000
  return age <= 15 ? 'current' : age <= 120 ? 'delayed' : 'old'
}
function trackOf(m: Member): Track {
  if (!m.rfid_tag_uid) return 'notag'
  if (!m.last_seen) return 'never'
  return trackOfTime(m.last_seen.seen_at)
}
const TRACK: Record<Track, { label: Tri; icon: LucideIcon; cls: string; ring: Fresh }> = {
  current: { label: { te: 'ప్రస్తుతం', hi: 'ताज़ा', en: 'Current' }, icon: CircleCheck, cls: 'live', ring: 'live' },
  delayed: { label: { te: 'ఆలస్యం', hi: 'विलंबित', en: 'Delayed' }, icon: Clock3, cls: 'delayed', ring: 'delayed' },
  old: { label: { te: 'తాజా కాదు', hi: 'ताज़ा नहीं', en: 'Not recent' }, icon: History, cls: 'stale', ring: 'none' },
  never: { label: { te: 'ఇంకా గుర్తించబడలేదు', hi: 'अभी तक नहीं दिखे', en: 'Not yet detected' }, icon: CircleHelp, cls: 'none', ring: 'none' },
  notag: { label: { te: 'రిస్ట్‌బ్యాండ్ లేదు', hi: 'रिस्टबैंड नहीं', en: 'No wristband' }, icon: Watch, cls: 'none', ring: 'none' },
}
const AGE: Record<Member['age_group'], Tri> = { child: { te: 'పిల్లవాడు', hi: 'बच्चा', en: 'Child' }, adult: { te: 'పెద్దవారు', hi: 'वयस्क', en: 'Adult' }, senior: { te: 'వృద్ధులు', hi: 'वरिष्ठ', en: 'Senior' } }
const DIRECTION: Record<string, Tri> = { in: { te: 'లోపలికి వెళ్లారు', hi: 'अंदर गए', en: 'Entered' }, out: { te: 'బయటకు వచ్చారు', hi: 'बाहर निकले', en: 'Exited' }, unknown: { te: 'దిశ తెలియదు', hi: 'दिशा अज्ञात', en: 'Direction unknown' } }
const METHOD: Record<string, Tri> = { rfid: { te: 'RFID రీడర్', hi: 'RFID रीडर', en: 'RFID reader' }, qr: { te: 'సిబ్బంది QR స్కాన్', hi: 'कर्मचारी QR स्कैन', en: 'QR scan by staff' }, ble: { te: 'బ్లూటూత్ బీకన్', hi: 'ब्लूटूथ बीकन', en: 'Bluetooth beacon' } }

function TrackLine({ m }: { m: Member }) {
  const { tr, clock, ago } = useLang()
  const tk = trackOf(m)
  const meta = TRACK[tk]
  const I = meta.icon
  return (
    <span className={`fresh ${meta.cls}`} style={{ fontSize: 'var(--fs-sm)', flexWrap: 'wrap' }}>
      <I aria-hidden />{tr(meta.label)}
      {m.last_seen && <span style={{ color: 'var(--text-2)' }}>· {m.last_seen.location_name} · {clock(m.last_seen.seen_at)} ({ago(m.last_seen.seen_at)})</span>}
    </span>
  )
}

function Inner() {
  const { t, tr, clock, ago } = useLang()
  const { user, places } = useStore()
  const toast = useToast()
  useNow(30000)
  const [fams, setFams] = useState<Family[] | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [fname, setFname] = useState(''); const [code, setCode] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const blank = { display_name: '', age_group: 'adult' as Member['age_group'], relation: '', is_vulnerable: false, phone: '' }
  const [m, setM] = useState(blank)
  const [tagFor, setTagFor] = useState<Member | null>(null); const [tag, setTag] = useState(''); const [consent, setConsent] = useState(false); const [scan, setScan] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [where, setWhere] = useState<{ m: Member; d: LastSeen } | null>(null)
  const [looking, setLooking] = useState<number | null>(null)
  const [removeFor, setRemoveFor] = useState<Member | null>(null)
  const [showErr, setShowErr] = useState(false)
  const act = useSubmit()

  const fam = fams?.[0] ?? null
  const isPrimary = !!fam && fam.primary_user_id === user?.id
  const self = fam?.members.find((x) => x.user_id === user?.id) ?? null

  const load = useCallback(() => api.get<Family[]>('/families/mine').then((f) => { setFams(f); setLoadErr(null) }).catch((e) => setLoadErr((e as Error).message)), [])
  useEffect(() => { void load() }, [load])

  useLive(['sighting', 'member.gps'], (e) => {
    const d = e.data as unknown as { member_id: number; lat?: number; lng?: number; at?: string } & Partial<Sighting>
    setFams((prev) => prev && prev.map((f) => ({ ...f, members: f.members.map((x) => x.id !== d.member_id ? x : e.type === 'sighting' ? { ...x, last_seen: d as Sighting } : { ...x, gps: { lat: d.lat!, lng: d.lng!, at: d.at! } }) })))
  })

  // self GPS sharing: post own position every 60 s while enabled and the page is open
  useEffect(() => {
    if (!fam || !self?.gps_sharing || !('geolocation' in navigator)) return
    const send = () => navigator.geolocation.getCurrentPosition(
      (p) => { api.post(`/families/${fam.id}/members/${self.id}/gps`, { lat: p.coords.latitude, lng: p.coords.longitude }).catch(() => {}) },
      () => { /* permission revoked or no fix: nothing is sent */ },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    )
    send()
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') send() }, 60000)
    return () => clearInterval(id)
  }, [fam?.id, self?.id, self?.gps_sharing]) // eslint-disable-line react-hooks/exhaustive-deps

  const doRun = async (fn: () => Promise<unknown>, okMsg?: string) => {
    const r = await act.run(async () => { await fn(); await load(); return true })
    if (r && okMsg) toast(okMsg)
    return !!r
  }
  const share = async () => {
    if (!fam) return
    const text = tr({ te: `మా కుటుంబ గ్రూప్‌లో చేరండి – పుష్కర సహాయం కోడ్: ${fam.join_code}`, hi: `हमारे परिवार समूह से जुड़ें – पुष्कर सहायम कोड: ${fam.join_code}`, en: `Join our family group on Pushkar Sahayam – code: ${fam.join_code}` })
    if (navigator.share) { navigator.share({ text }).catch(() => {}); return }
    try { await navigator.clipboard.writeText(fam.join_code); toast(t('copied')) } catch { toast(fam.join_code, 'info') }
  }
  const lookup = async (x: Member) => {
    if (!fam) return
    setLooking(x.id)
    try { const d = await api.get<LastSeen>(`/families/${fam.id}/members/${x.id}/last-seen`); setFindOpen(false); setWhere({ m: x, d }) }
    catch (e) { toast((e as Error).message, 'error') } finally { setLooking(null) }
  }
  const shareLabel = tr({ te: 'కోడ్ పంచుకో', hi: 'कोड साझा करें', en: 'Share code' })
  const findLabel = tr({ te: 'కుటుంబ సభ్యుడిని కనుగొనండి', hi: 'परिवार के सदस्य को खोजें', en: 'Find family member' })
  const openAdd = () => { setM(blank); setShowErr(false); setAddOpen(true) }
  const onScan = useCallback((text: string) => { setTag(text.toUpperCase().replace(/\s+/g, '')); setScan(false) }, [])

  if (loadErr && !fams) return <ErrorState message={loadErr} onRetry={() => void load()} />
  if (!fams) return <Skeleton rows={3} />

  if (!fam) return (
    <div className="stack">
      <PageHead title={t('myFamily')} back={false} sub={tr({ te: 'కుటుంబ గ్రూప్ సృష్టించండి లేదా కోడ్‌తో చేరండి', hi: 'परिवार समूह बनाएँ या कोड से जुड़ें', en: 'Create a family group or join one with a code' })} />
      <div className="narrow stack">
      <Notice icon={Users}>{tr({ te: 'కుటుంబ గ్రూప్ సృష్టించి, సభ్యులకు రిస్ట్‌బ్యాండ్‌లు లింక్ చేయండి. ఎవరైనా విడిపోతే చివరి చెక్‌పాయింట్ తెలుస్తుంది.', hi: 'परिवार समूह बनाएँ और सदस्यों के रिस्टबैंड जोड़ें। कोई बिछड़े तो आख़िरी चेकपॉइंट पता चलेगा।', en: 'Create a family group and link wristbands. If someone gets separated you can see the last checkpoint they passed.' })}</Notice>
      {act.error && <div className="err" role="alert">{act.error}</div>}
      <div className="cols-2">
      <div className="card stack">
        <div className="card-head" style={{ marginBottom: 0 }}><h2>{t('createFamily')}</h2></div>
        <Field label={tr({ te: 'కుటుంబం పేరు', hi: 'परिवार का नाम', en: 'Family name' })} htmlFor="fam-name">
          <input id="fam-name" className="input" value={fname} maxLength={120} onChange={(e) => setFname(e.target.value)} placeholder={tr({ te: 'ఉదా: రావు కుటుంబం', hi: 'उदा: शर्मा परिवार', en: 'e.g. Rao family' })} />
        </Field>
        <SubmitButton busy={act.busy} disabled={!fname.trim()} onClick={() => void doRun(() => api.post('/families', { name: fname.trim() }), t('saved'))}><Plus size={20} aria-hidden />{t('createFamily')}</SubmitButton>
      </div>
      <div className="card stack">
        <div className="card-head" style={{ marginBottom: 0 }}><h2>{t('joinFamily')}</h2></div>
        <Field label={t('joinCode')} htmlFor="fam-code" hint={tr({ te: 'కుటుంబ సభ్యుడు పంచుకున్న 6 అక్షరాల కోడ్', hi: 'परिवार के सदस्य द्वारा साझा 6 अक्षर का कोड', en: 'The 6-character code shared by a family member' })}>
          <input id="fam-code" className="input" value={code} maxLength={6} autoCapitalize="characters" autoComplete="off" style={{ letterSpacing: 6, textTransform: 'uppercase', fontWeight: 700, fontSize: 'var(--fs-xl)', textAlign: 'center' }} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
        </Field>
        <SubmitButton className="btn big block" busy={act.busy} disabled={code.length < 6} onClick={() => void doRun(() => api.post('/families/join', { join_code: code }), t('saved'))}><Link2 size={20} aria-hidden />{t('joinFamily')}</SubmitButton>
      </div>
      </div>
      </div>
    </div>
  )

  const tagErr = showErr && tag.trim().length < 4 ? tr({ te: 'కనీసం 4 అక్షరాలు', hi: 'कम से कम 4 अक्षर', en: 'At least 4 characters' }) : null
  const cp = where?.d.last_checkpoint ?? null
  const cpPlace: Location | null = cp ? (places.find((p) => p.id === cp.location_id) ?? null) : null
  const cpLoc: Location | null = cp ? (cpPlace ?? { id: cp.location_id, code: cp.location_code, site_id: 0, type: 'checkpoint', name: cp.location_name, name_te: null, name_hi: null, lat: cp.lat, lng: cp.lng, capacity: null, is_accessible: false, is_open: true, monitored: false, current_count: null, density_level: 'unknown', density_source: null, density_updated_at: null, details: {}, verification: 'official', source: 'RFID checkpoint sighting', source_ref: null, source_retrieved_at: null, verified_at: null, verification_note: null }) : null

  return (
    <div className="stack">
      <PageHead title={t('myFamily')} back={false}
        sub={<span className="row wrap" style={{ gap: 8 }}><span style={{ color: 'var(--text-2)', fontWeight: 600 }}>{fam.name}</span><span className="chip river">{t('joinCode')}: <strong style={{ letterSpacing: 2 }}>{fam.join_code}</strong></span></span>}
        actions={<span className="row wrap hide-mobile">
          <button className="btn" onClick={() => void share()}><Share2 size={18} aria-hidden />{shareLabel}</button>
          {isPrimary && <button className="btn" onClick={openAdd}><Plus size={18} aria-hidden />{t('addMember')}</button>}
          <button className="btn primary" onClick={() => setFindOpen(true)}><UserSearch size={18} aria-hidden />{findLabel}</button>
        </span>} />
      {act.error && <div className="err" role="alert">{act.error}</div>}

      <div className="stack tight only-mobile">
        <div className="row wrap">
          <button className="btn sm" onClick={() => void share()}><Share2 size={16} aria-hidden />{shareLabel}</button>
          {isPrimary && <button className="btn sm" onClick={openAdd}><Plus size={16} aria-hidden />{t('addMember')}</button>}
        </div>
        <button className="btn primary big block" onClick={() => setFindOpen(true)}><UserSearch size={22} aria-hidden />{findLabel}</button>
      </div>

      <div className="layout-aside">
      <div className="auto-grid">
        {fam.members.map((x) => {
          const tk = trackOf(x)
          const isSelf = x.user_id === user?.id
          return (
            <div key={x.id} className="card stack" style={{ gap: 'var(--s3)' }}>
              <div className="row top">
                <Avatar name={x.display_name} ring={TRACK[tk].ring} />
                <div className="grow stack tight" style={{ gap: 2 }}>
                  <div className="row wrap" style={{ gap: 6 }}>
                    <strong>{x.display_name}</strong>
                    {isSelf && <span className="chip neutral">{tr({ te: 'నేను', hi: 'मैं', en: 'me' })}</span>}
                    {x.is_vulnerable && <span className="chip accent">{tr({ te: 'ప్రత్యేక శ్రద్ధ', hi: 'विशेष ध्यान', en: 'Priority' })}</span>}
                  </div>
                  <span className="small muted">{tr(AGE[x.age_group])}{x.relation ? ` · ${x.relation}` : ''}{x.rfid_tag_uid ? ` · ${x.rfid_tag_uid}` : ''}</span>
                  <TrackLine m={x} />
                  {x.gps && <span className="chip teal" style={{ alignSelf: 'flex-start' }}><Satellite aria-hidden />{tr({ te: 'ఫోన్ GPS పంచుకున్నారు', hi: 'फ़ोन GPS साझा', en: 'Phone GPS shared' })} · {ago(x.gps.at)}</span>}
                </div>
              </div>
              <div className="row wrap">
                {!isSelf && <SubmitButton className="btn sm primary" busy={looking === x.id} onClick={() => void lookup(x)}><MapPin size={16} aria-hidden />{tr({ te: `${x.display_name} ఎక్కడ?`, hi: `${x.display_name} कहाँ?`, en: `Where is ${x.display_name}?` })}</SubmitButton>}
                {isPrimary && (x.rfid_tag_uid
                  ? <button className="btn sm" disabled={act.busy} onClick={() => void doRun(() => api.del(`/families/${fam.id}/members/${x.id}/tag`), tr({ te: 'రిస్ట్‌బ్యాండ్ తొలగించబడింది', hi: 'रिस्टबैंड हटाया', en: 'Wristband unlinked' }))}><Link2Off size={16} aria-hidden />{t('unlinkTag')}</button>
                  : <button className="btn sm tonal" onClick={() => { setTagFor(x); setTag(''); setConsent(false); setScan(false); setShowErr(false) }}><Watch size={16} aria-hidden />{t('linkTag')}</button>)}
                {isPrimary && !isSelf && <button className="btn icon sm ghost" onClick={() => setRemoveFor(x)} aria-label={tr({ te: `${x.display_name}ను తొలగించు`, hi: `${x.display_name} को हटाएँ`, en: `Remove ${x.display_name}` })}><Trash2 size={18} aria-hidden /></button>}
              </div>
              {isSelf && (
                <label className={`check ${x.gps_sharing ? 'on' : ''}`}>
                  <input type="checkbox" checked={x.gps_sharing} disabled={act.busy} onChange={(e) => void doRun(() => api.patch(`/families/${fam.id}/members/${x.id}`, { gps_sharing: e.target.checked }))} />
                  <span className="stack tight" style={{ gap: 2 }}>
                    <span className="strong small">{t('shareGps')}</span>
                    <span className="xs muted">{tr({ te: 'ఈ పేజీ తెరిచి ఉన్నప్పుడు నిమిషానికి ఒకసారి మీ కుటుంబానికి మాత్రమే పంపబడుతుంది.', hi: 'यह पेज खुला रहने पर हर मिनट केवल आपके परिवार को भेजा जाता है।', en: 'Sent once a minute, only to your family, while this page is open.' })}</span>
                  </span>
                </label>
              )}
            </div>
          )
        })}
      </div>

      <aside className="stack">
      <div className="card stack tight">
        <div className="card-head" style={{ marginBottom: 'var(--s2)' }}><h2 className="row" style={{ gap: 8 }}><Info size={18} aria-hidden style={{ color: 'var(--brand-ink)' }} />{tr({ te: 'ట్రాకింగ్ ఎలా పనిచేస్తుంది', hi: 'ट्रैकिंग कैसे काम करती है', en: 'How tracking works' })}</h2></div>
        <ul className="small stack tight" style={{ margin: 0, paddingLeft: '1.2rem' }}>
          <li>{tr({ te: 'రిస్ట్‌బ్యాండ్ గేట్లు, చెక్‌పాయింట్లు, సహాయ కేంద్రాల వద్ద మాత్రమే చదవబడుతుంది.', hi: 'रिस्टबैंड केवल गेट, चेकपॉइंट और सहायता केंद्रों पर पढ़ा जाता है।', en: 'Wristbands are read only at gates, checkpoints and help desks.' })}</li>
          <li>{tr({ te: 'ఇది నిరంతర GPS కాదు: "చివరిగా కనిపించింది" అంటే దాటిన చివరి చెక్‌పాయింట్.', hi: 'यह निरंतर GPS नहीं है: "अंतिम बार देखा" का अर्थ अंतिम चेकपॉइंट है।', en: 'It is not continuous GPS: "last seen" is the last checkpoint passed.' })}</li>
          <li>{tr({ te: 'పెద్దలు కావాలంటే తమ ఫోన్ GPSను కుటుంబంతో పంచుకోవచ్చు.', hi: 'वयस्क चाहें तो अपना फ़ोन GPS परिवार से साझा कर सकते हैं।', en: 'Adults can optionally share their phone GPS with the family.' })}</li>
          <li>{tr({ te: 'ప్రతి స్థాన లుక్అప్ నమోదు చేయబడుతుంది; 30 రోజుల తర్వాత డేటా తొలగించబడుతుంది.', hi: 'हर लुकअप दर्ज होता है; 30 दिन बाद डेटा हटता है।', en: 'Every lookup is audited; data is deleted 30 days after the festival.' })}</li>
        </ul>
      </div>
      <div className="card stack tight">
        <div className="card-head" style={{ marginBottom: 'var(--s2)' }}><h2 className="row" style={{ gap: 8 }}><Watch size={18} aria-hidden style={{ color: 'var(--brand-ink)' }} />{tr({ te: 'రిస్ట్‌బ్యాండ్ ఎక్కడ పొందాలి', hi: 'रिस्टबैंड कहाँ मिलेगा', en: 'Getting a wristband' })}</h2></div>
        <p className="small muted">{tr({ te: 'ఏదైనా సహాయ కేంద్రం వద్ద ఉచిత రిస్ట్‌బ్యాండ్ తీసుకోండి. దానిపై ముద్రించిన నంబర్‌ను ఇక్కడ లింక్ చేయండి – పిల్లలు, వృద్ధులకు ముందుగా.', hi: 'किसी भी सहायता केंद्र से निःशुल्क रिस्टबैंड लें। उस पर छपा नंबर यहाँ जोड़ें – बच्चों और बुज़ुर्गों के लिए पहले।', en: 'Collect a free wristband at any help desk, then link the number printed on it here – children and seniors first.' })}</p>
        <Link to="/facilities?type=help_desk" className="btn sm" style={{ alignSelf: 'flex-start' }}><MapPin size={16} aria-hidden />{tr({ te: 'సహాయ కేంద్రాలు', hi: 'सहायता केंद्र', en: 'Help desks' })}</Link>
      </div>
      </aside>
      </div>

      {/* choose who to find */}
      <Sheet open={findOpen} onClose={() => setFindOpen(false)} title={tr({ te: 'ఎవరిని కనుగొనాలి?', hi: 'किसे खोजना है?', en: 'Who are you looking for?' })}>
        <div className="list grouped">
          {fam.members.filter((x) => x.user_id !== user?.id).map((x) => (
            <button key={x.id} type="button" className="lrow" onClick={() => void lookup(x)} disabled={looking != null}>
              <Avatar name={x.display_name} ring={TRACK[trackOf(x)].ring} />
              <span className="body"><span className="title">{x.display_name}</span><span className="meta"><TrackLine m={x} /></span></span>
              {looking === x.id && <span className="spin" aria-hidden />}
            </button>
          ))}
        </div>
        {fam.members.filter((x) => x.user_id !== user?.id).length === 0 && <EmptyState icon={Users} title={tr({ te: 'ఇంకా సభ్యులు లేరు', hi: 'अभी कोई सदस्य नहीं', en: 'No other members yet' })} />}
      </Sheet>

      {/* last-seen detail */}
      <Sheet open={!!where} onClose={() => setWhere(null)} title={where?.m.display_name}>
        {where && (
          <div className="stack">
            {!where.d.consented && <Notice tone="warn" icon={Watch}>{tr({ te: 'రిస్ట్‌బ్యాండ్ లింక్ కాలేదు లేదా అనుమతి లేదు, కాబట్టి చెక్‌పాయింట్ సమాచారం లేదు.', hi: 'रिस्टबैंड लिंक नहीं या सहमति नहीं, इसलिए चेकपॉइंट जानकारी नहीं है।', en: 'No wristband linked or no consent, so there is no checkpoint information.' })}</Notice>}
            {cp && cpLoc ? (() => {
              const tk = trackOfTime(cp.seen_at)
              const meta = TRACK[tk]
              const I = meta.icon
              return (
                <>
                  <span className={`status lg ${tk === 'current' ? 'low' : tk === 'delayed' ? 'moderate' : 'unknown'}`} style={{ alignSelf: 'flex-start' }}><I aria-hidden />{tr(meta.label)}</span>
                  <div>
                    <div className="xs muted">{t('lastSeen')}</div>
                    <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 750 }}>{cp.location_name}</div>
                    <div className="small">{clock(cp.seen_at)} · {ago(cp.seen_at)}</div>
                    <div className="small muted">{tr(DIRECTION[cp.direction] ?? DIRECTION.unknown)} · {tr(METHOD[cp.method] ?? METHOD.rfid)}</div>
                  </div>
                  {tk === 'old' && <Notice tone="warn" icon={History}>{tr({ te: 'ఈ గుర్తింపు 2 గంటల కంటే పాతది. వారు ఇప్పుడు వేరే చోట ఉండవచ్చు.', hi: 'यह पहचान 2 घंटे से पुरानी है। वे अब कहीं और हो सकते हैं।', en: 'This detection is more than 2 hours old. They may be somewhere else now.' })}</Notice>}
                  <div style={{ borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
                    <LazyMap center={[cp.lat, cp.lng]} locations={[cpLoc]} me={where.d.gps ? [where.d.gps.lat, where.d.gps.lng] : null} height="180px" interactive={false} />
                  </div>
                  {where.d.gps && <span className="small row"><Satellite size={16} aria-hidden style={{ color: '#1A73E8' }} />{tr({ te: 'నీలి చుక్క: సభ్యుడు పంచుకున్న ఫోన్ GPS', hi: 'नीला बिंदु: सदस्य द्वारा साझा फ़ोन GPS', en: 'Blue dot: phone GPS, shared by member' })} · {ago(where.d.gps.at)}</span>}
                  <Link className="btn primary big block" to={`/map?to=${cp.location_id}`}><Navigation size={20} aria-hidden />{tr({ te: 'ఆ చెక్‌పాయింట్‌కు దారి', hi: 'उस चेकपॉइंट का रास्ता', en: 'Directions to checkpoint' })}</Link>
                  {where.d.recent.length > 1 && (
                    <div className="stack tight">
                      <strong className="small">{tr({ te: 'ఇంతకు ముందు', hi: 'इससे पहले', en: 'Earlier' })}</strong>
                      <ul className="small stack tight" style={{ margin: 0, paddingLeft: '1.2rem' }}>{where.d.recent.slice(1, 6).map((s, i) => <li key={i}>{s.location_name} · {clock(s.seen_at)}</li>)}</ul>
                    </div>
                  )}
                </>
              )
            })() : where.d.consented && (
              <Notice icon={CircleHelp}>{tr({ te: 'ఇంకా ఏ చెక్‌పాయింట్ వద్ద గుర్తించబడలేదు. దీని అర్థం వారు తప్పిపోయారని కాదు – రిస్ట్‌బ్యాండ్ గేట్లు, చెక్‌పాయింట్లు, సహాయ కేంద్రాల వద్ద మాత్రమే చదవబడుతుంది.', hi: 'अभी तक किसी चेकपॉइंट पर नहीं दिखे। इसका अर्थ यह नहीं कि वे खो गए हैं – रिस्टबैंड केवल गेट, चेकपॉइंट और सहायता केंद्रों पर पढ़ा जाता है।', en: 'Not detected at any checkpoint yet. This does not mean they are lost – the wristband is read only at gates, checkpoints and help desks.' })}</Notice>
            )}
            {!cp && where.d.gps && <span className="chip teal" style={{ alignSelf: 'flex-start' }}><Satellite aria-hidden />{tr({ te: 'ఫోన్ GPS పంచుకున్నారు', hi: 'फ़ोन GPS साझा', en: 'Phone GPS shared' })} · {ago(where.d.gps.at)}</span>}
            {where.d.nearest_help_desks.length > 0 && (
              <div className="stack tight">
                <strong>{t('nearestHelp')}</strong>
                <div className="list">{where.d.nearest_help_desks.map((l) => <PlaceRow key={l.id} loc={l} showStatus={false} />)}</div>
              </div>
            )}
            <Link to={`/missing?member=${where.m.id}`} className="btn danger-outline big block"><Siren size={20} aria-hidden />{t('reportMissing')}</Link>
          </div>
        )}
      </Sheet>

      {/* add member */}
      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title={t('addMember')}>
        <div className="stack">
          <Field label={t('name')} htmlFor="mem-name" error={showErr && !m.display_name.trim() ? t('required') : null}>
            <input id="mem-name" className="input" value={m.display_name} maxLength={120} onChange={(e) => setM({ ...m, display_name: e.target.value })} />
          </Field>
          <div className="field">
            <div className="field-label">{t('age')}</div>
            <div className="choice-grid" role="radiogroup" aria-label={t('age')}>
              {(['child', 'adult', 'senior'] as const).map((g) => <button key={g} type="button" className="choice" style={{ minHeight: 48 }} role="radio" aria-checked={m.age_group === g} onClick={() => setM({ ...m, age_group: g, is_vulnerable: g !== 'adult' ? true : m.is_vulnerable })}>{tr(AGE[g])}</button>)}
            </div>
          </div>
          <Field label={tr({ te: 'సంబంధం', hi: 'रिश्ता', en: 'Relation' })} htmlFor="mem-rel" optional>
            <input id="mem-rel" className="input" value={m.relation} maxLength={40} onChange={(e) => setM({ ...m, relation: e.target.value })} placeholder={tr({ te: 'ఉదా: కుమారుడు, అమ్మమ్మ', hi: 'उदा: बेटा, दादी', en: 'e.g. son, grandmother' })} />
          </Field>
          <Field label={t('phone')} htmlFor="mem-phone" optional>
            <input id="mem-phone" className="input" inputMode="tel" value={m.phone} onChange={(e) => setM({ ...m, phone: e.target.value })} />
          </Field>
          <label className={`check ${m.is_vulnerable ? 'on' : ''}`}>
            <input type="checkbox" checked={m.is_vulnerable} onChange={(e) => setM({ ...m, is_vulnerable: e.target.checked })} />
            <span className="small">{tr({ te: 'ప్రత్యేక శ్రద్ధ అవసరం (పిల్లలు, వృద్ధులు, దివ్యాంగులు) – సహాయ కేంద్రాల్లో ముందుగా చూస్తారు', hi: 'विशेष ध्यान (बच्चे, वरिष्ठ, दिव्यांग) – सहायता केंद्र पर प्राथमिकता', en: 'Needs priority (child, senior, disabled) – help desks handle them first' })}</span>
          </label>
          {act.error && <div className="err" role="alert">{act.error}</div>}
          <SubmitButton busy={act.busy} onClick={async () => {
            if (!m.display_name.trim()) { setShowErr(true); return }
            const ok = await doRun(() => api.post(`/families/${fam.id}/members`, { ...m, display_name: m.display_name.trim(), relation: m.relation || null, phone: m.phone || null }), t('saved'))
            if (ok) setAddOpen(false)
          }}>{t('save')}</SubmitButton>
        </div>
      </Sheet>

      {/* link wristband */}
      <Sheet open={!!tagFor} onClose={() => setTagFor(null)} title={tagFor ? `${t('linkTag')} · ${tagFor.display_name}` : ''}>
        {tagFor && (
          <div className="stack">
            {scan ? <QrScanner onResult={onScan} onCancel={() => setScan(false)} hint={tr({ te: 'రిస్ట్‌బ్యాండ్ మీది QR కోడ్ స్కాన్ చేయండి', hi: 'रिस्टबैंड पर QR कोड स्कैन करें', en: 'Scan the QR code on the wristband' })} /> : (
              <>
                <Field label={t('tagUid')} htmlFor="tag-uid" error={tagErr} hint={tr({ te: 'రిస్ట్‌బ్యాండ్‌పై ముద్రించిన నంబర్, ఉదా: GP27-00010', hi: 'रिस्टबैंड पर छपा नंबर, उदा: GP27-00010', en: 'Number printed on the wristband, e.g. GP27-00010' })}>
                  <input id="tag-uid" className="input" value={tag} autoCapitalize="characters" autoComplete="off" style={{ letterSpacing: 1.5, fontWeight: 700 }} onChange={(e) => setTag(e.target.value.toUpperCase())} aria-invalid={!!tagErr} />
                </Field>
                {qrSupported() && <button type="button" className="btn tonal block" onClick={() => setScan(true)}><QrCode size={20} aria-hidden />{tr({ te: 'రిస్ట్‌బ్యాండ్ QR స్కాన్', hi: 'रिस्टबैंड QR स्कैन', en: 'Scan wristband QR' })}</button>}
              </>
            )}
            <label className={`check ${consent ? 'on' : ''}`}>
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span className="small">{t('consentText')}</span>
            </label>
            {act.error && <div className="err" role="alert">{act.error}</div>}
            <SubmitButton busy={act.busy} disabled={!consent} onClick={async () => {
              if (tag.trim().length < 4) { setShowErr(true); return }
              const ok = await doRun(() => api.post(`/families/${fam.id}/members/${tagFor.id}/tag`, { tag_uid: tag.trim(), consent: true }), tr({ te: 'రిస్ట్‌బ్యాండ్ లింక్ అయింది', hi: 'रिस्टबैंड जुड़ गया', en: 'Wristband linked' }))
              if (ok) setTagFor(null)
            }}><Watch size={20} aria-hidden />{t('linkTag')}</SubmitButton>
          </div>
        )}
      </Sheet>

      {/* remove member */}
      <Sheet open={!!removeFor} onClose={() => setRemoveFor(null)} title={tr({ te: 'సభ్యుడిని తొలగించాలా?', hi: 'सदस्य को हटाएँ?', en: 'Remove member?' })}>
        {removeFor && (
          <div className="stack">
            <p>{tr({ te: `${removeFor.display_name} ఈ కుటుంబం నుండి తొలగించబడతారు; వారి రిస్ట్‌బ్యాండ్ లింక్ కూడా తీసివేయబడుతుంది.`, hi: `${removeFor.display_name} को परिवार से हटाया जाएगा; रिस्टबैंड लिंक भी हटेगा।`, en: `${removeFor.display_name} will be removed from this family and their wristband unlinked.` })}</p>
            <div className="grid2">
              <button className="btn big" onClick={() => setRemoveFor(null)}>{t('cancel')}</button>
              <SubmitButton className="btn danger big" busy={act.busy} onClick={async () => {
                const ok = await doRun(() => api.del(`/families/${fam.id}/members/${removeFor.id}`), tr({ te: 'తొలగించబడింది', hi: 'हटाया गया', en: 'Removed' }))
                if (ok) setRemoveFor(null)
              }}><Trash2 size={18} aria-hidden />{tr({ te: 'తొలగించు', hi: 'हटाएँ', en: 'Remove' })}</SubmitButton>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  )
}

export default function FamilyPage() {
  const { t, tr } = useLang()
  const { user } = useStore()
  return (
    <div className="stack">
      {!user && <PageHead title={t('myFamily')} back={false} />}
      <LoginGate reason={tr({ te: 'కుటుంబ ట్రాకింగ్ కోసం ధృవీకరించిన ఫోన్ అవసరం, అప్పుడే మీ కుటుంబం మాత్రమే స్థానాలు చూడగలదు.', hi: 'परिवार ट्रैकिंग के लिए सत्यापित फ़ोन ज़रूरी है, ताकि केवल आपका परिवार स्थान देख सके।', en: 'Family tracking needs a verified phone so that only your family can see locations.' })}><Inner /></LoginGate>
    </div>
  )
}
