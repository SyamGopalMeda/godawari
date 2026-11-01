/* Sign in with mobile number + password; create an account (mobile confirmed by OTP); forgot password (OTP to the
   registered mobile, then a new password). In demo mode (no SMS gateway) the API returns the OTP and it is shown
   on screen, clearly labelled. Duplicate-tap safe, inline validation, resend countdown. */
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Eye, EyeOff, KeyRound, LogIn, MessageSquareText, Smartphone, UserPlus, Waves } from 'lucide-react'
import { api, ApiError, type User } from '../../api'
import { useLang } from '../../i18n'
import { useStore } from '../../store'
import { Field, Notice, SubmitButton, useSubmit, useToast } from '../../components/ui'
import { track } from '../../firebase'

type Mode = 'login' | 'register' | 'forgot'
type Tok = { access_token: string; user: User }
const digits = (s: string) => s.replace(/\D/g, '')
function localTen(s: string) { const d = digits(s); return d.length === 12 && d.startsWith('91') ? d.slice(2) : d }
const strong = (p: string) => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p)

function PasswordInput({ id, value, onChange, autoComplete, invalid }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string; invalid?: boolean }) {
  const { tr } = useLang()
  const [show, setShow] = useState(false)
  return (
    <div className="row" style={{ gap: 0, position: 'relative' }}>
      <input id={id} className="input" type={show ? 'text' : 'password'} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid || undefined} maxLength={200} style={{ paddingRight: 52 }} />
      <button type="button" className="btn icon ghost" onClick={() => setShow((s) => !s)} style={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)' }}
        aria-label={show ? tr({ te: 'పాస్‌వర్డ్ దాచు', hi: 'पासवर्ड छिपाएँ', en: 'Hide password' }) : tr({ te: 'పాస్‌వర్డ్ చూపు', hi: 'पासवर्ड दिखाएँ', en: 'Show password' })} aria-pressed={show}>
        {show ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
      </button>
    </div>
  )
}

