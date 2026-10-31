/* Missing-person assistance: a calm, guided 5-step report, the reporter's own reports with live status,
   and the public non-identifying board of people waiting at help desks. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, ArrowRight, Camera, CircleCheck, CircleX, Clock3, FileText, HandHelping, ImageOff, Navigation, Phone, Search, SearchCheck,
  ShieldCheck, UserPlus, UserRound, type LucideIcon,
} from 'lucide-react'
import { api, type BoardEntry, type EmergencyContacts, type Family, type Member, type Report, type ReportEvent } from '../../api'
import { useLang, type Key } from '../../i18n'
import { useLive, useStore } from '../../store'
import { useDistance, useMyLocation } from '../../location'
import { TypeIcon } from '../../components/icons'
import {
  Avatar, EmptyState, ErrorState, Field, LoginGate, Notice, PageHead, PlaceRow, Segmented, Sheet, Skeleton, Stepper, SubmitButton, useAsync, useSubmit, useToast,
} from '../../components/ui'

type Tri = { te: string; hi: string; en: string }
const STATUS: Record<Report['status'], { label: Tri; cls: string; icon: LucideIcon }> = {
  open: { label: { te: 'నమోదైంది', hi: 'दर्ज', en: 'Open' }, cls: 'moderate', icon: FileText },
  verified: { label: { te: 'ధృవీకరించబడింది', hi: 'सत्यापित', en: 'Verified' }, cls: 'river', icon: ShieldCheck },
  searching: { label: { te: 'వెతుకుతున్నారు', hi: 'खोज जारी', en: 'Searching' }, cls: 'high', icon: Search },
  found: { label: { te: 'దొరికారు – సహాయ కేంద్రంలో', hi: 'मिल गए – सहायता केंद्र पर', en: 'Found – at help desk' }, cls: 'low', icon: CircleCheck },
  closed: { label: { te: 'మూసివేయబడింది', hi: 'बंद', en: 'Closed' }, cls: 'neutral', icon: CircleCheck },
  rejected: { label: { te: 'తిరస్కరించబడింది', hi: 'अस्वीकृत', en: 'Rejected' }, cls: 'critical', icon: CircleX },
}
const AGE_GROUP: Record<string, Tri> = {
  child: { te: 'పిల్లవాడు', hi: 'बच्चा', en: 'Child' }, adult: { te: 'పెద్దవారు', hi: 'वयस्क', en: 'Adult' },
  senior: { te: 'వృద్ధులు', hi: 'वरिष्ठ', en: 'Senior' }, unknown: { te: 'తెలియదు', hi: 'अज्ञात', en: 'Unknown' },
}
const GENDER: Record<string, Tri> = {
  male: { te: 'పురుషుడు', hi: 'पुरुष', en: 'Male' }, female: { te: 'స్త్రీ', hi: 'महिला', en: 'Female' }, other: { te: 'ఇతర', hi: 'अन्य', en: 'Other' },
}

function StatusChip({ s }: { s: Report['status'] }) {
  const { tr } = useLang()
  const m = STATUS[s]
  const I = m.icon
  return <span className={`chip ${m.cls}`}><I aria-hidden />{tr(m.label)}</span>
}

/* ------------------------------------------------------------------------------------------- report flow */
interface Form { subject_name: string; age: string; gender: string; clothing: string; description: string; last_seen_location_id: string; agoMin: number | null; contact_phone: string; photo_consent: boolean }

