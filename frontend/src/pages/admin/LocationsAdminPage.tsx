/* Locations & verification – the control-room tool for keeping place data honest.
   - Every place shows where its data comes from (organisers, OpenStreetMap, a written source) and whether its
     position is verified. Places without a verified position are never shown on maps or routed to.
   - Admins can correct names / type / position (click the map), set capacity, open/close, and change the
     verification level with a required note; every change is written to the audit log by the API.
   Desktop: list + sticky editor aside. Tablets/phones: list, editor in a sheet. */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMapEvents } from 'react-leaflet'
import { BadgeCheck, CircleOff, Crosshair, Database, ExternalLink, Info, MapPinned, MapPinOff, Plus, RefreshCw, Save, Search, Terminal, X } from 'lucide-react'
import { api, hasCoords, osmLink, type Location, type Site, type Verification } from '../../api'
import { useLang, type Key } from '../../i18n'
import MapView from '../../components/MapView'
import { TypeIcon } from '../../components/icons'
import { EmptyState, Field, FilterChips, Notice, PageHead, Sheet, Skeleton, SubmitButton, VerificationBadge, useBreakpoint, useSubmit, useToast } from '../../components/ui'

const TYPES = ['ghat', 'gate', 'checkpoint', 'parking', 'help_desk', 'medical', 'police', 'lost_found', 'restroom', 'water', 'dressing_room', 'food', 'rest_area', 'bus_stop', 'railway_station', 'shuttle', 'other']
const LEVELS: { v: Exclude<Verification, 'demo'>; label: string; hint: string; needsCoords: boolean }[] = [
  { v: 'official', label: 'Official', hint: 'Confirmed by the organisers / on-site survey', needsCoords: true },
  { v: 'source', label: 'OSM source', hint: 'Position from OpenStreetMap, not yet confirmed', needsCoords: true },
  { v: 'unverified', label: 'Unverified', hint: 'Named by a source; position not verified (no map pin)', needsCoords: false },
  { v: 'unavailable', label: 'Unavailable', hint: 'Closed, removed or not usable (closes the place)', needsCoords: false },
]
type VFilter = 'all' | Verification

function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}
function parseCoord(v: string, min: number, max: number): number | null | 'bad' {
  if (v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= min && n <= max ? n : 'bad'
}

/** Clicking the map sets the coordinates. Rendered inside <MapView>. */
function ClickToSet({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6))) })
  return null
}

/** Coordinates inputs + click-to-set map. */
function CoordPicker({ lat, lng, setLat, setLng, center, type, label }: { lat: string; lng: string; setLat: (v: string) => void; setLng: (v: string) => void; center: [number, number]; type: string; label: string }) {
  const la = parseCoord(lat, -90, 90), lo = parseCoord(lng, -180, 180)
  const ok = typeof la === 'number' && typeof lo === 'number'
  const pin: Location[] = ok ? [{
    id: -1, code: 'EDIT', site_id: 0, type, name: label, name_te: null, name_hi: null, lat: la, lng: lo, capacity: null, is_accessible: false, is_open: true, monitored: false,
    current_count: null, density_level: 'unknown', density_source: null, density_updated_at: null, details: {}, verification: 'unverified', source: null, source_ref: null,
    source_retrieved_at: null, verified_at: null, verification_note: null,
  }] : []
  const err = (la === 'bad' || lo === 'bad') ? 'Latitude must be −90…90 and longitude −180…180' : (la === null) !== (lo === null) ? 'Enter both latitude and longitude, or neither' : null
  return (
    <div className="stack tight">
      <div className="grid2">
        <Field label="Latitude" htmlFor="loc-lat"><input id="loc-lat" className="input" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="17.008396" aria-invalid={la === 'bad'} /></Field>
        <Field label="Longitude" htmlFor="loc-lng"><input id="loc-lng" className="input" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="81.766947" aria-invalid={lo === 'bad'} /></Field>
      </div>
      {err && <div className="field-error" role="alert">{err}</div>}
      <div className="map-panel">
        <MapView center={ok ? [la, lo] : center} zoom={ok ? 17 : 13} locations={pin} height="240px" focus={ok ? [la, lo] : null}>
          <ClickToSet onPick={(a, b) => { setLat(String(a)); setLng(String(b)) }} />
        </MapView>
      </div>
      <div className="row between wrap xs muted">
        <span className="row" style={{ gap: 4 }}><Crosshair size={14} aria-hidden />Click the map to set the position</span>
        {ok && <a href={osmLink(la, lo)} target="_blank" rel="noopener noreferrer" className="row" style={{ gap: 4 }}>Check on OpenStreetMap <ExternalLink size={12} aria-hidden /></a>}
        {(lat || lng) && <button type="button" className="btn ghost sm" onClick={() => { setLat(''); setLng('') }}><X size={14} aria-hidden />Clear position</button>}
      </div>
    </div>
  )
}

