/* Live crowd monitoring: KPI summary, list + map views, honest freshness, detail dialog with history and verified alternatives.
   Phones: type + view toggles, single-column cards. Tablets: KPI row, two-column card grid, list/map toggle.
   Desktop: KPI row, cards and map side by side. */
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronUp, DoorOpen, Gauge, Info, List as ListIcon, Map as MapIcon, Navigation, RadioTower, ShieldCheck, Waves } from 'lucide-react'
import { api, hasCoords, type CrowdStatus, type Level, type Location, type Recommendation } from '../../api'
import { useLang, type Key } from '../../i18n'
import { useStore } from '../../store'
import { useMyLocation } from '../../location'
import { haversineM } from '../../geo'
import { LEVEL_ICON } from '../../components/icons'
import LazyMap from '../../components/LazyMap'
import { EmptyState, Freshness, Meter, Notice, PageHead, Segmented, Sheet, Skeleton, StatusBadge, VerificationBadge, effectiveLevel, freshnessOf, useBreakpoint } from '../../components/ui'

const ORDER: Record<Level, number> = { low: 0, moderate: 1, high: 2, critical: 3, unknown: 4 }
const ALL_LEVELS: Level[] = ['low', 'moderate', 'high', 'critical', 'unknown']

function sourceLabel(src: string | null, t: (k: Key) => string): string {
  if (src === 'camera' || src === 'rfid' || src === 'manual' || src === 'estimate') return t(src)
  return src ?? '—'
}

function History({ id, capacity }: { id: number; capacity: number | null }) {
  const { tr } = useLang()
  const [pts, setPts] = useState<number[] | null>(null)
  useEffect(() => {
    let alive = true
    api.get<{ count: number }[]>(`/crowd/${id}/history?hours=6`).then((h) => { if (alive) setPts(h.map((x) => x.count)) }).catch(() => { if (alive) setPts([]) })
    return () => { alive = false }
  }, [id])
  if (pts === null) return <div className="skel" style={{ height: 64 }} aria-busy="true" />
  if (pts.length < 2) return <p className="small muted">{tr({ te: 'ఇంకా చరిత్ర లేదు', hi: 'अभी इतिहास नहीं', en: 'No history yet' })}</p>
  const w = 300, h = 72
  const max = Math.max(...pts, capacity ?? 0, 1)
  const y = (v: number) => h - (v / max) * (h - 6) - 3
  const d = pts.map((p, i) => `${((i / (pts.length - 1)) * w).toFixed(1)},${y(p).toFixed(1)}`).join(' ')
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label={tr({ te: 'గత 6 గంటల రద్దీ', hi: 'पिछले 6 घंटे की भीड़', en: 'Crowd over the last 6 hours' })}>
        {capacity && <line x1={0} x2={w} y1={y(capacity)} y2={y(capacity)} stroke="var(--critical-fill)" strokeDasharray="4 4" strokeWidth={1.5} />}
        <polyline points={d} fill="none" stroke="var(--brand-600)" strokeWidth={2.5} strokeLinejoin="round" />
      </svg>
      <figcaption className="xs muted">{tr({ te: 'గత 6 గంటలు · ఎరుపు గీత = సురక్షిత సామర్థ్యం', hi: 'पिछले 6 घंटे · लाल रेखा = सुरक्षित क्षमता', en: 'Last 6 hours · red line = safe capacity' })}</figcaption>
    </figure>
  )
}