function ReportFlow({ onFiled }: { onFiled: () => void }) {
  const { t, tr, name, ago } = useLang()
  const { user, places, site } = useStore()
  const { coords } = useMyLocation()
  const toast = useToast()
  const [params] = useSearchParams()
  const memberParam = params.get('member')
  const fams = useAsync(() => api.get<Family[]>('/families/mine'), [user?.id])
  const members: Member[] = useMemo(() => (fams.data ?? []).flatMap((f) => f.members).filter((m) => m.user_id !== user?.id), [fams.data, user?.id])

  const [step, setStep] = useState(0)
  const [who, setWho] = useState<Member | 'other' | null>(null)
  const [f, setF] = useState<Form>({ subject_name: '', age: '', gender: '', clothing: '', description: '', last_seen_location_id: '', agoMin: null, contact_phone: user?.phone ?? '', photo_consent: false })
  const [photo, setPhoto] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [placeQ, setPlaceQ] = useState('')
  const [showErr, setShowErr] = useState(false)
  const [photoBig, setPhotoBig] = useState(false)
  const [done, setDone] = useState<{ r: Report; c: EmergencyContacts | null } | null>(null)
  const { run, busy, error } = useSubmit<Report>()
  const preselected = useRef(false)

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }))
  const chooseMember = useCallback((m: Member | 'other') => {
    setWho(m)
    if (m !== 'other') {
      setF((s) => ({
        ...s,
        subject_name: m.display_name,
        age: s.age || (m.age_group === 'child' ? '8' : m.age_group === 'senior' ? '70' : ''),
        last_seen_location_id: m.last_seen ? String(m.last_seen.location_id) : s.last_seen_location_id,
      }))
    }
    setShowErr(false); setStep(1)
  }, [])

  useEffect(() => {
    if (preselected.current || !memberParam || !fams.data) return
    const m = fams.data.flatMap((x) => x.members).find((x) => String(x.id) === memberParam)
    if (m) { preselected.current = true; chooseMember(m) }
  }, [memberParam, fams.data, chooseMember])
  useEffect(() => { if (user?.phone && !f.contact_phone) set('contact_phone', user.phone) }, [user?.phone]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  const nameErr = !f.subject_name.trim() ? t('required') : null
  const ageNum = f.age === '' ? null : Number(f.age)
  const ageErr = f.age !== '' && (!Number.isInteger(ageNum) || ageNum! < 0 || ageNum! > 120) ? tr({ te: '0–120 మధ్య వయసు', hi: '0–120 के बीच उम्र', en: 'Age between 0 and 120' }) : null
  const photoErr = photo && !f.photo_consent ? tr({ te: 'ఫోటో కోసం అనుమతి అవసరం', hi: 'फ़ोटो के लिए सहमति आवश्यक', en: 'Consent is required to send a photo' }) : null
  const phoneErr = f.contact_phone.replace(/\D/g, '').length < 10 ? tr({ te: '10 అంకెల ఫోన్ నంబర్ ఇవ్వండి', hi: '10 अंकों का फ़ोन नंबर दें', en: 'Enter a 10-digit phone number' }) : null
  const valid = [who !== null, !nameErr && !ageErr, true, !photoErr, !phoneErr]

  const placeChoices = useMemo(() => {
    const q = placeQ.trim().toLowerCase()
    return places.filter((p) => ['ghat', 'gate', 'checkpoint', 'help_desk', 'lost_found', 'parking', 'bus_stop', 'food', 'rest_area'].includes(p.type))
      .filter((p) => !q || [p.name, p.name_te, p.name_hi, p.code].some((v) => v?.toLowerCase().includes(q)))
      .sort((a, b) => (String(a.id) === f.last_seen_location_id ? -1 : String(b.id) === f.last_seen_location_id ? 1 : a.type.localeCompare(b.type) || a.name.localeCompare(b.name)))
      .slice(0, 12)
  }, [places, placeQ, f.last_seen_location_id])
  const lastPlace = places.find((p) => String(p.id) === f.last_seen_location_id) ?? null

  const next = () => { if (!valid[step]) { setShowErr(true); return } setShowErr(false); setStep((s) => Math.min(4, s + 1)); window.scrollTo({ top: 0 }) }
  const back = () => { setShowErr(false); setStep((s) => Math.max(0, s - 1)) }

  const submit = async () => {
    if (phoneErr) { setShowErr(true); return }
    const r = await run(async () => {
      const fd = new FormData()
      fd.append('subject_name', f.subject_name.trim())
      fd.append('contact_phone', f.contact_phone)
      if (f.age !== '') fd.append('age', f.age)
      if (f.gender) fd.append('gender', f.gender)
      if (f.clothing.trim()) fd.append('clothing', f.clothing.trim())
      if (f.description.trim()) fd.append('description', f.description.trim())
      if (f.last_seen_location_id) fd.append('last_seen_location_id', f.last_seen_location_id)
      if (f.agoMin != null) fd.append('last_seen_at', new Date(Date.now() - f.agoMin * 60000).toISOString())
      if (who && who !== 'other') fd.append('member_id', String(who.id))
      if (photo) { fd.append('photo', photo); fd.append('photo_consent', 'true') }
      return api.postForm<Report>('/missing-reports', fd)
    })
    if (!r) return
    toast(tr({ te: 'నివేదిక పంపబడింది', hi: 'रिपोर्ट भेज दी गई', en: 'Report sent' }))
    const c = await api.get<EmergencyContacts>(`/emergency/contacts${coords ? `?near=${coords[0]},${coords[1]}` : ''}`).catch(() => null)
    setDone({ r, c }); onFiled()
  }

  if (done) {
    const desks = (done.c?.nearest_posts ?? places.filter((p) => ['help_desk', 'lost_found'].includes(p.type))).filter((p) => p.type !== 'medical' && p.type !== 'police').slice(0, 3)
    const lf = site?.emergency_contacts.lost_found ?? done.c?.site.lost_found
    return (
      <div className="stack loose">
        <div className="card stack center" role="status" style={{ alignItems: 'center' }}>
          <CircleCheck size={56} className="pop-check" style={{ color: 'var(--low)' }} aria-hidden />
          <h2>{tr({ te: `నివేదిక #${done.r.id} పంపబడింది`, hi: `रिपोर्ट #${done.r.id} भेजी गई`, en: `Report #${done.r.id} sent` })}</h2>
          <StatusChip s={done.r.status} />
          <p className="small muted">{tr({ te: 'ప్రశాంతంగా ఉండండి. చాలామంది గంటలోపే సహాయ కేంద్రంలో కలుస్తారు.', hi: 'शांत रहें। अधिकांश लोग एक घंटे में सहायता केंद्र पर मिल जाते हैं।', en: 'Stay calm. Most people are reunited within an hour at a help desk.' })}</p>
        </div>
        <div className="card stack">
          <h3>{tr({ te: 'తర్వాత ఏమి జరుగుతుంది', hi: 'आगे क्या होगा', en: 'What happens next' })}</h3>
          <ol className="stack tight" style={{ margin: 0, paddingLeft: '1.2rem' }}>
            <li>{tr({ te: 'సిబ్బంది మీ నివేదికను ధృవీకరించి మీకు కాల్ చేయవచ్చు.', hi: 'कर्मचारी रिपोर्ट सत्यापित करेंगे और आपको कॉल कर सकते हैं।', en: 'Staff verify your report and may call you.' })}</li>
            <li>{tr({ te: 'రిస్ట్‌బ్యాండ్ చెక్‌పాయింట్ డేటా మరియు సహాయ కేంద్రాలు వెతుకుతారు.', hi: 'रिस्टबैंड चेकपॉइंट डेटा और सहायता केंद्रों में खोज होगी।', en: 'Wristband checkpoint data and help desks are searched.' })}</li>
            <li>{tr({ te: 'ఈ పేజీలోని "నా నివేదికలు"లో స్థితి మారుతుంది.', hi: 'स्थिति "मेरी रिपोर्ट" में अपडेट होगी।', en: 'Status updates appear under "My reports" on this page.' })}</li>
          </ol>
        </div>
        <div className="stack tight">
          <h3>{tr({ te: 'సమీప సహాయ కేంద్రానికి వెళ్లండి', hi: 'निकटतम सहायता केंद्र जाएँ', en: 'Go to the nearest help desk' })}</h3>
          <div className="list">{desks.map((l) => <PlaceRow key={l.id} loc={l} showStatus={false} />)}</div>
        </div>
        <div className="grid2">
          {lf && <a className="btn primary big" href={`tel:${lf}`}><Phone size={20} aria-hidden />{t('lost_found')}</a>}
          <a className="btn danger big" href="tel:112"><Phone size={20} aria-hidden />112</a>
        </div>
      </div>
    )
  }

  const stepTitles = [
    tr({ te: 'ఎవరు తప్పిపోయారు?', hi: 'कौन बिछड़ गया है?', en: 'Who is missing?' }),
    tr({ te: 'వారి వివరాలు', hi: 'उनका विवरण', en: 'Describe them' }),
    tr({ te: 'చివరిగా ఎక్కడ చూశారు?', hi: 'आख़िरी बार कहाँ देखा?', en: 'Where were they last seen?' }),
    tr({ te: 'ఫోటో (ఐచ్ఛికం)', hi: 'फ़ोटो (वैकल्पिक)', en: 'Photo (optional)' }),
    tr({ te: 'సరిచూసి పంపండి', hi: 'जाँचें और भेजें', en: 'Check and send' }),
  ]

  return (
    <div className="card stack">
      <div className="stack tight">
        <Stepper total={5} current={step} label={tr({ te: `దశ ${step + 1} / 5`, hi: `चरण ${step + 1} / 5`, en: `Step ${step + 1} of 5` })} />
        <span className="xs muted">{tr({ te: `దశ ${step + 1} / 5`, hi: `चरण ${step + 1} / 5`, en: `Step ${step + 1} of 5` })}</span>
        <h2>{stepTitles[step]}</h2>
      </div>

      {step === 0 && (
        <div className="stack">
          <Notice icon={HandHelping}>{tr({ te: 'ప్రశాంతంగా ఉండండి. సిబ్బంది ప్రతి నివేదికపై వెంటనే పనిచేస్తారు, చాలామంది గంటలోపే కలుస్తారు.', hi: 'शांत रहें। कर्मचारी हर रिपोर्ट पर तुरंत काम करते हैं, अधिकांश एक घंटे में मिल जाते हैं।', en: 'Stay calm. Staff act on every report and most people are reunited within an hour.' })}</Notice>
          {fams.loading ? <Skeleton rows={2} /> : fams.error ? <ErrorState message={fams.error} onRetry={fams.reload} /> : members.length > 0 && (
            <div className="list grouped">
              {members.map((m) => (
                <button key={m.id} type="button" className="lrow" onClick={() => chooseMember(m)}>
                  <Avatar name={m.display_name} />
                  <span className="body">
                    <span className="title">{m.display_name}{m.relation ? ` · ${m.relation}` : ''}</span>
                    <span className="meta">{tr(AGE_GROUP[m.age_group])}{m.last_seen ? ` · ${t('lastSeen')}: ${m.last_seen.location_name}, ${ago(m.last_seen.seen_at)}` : ''}</span>
                  </span>
                  <ArrowRight size={20} aria-hidden className="muted" />
                </button>
              ))}
            </div>
          )}
          <button type="button" className="lrow" onClick={() => chooseMember('other')}>
            <span className="lead accent" aria-hidden><UserPlus size={22} /></span>
            <span className="body"><span className="title">{tr({ te: 'వేరే వ్యక్తి', hi: 'कोई और', en: 'Someone else' })}</span><span className="meta">{tr({ te: 'కుటుంబ జాబితాలో లేని వ్యక్తి', hi: 'जो परिवार सूची में नहीं है', en: 'A person not in your family list' })}</span></span>
            <ArrowRight size={20} aria-hidden className="muted" />
          </button>
        </div>
      )}

      {step === 1 && (
        <div className="stack">
          <Field label={t('name')} htmlFor="mp-name" error={showErr ? nameErr : null}>
            <input id="mp-name" className="input" value={f.subject_name} onChange={(e) => set('subject_name', e.target.value)} aria-invalid={showErr && !!nameErr} autoComplete="off" />
          </Field>
          <Field label={t('age')} htmlFor="mp-age" optional error={showErr ? ageErr : null}>
            <div className="row">
              <input id="mp-age" className="input" style={{ maxWidth: 110 }} inputMode="numeric" value={f.age} onChange={(e) => set('age', e.target.value.replace(/\D/g, '').slice(0, 3))} aria-invalid={!!ageErr} />
              <div className="row wrap" style={{ gap: 6 }}>
                {(['child', 'adult', 'senior'] as const).map((g) => (
                  <button key={g} type="button" className="btn sm tonal" onClick={() => { if (!f.age) set('age', g === 'child' ? '8' : g === 'senior' ? '70' : '35') }}>{tr(AGE_GROUP[g])}</button>
                ))}
              </div>
            </div>
          </Field>
          <div className="field">
            <div className="field-label">{t('gender')} <span className="muted" style={{ fontWeight: 500 }}>({t('optional')})</span></div>
            <div className="choice-grid" role="radiogroup" aria-label={t('gender')}>
              {Object.entries(GENDER).map(([k, v]) => <button key={k} type="button" className="choice" style={{ minHeight: 48 }} role="radio" aria-checked={f.gender === k} onClick={() => set('gender', f.gender === k ? '' : k)}>{tr(v)}</button>)}
            </div>
          </div>
          <Field label={t('clothing')} htmlFor="mp-cloth" optional hint={tr({ te: 'ఉదా: ఎరుపు చొక్కా, తెల్ల పంచె, పసుపు సంచి', hi: 'उदा: लाल शर्ट, सफ़ेद धोती, पीला थैला', en: 'e.g. red shirt, white dhoti, yellow bag' })}>
            <input id="mp-cloth" className="input" value={f.clothing} maxLength={255} onChange={(e) => set('clothing', e.target.value)} />
          </Field>
          <Field label={t('description')} htmlFor="mp-desc" optional hint={tr({ te: 'ఎత్తు, జుట్టు, మాట్లాడే భాష, ఆరోగ్య సమస్యలు', hi: 'लंबाई, बाल, भाषा, स्वास्थ्य समस्या', en: 'Height, hair, language spoken, health needs' })}>
            <textarea id="mp-desc" className="input" value={f.description} maxLength={2000} onChange={(e) => set('description', e.target.value)} />
          </Field>
        </div>
      )}

      {step === 2 && (
        <div className="stack">
          <div className="search"><Search size={18} aria-hidden /><input className="input" type="search" value={placeQ} onChange={(e) => setPlaceQ(e.target.value)} placeholder={t('search')} aria-label={t('lastSeenPlace')} /></div>
          {places.length === 0 ? <Skeleton rows={3} /> : (
            <div className="list grouped" role="radiogroup" aria-label={t('lastSeenPlace')}>
              {placeChoices.map((p) => {
                const on = String(p.id) === f.last_seen_location_id
                return (
                  <button key={p.id} type="button" className="lrow" role="radio" aria-checked={on} onClick={() => set('last_seen_location_id', on ? '' : String(p.id))} style={on ? { background: 'var(--brand-50)' } : undefined}>
                    <span className="lead" aria-hidden><TypeIcon type={p.type} /></span>
                    <span className="body"><span className="title">{name(p)}</span><span className="meta">{t(p.type as Key)}</span></span>
                    {on && <CircleCheck size={22} style={{ color: 'var(--brand-600)' }} aria-hidden />}
                  </button>
                )
              })}
            </div>
          )}
          <div className="field">
            <div className="field-label">{tr({ te: 'సుమారు ఎంత సేపటి క్రితం?', hi: 'लगभग कितनी देर पहले?', en: 'About how long ago?' })}</div>
            <div className="choice-grid" role="radiogroup">
              {[15, 30, 60, 120].map((m) => (
                <button key={m} type="button" className="choice" style={{ minHeight: 48 }} role="radio" aria-checked={f.agoMin === m} onClick={() => set('agoMin', f.agoMin === m ? null : m)}>
                  <Clock3 size={18} aria-hidden />{m < 60 ? tr({ te: `${m} నిమి.`, hi: `${m} मिनट`, en: `${m} min` }) : m === 60 ? tr({ te: '1 గంట', hi: '1 घंटा', en: '1 hour' }) : tr({ te: '2+ గంటలు', hi: '2+ घंटे', en: '2+ hours' })}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="stack">
          <p className="small">{tr({ te: 'స్పష్టమైన ఇటీవలి ఫోటో సిబ్బందికి త్వరగా గుర్తించడానికి సహాయపడుతుంది.', hi: 'हाल की साफ़ फ़ोटो कर्मचारियों को जल्दी पहचानने में मदद करती है।', en: 'A clear recent photo helps staff recognise them quickly.' })}</p>
          {preview ? (
            <div className="row top">
              <img src={preview} alt={tr({ te: 'ఎంచుకున్న ఫోటో', hi: 'चुनी गई फ़ोटो', en: 'Selected photo' })} style={{ width: 112, height: 112, objectFit: 'cover', borderRadius: 'var(--r-md)' }} />
              <button type="button" className="btn sm" onClick={() => { setPhoto(null); setPreview(null); set('photo_consent', false) }}><ImageOff size={16} aria-hidden />{tr({ te: 'తొలగించు', hi: 'हटाएँ', en: 'Remove' })}</button>
            </div>
          ) : (
            <label className="btn tonal big block" style={{ cursor: 'pointer' }}>
              <Camera size={22} aria-hidden />{tr({ te: 'ఫోటో తీయండి లేదా ఎంచుకోండి', hi: 'फ़ोटो लें या चुनें', en: 'Take or choose a photo' })}
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => {
                const file = e.target.files?.[0] ?? null
                setPhotoBig(false)
                if (file && file.size > 5 * 1024 * 1024) { setPhotoBig(true); setPhoto(null); return }
                setPhoto(file); setPreview(file ? URL.createObjectURL(file) : null)
              }} />
            </label>
          )}
          {photo && (
            <label className={`check ${f.photo_consent ? 'on' : ''}`}>
              <input type="checkbox" checked={f.photo_consent} onChange={(e) => set('photo_consent', e.target.checked)} />
              <span className="small">{t('photoConsent')}</span>
            </label>
          )}
          {showErr && photoErr && <div className="field-error" role="alert">{photoErr}</div>}
          {photoBig && <div className="field-error" role="alert">{tr({ te: 'ఫోటో 5 MB కంటే పెద్దది', hi: 'फ़ोटो 5 MB से बड़ी है', en: 'Photo is larger than 5 MB' })}</div>}
          <Notice icon={ShieldCheck}>{tr({ te: 'ఫోటో ధృవీకరించిన సిబ్బందికి మాత్రమే కనిపిస్తుంది, ఎప్పుడూ బహిరంగంగా చూపబడదు. గరిష్ఠం 5 MB.', hi: 'फ़ोटो केवल सत्यापित कर्मचारी देखते हैं, कभी सार्वजनिक नहीं। अधिकतम 5 MB।', en: 'Seen only by verified staff, never shown publicly. Max 5 MB.' })}</Notice>
        </div>
      )}

      {step === 4 && (
        <div className="stack">
          <dl className="kv">
            <dt>{t('name')}</dt><dd>{f.subject_name}</dd>
            {f.age && <><dt>{t('age')}</dt><dd>{f.age}</dd></>}
            {f.gender && <><dt>{t('gender')}</dt><dd>{tr(GENDER[f.gender])}</dd></>}
            {f.clothing && <><dt>{t('clothing')}</dt><dd>{f.clothing}</dd></>}
            <dt>{t('lastSeenPlace')}</dt><dd>{lastPlace ? name(lastPlace) : '—'}</dd>
            {f.agoMin != null && <><dt>{tr({ te: 'సమయం', hi: 'समय', en: 'When' })}</dt><dd>{f.agoMin >= 120 ? tr({ te: '2+ గంటల క్రితం', hi: '2+ घंटे पहले', en: '2+ hours ago' }) : ago(Date.now() - f.agoMin * 60000)}</dd></>}
            <dt>{t('photo')}</dt><dd>{photo ? tr({ te: 'జత చేయబడింది', hi: 'संलग्न', en: 'Attached' }) : '—'}</dd>
          </dl>
          <Field label={t('phone')} htmlFor="mp-phone" error={showErr ? phoneErr : null} hint={tr({ te: 'సిబ్బంది ఈ నంబర్‌కు కాల్ చేస్తారు', hi: 'कर्मचारी इस नंबर पर कॉल करेंगे', en: 'Staff will call this number' })}>
            <input id="mp-phone" className="input" inputMode="tel" autoComplete="tel" value={f.contact_phone} onChange={(e) => set('contact_phone', e.target.value)} aria-invalid={showErr && !!phoneErr} />
          </Field>
          <p className="xs muted">{tr({ te: 'తప్పుడు నివేదికలు చట్టరీత్యా శిక్షార్హం. మీ ఫోన్ నంబర్ OTPతో ధృవీకరించబడింది.', hi: 'झूठी रिपोर्ट दंडनीय है। आपका फ़ोन OTP से सत्यापित है।', en: 'False reports are punishable. Your phone number is OTP-verified.' })}</p>
          {error && <div className="err" role="alert">{error}</div>}
          <SubmitButton className="btn danger big block" busy={busy} onClick={() => void submit()}>{tr({ te: 'సహాయ కేంద్రాలకు నివేదిక పంపండి', hi: 'सहायता केंद्रों को रिपोर्ट भेजें', en: 'Send report to help desks' })}</SubmitButton>
        </div>
      )}

      {step > 0 && (
        <div className="grid2" style={{ borderTop: '1px solid var(--line)', paddingTop: 'var(--s4)', marginTop: 'var(--s1)' }}>
          <button type="button" className="btn big" onClick={back} disabled={busy}><ArrowLeft size={20} aria-hidden />{t('back')}</button>
          {step < 4 && <button type="button" className="btn primary big" onClick={next}>{t('next')}<ArrowRight size={20} aria-hidden /></button>}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------------------------------- my reports */
function MyReports({ tick }: { tick: number }) {
  const { t, tr, ago, clock } = useLang()
  const toast = useToast()
  const { data, loading, error, reload } = useAsync(() => api.get<Report[]>('/missing-reports/mine'), [tick])
  const [open, setOpen] = useState<number | null>(null)
  const [events, setEvents] = useState<ReportEvent[] | null>(null)
  const [withdraw, setWithdraw] = useState<Report | null>(null)
  const { run, busy } = useSubmit()
  useLive(['report.updated'], () => reload())
  useEffect(() => { if (open == null) return; setEvents(null); api.get<ReportEvent[]>(`/missing-reports/${open}/events`).then(setEvents).catch(() => setEvents([])) }, [open, data])

  const eventLabel = (e: string) => {
    if (e === 'created') return tr({ te: 'నివేదిక నమోదైంది', hi: 'रिपोर्ट दर्ज', en: 'Report submitted' })
    if (e.startsWith('status:')) { const s = e.slice(7) as Report['status']; return STATUS[s] ? tr(STATUS[s].label) : s }
    return tr({ te: 'నవీకరించబడింది', hi: 'अपडेट', en: 'Updated' })
  }

  if (loading && !data) return <Skeleton rows={3} />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data?.length) return <EmptyState icon={FileText} title={tr({ te: 'మీకు నివేదికలు లేవు', hi: 'आपकी कोई रिपोर्ट नहीं', en: 'You have no reports' })} body={tr({ te: 'మీరు పంపిన నివేదికల స్థితి ఇక్కడ కనిపిస్తుంది.', hi: 'आपकी भेजी रिपोर्ट की स्थिति यहाँ दिखेगी।', en: 'The status of reports you send appears here.' })} />
  return (
    <div className="list">
      {data.map((r) => (
        <div key={r.id} className="card stack tight">
          <div className="row between wrap"><strong>#{r.id} · {r.subject_name}</strong><StatusChip s={r.status} /></div>
          <span className="small muted">{tr({ te: 'పంపినది', hi: 'भेजा', en: 'Sent' })} {clock(r.created_at)} · {ago(r.created_at)}</span>
          {r.status === 'found' && <Notice tone="ok" icon={CircleCheck}>{tr({ te: 'దొరికారు! సహాయ కేంద్రానికి వెళ్లండి. గుర్తింపు కార్డు తీసుకెళ్లండి.', hi: 'मिल गए! सहायता केंद्र जाएँ। पहचान पत्र साथ रखें।', en: 'Found! Please go to the help desk and bring an ID.' })}</Notice>}
          <div className="row wrap">
            <button className="btn sm" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}><Clock3 size={16} aria-hidden />{tr({ te: 'చరిత్ర', hi: 'इतिहास', en: 'Timeline' })}</button>
            {r.help_desk_location_id && <Link className="btn sm primary" to={`/map?to=${r.help_desk_location_id}`}><Navigation size={16} aria-hidden />{t('directions')}</Link>}
            {!['closed', 'rejected'].includes(r.status) && <button className="btn sm ghost" onClick={() => setWithdraw(r)}>{tr({ te: 'ఉపసంహరించు', hi: 'वापस लें', en: 'Withdraw' })}</button>}
          </div>
          {open === r.id && (events == null ? <Skeleton rows={2} kind="line" /> : (
            <ol className="stack tight" style={{ margin: 0, paddingLeft: '1.2rem' }}>
              {events.map((e) => <li key={e.id} className="small"><strong>{eventLabel(e.event_type)}</strong>{e.note ? ` – ${e.note}` : ''} <span className="muted">· {clock(e.created_at)}</span></li>)}
            </ol>
          ))}
        </div>
      ))}
      <Sheet open={!!withdraw} onClose={() => setWithdraw(null)} title={tr({ te: 'నివేదిక ఉపసంహరించాలా?', hi: 'रिपोर्ट वापस लें?', en: 'Withdraw this report?' })}>
        {withdraw && (
          <div className="stack">
            <p>{tr({ te: `${withdraw.subject_name} దొరికితే లేదా పొరపాటుగా పంపితే మాత్రమే ఉపసంహరించండి.`, hi: `केवल तभी वापस लें जब ${withdraw.subject_name} मिल गए हों या गलती से भेजा हो।`, en: `Only withdraw if ${withdraw.subject_name} has been found or the report was a mistake.` })}</p>
            <div className="grid2">
              <button className="btn big" onClick={() => setWithdraw(null)}>{t('cancel')}</button>
              <SubmitButton className="btn danger big" busy={busy} onClick={async () => {
                const ok = await run(() => api.patch(`/missing-reports/${withdraw.id}`, { status: 'closed', note: 'Withdrawn by reporter' }))
                if (ok !== undefined) { setWithdraw(null); toast(tr({ te: 'ఉపసంహరించబడింది', hi: 'वापस लिया गया', en: 'Report withdrawn' })); reload() }
              }}>{tr({ te: 'ఉపసంహరించు', hi: 'वापस लें', en: 'Withdraw' })}</SubmitButton>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  )
}

/* ------------------------------------------------------------------------------------------- public board */
function Board() {
  const { tr, name, ago } = useLang()
  const { data, loading, error, reload } = useAsync(() => api.get<BoardEntry[]>('/missing-reports/board'), [])
  useLive(['report.updated'], () => reload())
  return (
    <div className="stack">
      <Notice icon={ShieldCheck}>{tr({ te: 'గోప్యత కోసం పేర్లు, ఫోటోలు చూపబడవు. మీ వారిలా అనిపిస్తే ఆ సహాయ కేంద్రానికి వెళ్లండి.', hi: 'गोपनीयता हेतु नाम व फ़ोटो नहीं दिखाए जाते। अपने लगें तो उस सहायता केंद्र पर जाएँ।', en: 'Names and photos are hidden for privacy. If someone sounds like your family member, go to that help desk.' })}</Notice>
      {loading && !data ? <Skeleton rows={3} /> : error ? <ErrorState message={error} onRetry={reload} /> : !data?.length ? (
        <EmptyState icon={SearchCheck} title={tr({ te: 'ప్రస్తుతం సహాయ కేంద్రాల్లో ఎవరూ వేచి లేరు', hi: 'अभी सहायता केंद्रों पर कोई प्रतीक्षा में नहीं', en: 'Nobody is waiting at a help desk right now' })} />
      ) : (
        <div className="auto-grid">
          {data.map((b) => (
            <div key={b.id} className="lrow">
              <span className="lead copper" aria-hidden><UserRound size={22} /></span>
              <span className="body">
                <span className="title">{tr(AGE_GROUP[b.age_group] ?? AGE_GROUP.unknown)}{b.gender && GENDER[b.gender] ? ` · ${tr(GENDER[b.gender])}` : ''}</span>
                <span className="meta">{b.clothing && <span>{b.clothing}</span>}{b.held_at && <span>{name(b.held_at)}</span>}<span>{ago(b.since)}</span></span>
              </span>
              {b.held_at && <Link className="btn icon sm tonal" to={`/map?to=${b.held_at.id}`} aria-label={`${tr({ te: 'దారి', hi: 'रास्ता', en: 'Directions' })}: ${name(b.held_at)}`}><Navigation size={20} aria-hidden /></Link>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function WhatToDoNow() {
  const { t, tr } = useLang()
  const { places, site } = useStore()
  const dist = useDistance()
  const desks = useMemo(() => places
    .filter((p) => ['help_desk', 'lost_found'].includes(p.type) && p.is_open)
    .map((p) => ({ p, d: dist(p.lat, p.lng) }))
    .sort((a, b) => (a.d != null && b.d != null ? a.d - b.d : a.p.name.localeCompare(b.p.name)))
    .slice(0, 3).map((x) => x.p), [places, dist])
  const lf = site?.emergency_contacts.lost_found
  return (
    <section className="card stack" aria-labelledby="mp-now">
      <div className="card-head" style={{ marginBottom: 0 }}><h2 id="mp-now">{tr({ te: 'ఇప్పుడు ఏమి చేయాలి', hi: 'अभी क्या करें', en: 'What to do now' })}</h2></div>
      <ol className="stack tight small" style={{ margin: 0, paddingLeft: '1.2rem' }}>
        <li>{tr({ te: 'మీరు ఉన్న చోటే ఉండండి లేదా నిర్ణయించుకున్న కలుసుకునే చోటుకు వెళ్లండి.', hi: 'जहाँ हैं वहीं रहें या तय मिलने की जगह जाएँ।', en: 'Stay where you are, or go to your agreed meeting point.' })}</li>
        <li>{tr({ te: 'సమీప సహాయ కేంద్రానికి వెళ్లండి లేదా ఇక్కడ నివేదిక పంపండి.', hi: 'निकटतम सहायता केंद्र जाएँ या यहाँ रिपोर्ट भेजें।', en: 'Go to the nearest help desk, or send a report here.' })}</li>
        <li>{tr({ te: 'ఫోన్ దగ్గర ఉంచుకోండి – సిబ్బంది మీకు కాల్ చేస్తారు. చాలామంది గంటలోపే కలుస్తారు.', hi: 'फ़ोन पास रखें – कर्मचारी कॉल करेंगे। अधिकांश एक घंटे में मिल जाते हैं।', en: 'Keep your phone with you – staff will call. Most people are reunited within an hour.' })}</li>
      </ol>
      {desks.length > 0 && (
        <div className="stack tight">
          <strong className="small">{tr({ te: 'సమీప సహాయ కేంద్రాలు', hi: 'निकटतम सहायता केंद्र', en: 'Nearest help desks' })}</strong>
          <div className="list">{desks.map((l) => <PlaceRow key={l.id} loc={l} showStatus={false} />)}</div>
        </div>
      )}
      <div className="stack tight">
        {lf && <a className="btn block" href={`tel:${lf}`}><Phone size={18} aria-hidden />{t('lost_found')} · {lf}</a>}
        <a className="btn danger block" href="tel:112"><Phone size={18} aria-hidden />{tr({ te: 'అత్యవసరం', hi: 'आपातकाल', en: 'Emergency' })} · 112</a>
      </div>
    </section>
  )
}

export default function MissingPage() {
  const { t, tr } = useLang()
  const [tab, setTab] = useState<'report' | 'mine' | 'board'>('report')
  const [tick, setTick] = useState(0)
  const tabs = (
    <Segmented label={t('missing')} value={tab} onChange={setTab} options={[
      { value: 'report', label: tr({ te: 'నివేదించు', hi: 'रिपोर्ट', en: 'Report' }) },
      { value: 'mine', label: t('myReports') },
      { value: 'board', label: tr({ te: 'సహాయ కేంద్రాల్లో', hi: 'केंद्रों पर', en: 'At help desks' }) },
    ]} />
  )
  return (
    <div className="stack">
      <PageHead title={t('missing')} sub={tr({ te: 'ప్రశాంతంగా ఉండండి – సిబ్బంది ప్రతి నివేదికపై వెంటనే పనిచేస్తారు', hi: 'शांत रहें – कर्मचारी हर रिपोर्ट पर तुरंत काम करते हैं', en: 'Stay calm – staff act on every report straight away' })}
        actions={<span className="hide-mobile">{tabs}</span>} />
      <div className="only-mobile">{tabs}</div>
      <div className="layout-aside">
        <div className="stack">
          {tab === 'report' && <LoginGate reason={tr({ te: 'సిబ్బంది మీకు తిరిగి కాల్ చేయగలిగేలా ధృవీకరించిన ఫోన్ నంబర్ అవసరం.', hi: 'ताकि कर्मचारी आपको वापस कॉल कर सकें, सत्यापित फ़ोन नंबर ज़रूरी है।', en: 'A verified phone number is needed so staff can call you back.' })}><ReportFlow onFiled={() => setTick((x) => x + 1)} /></LoginGate>}
          {tab === 'mine' && <LoginGate><MyReports tick={tick} /></LoginGate>}
          {tab === 'board' && <Board />}
        </div>
        <aside className="only-desktop"><WhatToDoNow /></aside>
      </div>
    </div>
  )
}
