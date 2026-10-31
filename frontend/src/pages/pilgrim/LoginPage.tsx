/* Phone OTP login: two short steps, inline validation, resend countdown, duplicate-tap safe. */
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { KeyRound, MessageSquareText, Smartphone, Waves } from 'lucide-react'
import { api, ApiError, type User } from '../../api'
import { useLang } from '../../i18n'
import { useStore } from '../../store'
import { Field, Notice, SubmitButton, useSubmit, useToast } from '../../components/ui'

const digits = (s: string) => s.replace(/\D/g, '')
function localTen(s: string) { const d = digits(s); return d.length === 12 && d.startsWith('91') ? d.slice(2) : d }

export default function LoginPage() {
  const { t, tr } = useLang()
  const { loginWithToken } = useStore()
  const nav = useNavigate()
  const toast = useToast()
  const [params] = useSearchParams()
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [devOtp, setDevOtp] = useState<string | null>(null)
  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [touched, setTouched] = useState(false)
  const [wait, setWait] = useState(0)
  const send = useSubmit<{ sent: boolean; dev_otp?: string }>()
  const verify = useSubmit<{ access_token: string; user: User }>()

  useEffect(() => { if (wait <= 0) return; const id = window.setTimeout(() => setWait((w) => w - 1), 1000); return () => clearTimeout(id) }, [wait])

  const ten = localTen(phone)
  const phoneOk = /^[6-9]\d{9}$/.test(ten)
  const phoneErr = touched && !phoneOk ? tr({ te: '10 అంకెల మొబైల్ నంబర్ నమోదు చేయండి', hi: '10 अंकों का मोबाइल नंबर दर्ज करें', en: 'Enter a 10-digit mobile number' }) : null

  const friendly = (e: string | null) => {
    if (!e) return null
    return e
  }
  const mapErr = (err: unknown) => {
    const s = (err as ApiError).status
    if (s === 429) return tr({ te: 'చాలా ప్రయత్నాలు. కొంతసేపటి తర్వాత ప్రయత్నించండి.', hi: 'बहुत प्रयास हुए। कुछ देर बाद प्रयास करें।', en: 'Too many attempts. Please try again later.' })
    if (s === 503) return tr({ te: 'SMS పంపలేకపోయాం. మళ్ళీ ప్రయత్నించండి.', hi: 'SMS नहीं भेजा जा सका। फिर से कोशिश करें।', en: 'SMS could not be sent. Please try again.' })
    if (s === 400) return tr({ te: 'OTP తప్పు లేదా గడువు ముగిసింది.', hi: 'OTP गलत है या समाप्त हो गया।', en: 'The OTP is wrong or has expired.' })
    return (err as Error).message
  }

  const doSend = async () => {
    setTouched(true)
    if (!phoneOk) return
    const r = await send.run(async () => { try { return await api.post<{ sent: boolean; dev_otp?: string }>('/auth/otp/request', { phone: ten }) } catch (e) { throw new Error(mapErr(e)) } })
    if (r) { setDevOtp(r.dev_otp ?? null); setStep('otp'); setCode(''); setWait(30) }
  }
  const doVerify = async () => {
    const r = await verify.run(async () => { try { return await api.post<{ access_token: string; user: User }>('/auth/otp/verify', { phone: ten, code, name: name.trim() || undefined }) } catch (e) { throw new Error(mapErr(e)) } })
    if (r) {
      loginWithToken(r.access_token, r.user)
      toast(tr({ te: 'లాగిన్ అయ్యారు', hi: 'लॉगिन हो गया', en: 'Logged in' }))
      nav(params.get('next') || '/', { replace: true })
    }
  }

  return (
    <div className="narrow-sm stack loose" style={{ marginTop: 'clamp(0px, 6vh, 64px)' }}>
      <div className="card stack loose" style={{ padding: 'clamp(20px, 4vw, 36px)' }}>
      <div className="stack tight" style={{ alignItems: 'flex-start' }}>
        <span className="brand-mark" aria-hidden><Waves size={20} /></span>
        <h1 style={{ marginTop: 'var(--s3)' }}>{t('login')}</h1>
        <p className="small muted">{tr({ te: 'మొబైల్ నంబర్‌కు వచ్చే OTPతో - పాస్‌వర్డ్ అవసరం లేదు', hi: 'मोबाइल पर आए OTP से - पासवर्ड नहीं चाहिए', en: 'With an OTP sent to your mobile – no password' })}</p>
      </div>

      {step === 'phone' ? (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void doSend() }} noValidate>
          <Field label={t('phone')} htmlFor="phone" error={phoneErr ?? friendly(send.error)}>
            <div className="row" style={{ gap: 0 }}>
              <span className="input" aria-hidden style={{ width: 'auto', flexShrink: 0, borderRadius: 'var(--r-md) 0 0 var(--r-md)', borderRight: 0, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', fontWeight: 600, color: 'var(--text-2)' }}>+91</span>
              <input id="phone" className="input" style={{ borderRadius: '0 var(--r-md) var(--r-md) 0' }} inputMode="tel" autoComplete="tel-national" placeholder="98765 43210"
                value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={() => setTouched(true)} aria-invalid={!!phoneErr || undefined} maxLength={16} />
            </div>
          </Field>
          <Field label={t('name')} htmlFor="name" optional>
            <input id="name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </Field>
          <SubmitButton type="submit" busy={send.busy}><MessageSquareText size={20} aria-hidden />{t('sendOtp')}</SubmitButton>
        </form>
      ) : (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); if (code.length >= 4) void doVerify() }} noValidate>
          <p className="small"><Smartphone size={16} aria-hidden style={{ verticalAlign: '-3px', marginRight: 4 }} />
            {tr({ te: 'OTP పంపిన నంబర్', hi: 'OTP भेजा गया', en: 'OTP sent to' })} <strong>+91 ••••••{ten.slice(-4)}</strong>
          </p>
          {devOtp && (
            <div className="notice warn" role="status">
              <KeyRound size={18} aria-hidden />
              <div className="grow">
                <div className="xs strong">DEV MODE – SMS not configured</div>
                <div>{tr({ te: 'మీ OTP', hi: 'आपका OTP', en: 'Your OTP' })}: <strong style={{ fontSize: 'var(--fs-xl)', letterSpacing: 3 }}>{devOtp}</strong></div>
              </div>
            </div>
          )}
          <Field label={t('enterOtp')} htmlFor="otp" error={friendly(verify.error)}>
            <input id="otp" className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus
              style={{ fontSize: 'var(--fs-2xl)', letterSpacing: 10, textAlign: 'center', fontWeight: 700 }}
              value={code} onChange={(e) => setCode(digits(e.target.value))} aria-invalid={!!verify.error || undefined} />
          </Field>
          <SubmitButton type="submit" busy={verify.busy} disabled={code.length < 4}>{t('verify')}</SubmitButton>
          <div className="row between wrap">
            <button type="button" className="btn ghost sm" disabled={wait > 0 || send.busy} onClick={() => void doSend()}>
              {wait > 0 ? tr({ te: `${wait} సె. తర్వాత మళ్ళీ పంపండి`, hi: `${wait} से. बाद फिर भेजें`, en: `Resend in ${wait}s` }) : tr({ te: 'OTP మళ్ళీ పంపండి', hi: 'OTP फिर भेजें', en: 'Resend OTP' })}
            </button>
            <button type="button" className="btn ghost sm" onClick={() => { setStep('phone'); setCode(''); verify.setError(null) }}>{tr({ te: 'నంబర్ మార్చు', hi: 'नंबर बदलें', en: 'Change number' })}</button>
          </div>
        </form>
      )}
      </div>

      <Notice>
        {tr({ te: 'లాగిన్ ఎందుకు? కుటుంబ ట్రాకింగ్, తప్పిపోయిన వారి నివేదికలు, డిజిటల్ పార్కింగ్ పాస్ కోసం మాత్రమే. ఫోన్ నంబర్ ధృవీకరణ తప్పుడు నివేదికలను నివారిస్తుంది.', hi: 'लॉगिन क्यों? केवल परिवार ट्रैकिंग, गुमशुदगी रिपोर्ट और डिजिटल पार्किंग पास के लिए। फ़ोन सत्यापन झूठी रिपोर्ट रोकता है।', en: 'Why log in? Only for family tracking, missing-person reports and digital parking passes. A verified phone number helps prevent false reports.' })}
      </Notice>
    </div>
  )
}
