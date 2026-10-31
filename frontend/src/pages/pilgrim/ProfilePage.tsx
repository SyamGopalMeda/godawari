/* Profile: account, language, display (sunlight/large text), permissions, privacy, staff links, about.
   Phones: one column in that order. Tablet/desktop: two columns of cards, About full width below. */
import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Bell, Briefcase, Camera, Info, Languages, LocateFixed, LogIn, LogOut, MapPinned, MonitorCog, MonitorSmartphone, RotateCcw, ShieldCheck, Trash2,
  UserRound, UsersRound, type LucideIcon,
} from 'lucide-react'
import { api, type User } from '../../api'
import { useLang } from '../../i18n'
import { useStore } from '../../store'
import { useMyLocation, type Perm } from '../../location'
import { usePrefs } from '../../prefs'
import { GloomDevCredit } from '../../components/brand'
import { ONBOARDED_KEY } from '../../components/Shell'
import { Avatar, Field, LangSwitch, ListRow, Notice, PageHead, Sheet, SubmitButton, useSubmit, useToast } from '../../components/ui'
import { ChoosePlaceSheet } from './HomePage'

const FLUSH_LIST = { border: 0, borderRadius: 0, boxShadow: 'none' } as const

/** Card with a titled header. `flush` = body is an edge-to-edge grouped list. */
function Card({ title, icon: I, children, flush }: { title: string; icon: LucideIcon; children: ReactNode; flush?: boolean }) {
  return (
    <section className="card" style={flush ? { padding: 0, overflow: 'hidden' } : undefined} aria-label={title}>
      <div className="card-head" style={flush ? { margin: 0, padding: 'var(--s4) var(--s5)', borderBottom: '1px solid var(--line)' } : undefined}>
        <h2 className="row" style={{ gap: 'var(--s2)' }}><I size={18} aria-hidden style={{ color: 'var(--brand-ink)' }} />{title}</h2>
      </div>
      {children}
    </section>
  )
}

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className={`check ${checked ? 'on' : ''}`} style={{ borderRadius: 0, border: 0, padding: 'var(--s3) var(--s5)' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="grow"><span className="strong">{label}</span>{hint && <span className="xs muted" style={{ display: 'block' }}>{hint}</span>}</span>
    </label>
  )
}