/* =============================================================================== editor */
function LocationEditor({ loc, site, onSaved, onClose }: { loc: Location; site: Site | undefined; onSaved: () => void; onClose?: () => void }) {
  const { t } = useLang()
  const toast = useToast()
  const [nm, setNm] = useState(loc.name); const [te, setTe] = useState(loc.name_te ?? ''); const [hi, setHi] = useState(loc.name_hi ?? '')
  const [type, setType] = useState(loc.type)
  const [lat, setLat] = useState(loc.lat != null ? String(loc.lat) : ''); const [lng, setLng] = useState(loc.lng != null ? String(loc.lng) : '')
  const [open, setOpen] = useState(loc.is_open); const [acc, setAcc] = useState(loc.is_accessible)
  const [cap, setCap] = useState(loc.capacity != null ? String(loc.capacity) : '')
  const [level, setLevel] = useState<Exclude<Verification, 'demo'>>(loc.verification === 'demo' ? 'unverified' : loc.verification)
  const [note, setNote] = useState(''); const [src, setSrc] = useState(loc.source ?? ''); const [srcRef, setSrcRef] = useState(loc.source_ref ?? '')
  const save = useSubmit<Location>()
  const verify = useSubmit<Location>()

  const la = parseCoord(lat, -90, 90), lo = parseCoord(lng, -180, 180)
  const coordsBad = la === 'bad' || lo === 'bad' || (la === null) !== (lo === null)
  const hasPos = typeof la === 'number' && typeof lo === 'number'
  const capN = cap.trim() === '' ? null : Number(cap)
  const capBad = capN !== null && (!Number.isInteger(capN) || capN < 0)
  const center: [number, number] = loc.lat != null && loc.lng != null ? [loc.lat, loc.lng] : site ? [site.center_lat, site.center_lng] : [17.0084, 81.7669]

  const doSave = () => {
    if (coordsBad || capBad || !nm.trim()) return
    const body: Record<string, unknown> = {}
    if (nm.trim() !== loc.name) body.name = nm.trim()
    if ((te.trim() || null) !== loc.name_te) body.name_te = te.trim() || null
    if ((hi.trim() || null) !== loc.name_hi) body.name_hi = hi.trim() || null
    if (type !== loc.type) body.type = type
    const newLat = hasPos ? (la as number) : null, newLng = hasPos ? (lo as number) : null
    if (newLat !== loc.lat || newLng !== loc.lng) { body.lat = newLat; body.lng = newLng }
    if (open !== loc.is_open) body.is_open = open
    if (acc !== loc.is_accessible) body.is_accessible = acc
    if (capN !== loc.capacity) body.capacity = capN
    if (Object.keys(body).length === 0) { toast('No changes', 'info'); return }
    void save.run(() => api.patch<Location>(`/locations/${loc.id}`, body)).then((r) => {
      if (!r) return
      toast(r.verification !== loc.verification && loc.verification === 'official' ? 'Saved – position changed, so it needs re-confirmation' : 'Saved')
      onSaved()
    })
  }
  const needsCoords = LEVELS.find((l) => l.v === level)?.needsCoords ?? false
  const doVerify = () => {
    if (note.trim().length < 3 || coordsBad || (needsCoords && !hasPos)) return
    const body: Record<string, unknown> = { verification: level, note: note.trim(), source: src.trim() || null, source_ref: srcRef.trim() || null }
    if (hasPos && (la !== loc.lat || lo !== loc.lng)) { body.lat = la; body.lng = lo }
    void verify.run(() => api.post<Location>(`/locations/${loc.id}/verification`, body)).then((r) => { if (r) { toast(`Marked ${LEVELS.find((l) => l.v === level)?.label ?? level}`); setNote(''); onSaved() } })
  }

  return (
    <div className="stack">
      <div className="row top">
        <span style={{ width: 42, height: 42, borderRadius: 'var(--r-md)', display: 'grid', placeItems: 'center', background: 'var(--brand-100)', color: 'var(--brand-ink)', flexShrink: 0 }} aria-hidden><TypeIcon type={loc.type} /></span>
        <div className="grow" style={{ minWidth: 0 }}>
          <h2 className="clamp2">{loc.name}</h2>
          <div className="xs muted" style={{ overflowWrap: 'anywhere' }}>{loc.code} · {site?.name ?? `Site ${loc.site_id}`}</div>
        </div>
        {onClose && <button className="btn icon sm ghost" onClick={onClose} aria-label="Close editor"><X size={18} aria-hidden /></button>}
      </div>

      {/* provenance */}
      <div className="card flat stack tight" style={{ padding: 'var(--s3) var(--s4)', background: 'var(--surface-2)' }}>
        <div className="row wrap" style={{ gap: 6 }}><VerificationBadge v={loc.lat == null && loc.verification !== 'unavailable' ? 'unverified' : loc.verification} />{!hasCoords(loc) && <span className="chip neutral"><MapPinOff aria-hidden />No position</span>}</div>
        <dl className="kv">
          <dt>Source</dt><dd style={{ overflowWrap: 'anywhere' }}>{loc.source_ref ? <a href={loc.source_ref} target="_blank" rel="noopener noreferrer">{loc.source ?? loc.source_ref}</a> : loc.source ?? '—'}</dd>
          <dt>Retrieved</dt><dd>{fmtDate(loc.source_retrieved_at)}</dd>
          <dt>Verified</dt><dd>{fmtDate(loc.verified_at)}</dd>
          {loc.verification_note && <><dt>Note</dt><dd style={{ overflowWrap: 'anywhere' }}>{loc.verification_note}</dd></>}
        </dl>
      </div>

      {/* details */}
      <div className="stack tight">
        <h3>Details</h3>
        <Field label="Name (English)" htmlFor="loc-name" error={!nm.trim() ? 'Required' : null}><input id="loc-name" className="input" value={nm} onChange={(e) => setNm(e.target.value)} /></Field>
        <div className="grid2">
          <Field label="Name (Telugu)" optional htmlFor="loc-te"><input id="loc-te" className="input" lang="te" value={te} onChange={(e) => setTe(e.target.value)} /></Field>
          <Field label="Name (Hindi)" optional htmlFor="loc-hi"><input id="loc-hi" className="input" lang="hi" value={hi} onChange={(e) => setHi(e.target.value)} /></Field>
        </div>
        <Field label="Type" htmlFor="loc-type">
          <select id="loc-type" className="input" value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map((x) => <option key={x} value={x}>{t(x as Key)}</option>)}</select>
        </Field>
        <CoordPicker lat={lat} lng={lng} setLat={setLat} setLng={setLng} center={center} type={type} label={nm} />
        {loc.verification === 'official' && hasPos && (la !== loc.lat || lo !== loc.lng) && <Notice tone="warn">Moving an official location resets it to "Unverified" until it is confirmed again.</Notice>}
        <Field label="Safe capacity (people)" optional htmlFor="loc-cap" hint="Safe simultaneous capacity from the district engineer. Crowd levels are computed only when this is set." error={capBad ? 'Whole number ≥ 0' : null}>
          <input id="loc-cap" className="input" inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value.replace(/[^\d]/g, ''))} />
        </Field>
        <div className="grid2">
          <label className={`check ${open ? 'on' : ''}`}><input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} /><span className="small strong">Open to the public</span></label>
          <label className={`check ${acc ? 'on' : ''}`}><input type="checkbox" checked={acc} onChange={(e) => setAcc(e.target.checked)} /><span className="small strong">Step-free / accessible</span></label>
        </div>
        {save.error && <div className="err" role="alert">{save.error}</div>}
        <SubmitButton className="btn primary block" onClick={doSave} busy={save.busy} disabled={coordsBad || capBad || !nm.trim()}><Save size={18} aria-hidden />Save changes</SubmitButton>
      </div>

      {/* verification */}
      <div className="stack tight" style={{ borderTop: '1px solid var(--line)', paddingTop: 'var(--s4)' }}>
        <h3>Verification</h3>
        <div className="stack tight" role="radiogroup" aria-label="Verification level">
          {LEVELS.map((l) => {
            const disabled = l.needsCoords && !hasPos
            return (
              <label key={l.v} className={`check ${level === l.v ? 'on' : ''}`} style={disabled ? { opacity: .55 } : undefined}>
                <input type="radio" name={`lvl-${loc.id}`} checked={level === l.v} disabled={disabled} onChange={() => setLevel(l.v)} />
                <span className="stack" style={{ gap: 2 }}><span className="small strong">{l.label}</span><span className="xs muted">{disabled ? 'Add coordinates first – a verified place needs a position.' : l.hint}</span></span>
              </label>
            )
          })}
        </div>
        <Field label="Note" htmlFor="ver-note" hint="Why – e.g. 'Surveyed by district engineer 12 Mar', 'Official ghat list No. 14'" error={note && note.trim().length < 3 ? 'At least 3 characters' : null}>
          <textarea id="ver-note" className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="grid2">
          <Field label="Source" optional htmlFor="ver-src"><input id="ver-src" className="input" value={src} onChange={(e) => setSrc(e.target.value)} placeholder="District collectorate notice" /></Field>
          <Field label="Source URL" optional htmlFor="ver-ref"><input id="ver-ref" className="input" inputMode="url" value={srcRef} onChange={(e) => setSrcRef(e.target.value)} placeholder="https://" /></Field>
        </div>
        {verify.error && <div className="err" role="alert">{verify.error}</div>}
        <SubmitButton className="btn block" onClick={doVerify} busy={verify.busy} disabled={note.trim().length < 3 || coordsBad || (needsCoords && !hasPos)}><BadgeCheck size={18} aria-hidden />Record verification</SubmitButton>
        <p className="xs muted">Recorded with your name and time in the audit log. "Unavailable" also closes the place.</p>
      </div>
    </div>
  )
}

