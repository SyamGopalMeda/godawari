import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, LogIn, Waves } from 'lucide-react'
import { api, type User } from '../../api'
import { useLang } from '../../i18n'
import { useStore } from '../../store'
import { Field, Notice } from '../../components/ui'

export default function AdminLogin() {
  const { loginWithToken } = useStore()
  const { t } = useLang()
  const nav = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true); setErr(null)
    try {
      const r = await api.post<{ access_token: string; user: User }>('/auth/login', { username, password })
      loginWithToken(r.access_token, r.user)
      nav(r.user.role === 'volunteer' ? '/staff' : '/admin')
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', padding: 'max(24px, 8vh) 16px 32px' }}>
      <div className="narrow-sm stack">
        <div className="row" style={{ gap: 12 }}>
          <span className="brand-mark" aria-hidden><Waves size={20} /></span>
          <div style={{ lineHeight: 1.25 }}><div className="strong">{t('appName')}</div><div className="muted xs">{t('tagline')} · Control room</div></div>
        </div>
        <form className="card stack" onSubmit={submit}>
          <div>
            <h1 style={{ fontSize: 'var(--fs-2xl)' }}>Staff sign in</h1>
            <div className="muted small" style={{ marginTop: 4 }}>Control room, help desks and field staff. Pilgrims sign in with their phone number in the app.</div>
          </div>
          <Field label="Username" htmlFor="u"><input id="u" className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required /></Field>
          <Field label="Password" htmlFor="p"><input id="p" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
          {err && <div className="err" role="alert">{err}</div>}
          <button className="btn primary big block" disabled={busy} aria-busy={busy || undefined}>{busy ? <span className="spin" aria-hidden /> : <LogIn size={18} aria-hidden />}{t('login')}</button>
          <div className="row between wrap" style={{ gap: 8 }}>
            <Link to="/login?mode=forgot" className="btn ghost sm">Forgot password?</Link>
          </div>
          <Notice>Staff with a registered mobile number can sign in with that number and reset a forgotten password by OTP. Accounts without a mobile number are reset by an administrator.</Notice>
        </form>
        <Link to="/" className="btn ghost sm" style={{ alignSelf: 'flex-start' }}><ArrowLeft size={16} aria-hidden />Pilgrim app</Link>
      </div>
    </div>
  )
}
