/* First-run introduction: language → what the app does → location (explained before asking) → privacy.
   Every step can be skipped; declining location never blocks the app. Camera/notifications are not asked here.
   Phones: full-screen flow with actions at the bottom. Tablet/desktop: a centred card with the brand above it. */
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { CircleCheck, Eye, History, LocateFixed, Lock, MapPinned, RadioTower, Siren, Toilet, Users, UsersRound, Waves } from 'lucide-react'
import { useLang } from '../../i18n'
import { useMyLocation } from '../../location'
import { ONBOARDED_KEY } from '../../components/Shell'
import { GloomDevCredit } from '../../components/brand'
import { LanguagePicker, ListRow, Notice, Stepper, useBreakpoint } from '../../components/ui'

const STEPS = 4

export default function OnboardingPage() {
  const { t, tr } = useLang()
  const nav = useNavigate()
  const { requestGps, requesting, perm } = useMyLocation()
  const [step, setStep] = useState(0)
  const [gpsResult, setGpsResult] = useState<'ok' | 'no' | null>(null)
  const wide = useBreakpoint() !== 'mobile'

  const finish = () => {
    try { localStorage.setItem(ONBOARDED_KEY, '1') } catch { /* private mode: onboarding simply shows again */ }
    nav('/', { replace: true })
  }
  const next = () => (step < STEPS - 1 ? setStep(step + 1) : finish())
  const askGps = async () => { const p = await requestGps(); setGpsResult(p ? 'ok' : 'no') }

  const progress = (
    <div className="row between" style={{ gap: 'var(--s4)' }}>
      <div className="grow" style={{ maxWidth: 240 }}><Stepper total={STEPS} current={step} label={`${step + 1} / ${STEPS}`} /></div>
      <span className="xs muted hide-mobile">{step + 1} / {STEPS}</span>
      <button className="btn ghost sm" onClick={finish}>{t('skip')}</button>
    </div>
  )

  let body: ReactNode = null
  if (step === 0) body = (
    <>
      <div className="stack tight">
        <h1 style={{ fontSize: 'var(--fs-xl)' }}>
          <span lang="te">భాష ఎంచుకోండి</span> / <span lang="hi">भाषा चुनें</span> / <span lang="en">Choose language</span>
        </h1>
        <p className="muted small">{t('tagline')} · {t('appName')}</p>
      </div>
      <LanguagePicker />
      {!wide && <GloomDevCredit />}
    </>
  )
  else if (step === 1) body = (
    <>
      <h1 style={{ fontSize: 'var(--fs-xl)' }}>{tr({ te: 'ఈ యాప్ మీకు ఎలా సహాయపడుతుంది', hi: 'यह ऐप कैसे मदद करता है', en: 'How this app helps you' })}</h1>
      <div className="list grouped">
        <ListRow icon={<Users size={20} />} title={tr({ te: 'గేట్లు, ఘాట్ల వద్ద లైవ్ రద్దీ', hi: 'गेट व घाटों पर लाइव भीड़', en: 'Live crowd at gates and ghats' })} meta={tr({ te: 'తక్కువ రద్దీ ఉన్న ప్రత్యామ్నాయాలు', hi: 'कम भीड़ वाले विकल्प', en: 'and less crowded alternatives' })} />
        <ListRow icon={<Toilet size={20} />} title={tr({ te: 'సౌకర్యాలు, పార్కింగ్ కనుగొనండి', hi: 'सुविधाएँ व पार्किंग खोजें', en: 'Find facilities and parking' })} meta={tr({ te: 'మరుగుదొడ్లు, తాగునీరు, వైద్యం, నడక దారి', hi: 'शौचालय, पानी, चिकित्सा, पैदल रास्ता', en: 'toilets, water, medical, walking directions' })} />
        <ListRow icon={<UsersRound size={20} />} title={tr({ te: 'కుటుంబ రిస్ట్‌బ్యాండ్ ట్రాకింగ్', hi: 'परिवार रिस्टबैंड ट्रैकिंग', en: 'Family wristband tracking' })} meta={tr({ te: 'చెక్‌పాయింట్ల వద్ద చివరిగా కనిపించిన చోటు', hi: 'चेकपॉइंट पर अंतिम बार देखा गया', en: 'last seen at checkpoints' })} />
        <ListRow icon={<Siren size={20} />} tone="danger" title={tr({ te: 'అత్యవసర సహాయం', hi: 'आपातकालीन सहायता', en: 'Emergency help' })} meta={tr({ te: 'అధికారిక నంబర్లు, సమీప సహాయ కేంద్రాలు', hi: 'आधिकारिक नंबर, निकटतम सहायता', en: 'official numbers, nearest help points' })} />
      </div>
      <Notice icon={Lock}>
        {tr({ te: 'రద్దీ, మ్యాప్, సౌకర్యాలు, అత్యవసర సమాచారం ఖాతా లేకుండానే పనిచేస్తాయి. కుటుంబ ట్రాకింగ్ మరియు నివేదికలకు మాత్రమే ఫోన్ OTP లాగిన్ అవసరం.', hi: 'भीड़, नक्शा, सुविधाएँ और आपात जानकारी बिना खाते के काम करती हैं। केवल परिवार ट्रैकिंग और रिपोर्ट के लिए फ़ोन OTP लॉगिन चाहिए।', en: 'Crowd, map, facilities and emergency information work without an account. Phone OTP login is only needed for family tracking and reports.' })}
      </Notice>
    </>
  )
  else if (step === 2) body = (
    <>
      <div className="center stack" style={{ alignItems: 'center', paddingTop: 'var(--s2)' }}>
        <span style={{ width: 88, height: 88, borderRadius: 'var(--r-xl)', display: 'grid', placeItems: 'center', background: 'var(--brand-100)', color: 'var(--brand-ink)' }} aria-hidden><LocateFixed size={44} /></span>
        <h1 style={{ fontSize: 'var(--fs-xl)' }}>{tr({ te: 'మీ స్థానం ఎందుకు?', hi: 'आपका स्थान क्यों?', en: 'Why your location?' })}</h1>
        <p className="muted" style={{ maxWidth: '44ch' }}>{t('locationWhy')}</p>
      </div>
      {gpsResult === 'ok' && <Notice tone="ok" icon={CircleCheck}>{tr({ te: 'స్థానం ఆన్ అయింది.', hi: 'स्थान चालू हो गया।', en: 'Location is on.' })}</Notice>}
      {(gpsResult === 'no' || perm === 'denied') && (
        <Notice tone="warn" icon={MapPinned}>
          {tr({ te: 'పర్వాలేదు - యాప్ అలాగే పనిచేస్తుంది. మీరు ఉన్న ప్రదేశాన్ని హోమ్ స్క్రీన్‌లో ఎంచుకోవచ్చు.', hi: 'कोई बात नहीं - ऐप फिर भी काम करेगा। आप होम स्क्रीन पर अपना स्थान चुन सकते हैं।', en: 'No problem – the app still works. You can choose where you are on the home screen.' })}
        </Notice>
      )}
    </>
  )
  else body = (
    <>
      <h1 style={{ fontSize: 'var(--fs-xl)' }}>{tr({ te: 'మీ గోప్యత', hi: 'आपकी गोपनीयता', en: 'Your privacy' })}</h1>
      <div className="list grouped">
        <ListRow icon={<Lock size={20} />} title={tr({ te: 'అనుమతితో మాత్రమే', hi: 'केवल सहमति से', en: 'Only with consent' })} meta={tr({ te: 'రిస్ట్‌బ్యాండ్‌ను కుటుంబ సభ్యునికి లింక్ చేయడానికి మీ అనుమతి అవసరం', hi: 'रिस्टबैंड को परिवार सदस्य से जोड़ने के लिए आपकी सहमति चाहिए', en: 'Linking a wristband to a family member needs your consent' })} />
        <ListRow icon={<RadioTower size={20} />} title={tr({ te: 'చెక్‌పాయింట్ల వద్ద మాత్రమే', hi: 'केवल चेकपॉइंट पर', en: 'Checkpoints only' })} meta={tr({ te: 'రిస్ట్‌బ్యాండ్ గేట్లు, చెక్‌పాయింట్ల వద్ద మాత్రమే చదవబడుతుంది - ఇది నిరంతర GPS కాదు', hi: 'रिस्टबैंड केवल गेट व चेकपॉइंट पर पढ़ा जाता है - यह निरंतर GPS नहीं है', en: 'Wristbands are read only at gates and checkpoints – not continuous GPS' })} />
        <ListRow icon={<Eye size={20} />} title={tr({ te: 'ప్రతి వీక్షణ నమోదు', hi: 'हर लुकअप दर्ज', en: 'Every lookup is recorded' })} meta={tr({ te: 'మీ కుటుంబం, తప్పిపోయిన నివేదిక ఉన్నప్పుడు సిబ్బంది మాత్రమే చూడగలరు', hi: 'केवल आपका परिवार, और गुमशुदगी रिपोर्ट पर कर्मचारी देख सकते हैं', en: 'Only your family – and staff while a missing report is open – can see it' })} />
        <ListRow icon={<History size={20} />} title={tr({ te: '30 రోజుల్లో తొలగింపు', hi: '30 दिन में हटाया जाता है', en: 'Deleted after 30 days' })} meta={tr({ te: 'పుష్కరాలు ముగిసిన 30 రోజుల తర్వాత డేటా తొలగించబడుతుంది', hi: 'पुष्करालु के 30 दिन बाद डेटा हटा दिया जाता है', en: 'Data is deleted 30 days after the festival' })} />
      </div>
    </>
  )

  const actions = (
    <div className="stack tight">
      {step === 2 && gpsResult == null && perm !== 'granted' && perm !== 'unsupported' ? (
        <>
          <button className="btn primary big block" onClick={() => void askGps()} disabled={requesting} aria-busy={requesting || undefined}>
            {requesting ? <span className="spin" aria-hidden /> : <LocateFixed size={20} aria-hidden />}{t('useMyLocation')}
          </button>
          <button className="btn ghost block" onClick={next}>{t('notNow')}</button>
        </>
      ) : (
        <button className="btn primary big block" onClick={next}>
          {step === STEPS - 1 ? tr({ te: 'ప్రారంభించండి', hi: 'शुरू करें', en: 'Start' }) : t('continue')}
        </button>
      )}
      {step > 0 && <button className="btn ghost block" onClick={() => setStep(step - 1)}>{t('back')}</button>}
    </div>
  )

  if (!wide) return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', padding: 'max(20px, env(safe-area-inset-top)) var(--gutter) max(20px, env(safe-area-inset-bottom))', maxWidth: 560, margin: '0 auto' }}>
      <div style={{ marginBottom: 'var(--s5)' }}>{progress}</div>
      <main className="stack loose page-enter" key={step} style={{ flex: 1 }}>{body}</main>
      <div style={{ marginTop: 'var(--s6)' }}>{actions}</div>
    </div>
  )

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', display: 'grid', placeItems: 'center', padding: 'var(--s10) var(--s6)' }}>
      <div className="stack loose" style={{ width: '100%', maxWidth: 560 }}>
        <div className="row" style={{ gap: 'var(--s3)', justifyContent: 'center' }}>
          <span className="brand-mark" aria-hidden><Waves size={20} /></span>
          <span className="strong">{t('brandShort')} <span className="muted" style={{ fontWeight: 500 }}>· {t('appName')}</span></span>
        </div>
        <div className="card stack loose" style={{ padding: 'var(--s8)' }}>
          {progress}
          <main className="stack loose page-enter" key={step}>{body}</main>
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 'var(--s5)' }}>{actions}</div>
        </div>
        {step === 0 && <GloomDevCredit />}
      </div>
    </div>
  )
}
