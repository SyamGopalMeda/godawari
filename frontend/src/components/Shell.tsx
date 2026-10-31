/* Responsive app shell.
   - Phones (< 768 px): white top bar with brand + language / notifications / SOS, five bottom tabs.
   - Tablets (768–1023 px): icon rail on the left, top bar with live-data status and actions.
   - Desktop (≥ 1024 px): grouped sidebar with the GloomDev credit, top bar with status, actions and account.
   Emergency is always one tap away but never sends anything by itself; it opens the emergency screen. */
import { useState } from 'react'
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Bell, Briefcase, CircleUser, Gauge, House, Languages, LayoutGrid, LogIn, Map as MapIcon, MonitorCog, RefreshCw, SearchCheck,
  Siren, SquareParking, Users, Waves, WifiOff, type LucideIcon,
} from 'lucide-react'
import { useLang, type Key } from '../i18n'
import { useStore } from '../store'
import { Avatar, LanguagePicker, Sheet, useNow } from './ui'
import { GloomDevCredit } from './brand'
import type { Lang } from '../api'

export const ONBOARDED_KEY = 'ps.onboarded'
export function isOnboarded(): boolean { try { return localStorage.getItem(ONBOARDED_KEY) === '1' } catch { return true } }

const SHORT: Record<Lang, string> = { te: 'తె', hi: 'हि', en: 'EN' }

interface NavItem { to: string; key: Key; icon: LucideIcon; match: string[]; tone?: 'danger' }
const TABS: NavItem[] = [
  { to: '/', key: 'home', icon: House, match: ['/'] },
  { to: '/map', key: 'explore', icon: MapIcon, match: ['/map', '/crowd', '/ghats', '/places'] },
  { to: '/family', key: 'family', icon: Users, match: ['/family'] },
  { to: '/services', key: 'services', icon: LayoutGrid, match: ['/services', '/facilities', '/parking', '/missing'] },
  { to: '/profile', key: 'profile', icon: CircleUser, match: ['/profile', '/login', '/more'] },
]
const GROUPS: { label: { te: string; hi: string; en: string }; items: NavItem[] }[] = [
  { label: { te: 'అవలోకనం', hi: 'अवलोकन', en: 'Overview' }, items: [
    { to: '/', key: 'home', icon: House, match: ['/'] },
    { to: '/ghats', key: 'ghatsDirectory', icon: Waves, match: ['/ghats', '/places'] },
    { to: '/map', key: 'explore', icon: MapIcon, match: ['/map'] },
    { to: '/crowd', key: 'crowdStatus', icon: Gauge, match: ['/crowd'] },
  ] },
  { label: { te: 'సేవలు', hi: 'सेवाएँ', en: 'Services' }, items: [
    { to: '/services', key: 'facilities', icon: LayoutGrid, match: ['/services', '/facilities'] },
    { to: '/parking', key: 'parking', icon: SquareParking, match: ['/parking'] },
    { to: '/family', key: 'family', icon: Users, match: ['/family'] },
    { to: '/missing', key: 'findMissing', icon: SearchCheck, match: ['/missing'] },
  ] },
  { label: { te: 'సహాయం', hi: 'सहायता', en: 'Help' }, items: [
    { to: '/emergency', key: 'emergencyAssist', icon: Siren, match: ['/emergency'], tone: 'danger' },
    { to: '/alerts', key: 'notifications', icon: Bell, match: ['/alerts'] },
  ] },
  { label: { te: 'ఖాతా', hi: 'खाता', en: 'Account' }, items: [
    { to: '/profile', key: 'profile', icon: CircleUser, match: ['/profile', '/login', '/more'] },
  ] },
]
const TITLES: [string, Key][] = [
  ['/map', 'explore'], ['/ghats', 'ghatsDirectory'], ['/places', 'viewDetails'], ['/crowd', 'crowdStatus'], ['/parking', 'parking'], ['/services', 'services'], ['/facilities', 'facilities'],
  ['/family', 'myFamily'], ['/missing', 'findMissing'], ['/emergency', 'emergencyAssist'], ['/alerts', 'notifications'],
  ['/profile', 'profile'], ['/login', 'login'], ['/staff', 'staffMode'],
]