/* =============================================================================== add location */
function AddLocationSheet({ open, onClose, sites, onCreated }: { open: boolean; onClose: () => void; sites: Site[]; onCreated: (l: Location) => void }) {
  const { t } = useLang()
  const toast = useToast()
  const [siteId, setSiteId] = useState<number | ''>('')
  const [type, setType] = useState('ghat')
  const [code, setCode] = useState(''); const [codeTouched, setCodeTouched] = useState(false)
  const [nm, setNm] = useState(''); const [te, setTe] = useState(''); const [hi, setHi] = useState('')
  const [lat, setLat] = useState(''); const [lng, setLng] = useState('')
  const [level, setLevel] = useState<Exclude<Verification, 'demo'>>('unverified')
  const [note, setNote] = useState(''); const [src, setSrc] = useState(''); const [srcRef, setSrcRef] = useState('')
  const [tried, setTried] = useState(false)
  const sub = useSubmit<Location>()
  const site = sites.find((s) => s.id === siteId)

  useEffect(() => {
    if (!open) return
    setSiteId(sites[0]?.id ?? ''); setType('ghat'); setCodeTouched(false); setNm(''); setTe(''); setHi(''); setLat(''); setLng('')
    setLevel('unverified'); setNote(''); setSrc(''); setSrcRef(''); setTried(false)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (codeTouched) return
    setCode(`${type.toUpperCase()}-${site?.code ?? 'SITE'}-${Date.now().toString(36).toUpperCase()}`)
  }, [type, site?.code, codeTouched])

  const la = parseCoord(lat, -90, 90), lo = parseCoord(lng, -180, 180)
  const coordsBad = la === 'bad' || lo === 'bad' || (la === null) !== (lo === null)
  const hasPos = typeof la === 'number' && typeof lo === 'number'
  const needsCoords = LEVELS.find((l) => l.v === level)?.needsCoords ?? false
  const valid = !!siteId && nm.trim() && code.trim() && !coordsBad && !(needsCoords && !hasPos) && (level === 'unverified' || note.trim().length >= 3)

  const create = () => {
    setTried(true)
    if (!valid) return
    void sub.run(() => api.post<Location>('/locations', {
      code: code.trim(), site_id: siteId, type, name: nm.trim(), name_te: te.trim() || null, name_hi: hi.trim() || null,
      lat: hasPos ? la : null, lng: hasPos ? lo : null, verification: level, source: src.trim() || null, source_ref: srcRef.trim() || null, verification_note: note.trim() || null,
    })).then((r) => { if (r) { toast('Location added'); onCreated(r); onClose() } })
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add location">
      <div className="stack">
        <div className="grid2">
          <Field label="Bathing centre" htmlFor="add-site">
            <select id="add-site" className="input" value={siteId} onChange={(e) => setSiteId(e.target.value ? Number(e.target.value) : '')}>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}{s.state ? ` (${s.state})` : ''}</option>)}
            </select>
          </Field>
          <Field label="Type" htmlFor="add-type">
            <select id="add-type" className="input" value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map((x) => <option key={x} value={x}>{t(x as Key)}</option>)}</select>
          </Field>
        </div>
        <Field label="Code" htmlFor="add-code" hint="Unique; generated automatically" error={tried && !code.trim() ? 'Required' : null}>
          <input id="add-code" className="input" value={code} onChange={(e) => { setCodeTouched(true); setCode(e.target.value.toUpperCase().replace(/\s/g, '-')) }} style={{ fontFamily: 'ui-monospace, Consolas, monospace' }} />
        </Field>
        <Field label="Name (English)" htmlFor="add-name" error={tried && !nm.trim() ? 'Required' : null}><input id="add-name" className="input" value={nm} onChange={(e) => setNm(e.target.value)} /></Field>
        <div className="grid2">
          <Field label="Name (Telugu)" optional htmlFor="add-te"><input id="add-te" className="input" lang="te" value={te} onChange={(e) => setTe(e.target.value)} /></Field>
          <Field label="Name (Hindi)" optional htmlFor="add-hi"><input id="add-hi" className="input" lang="hi" value={hi} onChange={(e) => setHi(e.target.value)} /></Field>
        </div>
        <CoordPicker lat={lat} lng={lng} setLat={setLat} setLng={setLng} center={site ? [site.center_lat, site.center_lng] : [17.0084, 81.7669]} type={type} label={nm || 'New location'} />
        <div className="stack tight" role="radiogroup" aria-label="Verification level">
          <span className="field-label">Verification</span>
          {LEVELS.map((l) => {
            const disabled = l.needsCoords && !hasPos
            return (
              <label key={l.v} className={`check ${level === l.v ? 'on' : ''}`} style={disabled ? { opacity: .55 } : undefined}>
                <input type="radio" name="add-level" checked={level === l.v} disabled={disabled} onChange={() => setLevel(l.v)} />
                <span className="stack" style={{ gap: 2 }}><span className="small strong">{l.label}</span><span className="xs muted">{disabled ? 'Add coordinates first' : l.hint}</span></span>
              </label>
            )
          })}
        </div>
        <Field label="Note" optional={level === 'unverified'} htmlFor="add-note" error={tried && level !== 'unverified' && note.trim().length < 3 ? 'Explain the verification (at least 3 characters)' : null}>
          <textarea id="add-note" className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="grid2">
          <Field label="Source" optional htmlFor="add-src"><input id="add-src" className="input" value={src} onChange={(e) => setSrc(e.target.value)} placeholder="Official ghat list / newspaper" /></Field>
          <Field label="Source URL" optional htmlFor="add-ref"><input id="add-ref" className="input" inputMode="url" value={srcRef} onChange={(e) => setSrcRef(e.target.value)} placeholder="https://" /></Field>
        </div>
        {sub.error && <div className="err" role="alert">{sub.error}</div>}
        <SubmitButton onClick={create} busy={sub.busy} disabled={tried && !valid}><Plus size={18} aria-hidden />Add location</SubmitButton>
      </div>
    </Sheet>
  )
}