function Detail({ c, onClose }: { c: CrowdStatus | null; onClose: () => void }) {
  const { t, tr, name, clock, ago, num } = useLang()
  const { nearParam } = useMyLocation()
  const nav = useNavigate()
  const [alts, setAlts] = useState<Recommendation[] | null>(null)
  useEffect(() => {
    if (!c) return
    let alive = true
    setAlts(null)
    api.get<Recommendation[]>(`/crowd/recommendations?for=${c.type}${nearParam}&limit=5`)
      .then((r) => { if (alive) setAlts(r.filter((x) => x.location.location_id !== c.location_id && !x.location.is_stale && x.location.is_open && (x.location.density_level === 'low' || x.location.density_level === 'moderate') && freshnessOf(x.location.updated_at) !== 'stale')) })
      .catch(() => { if (alive) setAlts([]) })
    return () => { alive = false }
  }, [c?.location_id]) // eslint-disable-line react-hooks/exhaustive-deps
  const fresh = c && !c.is_stale
  const pct = c && c.capacity && c.current_count != null ? Math.round((c.current_count / c.capacity) * 100) : null
  return (
    <Sheet open={!!c} onClose={onClose} title={c ? name(c) : ''}>
      {c && (
        <div className="stack">
          <div className="row wrap"><StatusBadge level={c.density_level} stale={c.is_stale} size="lg" />{!c.is_open && <span className="chip closed">{t('closed')}</span>}</div>
          <Freshness iso={c.updated_at} source={c.source} forceStale={c.is_stale} />
          <dl className="kv">
            <dt>{tr({ te: 'ప్రస్తుతం', hi: 'वर्तमान', en: 'Current count' })}</dt><dd>{fresh && c.current_count != null ? `${num(c.current_count)} ${t('people')}` : t('unknown')}</dd>
            <dt>{tr({ te: 'సురక్షిత సామర్థ్యం', hi: 'सुरक्षित क्षमता', en: 'Safe capacity' })}</dt><dd>{c.capacity ? num(c.capacity) : '—'}</dd>
            {fresh && pct != null && <><dt>%</dt><dd>{pct}%</dd></>}
            <dt>{t('source')}</dt><dd>{sourceLabel(c.source, t)}</dd>
            <dt>{t('updated')}</dt><dd>{c.updated_at ? `${clock(c.updated_at)} · ${ago(c.updated_at)}` : '—'}</dd>
          </dl>
          {c.override && <Notice icon={ShieldCheck}>{tr({ te: 'ఈ స్థితిని కంట్రోల్ రూమ్ నిర్ణయించింది', hi: 'यह स्थिति कंट्रोल रूम द्वारा तय की गई है', en: 'Status set by the control room' })}</Notice>}
          <div className="stack tight"><h3>{tr({ te: 'గత 6 గంటలు', hi: 'पिछले 6 घंटे', en: 'Last 6 hours' })}</h3><History id={c.location_id} capacity={c.capacity} /></div>
          <div className="stack tight">
            <h3>{tr({ te: 'తక్కువ రద్దీ ఉన్న ప్రత్యామ్నాయాలు', hi: 'कम भीड़ वाले विकल्प', en: 'Less crowded alternatives' })}</h3>
            {alts === null ? <Skeleton rows={2} /> : alts.length === 0 ? (
              <p className="small muted">{tr({ te: 'ప్రస్తుతం ధృవీకరించిన ప్రత్యామ్నాయం లేదు', hi: 'अभी कोई सत्यापित विकल्प नहीं', en: 'No verified alternative right now' })}</p>
            ) : (
              <div className="list">
                {alts.map((a) => (
                  <Link key={a.location.location_id} to={`/map?to=${a.location.location_id}`} className="lrow" aria-label={`${t('directions')}: ${name(a.location)}`}>
                    <span className="body"><span className="title">{name(a.location)}</span><span className="meta"><StatusBadge level={a.location.density_level} />{a.distance_m != null && <span>{(a.distance_m / 1000).toFixed(1)} km</span>}</span></span>
                    <span className="trail"><Navigation size={20} aria-hidden /></span>
                  </Link>
                ))}
              </div>
            )}
          </div>
          {hasCoords(c)
            ? <button className="btn primary big block" onClick={() => nav(`/map?to=${c.location_id}`)}><Navigation size={20} aria-hidden />{t('directions')}</button>
            : <Notice tone="warn">{tr({ te: 'స్థానం ఇంకా ధృవీకరించబడలేదు – దిశలు అందుబాటులో లేవు', hi: 'स्थान अभी सत्यापित नहीं – दिशा उपलब्ध नहीं', en: 'Location not yet verified – no directions available' })}</Notice>}
          <Link className="btn ghost block" to={`/places/${c.location_id}`}>{t('viewDetails')}</Link>
        </div>
      )}
    </Sheet>
  )
}