function isActive(pathname: string, m: string[]) { return m.some((p) => (p === '/' ? pathname === '/' : pathname.startsWith(p))) }

/** Live-data status: "Live" while the socket is connected, else the time of the data being shown. */
function DataStatus() {
  const { online, wsConnected, lastSync, syncing, reload } = useStore()
  const { t, clock, tr } = useLang()
  useNow(30000)
  if (!online) return <span className="row" style={{ color: 'var(--moderate)', gap: 6 }}><WifiOff size={16} aria-hidden />{t('offlineSince')} {clock(lastSync)}</span>
  if (wsConnected) return <span className="fresh live" style={{ fontSize: 'var(--fs-sm)' }}><span className="live-dot" aria-hidden />{t('fLive')} · {tr({ te: 'నవీకరణ', hi: 'अपडेट', en: 'updated' })} {clock(lastSync)}</span>
  return (
    <span className="row" style={{ gap: 6 }}>
      <RefreshCw size={15} aria-hidden className={syncing ? 'spin-icon' : ''} />{t('updated')} {clock(lastSync)}
      <button className="btn ghost sm" onClick={() => void reload()} disabled={syncing}>{t('retry')}</button>
    </span>
  )
}

/** Phone-only bar that explains stale/offline data (larger screens show this in the top bar). */
function NetBar() {
  const { online, wsConnected, lastSync, syncing, reload, fromCache } = useStore()
  const { t, clock } = useLang()
  useNow(30000)
  const old = !lastSync || Date.now() - lastSync > 2 * 60 * 1000
  if (online && (wsConnected || !old) && !fromCache) return null
  if (!online) return <div className="netbar offline only-mobile" role="status"><WifiOff size={16} aria-hidden /><span>{t('offlineSince')} {clock(lastSync)}</span></div>
  if (!wsConnected && old) return (
    <div className="netbar syncing only-mobile" role="status">
      <RefreshCw size={16} aria-hidden className={syncing ? 'spin-icon' : ''} />
      <span>{t('livePaused')} {clock(lastSync)}</span>
      <button onClick={() => void reload()} disabled={syncing}>{t('retry')}</button>
    </div>
  )
  return null
}

function Brand({ className = '' }: { className?: string }) {
  const { t } = useLang()
  return (
    <NavLink to="/" className={`brand ${className}`} aria-label={t('appName')}>
      <span className="brand-mark" aria-hidden><Waves size={20} /></span>
      <span className="brand-text"><span className="brand-name">{t('brandShort')}</span><span className="brand-sub">{t('appName')}</span></span>
    </NavLink>
  )
}