/* =============================================================================== page */
export default function LocationsAdminPage() {
  const { t } = useLang()
  const bp = useBreakpoint()
  const desktop = bp === 'desktop'
  const mobile = bp === 'mobile'
  const [all, setAll] = useState<Location[] | null>(null)
  const [sites, setSites] = useState<Site[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [siteF, setSiteF] = useState<number | ''>('')
  const [typeF, setTypeF] = useState('')
  const [vF, setVF] = useState<VFilter>('all')
  const [missingOnly, setMissingOnly] = useState(false)
  const [selId, setSelId] = useState<number | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [locs, ss] = await Promise.all([api.get<Location[]>('/locations?limit=3000'), api.get<Site[]>('/sites')])
      setAll(locs); setSites(ss); setErr(null)
    } catch (e) { setErr((e as Error).message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const siteById = useMemo(() => new Map(sites.map((s) => [s.id, s])), [sites])
  const rows = useMemo(() => {
    const qq = q.trim().toLowerCase()
    return (all ?? []).filter((l) =>
      (!qq || [l.name, l.name_te, l.name_hi, l.code, siteById.get(l.site_id)?.name].some((x) => (x ?? '').toLowerCase().includes(qq))) &&
      (!siteF || l.site_id === siteF) && (!typeF || l.type === typeF) && (vF === 'all' || l.verification === vF) && (!missingOnly || l.lat == null),
    ).sort((a, b) => (siteById.get(a.site_id)?.sort_order ?? 0) - (siteById.get(b.site_id)?.sort_order ?? 0) || Number(a.type !== 'ghat') - Number(b.type !== 'ghat') || a.name.localeCompare(b.name))
  }, [all, q, siteF, typeF, vF, missingOnly, siteById])
  const counts = useMemo(() => {
    const a = all ?? []
    return { total: a.length, official: a.filter((l) => l.verification === 'official').length, source: a.filter((l) => l.verification === 'source').length,
      unverified: a.filter((l) => l.verification === 'unverified').length, noPos: a.filter((l) => l.lat == null).length, unavailable: a.filter((l) => l.verification === 'unavailable').length,
      demo: a.filter((l) => l.verification === 'demo').length }
  }, [all])
  const presentTypes = useMemo(() => Array.from(new Set((all ?? []).map((l) => l.type))).sort(), [all])
  const sel = selId ? (all ?? []).find((l) => l.id === selId) ?? null : null

  const vOptions: { value: VFilter; label: string }[] = [
    { value: 'all', label: `All (${counts.total})` }, { value: 'official', label: `Official (${counts.official})` }, { value: 'source', label: `OSM source (${counts.source})` },
    { value: 'unverified', label: `Unverified (${counts.unverified})` }, { value: 'unavailable', label: `Unavailable (${counts.unavailable})` },
    ...(counts.demo ? [{ value: 'demo' as VFilter, label: `Demo (${counts.demo})` }] : []),
  ]

  const kpis = (
    <div className="kpis">
      <div className="kpi"><div className="v">{counts.total}</div><div className="l row" style={{ gap: 4 }}><Database size={14} aria-hidden />Locations</div></div>
      <div className="kpi"><div className="v" style={{ color: 'var(--low)' }}>{counts.official}</div><div className="l row" style={{ gap: 4 }}><BadgeCheck size={14} aria-hidden />Official</div></div>
      <div className="kpi"><div className="v">{counts.source}</div><div className="l row" style={{ gap: 4 }}><Info size={14} aria-hidden />OSM source</div></div>
      <div className="kpi"><div className="v" style={{ color: counts.unverified ? 'var(--moderate)' : undefined }}>{counts.unverified}</div><div className="l row" style={{ gap: 4 }}><MapPinOff size={14} aria-hidden />Unverified · {counts.noPos} without position</div></div>
      <div className="kpi"><div className="v" style={{ color: counts.unavailable ? 'var(--critical)' : undefined }}>{counts.unavailable}</div><div className="l row" style={{ gap: 4 }}><CircleOff size={14} aria-hidden />Unavailable</div></div>
    </div>
  )

  const filters = (
    <div className="card stack tight">
      <div className="row wrap" style={{ gap: 'var(--s3)', alignItems: 'flex-end' }}>
        <div className="search" style={{ flex: '2 1 240px' }}><Search size={18} aria-hidden /><input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name (en / te / hi), code or centre" aria-label="Search locations" /></div>
        <select className="input" style={{ flex: '1 1 180px', width: 'auto' }} value={siteF} onChange={(e) => setSiteF(e.target.value ? Number(e.target.value) : '')} aria-label="Bathing centre">
          <option value="">All centres</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.ghats_mapped}/{s.ghats_total} ghats mapped</option>)}
        </select>
        <select className="input" style={{ flex: '1 1 160px', width: 'auto' }} value={typeF} onChange={(e) => setTypeF(e.target.value)} aria-label="Type">
          <option value="">All types</option>
          {presentTypes.map((x) => <option key={x} value={x}>{t(x as Key)}</option>)}
        </select>
        <label className={`check ${missingOnly ? 'on' : ''}`} style={{ flex: '0 0 auto' }}><input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} /><span className="small strong">Missing position only</span></label>
      </div>
      <FilterChips label="Verification" options={vOptions} selected={vF} onToggle={(v) => setVF(v)} />
    </div>
  )

  const posCell = (l: Location) => (hasCoords(l) ? <span style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap' }}>{l.lat.toFixed(5)}, {l.lng.toFixed(5)}</span> : <span className="muted">—</span>)
  const srcCell = (l: Location) => (l.source_ref ? <a href={l.source_ref} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: 'anywhere' }}>{l.source ?? 'link'}</a> : <span>{l.source ?? '—'}</span>)

  const list: ReactNode = all === null
    ? (err ? <div className="err" role="alert">{err}</div> : <Skeleton rows={6} />)
    : rows.length === 0 ? <EmptyState icon={MapPinned} title="No locations match these filters" action={<button className="btn" onClick={() => { setQ(''); setSiteF(''); setTypeF(''); setVF('all'); setMissingOnly(false) }}>Clear filters</button>} />
    : mobile ? (
      <div className="list">
        {rows.map((l) => (
          <button key={l.id} type="button" className="lrow" onClick={() => setSelId(l.id)} aria-label={`Edit ${l.name}`} style={selId === l.id ? { borderColor: 'var(--brand-700)' } : undefined}>
            <span className="lead" aria-hidden><TypeIcon type={l.type} /></span>
            <span className="body">
              <span className="title">{l.name}{l.name_te && <span className="muted" lang="te" style={{ fontWeight: 500 }}> · {l.name_te}</span>}</span>
              <span className="meta"><span>{t(l.type as Key)}</span><span>{siteById.get(l.site_id)?.name}</span></span>
              <span className="row wrap" style={{ gap: 6, marginTop: 4 }}><VerificationBadge v={l.verification} compact />{!hasCoords(l) && <span className="chip neutral"><MapPinOff aria-hidden />No position</span>}</span>
            </span>
          </button>
        ))}
      </div>
    ) : (
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>Name</th><th>Type</th><th>Centre</th><th>Status</th><th>Position</th><th>Source</th><th>Verified / retrieved</th></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} onClick={() => setSelId(l.id)} style={{ cursor: 'pointer', background: selId === l.id ? 'var(--brand-50)' : undefined }}>
                  <td>
                    <button type="button" className="btn ghost sm" style={{ padding: '0 8px', marginLeft: -8, fontWeight: 600, color: 'var(--text)', textAlign: 'left', justifyContent: 'flex-start' }} onClick={(e) => { e.stopPropagation(); setSelId(l.id) }}>{l.name}</button>
                    {l.name_te && <div className="xs muted" lang="te">{l.name_te}</div>}
                  </td>
                  <td className="small">{t(l.type as Key)}</td>
                  <td className="small">{siteById.get(l.site_id)?.name ?? '—'}</td>
                  <td><VerificationBadge v={l.verification} compact /></td>
                  <td>{posCell(l)}</td>
                  <td className="small" style={{ maxWidth: 220 }}>{srcCell(l)}</td>
                  <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{fmtDate(l.verified_at ?? l.source_retrieved_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )

  const help = (
    <div className="card stack tight">
      <div className="card-head" style={{ marginBottom: 0 }}><h3 className="row" style={{ gap: 8 }}><Terminal size={18} aria-hidden />Refreshing the OpenStreetMap dataset</h3></div>
      <p className="small">Run the import tool on the server, then restart the API. It refreshes OSM positions and adds new places; records you have edited or verified here are never overwritten.</p>
      <pre className="qr" style={{ textAlign: 'left', fontSize: 'var(--fs-xs)', whiteSpace: 'pre-wrap', margin: 0 }}>python backend/scripts/import_osm.py</pre>
      <p className="xs muted">Location data © OpenStreetMap contributors (ODbL). Official 2027 ghat lists, festival gates, parking zones and capacities must be entered here once the organisers publish them.</p>
    </div>
  )

  const editor = sel ? <LocationEditor key={sel.id} loc={sel} site={siteById.get(sel.site_id)} onSaved={() => void load()} onClose={desktop ? () => setSelId(null) : undefined} /> : null

  return (
    <div className="stack loose">
      <PageHead back={false} title="Locations & verification"
        sub="Official 2027 ghat lists are not yet published. Positions marked OSM come from OpenStreetMap contributors and need confirmation."
        actions={<>
          <button className="btn" onClick={() => void load()} disabled={loading} aria-label="Refresh"><RefreshCw size={18} aria-hidden className={loading ? 'spin-icon' : ''} />{mobile ? null : 'Refresh'}</button>
          <button className="btn primary" onClick={() => setAddOpen(true)} disabled={sites.length === 0}><Plus size={18} aria-hidden />Add location</button>
        </>} />
      {kpis}
      {filters}
      {desktop ? (
        <div className="layout-aside">
          <div className="stack">
            <div className="small muted">{rows.length} of {counts.total} shown · select a row to edit</div>
            {list}
            {help}
          </div>
          <aside className="stack" style={{ maxHeight: 'calc(100dvh - var(--s8) - var(--s6))', overflowY: 'auto' }}>
            {editor ? <div className="card">{editor}</div> : <div className="card"><EmptyState icon={MapPinned} title="Select a location" body="Edit its names, position, capacity and verification level." /></div>}
          </aside>
        </div>
      ) : (
        <div className="stack">
          <div className="small muted">{rows.length} of {counts.total} shown · tap a location to edit</div>
          {list}
          {help}
        </div>
      )}
      {!desktop && <Sheet open={!!sel} onClose={() => setSelId(null)} title="Edit location">{editor}</Sheet>}
      <AddLocationSheet open={addOpen} onClose={() => setAddOpen(false)} sites={sites} onCreated={(l) => { void load(); setSelId(l.id) }} />
    </div>
  )
}
