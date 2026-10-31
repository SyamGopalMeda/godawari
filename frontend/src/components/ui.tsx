/* Reusable mobile building blocks. Every screen composes these so spacing, type, states and
   accessibility stay consistent. Older exports (DensityChip, Meter, Updated, LocationItem, LangSwitch,
   Sheet, LoginGate, useAsync) are kept for the admin and staff pages. */
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Accessibility, ArrowLeft, BadgeCheck, ChevronRight, CircleAlert, CircleCheck, CircleHelp, CircleOff, Clock3, FlaskConical, History, Info, Lock, MapPinOff, Navigation, Phone, RefreshCw, X,
  type LucideIcon,
} from 'lucide-react'
import { fmtDist, type Lang, type Level, type Location, type Verification } from '../api'
import { useLang, LANG_LABELS, type Key } from '../i18n'
import { useStore } from '../store'
import { haptic } from '../prefs'
import { walkMinutes } from '../geo'
import { useDistance } from '../location'
import { LEVEL_ICON, TYPE_META, TypeIcon, typeMeta, type Tone } from './icons'


/* ============================================================================ status & freshness */
export function effectiveLevel(level: Level, stale?: boolean | null): Level { return stale ? 'unknown' : level }

/** Crowd level as icon + words (never colour alone). Stale data is shown as "No recent data", not as a level. */
export function StatusBadge({ level, stale, size }: { level: Level; stale?: boolean | null; size?: 'lg' }) {
  const { t } = useLang()
  const l = effectiveLevel(level, stale)
  const I = LEVEL_ICON[l]
  // plain text (no live region): lists contain many badges and must not be announced repeatedly
  return <span className={`status ${l} ${size ?? ''}`}><I aria-hidden />{t(l as Key)}</span>
}
export const DensityChip = StatusBadge

export function Meter({ level, pct, label }: { level: Level; pct: number; label?: string }) {
  return (
    <div className="meter" role="meter" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <span className={level} style={{ width: `${Math.min(100, Math.max(3, pct))}%` }} />
    </div>
  )
}

export type Fresh = 'live' | 'delayed' | 'stale' | 'none'
const LIVE_SOURCES = new Set(['camera', 'rfid', 'sensor', 'pass_scan'])
/** Classify an update timestamp. Defaults match the server's 15-minute crowd staleness rule. */
export function freshnessOf(iso?: string | null, { liveSec = 300, staleSec = 900 }: { liveSec?: number; staleSec?: number } = {}): Fresh {
  if (!iso) return 'none'
  const age = (Date.now() - new Date(iso).getTime()) / 1000
  return age <= liveSec ? 'live' : age <= staleSec ? 'delayed' : 'stale'
}

/** "● Live · 2 min ago" / "Staff update · 8 min ago" / "Delayed · 9 min ago" / "Not recent · 3 h ago" / "No data yet" */
export function Freshness({ iso, source, liveSec, staleSec, forceStale }: { iso?: string | null; source?: string | null; liveSec?: number; staleSec?: number; forceStale?: boolean }) {
  const { t, ago } = useLang()
  useNow(30000)
  let f = freshnessOf(iso, { liveSec, staleSec })
  if (forceStale && f !== 'none') f = 'stale'
  const automatic = !!source && LIVE_SOURCES.has(source)
  if (f === 'none') return <span className="fresh none"><CircleHelp aria-hidden />{t('fNone')}</span>
  if (f === 'live') return (
    <span className="fresh live">{automatic ? <span className="live-dot" aria-hidden /> : <CircleCheck aria-hidden />}{automatic ? t('fLive') : source === 'estimate' ? t('fEstimate') : source === 'video' ? t('video') : t('fStaff')} · {ago(iso)}</span>
  )
  if (f === 'delayed') return <span className="fresh delayed"><Clock3 aria-hidden />{t('fDelayed')} · {ago(iso)}</span>
  return <span className="fresh stale"><History aria-hidden />{t('fStale')} · {ago(iso)}</span>
}
/** @deprecated use <Freshness/> */
export function Updated({ iso, source }: { iso?: string | null; source?: string | null }) { return <Freshness iso={iso} source={source} /> }

