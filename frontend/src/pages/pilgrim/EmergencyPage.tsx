/* Emergency assistance. Three clearly separated layers:
   1. Official services by phone (the real emergency route).
   2. Nearest staffed assistance points.
   3. An in-app request to the event control room - recorded, visible to staff, NOT a dispatch. */
import { useMemo, useState } from 'react'
import {
  Ambulance, Baby, CircleCheck, CircleHelp, Droplets, Flame, HeartPulse, LocateFixed, MapPin, MapPinOff, Phone, Send, Shield, ShieldAlert,
  Sun, UserSearch, Users, Waves, type LucideIcon,
} from 'lucide-react'
import { api, type SosResponse } from '../../api'
import { useLang } from '../../i18n'
import { useStore } from '../../store'
import { useDistance, useMyLocation } from '../../location'
import { haptic } from '../../prefs'
import { Field, ListRow, Notice, PageHead, PlaceRow, Skeleton, SubmitButton, useSubmit, useToast } from '../../components/ui'
import { LocationPrompt } from './FacilitiesPage'

type SosType = 'medical' | 'police' | 'lost_child' | 'fire' | 'other'

function CallButton({ n, label, icon: I, tone = 'danger' }: { n: string; label: string; icon: LucideIcon; tone?: 'danger' | 'primary' | 'tonal' }) {
  return (
    <a href={`tel:${n.replace(/[^\d+]/g, '')}`} className={`btn ${tone} big`} style={{ justifyContent: 'flex-start', paddingLeft: 'var(--s4)', minHeight: 64 }} aria-label={`${label} ${n}`}>
      <I size={24} aria-hidden />
      <span className="grow" style={{ textAlign: 'left', lineHeight: 1.2 }}><span style={{ display: 'block' }}>{label}</span><span className="small" style={{ opacity: 0.9, fontWeight: 650 }}>{n}</span></span>
      <Phone size={20} aria-hidden />
    </a>
  )
}