function CrowdCard({ c, dist, onOpen, active }: { c: CrowdStatus; dist: number | null; onOpen: () => void; active?: boolean }) {
  const { t, tr, name, num, ago } = useLang()
  const lvl = effectiveLevel(c.density_level, c.is_stale)
  const pct = c.capacity && c.current_count != null ? (c.current_count / c.capacity) * 100 : 0
  const fresh = !c.is_stale
  return (
    <div className="card pad-sm stack tight" style={active ? { borderColor: 'var(--brand-500)', boxShadow: 'var(--sh-2)' } : undefined}>
      <button type="button" onClick={onOpen} style={{ background: 'none', border: 0, padding: 0, width: '100%', textAlign: 'left', color: 'inherit', display: 'flex', flexDirection: 'column', gap: 10 }} aria-label={`${name(c)}: ${t(lvl as Key)}`}>
        <div className="row between top wrap">
          <h3 className="grow" style={{ minWidth: 120 }}>{name(c)}</h3>
          <StatusBadge level={c.density_level} stale={c.is_stale} />
        </div>
        <Meter level={lvl} pct={fresh ? pct : 0} label={name(c)} />
        {fresh && c.current_count != null ? (
          <span className="small">
            <strong style={{ fontSize: 'var(--fs-lg)' }}>{num(c.current_count)}</strong> {t('people')}
            {c.capacity ? <span className="muted"> · {Math.round(pct)}% {tr({ te: 'సురక్షిత సామర్థ్యం', hi: 'सुरक्षित क्षमता का', en: 'of safe capacity' })}</span> : null}
          </span>
        ) : (
          <span className="small muted">{c.updated_at ? `${t('unknown')} – ${tr({ te: 'చివరి రీడింగ్', hi: 'अंतिम रीडिंग', en: 'last reading' })} ${ago(c.updated_at)}` : t('noVerifiedCrowd')}</span>
        )}
      </button>
      <div className="divider" />
      <div className="row between wrap">
        <span className="row wrap" style={{ gap: 6 }}>
          <Freshness iso={c.updated_at} source={c.source} forceStale={c.is_stale} />
          {dist != null && <span className="xs muted">· {(dist / 1000).toFixed(1)} km</span>}
          {!c.is_open && <span className="chip closed">{t('closed')}</span>}
        </span>
        {hasCoords(c)
          ? <Link to={`/map?to=${c.location_id}`} className="btn sm"><Navigation size={16} aria-hidden />{t('directions')}</Link>
          : <span className="row wrap" style={{ gap: 6 }}><VerificationBadge v="unverified" /><Link to={`/places/${c.location_id}`} className="btn sm ghost">{t('viewDetails')}</Link></span>}
      </div>
    </div>
  )
}

function Legend() {
  const { t, tr } = useLang()
  return (
    <div className="legend" aria-label={tr({ te: 'చిహ్నాలు', hi: 'संकेत', en: 'Legend' })}>
      {ALL_LEVELS.map((l) => { const I = LEVEL_ICON[l]; return <span key={l} className="row" style={{ gap: 4, color: `var(--${l})` }}><I size={14} aria-hidden />{t(l as Key)}</span> })}
    </div>
  )
}