/** Current layout class, matching the CSS breakpoints: phone < 768 ≤ tablet < 1024 ≤ desktop. */
export type Breakpoint = 'mobile' | 'tablet' | 'desktop'
function bpNow(): Breakpoint {
  if (typeof window === 'undefined' || !window.matchMedia) return 'mobile'
  return window.matchMedia('(min-width: 1024px)').matches ? 'desktop' : window.matchMedia('(min-width: 768px)').matches ? 'tablet' : 'mobile'
}
export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(bpNow)
  useEffect(() => {
    if (!window.matchMedia) return
    const qs = [window.matchMedia('(min-width: 768px)'), window.matchMedia('(min-width: 1024px)')]
    const on = () => setBp(bpNow())
    qs.forEach((q) => q.addEventListener?.('change', on))
    return () => qs.forEach((q) => q.removeEventListener?.('change', on))
  }, [])
  return bp
}

/** Re-render periodically so relative times stay true. */
export function useNow(ms = 30000) {
  const [, set] = useState(0)
  useEffect(() => { const id = window.setInterval(() => set((x) => x + 1), ms); return () => clearInterval(id) }, [ms])
}

/* ============================================================================ provenance */
const V_META: Record<Verification, { icon: LucideIcon; cls: string; key: Key }> = {
  official: { icon: BadgeCheck, cls: 'low', key: 'vOfficial' },
  source: { icon: Info, cls: 'brand', key: 'vSource' },
  unverified: { icon: MapPinOff, cls: 'moderate', key: 'vUnverified' },
  unavailable: { icon: CircleOff, cls: 'critical', key: 'vUnavailable' },
  demo: { icon: FlaskConical, cls: 'neutral', key: 'vDemo' },
}
/** Where a place's information comes from: organisers, a public map source, unverified, unavailable or demo. */
export function VerificationBadge({ v, compact }: { v: Verification; compact?: boolean }) {
  const { t } = useLang()
  const m = V_META[v] ?? V_META.unverified
  const I = m.icon
  return <span className={`chip ${m.cls}`} title={t(m.key)}><I aria-hidden />{compact && v === 'source' ? 'OSM' : t(m.key)}</span>
}

/* ============================================================================ layout */
export function PageHead({ title, sub, back = true, actions }: { title: ReactNode; sub?: ReactNode; back?: boolean | string; actions?: ReactNode }) {
  const nav = useNavigate()
  const { t } = useLang()
  const goBack = () => { if (typeof back === 'string') nav(back); else if (window.history.length > 1) nav(-1); else nav('/') }
  return (
    <header className="page-head">
      {back && <button className="back" onClick={goBack} aria-label={t('back')}><ArrowLeft size={24} aria-hidden /></button>}
      <div className="grow"><h1>{title}</h1>{sub && <div className="sub">{sub}</div>}</div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  )
}

export function Section({ title, action, children, id }: { title?: ReactNode; action?: { label: string; to?: string; onClick?: () => void }; children: ReactNode; id?: string }) {
  const hid = useId()
  return (
    <section className="section" aria-labelledby={title ? hid : undefined} id={id}>
      {(title || action) && (
        <div className="section-head">
          {title && <h2 id={hid}>{title}</h2>}
          {action && (action.to ? <Link to={action.to}>{action.label}<ChevronRight size={16} aria-hidden /></Link> : <button onClick={action.onClick}>{action.label}<ChevronRight size={16} aria-hidden /></button>)}
        </div>
      )}
      {children}
    </section>
  )
}