export default function Shell() {
  const { t, tr, lang } = useLang()
  const { unreadAlerts, user } = useStore()
  const loc = useLocation()
  const [langOpen, setLangOpen] = useState(false)
  if (loc.pathname === '/' && !isOnboarded()) return <Navigate to="/welcome" replace />
  const flush = loc.pathname === '/map'
  const title = TITLES.find(([p]) => loc.pathname.startsWith(p))?.[1]
  const staff = user && user.role !== 'pilgrim'
  return (
    <div className="app">
      <a href="#main" className="sr-only">Skip to content</a>
      <div className="app-body">
        {/* tablet rail / desktop sidebar */}
        <aside className="sidebar" aria-label="Sidebar">
          <Brand />
          <nav aria-label="Primary" className="stack" style={{ gap: 2 }}>
            {GROUPS.map((g) => (
              <div key={g.label.en} className="stack" style={{ gap: 2 }}>
                <div className="side-group-label">{tr(g.label)}</div>
                {g.items.map((it) => {
                  const on = isActive(loc.pathname, it.match)
                  const I = it.icon
                  return (
                    <NavLink key={it.to} to={it.to} end={it.to === '/'} className={`side-link ${on ? 'active' : ''} ${it.tone === 'danger' ? 'danger' : ''}`} aria-current={on ? 'page' : undefined}>
                      <I size={20} aria-hidden strokeWidth={on ? 2.3 : 2} /><span>{t(it.key)}</span>
                      {it.to === '/alerts' && unreadAlerts > 0 && <span className="count" aria-label={`${unreadAlerts}`}>{unreadAlerts > 9 ? '9+' : unreadAlerts}</span>}
                    </NavLink>
                  )
                })}
              </div>
            ))}
            {staff && (
              <div className="stack" style={{ gap: 2 }}>
                <div className="side-group-label">{tr({ te: 'సిబ్బంది', hi: 'कर्मचारी', en: 'Staff' })}</div>
                <NavLink to="/staff" className={`side-link ${loc.pathname.startsWith('/staff') ? 'active' : ''}`}><Briefcase size={20} aria-hidden /><span>{t('staffMode')}</span></NavLink>
                {(user.role === 'staff' || user.role === 'admin') && <NavLink to="/admin" className="side-link"><MonitorCog size={20} aria-hidden /><span>{t('admin')}</span></NavLink>}
              </div>
            )}
          </nav>
          <div className="side-foot"><GloomDevCredit /></div>
        </aside>

        <div className="app-main">
          <header className="app-header">
            <Brand className="mobile-brand" />
            <div className="header-context">
              {title && <strong style={{ color: 'var(--text)', fontSize: 'var(--fs-md)' }}>{t(title)}</strong>}
              {title && <span aria-hidden style={{ color: 'var(--line-strong)' }}>|</span>}
              <DataStatus />
            </div>
            <div className="header-actions">
              <button className="hbtn" onClick={() => setLangOpen(true)} aria-label={`${t('language')}: ${lang}`}><Languages size={20} aria-hidden /><span lang={lang}>{SHORT[lang]}</span></button>
              <NavLink to="/alerts" className="hbtn" aria-label={`${t('notifications')}${unreadAlerts ? ` (${unreadAlerts})` : ''}`}>
                <Bell size={20} aria-hidden />{unreadAlerts > 0 && <span className="badge" aria-hidden>{unreadAlerts > 9 ? '9+' : unreadAlerts}</span>}
              </NavLink>
              <NavLink to="/emergency" className="hbtn sos" aria-label={t('emergencyAssist')}><Siren size={18} aria-hidden /><span className="only-mobile">SOS</span><span className="hide-mobile">{t('emergency')}</span></NavLink>
              <span className="hide-mobile">
                {user
                  ? <NavLink to="/profile" className="hbtn account" aria-label={t('profile')}><Avatar name={user.name || user.phone || user.role} /><span className="only-desktop">{user.name || t('profile')}</span></NavLink>
                  : <NavLink to="/login" className="btn sm primary"><LogIn size={16} aria-hidden />{t('login')}</NavLink>}
              </span>
            </div>
          </header>
          <NetBar />
          <main className={`page ${flush ? 'flush' : ''}`} id="main">
            <div key={loc.pathname} className={flush ? '' : 'page-enter'}><Outlet /></div>
          </main>
        </div>
      </div>

      {/* phones: bottom tabs */}
      <nav className="bottom-nav" aria-label="Main">
        {TABS.map((tb) => {
          const on = isActive(loc.pathname, tb.match)
          const I = tb.icon
          return (
            <NavLink key={tb.to} to={tb.to} end={tb.to === '/'} className={on ? 'active' : ''} aria-current={on ? 'page' : undefined}>
              <span className="pill"><I size={22} aria-hidden strokeWidth={on ? 2.4 : 2} /></span><span className="lbl">{t(tb.key)}</span>
            </NavLink>
          )
        })}
      </nav>
      <Sheet open={langOpen} onClose={() => setLangOpen(false)} title={t('language')}>
        <LanguagePicker onPick={() => setLangOpen(false)} />
      </Sheet>
    </div>
  )
}
