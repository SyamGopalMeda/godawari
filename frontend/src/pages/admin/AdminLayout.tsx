/* Control-room shell: corporate sidebar (≥ 760 px) that becomes a horizontal scrolling bar on phones (CSS). */
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Bell, Briefcase, Car, ClipboardList, Cpu, FileVideo, Gauge, LayoutDashboard, LogOut, MapPinned, Smartphone, Waves, type LucideIcon } from 'lucide-react'
import { useLang } from '../../i18n'
import { useStore } from '../../store'
import { LangSwitch } from '../../components/ui'

interface AdminLink { to: string; label: string; icon: LucideIcon; end?: boolean }

function Item({ l }: { l: AdminLink }) {
  const I = l.icon
  return (
    <NavLink to={l.to} end={l.end} className={({ isActive }) => (isActive ? 'active' : '')}>
      <span className="row" style={{ gap: 10, whiteSpace: 'nowrap' }}><I size={18} aria-hidden />{l.label}</span>
    </NavLink>
  )
}

export default function AdminLayout() {
  const { user, logout, wsConnected, online, site } = useStore()
  const { t, name } = useLang()
  const nav = useNavigate()
  const isAdmin = user?.role === 'admin'
  const ops: AdminLink[] = [
    { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/admin/crowd', label: 'Crowd', icon: Gauge },
    { to: '/admin/video', label: 'Video check', icon: FileVideo },
    { to: '/admin/locations', label: 'Locations', icon: MapPinned },
    { to: '/admin/parking', label: 'Parking', icon: Car },
    { to: '/admin/reports', label: 'Missing & SOS', icon: ClipboardList },
    { to: '/admin/alerts', label: 'Alerts', icon: Bell },
  ]
  const sys: AdminLink[] = isAdmin ? [{ to: '/admin/devices', label: 'Devices', icon: Cpu }, { to: '/admin/audit', label: 'Audit', icon: ClipboardList }] : []
  const other: AdminLink[] = [{ to: '/staff', label: t('staffMode'), icon: Briefcase }, { to: '/', label: 'Pilgrim app', icon: Smartphone, end: true }]
  const label = (text: string) => <div className="hide-mobile eyebrow" style={{ padding: '16px 12px 6px' }}>{text}</div>

  return (
    <div className="admin">
      <aside aria-label="Control room navigation">
        <div className="row hide-mobile" style={{ gap: 12, padding: '0 8px 8px' }}>
          <span className="brand-mark" aria-hidden><Waves size={20} /></span>
          <div style={{ minWidth: 0, lineHeight: 1.25 }}>
            <div style={{ fontWeight: 700 }}>Control room</div>
            <div className="muted xs" style={{ overflowWrap: 'anywhere' }}>{site ? name(site) : t('tagline')}</div>
          </div>
        </div>
        <div className="hide-mobile" style={{ padding: '0 12px 4px' }}>
          <span className={`chip ${wsConnected ? 'low' : 'unknown'}`}>{wsConnected ? 'Live' : online ? 'Reconnecting' : 'Offline'}</span>
        </div>
        {label('Operations')}
        {ops.map((l) => <Item key={l.to} l={l} />)}
        {sys.length > 0 && label('System')}
        {sys.map((l) => <Item key={l.to} l={l} />)}
        {label('Switch')}
        {other.map((l) => <Item key={l.to} l={l} />)}
        <div className="hide-mobile stack tight" style={{ borderTop: '1px solid var(--line)', marginTop: 16, padding: '16px 8px 0' }}>
          <div>
            <div className="strong small" style={{ overflowWrap: 'anywhere' }}>{user?.name ?? user?.phone ?? '—'}</div>
            <span className="chip brand" style={{ marginTop: 4 }}>{user?.role}</span>
          </div>
          <LangSwitch light={false} />
          <button className="btn sm block" onClick={() => { logout(); nav('/admin/login') }}><LogOut size={16} aria-hidden />{t('logout')}</button>
        </div>
      </aside>
      <main><Outlet /></main>
    </div>
  )
}