interface RowProps { icon?: ReactNode; tone?: Tone; title: ReactNode; meta?: ReactNode; trail?: ReactNode; to?: string; onClick?: () => void; ariaLabel?: string; chevron?: boolean }
/** Standard 64 px list row. Renders as a link, a button or a plain block. */
export function ListRow({ icon, tone = 'brand', title, meta, trail, to, onClick, ariaLabel, chevron }: RowProps) {
  const inner = (
    <>
      {icon && <span className={`lead ${tone === 'brand' ? '' : tone}`} aria-hidden>{icon}</span>}
      <span className="body"><span className="title">{title}</span>{meta && <span className="meta">{meta}</span>}</span>
      {(trail || chevron) && <span className="trail">{trail}{chevron && <ChevronRight size={20} aria-hidden className="muted" />}</span>}
    </>
  )
  if (to) return <Link to={to} className="lrow" aria-label={ariaLabel}>{inner}</Link>
  if (onClick) return <button type="button" className="lrow" onClick={onClick} aria-label={ariaLabel}>{inner}</button>
  return <div className="lrow">{inner}</div>
}

/** A place with type icon, distance + walking time, accessibility, open state, live status and a directions action. */
export function PlaceRow({ loc, onSelect, showStatus = true, trail }: { loc: Location; onSelect?: (l: Location) => void; showStatus?: boolean; trail?: ReactNode }) {
  const { name, t, walkText } = useLang()
  const nav = useNavigate()
  const dist = useDistance()
  const d = loc.distance_m ?? dist(loc.lat, loc.lng)
  const meta = typeMeta(loc.type)
  const phone = typeof loc.details?.phone === 'string' ? loc.details.phone : null
  return (
    <div className="lrow">
      <span className={`lead ${meta.tone === 'brand' ? '' : meta.tone}`} aria-hidden><TypeIcon type={loc.type} /></span>
      <button type="button" className="body" style={{ background: 'none', border: 0, padding: 0, textAlign: 'left' }} onClick={() => (onSelect ? onSelect(loc) : nav(`/places/${loc.id}`))}>
        <span className="title">{name(loc)}</span>
        <span className="meta">
          {d != null && <span>{fmtDist(d)} · {walkText(walkMinutes(d, loc.is_accessible))}</span>}
          {d == null && <span>{t((loc.type in TYPE_META ? loc.type : 'other') as Key)}</span>}
          {loc.is_accessible && <span className="row" style={{ gap: 3 }}><Accessibility size={14} aria-hidden />{t('accessible')}</span>}
          {!loc.is_open && <span className="chip closed">{t('closed')}</span>}
          {(loc.verification === 'unverified' || loc.verification === 'unavailable' || loc.lat == null) && <VerificationBadge v={loc.lat == null ? 'unverified' : loc.verification} />}
        </span>
        {showStatus && loc.monitored && <span style={{ marginTop: 4 }}><StatusBadge level={loc.density_level} stale={loc.is_stale} /></span>}
      </button>
      <span className="trail">
        {trail}
        {phone && <a className="btn icon sm tonal" href={`tel:${phone}`} aria-label={`${t('call')} ${name(loc)}`}><Phone size={20} aria-hidden /></a>}
        {loc.lat != null && <Link className="btn icon sm tonal" to={`/map?to=${loc.id}`} aria-label={`${t('directions')}: ${name(loc)}`}><Navigation size={20} aria-hidden /></Link>}
      </span>
    </div>
  )
}
/** @deprecated use <PlaceRow/> */
export function LocationItem({ loc, right }: { loc: Location; onDirections?: (l: Location) => void; right?: ReactNode }) { return <PlaceRow loc={loc} trail={right} /> }

/* ============================================================================ states */
export function Skeleton({ rows = 3, kind = 'block' }: { rows?: number; kind?: 'block' | 'line' }) {
  const { t } = useLang()
  return (
    <div className="stack tight" aria-busy="true" aria-live="polite">
      <span className="sr-only">{t('loading')}</span>
      {Array.from({ length: rows }).map((_, i) => <div key={i} className={`skel ${kind}`} style={kind === 'line' ? { width: `${90 - i * 15}%` } : undefined} />)}
    </div>
  )
}