export default function ProfilePage() {
  const { t, tr } = useLang()
  const { user, logout, refreshUser } = useStore()
  const { perm, pos, requestGps, requesting } = useMyLocation()
  const { prefs, set } = usePrefs()
  const toast = useToast()
  const nav = useNavigate()
  const [name, setName] = useState(user?.name ?? '')
  const [confirmOut, setConfirmOut] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [choose, setChoose] = useState(false)
  const save = useSubmit<User>()

  const permText: Record<Perm, string> = {
    granted: tr({ te: 'అనుమతించబడింది', hi: 'अनुमति है', en: 'Allowed' }),
    denied: tr({ te: 'నిరాకరించబడింది', hi: 'अस्वीकृत', en: 'Blocked' }),
    prompt: tr({ te: 'ఇంకా అడగలేదు', hi: 'अभी नहीं पूछा', en: 'Not asked yet' }),
    unknown: tr({ te: 'తెలియదు', hi: 'अज्ञात', en: 'Unknown' }),
    unsupported: tr({ te: 'ఈ ఫోన్‌లో లేదు', hi: 'इस फ़ोन पर नहीं', en: 'Not supported' }),
  }
  const source = pos?.source === 'gps' ? t('gpsFix') : pos?.source === 'manual' ? `${t('chosenPlace')}: ${pos.label}` : t('locationOff')

  const saveName = async () => {
    const r = await save.run(() => api.patch<User>('/auth/me', { name: name.trim() || null }))
    if (r) { await refreshUser(); toast(t('saved')) }
  }
  const clearLocal = () => {
    try {
      const keys: string[] = []
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('ps.') && k !== 'ps.token' && k !== 'ps.lang') keys.push(k) }
      keys.forEach((k) => localStorage.removeItem(k))
    } catch { /* ignore */ }
    toast(tr({ te: 'ఈ ఫోన్‌లోని డేటా తొలగించబడింది', hi: 'इस फ़ोन का डेटा हटाया गया', en: 'Data on this phone cleared' }))
    window.setTimeout(() => window.location.reload(), 700)
  }

  const account = (
    <Card title={t('account')} icon={UserRound}>
      {user ? (
        <div className="stack">
          <div className="row" style={{ gap: 'var(--s3)' }}>
            <Avatar name={user.name || user.phone || user.role} />
            <div className="grow">
              <div className="strong">{user.name || user.phone || '—'}</div>
              {user.name && user.phone && <div className="small muted">{user.phone}</div>}
            </div>
            <span className={`chip ${user.role === 'pilgrim' ? 'info' : 'copper'}`}>{user.role}</span>
          </div>
          <Field label={t('name')} htmlFor="pname" optional error={save.error}>
            <input id="pname" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={120} />
          </Field>
          <div className="row wrap">
            <SubmitButton className="btn primary grow" onClick={() => void saveName()} busy={save.busy} disabled={name.trim() === (user.name ?? '')}>{t('save')}</SubmitButton>
            <button className="btn grow" onClick={() => setConfirmOut(true)}><LogOut size={18} aria-hidden />{t('logout')}</button>
          </div>
        </div>
      ) : (
        <div className="stack">
          <p className="small muted">{tr({ te: 'కుటుంబ ట్రాకింగ్, తప్పిపోయిన వారి నివేదికలు, డిజిటల్ పార్కింగ్ పాస్ కోసం ఫోన్ నంబర్‌తో లాగిన్ అవ్వండి. రద్దీ, మ్యాప్, సౌకర్యాలు లాగిన్ లేకుండానే పనిచేస్తాయి.', hi: 'परिवार ट्रैकिंग, गुमशुदगी रिपोर्ट और डिजिटल पार्किंग पास के लिए फ़ोन नंबर से लॉगिन करें। भीड़, नक्शा और सुविधाएँ बिना लॉगिन के काम करती हैं।', en: 'Log in with your phone number for family tracking, missing-person reports and digital parking passes. Crowd, map and facilities work without logging in.' })}</p>
          <div className="row wrap">
            <Link to="/login?next=/profile" className="btn primary grow"><LogIn size={18} aria-hidden />{t('login')}</Link>
            <Link to="/admin/login" className="btn grow"><Briefcase size={18} aria-hidden />{tr({ te: 'సిబ్బంది లాగిన్', hi: 'कर्मचारी लॉगिन', en: 'Staff login' })}</Link>
          </div>
        </div>
      )}
    </Card>
  )

  const language = (
    <Card title={t('language')} icon={Languages}>
      <div className="stack tight">
        <p className="small muted">{tr({ te: 'యాప్ అంతా ఈ భాషలో', hi: 'पूरा ऐप इस भाषा में', en: 'The whole app uses this language' })}</p>
        <LangSwitch light={false} />
      </div>
    </Card>
  )

  const display = (
    <Card title={t('display')} icon={MonitorSmartphone} flush>
      <div className="list grouped" style={FLUSH_LIST}>
        <Toggle label={t('largeText')} checked={prefs.text === 'large'} onChange={(v) => set('text', v ? 'large' : 'normal')} />
        <Toggle label={t('highContrast')} checked={prefs.contrast === 'high'} onChange={(v) => set('contrast', v ? 'high' : 'normal')} hint={tr({ te: 'ఎండలో చదవడానికి సులభం', hi: 'धूप में पढ़ने में आसान', en: 'Easier to read in bright sunlight' })} />
        <Toggle label={t('darkTheme')} checked={prefs.theme === 'dark'} onChange={(v) => set('theme', v ? 'dark' : 'light')} />
        <Toggle label={t('vibration')} checked={prefs.haptics} onChange={(v) => set('haptics', v)} />
      </div>
    </Card>
  )

  const permissions = (
    <Card title={t('permissions')} icon={LocateFixed} flush>
      <div className="list grouped" style={FLUSH_LIST}>
        <ListRow icon={<LocateFixed size={20} />} title={t('myLocation')} meta={<><span>{permText[perm]}</span><span>· {source}</span></>}
          trail={perm !== 'denied' && perm !== 'unsupported' && pos?.source !== 'gps' ? (
            <button className="btn sm tonal" onClick={() => void requestGps()} disabled={requesting}>{requesting ? <span className="spin" aria-hidden /> : null}{tr({ te: 'ఆన్ చేయి', hi: 'चालू करें', en: 'Turn on' })}</button>
          ) : undefined} />
        {perm === 'denied' && (
          <div style={{ padding: 'var(--s3) var(--s5)' }}>
            <p className="small muted">{tr({ te: 'మళ్ళీ అనుమతించడానికి: బ్రౌజర్ చిరునామా పట్టీలో తాళం గుర్తు నొక్కి → అనుమతులు → స్థానం → అనుమతించు.', hi: 'फिर से अनुमति देने के लिए: ब्राउज़र पता बार में ताला चिह्न → अनुमतियाँ → स्थान → अनुमति दें।', en: 'To allow again: tap the lock icon in the browser address bar → Permissions → Location → Allow.' })}</p>
          </div>
        )}
        <ListRow icon={<MapPinned size={20} />} title={t('iAmNear')} meta={pos?.source === 'manual' ? pos.label : t('chooseManually')} onClick={() => setChoose(true)} chevron />
        <ListRow icon={<Camera size={20} />} title={tr({ te: 'కెమెరా', hi: 'कैमरा', en: 'Camera' })} meta={tr({ te: 'QR కోడ్ స్కాన్ చేసినప్పుడు మాత్రమే అడుగుతాం', hi: 'केवल QR कोड स्कैन करते समय पूछा जाता है', en: 'Asked only when you scan a QR code' })} />
        <ListRow icon={<Bell size={20} />} title={t('notifications')} meta={tr({ te: 'యాప్‌లో సూచనలు మాత్రమే; పుష్ ఇంకా అందుబాటులో లేదు', hi: 'केवल ऐप में सूचनाएँ; पुश अभी उपलब्ध नहीं', en: 'In-app alerts only; push not available yet' })} />
      </div>
    </Card>
  )

  const privacy = (
    <Card title={t('privacy')} icon={ShieldCheck} flush>
      <p className="small" style={{ padding: 'var(--s4) var(--s5)', color: 'var(--text-2)' }}>
        {tr({ te: 'రిస్ట్‌బ్యాండ్‌లు అనుమతితో మాత్రమే లింక్ అవుతాయి మరియు చెక్‌పాయింట్ల వద్ద మాత్రమే గుర్తించబడతాయి. ప్రతి వీక్షణ నమోదు అవుతుంది. పుష్కరాలు ముగిసిన 30 రోజుల్లో డేటా తొలగించబడుతుంది. మీరు కుటుంబంతో పంచుకుంటే తప్ప మీ స్థానం సర్వర్‌లో నిల్వ చేయబడదు.', hi: 'रिस्टबैंड केवल सहमति से जुड़ते हैं और केवल चेकपॉइंट पर पढ़े जाते हैं। हर लुकअप दर्ज होता है। पुष्करालु के 30 दिन बाद डेटा हटता है। जब तक आप परिवार से साझा न करें, आपका स्थान सर्वर पर नहीं रखा जाता।', en: 'Wristbands are linked only with consent and detected only at checkpoints. Every lookup is recorded. Data is deleted 30 days after the festival. Your location is not stored on the server unless you share it with your family.' })}
      </p>
      <div className="list grouped" style={{ ...FLUSH_LIST, borderTop: '1px solid var(--line)' }}>
        <ListRow to="/family" icon={<UsersRound size={20} />} title={tr({ te: 'కుటుంబం & రిస్ట్‌బ్యాండ్ లింక్‌లు నిర్వహించు', hi: 'परिवार व रिस्टबैंड लिंक प्रबंधित करें', en: 'Manage family & wristband links' })} chevron />
        <ListRow onClick={() => setConfirmClear(true)} icon={<Trash2 size={20} />} tone="danger" title={tr({ te: 'ఈ ఫోన్‌లో సేవ్ చేసిన డేటా తొలగించు', hi: 'इस फ़ोन पर सहेजा डेटा हटाएँ', en: 'Clear data saved on this phone' })} chevron />
      </div>
    </Card>
  )

  const staff = user && user.role !== 'pilgrim' ? (
    <Card title={t('staffMode')} icon={Briefcase} flush>
      <div className="list grouped" style={FLUSH_LIST}>
        <ListRow to="/staff" icon={<Briefcase size={20} />} title={t('staffMode')} chevron />
        {(user.role === 'staff' || user.role === 'admin') && <ListRow to="/admin" icon={<MonitorCog size={20} />} title={t('admin')} chevron />}
      </div>
    </Card>
  ) : null

  return (
    <div className="stack loose">
      <PageHead title={t('profile')} back={false} sub={tr({ te: 'ఖాతా, భాష, ప్రదర్శన మరియు గోప్యత', hi: 'खाता, भाषा, प्रदर्शन और गोपनीयता', en: 'Account, language, display and privacy' })} />

      <div className="cols-2">
        <div className="stack loose" style={{ minWidth: 0 }}>{account}{language}{display}</div>
        <div className="stack loose" style={{ minWidth: 0 }}>{permissions}{privacy}{staff}</div>
      </div>

      <Card title={tr({ te: 'యాప్ గురించి', hi: 'ऐप के बारे में', en: 'About' })} icon={Info}>
        <div className="cols-2" style={{ alignItems: 'center' }}>
          <div className="stack tight">
            <div className="strong">Pushkar Sahayam v2.0</div>
            <div className="small muted">Godavari Pushkaralu 2027</div>
            <Notice icon={Info}>{t('demoNote')}</Notice>
            <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => { try { localStorage.removeItem(ONBOARDED_KEY) } catch { /* ignore */ } nav('/welcome') }}>
              <RotateCcw size={18} aria-hidden />{tr({ te: 'పరిచయం మళ్ళీ చూపించు', hi: 'परिचय फिर दिखाएँ', en: 'Show introduction again' })}
            </button>
          </div>
          <GloomDevCredit />
        </div>
      </Card>

      <Sheet open={confirmOut} onClose={() => setConfirmOut(false)} title={tr({ te: 'లాగ్ అవుట్ చేయాలా?', hi: 'लॉग आउट करें?', en: 'Log out?' })}>
        <div className="stack">
          <p className="small muted">{tr({ te: 'కుటుంబ ట్రాకింగ్ చూడటానికి మళ్ళీ OTPతో లాగిన్ అవ్వాలి.', hi: 'परिवार ट्रैकिंग देखने के लिए फिर से OTP से लॉगिन करना होगा।', en: 'You will need to log in again with OTP to see family tracking.' })}</p>
          <button className="btn danger big block" onClick={() => { logout(); setConfirmOut(false); toast(t('logout')); nav('/') }}><LogOut size={20} aria-hidden />{t('logout')}</button>
          <button className="btn block" onClick={() => setConfirmOut(false)}>{t('cancel')}</button>
        </div>
      </Sheet>

      <Sheet open={confirmClear} onClose={() => setConfirmClear(false)} title={tr({ te: 'ఈ ఫోన్ డేటా తొలగించాలా?', hi: 'इस फ़ोन का डेटा हटाएँ?', en: 'Clear data on this phone?' })}>
        <div className="stack">
          <p className="small muted">{tr({ te: 'సేవ్ చేసిన స్థితి, ఎంచుకున్న ప్రదేశం, ప్రదర్శన సెట్టింగ్‌లు, పార్కింగ్ స్థలం తొలగించబడతాయి. మీ లాగిన్, భాష అలాగే ఉంటాయి.', hi: 'सहेजी स्थिति, चुना स्थान, प्रदर्शन सेटिंग और पार्किंग जगह हटेगी। लॉगिन और भाषा बनी रहेगी।', en: 'Saved status, chosen place, display settings and saved parking spot will be removed. Your login and language stay.' })}</p>
          <button className="btn danger big block" onClick={clearLocal}><Trash2 size={20} aria-hidden />{tr({ te: 'తొలగించు', hi: 'हटाएँ', en: 'Clear' })}</button>
          <button className="btn block" onClick={() => setConfirmClear(false)}>{t('cancel')}</button>
        </div>
      </Sheet>

      <ChoosePlaceSheet open={choose} onClose={() => setChoose(false)} />
    </div>
  )
}