export default function EmergencyPage() {
  const { t, tr, num } = useLang()
  const { site, user, places } = useStore()
  const { coords, pos, requestGps, requesting, perm } = useMyLocation()
  const dist = useDistance()
  const toast = useToast()
  const [type, setType] = useState<SosType | null>(null)
  const [note, setNote] = useState('')
  const [phone, setPhone] = useState('')
  const [shareLoc, setShareLoc] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [sent, setSent] = useState<SosResponse | null>(null)
  const [touched, setTouched] = useState(false)
  const { run, busy, error } = useSubmit<SosResponse>()

  const posts = useMemo(() => places
    .filter((p) => ['medical', 'police', 'help_desk', 'lost_found'].includes(p.type) && p.is_open)
    .map((p) => ({ p, d: dist(p.lat, p.lng) }))
    .sort((a, b) => (a.d != null && b.d != null ? a.d - b.d : a.p.name.localeCompare(b.p.name)))
    .slice(0, 5).map((x) => x.p), [places, dist])

  const types: { k: SosType; icon: LucideIcon; l: string }[] = [
    { k: 'medical', icon: HeartPulse, l: t('medical') },
    { k: 'police', icon: Shield, l: t('police') },
    { k: 'lost_child', icon: Baby, l: tr({ te: 'పిల్లవాడు తప్పిపోయాడు', hi: 'बच्चा खो गया', en: 'Lost child' }) },
    { k: 'fire', icon: Flame, l: tr({ te: 'అగ్ని', hi: 'आग', en: 'Fire' }) },
    { k: 'other', icon: CircleHelp, l: t('other') },
  ]
  const typeLabel = types.find((x) => x.k === type)?.l ?? ''
  const phoneDigits = phone.replace(/\D/g, '')
  const phoneErr = !user && touched && phoneDigits.length < 10 ? tr({ te: '10 అంకెల ఫోన్ నంబర్ ఇవ్వండి', hi: '10 अंकों का फ़ोन नंबर दें', en: 'Enter a 10-digit phone number' }) : null
  const canSend = !!type && (!!user || phoneDigits.length >= 10)
  const willShare = shareLoc && !!coords

  const locText = !shareLoc || !pos
    ? tr({ te: 'స్థానం పంపబడదు', hi: 'कोई स्थान नहीं भेजा जाएगा', en: 'No location will be shared' })
    : pos.source === 'gps'
      ? tr({ te: `మీ GPS స్థానం ${pos.accuracy && pos.accuracy >= 1 ? `(±${num(Math.round(pos.accuracy))} మీ.) ` : ''}జత చేయబడుతుంది`, hi: `आपका GPS स्थान ${pos.accuracy && pos.accuracy >= 1 ? `(±${num(Math.round(pos.accuracy))} मी.) ` : ''}जोड़ा जाएगा`, en: `Your GPS location ${pos.accuracy && pos.accuracy >= 1 ? `(±${num(Math.round(pos.accuracy))} m) ` : ''}will be attached` })
      : tr({ te: `ఎంచుకున్న ప్రదేశం: ${pos.label ?? ''}`, hi: `चुना गया स्थान: ${pos.label ?? ''}`, en: `Chosen place: ${pos.label ?? ''}` })

  const send = async () => {
    const r = await run(() => api.post<SosResponse>('/sos', {
      type, note: note.trim() || null,
      lat: willShare ? coords![0] : undefined, lng: willShare ? coords![1] : undefined,
      phone: user ? undefined : phone,
    }))
    if (r) { setSent(r); setConfirming(false); toast(tr({ te: 'అభ్యర్థన నమోదైంది', hi: 'अनुरोध दर्ज हुआ', en: 'Request recorded' })) }
    else setConfirming(false)
  }

  const ec = site?.emergency_contacts ?? {}
  const nearest = (cls: string) => (
    <section className={`card ${cls}`} aria-labelledby={`near-${cls}`}>
      <div className="card-head"><h2 id={`near-${cls}`}>{tr({ te: 'సమీప సహాయ కేంద్రాలు', hi: 'निकटतम सहायता केंद्र', en: 'Nearest assistance points' })}</h2></div>
      <div className="stack tight">
        <LocationPrompt compact />
        {places.length === 0 ? <Skeleton rows={3} /> : <div className="list">{posts.map((p) => <PlaceRow key={p.id} loc={p} showStatus={false} />)}</div>}
      </div>
    </section>
  )
  return (
    <div>
      <PageHead title={t('emergencyAssist')} sub={tr({ te: 'అధికారిక సేవలు, సమీప సహాయం మరియు కంట్రోల్ రూమ్', hi: 'आधिकारिक सेवाएँ, निकटतम सहायता और कंट्रोल रूम', en: 'Official services, nearest help and the event control room' })} />
      <div className="layout-aside">
        <div className="stack loose">
          <section className="card" aria-labelledby="em-official">
            <div className="card-head"><h2 id="em-official">{tr({ te: 'అధికారిక అత్యవసర సేవలకు కాల్ చేయండి', hi: 'आधिकारिक आपात सेवाओं को कॉल करें', en: 'Call official emergency services' })}</h2></div>
            <div className="stack tight">
              <CallButton n="112" label={tr({ te: 'అత్యవసరం', hi: 'आपातकाल', en: 'Emergency' })} icon={ShieldAlert} />
              <div className="cols-2" style={{ gap: 'var(--s2) var(--s3)' }}>
                <CallButton n="108" label={tr({ te: 'అంబులెన్స్', hi: 'एम्बुलेंस', en: 'Ambulance' })} icon={Ambulance} tone="primary" />
                <CallButton n="100" label={t('police')} icon={Shield} tone="primary" />
                {ec.control_room && <CallButton n={ec.control_room} label={tr({ te: 'కంట్రోల్ రూమ్', hi: 'कंट्रोल रूम', en: 'Control room' })} icon={Phone} tone="tonal" />}
                {ec.lost_found && <CallButton n={ec.lost_found} label={t('lost_found')} icon={UserSearch} tone="tonal" />}
              </div>
              <p className="small muted">{tr({ te: 'కాల్‌లు మీ ఫోన్ నుండి నేరుగా అధికారిక సేవకు వెళ్తాయి.', hi: 'कॉल आपके फ़ोन से सीधे आधिकारिक सेवा को जाती है।', en: 'Calls go directly to the official service from your phone.' })}</p>
            </div>
          </section>

          {nearest('hide-desktop')}

          <section className="card" aria-labelledby="em-request">
            <div className="card-head"><h2 id="em-request">{tr({ te: 'ఈవెంట్ కంట్రోల్ రూమ్‌కు అభ్యర్థన', hi: 'इवेंट कंट्रोल रूम को अनुरोध', en: 'Send a request to the event control room' })}</h2></div>
            <div className="stack">
              <Notice tone="warn" icon={ShieldAlert}>
                {tr({ te: 'ఇది యాప్‌లో నమోదయ్యే అభ్యర్థన మాత్రమే. ఇది అంబులెన్స్ లేదా పోలీసులను పిలవదు. ప్రాణాపాయం ఉంటే వెంటనే 112కు కాల్ చేయండి.', hi: 'यह केवल ऐप में दर्ज अनुरोध है। यह एम्बुलेंस या पुलिस को नहीं बुलाता। जान का ख़तरा हो तो तुरंत 112 पर कॉल करें।', en: 'This is an in-app request only. It does not call an ambulance or the police. If a life is in danger, call 112 now.' })}
              </Notice>
        {sent ? (
          <div className="stack" role="status">
            <div className="row"><CircleCheck size={36} className="pop-check" style={{ color: 'var(--low)' }} aria-hidden /><h3 className="grow">{tr({ te: `అభ్యర్థన #${sent.request.id} కంట్రోల్ రూమ్‌లో నమోదైంది`, hi: `अनुरोध #${sent.request.id} कंट्रोल रूम में दर्ज`, en: `Request #${sent.request.id} recorded by the control room` })}</h3></div>
            <p className="small">{tr({ te: 'సిబ్బంది దీన్ని ఇప్పుడు చూడగలరు; అవసరమైతే మీ ఫోన్‌కు కాల్ చేస్తారు. ఎవరైనా ప్రమాదంలో ఉంటే 112కు కాల్ చేయండి.', hi: 'कर्मचारी इसे अभी देख सकते हैं; ज़रूरत हो तो आपके फ़ोन पर कॉल करेंगे। कोई ख़तरे में हो तो 112 पर कॉल करें।', en: 'Staff can see it now; they will call your phone if needed. If anyone is in danger, call 112.' })}</p>
            <CallButton n="112" label={tr({ te: 'అత్యవసరం', hi: 'आपातकाल', en: 'Emergency' })} icon={ShieldAlert} />
            {sent.nearest.length > 0 && <><strong>{t('nearestHelp')}</strong><div className="list">{sent.nearest.map((l) => <PlaceRow key={l.id} loc={l} showStatus={false} />)}</div></>}
            <button className="btn ghost" onClick={() => { setSent(null); setType(null); setNote('') }}>{tr({ te: 'కొత్త అభ్యర్థన', hi: 'नया अनुरोध', en: 'New request' })}</button>
          </div>
        ) : (
          <div className="stack">
            <div className="field-label">{tr({ te: 'ఏ రకమైన సహాయం?', hi: 'किस तरह की मदद?', en: 'What kind of help?' })}</div>
            <div className="choice-grid" role="radiogroup" aria-label={tr({ te: 'సహాయ రకం', hi: 'मदद का प्रकार', en: 'Type of help' })}>
              {types.map(({ k, icon: I, l }) => (
                <button key={k} type="button" className="choice" role="radio" aria-checked={type === k} onClick={() => { haptic(8); setType(k); setConfirming(false) }}>
                  <I size={24} aria-hidden />{l}
                </button>
              ))}
            </div>
            <Field label={tr({ te: 'వివరం', hi: 'विवरण', en: 'Details' })} optional htmlFor="sos-note">
              <input id="sos-note" className="input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={tr({ te: 'ఉదా: గేట్ B దగ్గర వృద్ధుడు కళ్ళు తిరిగి పడిపోయారు', hi: 'उदा: गेट B के पास बुज़ुर्ग बेहोश', en: 'e.g. elderly man fainted near Gate B' })} />
            </Field>
            {!user && (
              <Field label={t('phone')} htmlFor="sos-phone" error={phoneErr} hint={tr({ te: 'సిబ్బంది మిమ్మల్ని సంప్రదించడానికి', hi: 'कर्मचारी आपसे संपर्क कर सकें', en: 'So staff can reach you' })}>
                <input id="sos-phone" className="input" inputMode="tel" autoComplete="tel" value={phone} onBlur={() => setTouched(true)} onChange={(e) => setPhone(e.target.value)} aria-invalid={!!phoneErr} placeholder="98765 43210" />
              </Field>
            )}

            <div className="stack tight">
              <div className="field-label">{tr({ te: 'స్థానం పంచుకోవడం', hi: 'स्थान साझा करना', en: 'Location sharing' })}</div>
              <div className={`notice ${willShare ? 'ok' : ''}`}>
                {willShare ? <MapPin size={18} aria-hidden /> : <MapPinOff size={18} aria-hidden />}
                <div className="grow stack tight">
                  <span>{locText}</span>
                  <div className="row wrap">
                    {coords && <label className="row small" style={{ gap: 6, minHeight: 40 }}><input type="checkbox" checked={shareLoc} onChange={(e) => setShareLoc(e.target.checked)} style={{ width: 20, height: 20 }} />{tr({ te: 'స్థానం జత చేయి', hi: 'स्थान जोड़ें', en: 'Attach location' })}</label>}
                    {pos?.source !== 'gps' && perm !== 'denied' && perm !== 'unsupported' && (
                      <button type="button" className="btn sm" onClick={() => void requestGps()} disabled={requesting}>{requesting ? <span className="spin" aria-hidden /> : <LocateFixed size={16} aria-hidden />}{t('useMyLocation')}</button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {error && <div className="err" role="alert">{error}</div>}
            {!confirming ? (
              <SubmitButton className="btn danger big block" disabled={!canSend} onClick={() => { setTouched(true); if (canSend) { haptic(15); setConfirming(true) } }}>
                <Send size={20} aria-hidden />{tr({ te: 'అభ్యర్థన పంపు', hi: 'अनुरोध भेजें', en: 'Send request' })}
              </SubmitButton>
            ) : (
              <div className="card flat stack" style={{ borderColor: 'var(--danger)', borderWidth: 2 }} role="alertdialog" aria-label={t('confirm')}>
                <strong>{tr({ te: 'పంపే ముందు నిర్ధారించండి', hi: 'भेजने से पहले पुष्टि करें', en: 'Confirm before sending' })}</strong>
                <dl className="kv">
                  <dt>{tr({ te: 'రకం', hi: 'प्रकार', en: 'Type' })}</dt><dd>{typeLabel}</dd>
                  <dt>{tr({ te: 'స్థానం', hi: 'स्थान', en: 'Location' })}</dt><dd>{locText}</dd>
                </dl>
                <p className="small" style={{ color: 'var(--danger)', fontWeight: 650 }}>{tr({ te: 'ఇది అంబులెన్స్ లేదా పోలీసులను పిలవదు.', hi: 'यह एम्बुलेंस या पुलिस को नहीं बुलाता।', en: 'This does not call an ambulance or the police.' })}</p>
                <div className="grid2">
                  <button className="btn big" onClick={() => setConfirming(false)} disabled={busy}>{t('cancel')}</button>
                  <SubmitButton className="btn danger big" busy={busy} onClick={() => { haptic([20, 40, 20]); void send() }}>{t('confirm')}</SubmitButton>
                </div>
              </div>
            )}
          </div>
        )}
            </div>
          </section>
        </div>

        <aside className="stack loose" style={{ position: 'static' }}>
          {nearest('only-desktop')}
          <div className="list grouped">
            <ListRow to="/missing" tone="accent" icon={<UserSearch size={22} />} title={t('findMissing')} meta={tr({ te: 'కుటుంబ సభ్యుడు తప్పిపోతే నివేదించండి', hi: 'परिवार का सदस्य बिछड़ जाए तो रिपोर्ट करें', en: 'Report a separated family member' })} chevron />
          </div>
          <section className="card" aria-labelledby="em-tips" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="card-head" style={{ padding: 'var(--s4) var(--s5) 0', marginBottom: 'var(--s2)' }}><h2 id="em-tips">{tr({ te: 'భద్రతా సూచనలు', hi: 'सुरक्षा सुझाव', en: 'Safety tips' })}</h2></div>
            <div className="list grouped" style={{ border: 0, borderRadius: 0, boxShadow: 'none' }}>
              <ListRow tone="copper" icon={<Users size={20} />} title={tr({ te: 'విడిపోతే కలుసుకునే చోటు ముందే నిర్ణయించుకోండి', hi: 'बिछड़ने पर मिलने की जगह पहले तय करें', en: 'Agree a meeting point in case you get separated' })} />
              <ListRow tone="copper" icon={<Baby size={20} />} title={tr({ te: 'పిల్లలకు రిస్ట్‌బ్యాండ్ లేదా ఫోన్ నంబర్ ఉంచండి', hi: 'बच्चों को रिस्टबैंड या फ़ोन नंबर पहनाएँ', en: 'Give children a wristband or a phone number' })} />
              <ListRow tone="copper" icon={<Waves size={20} />} title={tr({ te: 'గుర్తించిన ఘాట్‌లలోనే స్నానం; లోతైన నీటికి దూరంగా', hi: 'केवल चिह्नित घाटों पर स्नान; गहरे पानी से दूर', en: 'Bathe only at marked ghats; stay out of deep water' })} />
              <ListRow tone="copper" icon={<Droplets size={20} />} title={tr({ te: 'తరచుగా నీరు తాగండి', hi: 'पानी पीते रहें', en: 'Drink water often' })} />
              <ListRow tone="copper" icon={<Sun size={20} />} title={tr({ te: 'ఉదయం 5–9 గంటల రద్దీని వీలైతే తప్పించండి', hi: 'संभव हो तो सुबह 5–9 की भीड़ से बचें', en: 'Avoid the 5–9 am peak if you can' })} />
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