export function EmptyState({ icon: I = Info, title, body, action }: { icon?: LucideIcon; title: ReactNode; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="e-ic"><I size={30} aria-hidden /></div>
      <div className="e-title">{title}</div>
      {body && <div className="e-body">{body}</div>}
      {action}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message?: string | null; onRetry?: () => void }) {
  const { t } = useLang()
  const { online } = useStore()
  return (
    <div className="err" role="alert" style={{ justifyContent: 'space-between' }}>
      <span className="row"><CircleAlert size={18} aria-hidden />{online ? (message || t('somethingWrong')) : t('noConnection')}</span>
      {onRetry && <button className="btn sm" onClick={onRetry}><RefreshCw size={16} aria-hidden />{t('retry')}</button>}
    </div>
  )
}

export function Notice({ tone = 'info', icon: I = Info, children }: { tone?: 'info' | 'warn' | 'danger' | 'ok'; icon?: LucideIcon; children: ReactNode }) {
  return <div className={`notice ${tone === 'info' ? '' : tone}`} role={tone === 'danger' ? 'alert' : undefined}><I size={18} aria-hidden /><div className="grow">{children}</div></div>
}

/* ============================================================================ controls */
export function Segmented<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string; icon?: LucideIcon }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((o) => {
        const I = o.icon
        return <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => { haptic(8); onChange(o.value) }}>{I && <I size={18} aria-hidden />}{o.label}</button>
      })}
    </div>
  )
}

export function FilterChips<T extends string>({ options, selected, onToggle, label }: { options: { value: T; label: string; icon?: ReactNode }[]; selected: T[] | T; onToggle: (v: T) => void; label: string }) {
  const isOn = (v: T) => (Array.isArray(selected) ? selected.includes(v) : selected === v)
  return (
    <div className="tabs" role="group" aria-label={label}>
      {options.map((o) => <button key={o.value} type="button" aria-pressed={isOn(o.value)} className={isOn(o.value) ? 'active' : ''} onClick={() => { haptic(8); onToggle(o.value) }}>{o.icon}{o.label}</button>)}
    </div>
  )
}

export function Avatar({ name, ring, tone }: { name: string; ring?: Fresh; tone?: string }) {
  const initials = name.trim().split(/\s+/).map((p) => Array.from(p)[0] ?? '').slice(0, 2).join('').toUpperCase() || '?'
  return <span className="avatar" style={tone ? { background: tone } : undefined} aria-hidden>{initials}{ring && ring !== 'none' && ring !== 'stale' && <span className={`ring ${ring}`} />}</span>
}

export function Field({ label, hint, error, children, htmlFor, optional }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string; optional?: boolean }) {
  const { t } = useLang()
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>{label}{optional && <span className="muted" style={{ fontWeight: 500 }}> ({t('optional')})</span>}</label>
      {children}
      {hint && !error && <div className="field-hint">{hint}</div>}
      {error && <div className="field-error" role="alert"><CircleAlert size={14} aria-hidden />{error}</div>}
    </div>
  )
}

export function Stepper({ total, current, label }: { total: number; current: number; label?: string }) {
  return <div className="stepper" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={current + 1} aria-label={label}>{Array.from({ length: total }).map((_, i) => <span key={i} className={i <= current ? 'done' : ''} />)}</div>
}

/* ============================================================================ submissions */
/** Guards against double taps / retries on flaky networks: only one request in flight at a time. */
export function useSubmit<T>() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lock = useRef(false)
  const run = useCallback(async (fn: () => Promise<T>): Promise<T | undefined> => {
    if (lock.current) return undefined
    lock.current = true; setBusy(true); setError(null)
    try { const r = await fn(); haptic(15); return r } catch (e) { setError((e as Error).message); haptic([30, 40, 30]); return undefined } finally { lock.current = false; setBusy(false) }
  }, [])
  return { run, busy, error, setError }
}