export default function CrowdPage() {
  const { t, tr, clock, num } = useLang()
  const { crowd, places, lastSync, online } = useStore()
  const { coords } = useMyLocation()
  const bp = useBreakpoint()
  const desktop = bp === 'desktop'
  const mobile = bp === 'mobile'
  const [type, setType] = useState<'ghat' | 'gate'>('ghat')
  const [view, setView] = useState<'list' | 'map'>('list')
  const [openId, setOpenId] = useState<number | null>(null)
  const [explain, setExplain] = useState(false)

  const reporting = crowd.filter((c) => !c.is_stale).length
  const rows = useMemo(() => {
    const d = (c: CrowdStatus) => (coords && hasCoords(c) ? haversineM(coords[0], coords[1], c.lat, c.lng) : Number.MAX_SAFE_INTEGER)
    return crowd.filter((c) => c.type === type).sort((a, b) => ORDER[effectiveLevel(a.density_level, a.is_stale)] - ORDER[effectiveLevel(b.density_level, b.is_stale)] || d(a) - d(b))
  }, [crowd, type, coords])
  // places without a verified position are listed but never drawn on the map
  const mapLocs: Location[] = useMemo(() => places.filter((p) => p.monitored && p.type === type && hasCoords(p)), [places, type])
  const open = openId ? crowd.find((c) => c.location_id === openId) ?? null : null
  const firstMapped = mapLocs.find(hasCoords)
  const center: [number, number] | null = coords ?? (firstMapped ? [firstMapped.lat as number, firstMapped.lng as number] : null)
  const countOf = (l: Level) => rows.filter((c) => effectiveLevel(c.density_level, c.is_stale) === l).length
  const typeReporting = rows.filter((c) => !c.is_stale).length

  const sub = crowd.length > 0
    ? tr({ te: `${crowd.length} లో ${reporting} ప్రదేశాలు నివేదిస్తున్నాయి · ${clock(lastSync)}`, hi: `${crowd.length} में से ${reporting} स्थान रिपोर्ट कर रहे · ${clock(lastSync)}`, en: `${reporting} of ${crowd.length} places reporting · updated ${clock(lastSync)}` })
    : undefined

  const typeSwitch = <Segmented label={tr({ te: 'రకం', hi: 'प्रकार', en: 'Type' })} value={type} onChange={(v) => { setType(v); setOpenId(null) }} options={[{ value: 'ghat', label: t('ghats'), icon: Waves }, { value: 'gate', label: t('gates'), icon: DoorOpen }]} />
  const viewSwitch = <Segmented label={t('mapView')} value={view} onChange={setView} options={[{ value: 'list', label: t('listView'), icon: ListIcon }, { value: 'map', label: t('mapView'), icon: MapIcon }]} />
  const card = (c: CrowdStatus) => <CrowdCard key={c.location_id} c={c} active={c.location_id === openId} dist={coords && hasCoords(c) ? haversineM(coords[0], coords[1], c.lat, c.lng) : null} onOpen={() => setOpenId(c.location_id)} />
  const mapPanel = center ? (
    <div className="map-panel">
      <LazyMap center={center} locations={mapLocs} me={coords} fitLocations onSelect={(l) => setOpenId(l?.id ?? null)} selectedId={openId} />
    </div>
  ) : (
    <div className="card"><EmptyState icon={MapIcon} title={tr({ te: 'మ్యాప్ చేయబడిన ప్రదేశాలు లేవు', hi: 'कोई मैप किया गया स्थान नहीं', en: 'No mapped places of this type' })} /></div>
  )
  const empty = <EmptyState icon={Waves} title={tr({ te: 'ఏమీ లేదు', hi: 'कुछ नहीं', en: 'Nothing to show' })} />

  let content
  if (crowd.length === 0 && !lastSync) content = <Skeleton rows={4} />
  else if (crowd.length === 0) content = <EmptyState icon={Waves} title={tr({ te: 'పర్యవేక్షణ ప్రదేశాలు లేవు', hi: 'कोई निगरानी स्थान नहीं', en: 'No monitored places yet' })} body={tr({ te: 'రద్దీ సమాచారం అందుబాటులోకి వచ్చినప్పుడు ఇక్కడ కనిపిస్తుంది.', hi: 'भीड़ की जानकारी उपलब्ध होने पर यहाँ दिखेगी।', en: 'Crowd information will appear here once places start reporting.' })} />
  else if (desktop) content = (
    <div className="layout-split">
      <div className="stack tight">{rows.length === 0 ? empty : rows.map(card)}</div>
      <div className="split-map">{mapPanel}</div>
    </div>
  )
  else if (view === 'list') content = rows.length === 0 ? empty : <div className={mobile ? 'list' : 'auto-grid'}>{rows.map(card)}</div>
  else content = mapPanel

  const noReadings = crowd.length > 0 && reporting === 0
  return (
    <div className="stack loose">
      <div className="stack">
        <PageHead title={t('crowdStatus')} sub={sub} actions={mobile ? undefined : <div style={{ width: 240 }}>{typeSwitch}</div>} />
        {!online && lastSync && <Notice tone="warn">{tr({ te: 'సేవ్ చేసిన సమాచారం చూపుతున్నాం:', hi: 'सहेजी गई जानकारी दिखा रहे हैं:', en: 'Showing saved data from' })} {clock(lastSync)}</Notice>}
        {mobile ? (
          <>
            <div className="grid2">{typeSwitch}{viewSwitch}</div>
            <Legend />
          </>
        ) : (
          <>
            {crowd.length > 0 && (
              <div className="kpis" aria-label={tr({ te: 'సారాంశం', hi: 'सारांश', en: 'Summary' })}>
                <div className="kpi">
                  <div className="v">{num(typeReporting)}<span className="muted" style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>/{num(rows.length)}</span></div>
                  <div className="l row" style={{ gap: 4 }}><RadioTower size={14} aria-hidden />{tr({ te: 'నివేదిస్తున్నవి', hi: 'रिपोर्ट कर रहे', en: 'Places reporting' })}</div>
                </div>
                {(['low', 'moderate', 'high', 'critical'] as Level[]).map((l) => {
                  const I = LEVEL_ICON[l]
                  return (
                    <div key={l} className="kpi">
                      <div className="v" style={{ color: `var(--${l})` }}>{num(countOf(l))}</div>
                      <div className="l row" style={{ gap: 4, color: `var(--${l})` }}><I size={14} aria-hidden />{t(l as Key)}</div>
                    </div>
                  )
                })}
              </div>
            )}
            {!desktop && <div className="row" style={{ justifyContent: 'flex-end' }}><div style={{ width: 240 }}>{viewSwitch}</div></div>}
          </>
        )}
        {noReadings && (
          <div className="card">
            <EmptyState icon={Gauge} title={tr({ te: 'ఇంకా ధృవీకరించిన రద్దీ సమాచారం లేదు', hi: 'अभी सत्यापित भीड़ जानकारी नहीं', en: 'No verified crowd data yet' })}
              body={tr({ te: 'ఘాట్‌ల వద్ద కెమెరాలు లేదా సిబ్బంది నివేదించినప్పుడు రద్దీ స్థాయిలు ఇక్కడ కనిపిస్తాయి. అంచనాలు చూపబడవు.', hi: 'घाटों पर कैमरे या कर्मचारी रिपोर्ट करेंगे तब भीड़ का स्तर यहाँ दिखेगा। अनुमान नहीं दिखाए जाते।', en: 'Crowd levels appear here when cameras or staff at the ghats report them. Estimates are never shown.' })} />
          </div>
        )}
        {content}
      </div>

      <div className="card flat stack tight">
        {!mobile && <Legend />}
        <button type="button" className="row between" style={{ background: 'none', border: 0, padding: 0, width: '100%', color: 'inherit', display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 }} onClick={() => setExplain((x) => !x)} aria-expanded={explain}>
          <span className="row strong small"><Info size={16} aria-hidden />{tr({ te: 'ఈ స్థాయిలు ఎలా లెక్కిస్తారు', hi: 'ये स्तर कैसे तय होते हैं', en: 'How these levels are worked out' })}</span>
          {explain ? <ChevronUp size={18} aria-hidden /> : <ChevronDown size={18} aria-hidden />}
        </button>
        {explain && (
          <p className="small muted">{tr({
            te: 'సురక్షిత సామర్థ్యంలో 40% కంటే తక్కువ = తక్కువ రద్దీ, 40–70% మధ్యస్థ, 70–90% ఎక్కువ, 90% పైన అత్యధికం. 15 నిమిషాల కంటే పాత సమాచారం "తాజా సమాచారం లేదు"గా చూపబడుతుంది. ధృవీకరించిన సమాచారం లేనందున వేచి ఉండే సమయం చూపడం లేదు.',
            hi: 'सुरक्षित क्षमता का 40% से कम = कम भीड़, 40–70% मध्यम, 70–90% भारी, 90% से ऊपर अत्यधिक। 15 मिनट से पुरानी जानकारी "ताज़ा जानकारी नहीं" दिखती है। सत्यापित डेटा न होने से प्रतीक्षा समय नहीं दिखाया जाता।',
            en: 'Under 40% of safe capacity = light, 40–70% moderate, 70–90% heavy, above 90% very heavy. Data older than 15 minutes is shown as "No recent data". Waiting times are not shown because no verified data exists for them.',
          })}</p>
        )}
      </div>
      <Detail c={open} onClose={() => setOpenId(null)} />
    </div>
  )
}