export default function LoginPage() {
  const { t, tr } = useLang()
  const { loginWithToken } = useStore()
  const nav = useNavigate()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const mode: Mode = (['register', 'forgot'].includes(params.get('mode') ?? '') ? params.get('mode') : 'login') as Mode
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [code, setCode] = useState('')
  const [devOtp, setDevOtp] = useState<string | null>(null)
  const [step, setStep] = useState<'form' | 'otp'>('form')
  const [touched, setTouched] = useState(false)
  const [wait, setWait] = useState(0)
  const send = useSubmit<{ sent: boolean; dev_otp?: string }>()
  const submit = useSubmit<Tok>()

  useEffect(() => { if (wait <= 0) return; const id = window.setTimeout(() => setWait((w) => w - 1), 1000); return () => clearTimeout(id) }, [wait])
  // switching mode starts that flow fresh (keep the phone number)
  useEffect(() => { setStep('form'); setCode(''); setDevOtp(null); setPassword(''); setConfirm(''); setTouched(false); send.setError(null); submit.setError(null) }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const go = (m: Mode) => { const p = new URLSearchParams(params); if (m === 'login') p.delete('mode'); else p.set('mode', m); setParams(p, { replace: true }) }

  const ten = localTen(phone)
  const phoneOk = /^[6-9]\d{9}$/.test(ten)
  const phoneErr = touched && !phoneOk ? tr({ te: '10 అంకెల మొబైల్ నంబర్ నమోదు చేయండి', hi: '10 अंकों का मोबाइल नंबर दर्ज करें', en: 'Enter a 10-digit mobile number' }) : null
  const needsNew = mode !== 'login'
  const pwErr = touched && needsNew && !strong(password) ? tr({ te: 'కనీసం 8 అక్షరాలు, ఒక అక్షరం మరియు ఒక అంకె ఉండాలి', hi: 'कम से कम 8 अक्षर, एक अक्षर और एक अंक होना चाहिए', en: 'At least 8 characters, with a letter and a number' }) : null
  const confirmErr = touched && needsNew && confirm !== password ? tr({ te: 'పాస్‌వర్డ్‌లు సరిపోలలేదు', hi: 'पासवर्ड मेल नहीं खाते', en: 'Passwords do not match' }) : null

  const mapErr = (err: unknown) => {
    const e = err as ApiError
    if (e.status === 429) return e.message || tr({ te: 'చాలా ప్రయత్నాలు. కొంతసేపటి తర్వాత ప్రయత్నించండి.', hi: 'बहुत प्रयास हुए। कुछ देर बाद प्रयास करें।', en: 'Too many attempts. Please try again later.' })
    if (e.status === 503) return tr({ te: 'SMS పంపలేకపోయాం. మళ్ళీ ప్రయత్నించండి.', hi: 'SMS नहीं भेजा जा सका। फिर से कोशिश करें।', en: 'SMS could not be sent. Please try again.' })
    if (e.status === 400) return tr({ te: 'OTP తప్పు లేదా గడువు ముగిసింది.', hi: 'OTP गलत है या समाप्त हो गया।', en: 'The OTP is wrong or has expired.' })
    if (e.status === 401 && mode === 'login' && !/Forgot/.test(e.message)) return tr({ te: 'మొబైల్ నంబర్ లేదా పాస్‌వర్డ్ తప్పు.', hi: 'मोबाइल नंबर या पासवर्ड गलत है।', en: 'Wrong mobile number or password.' })
    return e.message
  }

  const finish = (r: Tok, msg: string, event: string) => {
    loginWithToken(r.access_token, r.user)
    track(event, { method: 'password' })
    toast(msg)
    nav(params.get('next') || '/', { replace: true })
  }

  const doLogin = async () => {
    setTouched(true)
    if (!phoneOk || !password) return
    const r = await submit.run(async () => { try { return await api.post<Tok>('/auth/login', { username: ten, password }) } catch (e) { throw new Error(mapErr(e)) } })
    if (r) finish(r, tr({ te: 'లాగిన్ అయ్యారు', hi: 'लॉगिन हो गया', en: 'Logged in' }), 'login')
  }
  const doSend = async () => {
    setTouched(true)
    if (!phoneOk || (needsNew && step === 'form' && mode === 'register' && (!strong(password) || confirm !== password))) return
    const r = await send.run(async () => { try { return await api.post<{ sent: boolean; dev_otp?: string }>('/auth/otp/request', { phone: ten }) } catch (e) { throw new Error(mapErr(e)) } })
    if (r) { setDevOtp(r.dev_otp ?? null); setStep('otp'); setCode(''); setWait(30); setTouched(false) }
  }
  const doConfirm = async () => {
    if (code.length < 4) return
    if (mode === 'forgot') {
      setTouched(true)
      if (!strong(password) || confirm !== password) return
      const r = await submit.run(async () => { try { return await api.post<Tok>('/auth/password/reset', { phone: ten, code, new_password: password }) } catch (e) { throw new Error(mapErr(e)) } })
      if (r) finish(r, tr({ te: 'కొత్త పాస్‌వర్డ్ సెట్ అయింది', hi: 'नया पासवर्ड सेट हो गया', en: 'New password set' }), 'password_reset')
    } else {
      const r = await submit.run(async () => { try { return await api.post<Tok>('/auth/register', { phone: ten, code, password, name: name.trim() || undefined }) } catch (e) { throw new Error(mapErr(e)) } })
      if (r) finish(r, tr({ te: 'ఖాతా సృష్టించబడింది', hi: 'खाता बन गया', en: 'Account created' }), 'sign_up')
    }
  }

  const phoneField = (
    <Field label={t('phone')} htmlFor="phone" error={phoneErr}>
      <div className="row" style={{ gap: 0 }}>
        <span className="input" aria-hidden style={{ width: 'auto', flexShrink: 0, borderRadius: 'var(--r-md) 0 0 var(--r-md)', borderRight: 0, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', fontWeight: 600, color: 'var(--text-2)' }}>+91</span>
        <input id="phone" className="input" style={{ borderRadius: '0 var(--r-md) var(--r-md) 0' }} inputMode="tel" autoComplete="tel-national" placeholder="98765 43210"
          value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={() => setTouched(true)} aria-invalid={!!phoneErr || undefined} maxLength={16} />
      </div>
    </Field>
  )
  const newPasswordFields = (
    <>
      <Field label={mode === 'forgot' ? tr({ te: 'కొత్త పాస్‌వర్డ్', hi: 'नया पासवर्ड', en: 'New password' }) : tr({ te: 'పాస్‌వర్డ్', hi: 'पासवर्ड', en: 'Password' })} htmlFor="pw" error={pwErr}
        hint={tr({ te: 'కనీసం 8 అక్షరాలు, ఒక అక్షరం మరియు ఒక అంకె', hi: 'कम से कम 8 अक्षर, एक अक्षर और एक अंक', en: 'At least 8 characters, with a letter and a number' })}>
        <PasswordInput id="pw" value={password} onChange={setPassword} autoComplete="new-password" invalid={!!pwErr} />
      </Field>
      <Field label={tr({ te: 'పాస్‌వర్డ్ మళ్ళీ', hi: 'पासवर्ड दोबारा', en: 'Confirm password' })} htmlFor="pw2" error={confirmErr}>
        <PasswordInput id="pw2" value={confirm} onChange={setConfirm} autoComplete="new-password" invalid={!!confirmErr} />
      </Field>
    </>
  )
  const otpStep = (extra?: ReactNode) => (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); void doConfirm() }} noValidate>
      <p className="small"><Smartphone size={16} aria-hidden style={{ verticalAlign: '-3px', marginRight: 4 }} />
        {tr({ te: 'OTP పంపిన నంబర్', hi: 'OTP भेजा गया', en: 'OTP sent to' })} <strong>+91 ••••••{ten.slice(-4)}</strong>
      </p>
      {devOtp && (
        <div className="notice warn" role="status">
          <KeyRound size={18} aria-hidden />
          <div className="grow">
            <div className="xs strong">{tr({ te: 'డెమో మోడ్ – SMS ఇంకా కాన్ఫిగర్ కాలేదు', hi: 'डेमो मोड – SMS अभी कॉन्फ़िगर नहीं है', en: 'Demo mode – SMS not configured yet' })}</div>
            <div>{tr({ te: 'మీ OTP', hi: 'आपका OTP', en: 'Your OTP' })}: <strong style={{ fontSize: 'var(--fs-xl)', letterSpacing: 3 }}>{devOtp}</strong></div>
          </div>
        </div>
      )}
      <Field label={t('enterOtp')} htmlFor="otp">
        <input id="otp" className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus
          style={{ fontSize: 'var(--fs-2xl)', letterSpacing: 10, textAlign: 'center', fontWeight: 700 }}
          value={code} onChange={(e) => setCode(digits(e.target.value))} />
      </Field>
      {extra}
      {submit.error && <div className="err" role="alert">{submit.error}</div>}
      <SubmitButton type="submit" busy={submit.busy} disabled={code.length < 4}>
        {mode === 'forgot' ? <><KeyRound size={20} aria-hidden />{tr({ te: 'పాస్‌వర్డ్ సెట్ చేసి లాగిన్ అవ్వండి', hi: 'पासवर्ड सेट करें और लॉगिन करें', en: 'Set password and sign in' })}</> : <><UserPlus size={20} aria-hidden />{tr({ te: 'ఖాతా సృష్టించండి', hi: 'खाता बनाएँ', en: 'Create account' })}</>}
      </SubmitButton>
      <div className="row between wrap">
        <button type="button" className="btn ghost sm" disabled={wait > 0 || send.busy} onClick={() => void doSend()}>
          {wait > 0 ? tr({ te: `${wait} సె. తర్వాత మళ్ళీ పంపండి`, hi: `${wait} से. बाद फिर भेजें`, en: `Resend in ${wait}s` }) : tr({ te: 'OTP మళ్ళీ పంపండి', hi: 'OTP फिर भेजें', en: 'Resend OTP' })}
        </button>
        <button type="button" className="btn ghost sm" onClick={() => { setStep('form'); setCode(''); submit.setError(null) }}>{tr({ te: 'వెనక్కి', hi: 'वापस', en: 'Back' })}</button>
      </div>
    </form>
  )

  const title = mode === 'register' ? tr({ te: 'ఖాతా సృష్టించండి', hi: 'खाता बनाएँ', en: 'Create account' })
    : mode === 'forgot' ? tr({ te: 'పాస్‌వర్డ్ మర్చిపోయారా?', hi: 'पासवर्ड भूल गए?', en: 'Forgot password' }) : t('login')
  const sub = mode === 'register' ? tr({ te: 'మీ మొబైల్ నంబర్ OTPతో ధృవీకరించబడుతుంది', hi: 'आपका मोबाइल नंबर OTP से सत्यापित होगा', en: 'Your mobile number is confirmed with a one-time code (OTP)' })
    : mode === 'forgot' ? tr({ te: 'నమోదిత మొబైల్‌కు OTP పంపి కొత్త పాస్‌వర్డ్ సెట్ చేయండి', hi: 'पंजीकृत मोबाइल पर OTP भेजकर नया पासवर्ड सेट करें', en: 'We send a one-time code (OTP) to your registered mobile, then you set a new password' })
    : tr({ te: 'మొబైల్ నంబర్ మరియు పాస్‌వర్డ్‌తో', hi: 'मोबाइल नंबर और पासवर्ड से', en: 'With your mobile number and password' })

  return (
    <div className="narrow-sm stack loose" style={{ marginTop: 'clamp(0px, 6vh, 64px)' }}>
      <div className="card stack loose" style={{ padding: 'clamp(20px, 4vw, 36px)' }}>
        <div className="stack tight" style={{ alignItems: 'flex-start' }}>
          <span className="brand-mark" aria-hidden><Waves size={20} /></span>
          <h1 style={{ marginTop: 'var(--s3)' }}>{title}</h1>
          <p className="small muted">{sub}</p>
        </div>

        {mode === 'login' && (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void doLogin() }} noValidate>
            {phoneField}
            <Field label={tr({ te: 'పాస్‌వర్డ్', hi: 'पासवर्ड', en: 'Password' })} htmlFor="pw">
              <PasswordInput id="pw" value={password} onChange={setPassword} autoComplete="current-password" />
            </Field>
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: -8 }}>
              <button type="button" className="btn ghost sm" onClick={() => go('forgot')}>{tr({ te: 'పాస్‌వర్డ్ మర్చిపోయారా?', hi: 'पासवर्ड भूल गए?', en: 'Forgot password?' })}</button>
            </div>
            {submit.error && (
              <div className="err" role="alert">
                {submit.error}
                {/Forgot/.test(submit.error) && <> <button type="button" className="btn sm" onClick={() => go('forgot')}>{tr({ te: 'పాస్‌వర్డ్ సెట్ చేయండి', hi: 'पासवर्ड सेट करें', en: 'Set a password' })}</button></>}
              </div>
            )}
            <SubmitButton type="submit" busy={submit.busy} disabled={!password}><LogIn size={20} aria-hidden />{t('login')}</SubmitButton>
            <div className="row" style={{ justifyContent: 'center', gap: 6 }}>
              <span className="small muted">{tr({ te: 'ఖాతా లేదా?', hi: 'खाता नहीं है?', en: 'New here?' })}</span>
              <button type="button" className="btn ghost sm" onClick={() => go('register')}><UserPlus size={16} aria-hidden />{tr({ te: 'ఖాతా సృష్టించండి', hi: 'खाता बनाएँ', en: 'Create account' })}</button>
            </div>
          </form>
        )}

        {mode === 'register' && (step === 'form' ? (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void doSend() }} noValidate>
            {phoneField}
            <Field label={t('name')} htmlFor="name" optional>
              <input id="name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </Field>
            {newPasswordFields}
            {send.error && <div className="err" role="alert">{send.error}</div>}
            <SubmitButton type="submit" busy={send.busy}><MessageSquareText size={20} aria-hidden />{t('sendOtp')}</SubmitButton>
          </form>
        ) : otpStep())}

        {mode === 'forgot' && (step === 'form' ? (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void doSend() }} noValidate>
            {phoneField}
            {send.error && <div className="err" role="alert">{send.error}</div>}
            <SubmitButton type="submit" busy={send.busy}><MessageSquareText size={20} aria-hidden />{t('sendOtp')}</SubmitButton>
          </form>
        ) : otpStep(newPasswordFields))}

        {mode !== 'login' && (
          <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => go('login')}><ArrowLeft size={16} aria-hidden />{tr({ te: 'లాగిన్‌కు వెనక్కి', hi: 'लॉगिन पर वापस', en: 'Back to sign in' })}</button>
        )}
      </div>

      <Notice>
        {tr({ te: 'లాగిన్ ఎందుకు? కుటుంబ ట్రాకింగ్, తప్పిపోయిన వారి నివేదికలు, డిజిటల్ పార్కింగ్ పాస్ కోసం మాత్రమే. ఫోన్ నంబర్ ధృవీకరణ తప్పుడు నివేదికలను నివారిస్తుంది.', hi: 'लॉगिन क्यों? केवल परिवार ट्रैकिंग, गुमशुदगी रिपोर्ट और डिजिटल पार्किंग पास के लिए। फ़ोन सत्यापन झूठी रिपोर्ट रोकता है।', en: 'Why log in? Only for family tracking, missing-person reports and digital parking passes. A verified phone number helps prevent false reports.' })}
      </Notice>
      <Link to="/admin/login" className="btn ghost sm" style={{ alignSelf: 'center' }}>{tr({ te: 'సిబ్బంది లాగిన్', hi: 'स्टाफ़ लॉगिन', en: 'Staff sign in' })}</Link>
    </div>
  )
}