export function SubmitButton({ onClick, busy, disabled, children, className = 'btn primary big block', type = 'button' }: { onClick?: () => void; busy?: boolean; disabled?: boolean; children: ReactNode; className?: string; type?: 'button' | 'submit' }) {
  return <button type={type} className={className} onClick={onClick} disabled={disabled || busy} aria-busy={busy || undefined}>{busy && <span className="spin" aria-hidden />}{children}</button>
}

/* ============================================================================ sheet */
export function Sheet({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: ReactNode; title?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const { t } = useLang()
  const tid = useId()
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const f = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.sheet-close), a[href]')
    ;(f ?? ref.current)?.focus({ preventScroll: true })
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.({ preventScroll: true }) }
  }, [open, onClose])
  if (!open) return null
  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={title ? tid : undefined} ref={ref} tabIndex={-1}>
        <div className="handle" />
        {title && <div className="sheet-head"><h2 id={tid}>{title}</h2><button className="btn icon ghost sheet-close" onClick={onClose} aria-label={t('close')}><X size={22} aria-hidden /></button></div>}
        {children}
      </div>
    </>
  )
}

/* ============================================================================ toast */
interface Toast { id: number; kind: 'success' | 'info' | 'error'; text: string }
const ToastCtx = createContext<(text: string, kind?: Toast['kind']) => void>(() => {})
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const push = useCallback((text: string, kind: Toast['kind'] = 'success') => {
    const id = Date.now() + Math.random()
    setItems((x) => [...x.slice(-2), { id, kind, text }])
    window.setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 3500)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite" role="status">
        {items.map((i) => <div key={i.id} className={`toast ${i.kind}`}>{i.kind === 'error' ? <CircleAlert size={18} aria-hidden /> : <CircleCheck size={18} aria-hidden />}{i.text}</div>)}
      </div>
    </ToastCtx.Provider>
  )
}
export function useToast() { return useContext(ToastCtx) }

/* ============================================================================ language */
export function LangSwitch({ light: _light = true }: { light?: boolean }) {
  const { lang, setLang } = useLang()
  return (
    <div className="lang-switch" role="radiogroup" aria-label="Language / భాష / भाषा">
      {(Object.keys(LANG_LABELS) as Lang[]).map((l) => (
        <button key={l} role="radio" aria-checked={l === lang} className={l === lang ? 'active' : ''} onClick={() => setLang(l)} lang={l}>{LANG_LABELS[l]}</button>
      ))}
    </div>
  )
}

/** Large language list for onboarding, profile and the header language sheet. */
export function LanguagePicker({ onPick }: { onPick?: (l: Lang) => void }) {
  const { lang, setLang } = useLang()
  const sub: Record<Lang, string> = { te: 'Telugu', hi: 'Hindi', en: 'English' }
  return (
    <div className="lang-big" role="radiogroup" aria-label="Language / భాష / भाषा">
      {(Object.keys(LANG_LABELS) as Lang[]).map((l) => (
        <button key={l} role="radio" aria-checked={l === lang} lang={l} onClick={() => { haptic(10); setLang(l); onPick?.(l) }}>
          <span>{LANG_LABELS[l]}</span>
          {l === lang ? <CircleCheck size={26} aria-hidden /> : <small>{sub[l]}</small>}
        </button>
      ))}
    </div>
  )
}

/* ============================================================================ auth gate */
export function LoginGate({ children, reason }: { children: ReactNode; reason?: ReactNode }) {
  const { user } = useStore()
  const { t } = useLang()
  const nav = useNavigate()
  if (user) return <>{children}</>
  return (
    <div className="card">
      <EmptyState icon={Lock} title={t('loginNeeded')} body={reason}
        action={<button className="btn primary big" onClick={() => nav('/login?next=' + encodeURIComponent(location.pathname + location.search))}>{t('login')}</button>} />
    </div>
  )
}

/* ============================================================================ data */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    setLoading(true)
    fn().then((d) => { if (alive) { setData(d); setError(null) } }).catch((e) => { if (alive) setError((e as Error).message) }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [...deps, tick]) // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, loading, reload: () => setTick((x) => x + 1) }
}
