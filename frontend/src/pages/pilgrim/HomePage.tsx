/* Home: the pilgrim assistance hub.
   Phones/tablets keep the order a stressed pilgrim needs first:
     critical alerts → greeting → where am I → quick actions → live crowd → map → nearby facilities → alerts.
   Desktop (≥ 1024 px) is a dashboard: main column (quick actions, live crowd, nearby) + aside (location, map, alerts).
   Each block is rendered exactly once (the breakpoint decides where), so nothing is fetched or mounted twice. */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Briefcase, ChevronRight, Gauge, HeartPulse, Info, LayoutGrid, LocateFixed, MapPin, MapPinned, MonitorCog, Navigation, OctagonAlert, SearchCheck, Siren,
  SquareParking, TriangleAlert, Users, UsersRound, Waves,
} from 'lucide-react'
import { api, fmtDist, hasCoords, type Alert, type Level, type Location, type Recommendation, type Site } from '../../api'
import { useLang, type Key } from '../../i18n'
import { useStore } from '../../store'
import { useMyLocation } from '../../location'
import { haversineM, nearest, walkMinutes } from '../../geo'
import { EmptyState, Freshness, ListRow, Notice, PlaceRow, Sheet, Skeleton, StatusBadge, useBreakpoint } from '../../components/ui'
import { LEVEL_ICON, TypeIcon } from '../../components/icons'
import LazyMap from '../../components/LazyMap'

const LEVELS: Level[] = ['low', 'moderate', 'high', 'critical']
const PREVIEW_TYPES = ['ghat', 'gate', 'parking', 'medical', 'restroom', 'water', 'help_desk', 'police']
const NEARBY_TYPES = ['restroom', 'water', 'medical', 'police', 'help_desk', 'dressing_room']
/** "Nearby" means walkable: further than this is not a nearby facility. */
const NEARBY_MAX_M = 5000

/* ---------------------------------------------------------------------------- bathing centres (sites)
   Shared with the ghat directory and place detail pages (both import from here; Home is in the main bundle). */
let sitesCache: Site[] | null = null
let sitesPromise: Promise<Site[]> | null = null
/** All bathing centres, fetched once per session (upstream → downstream). null while loading. */
export function useSites(): Site[] | null {
  const [s, setS] = useState<Site[] | null>(sitesCache)
  useEffect(() => {
    if (sitesCache) { setS(sitesCache); return }
    let alive = true
    sitesPromise ??= api.get<Site[]>('/sites').then((r) => (sitesCache = r)).catch(() => { sitesPromise = null; return [] as Site[] })
    void sitesPromise.then((r) => { if (alive) setS(r) })
    return () => { alive = false }
  }, [])
  return s
}
/** A bathing centre's verified town position, shaped as a Location so it can be drawn and measured like one.
    Negative ids keep it apart from real locations. */
export function siteAsLocation(s: Site): Location {
  return {
    id: -s.id, code: s.code ?? `SITE-${s.id}`, site_id: s.id, type: 'other', name: s.name, name_te: s.name_te, name_hi: s.name_hi,
    lat: s.center_lat, lng: s.center_lng, capacity: null, is_accessible: false, is_open: true, monitored: false,
    current_count: null, density_level: 'unknown', density_source: null, density_updated_at: null, details: {},
    verification: 'source', source: s.source, source_ref: s.source_ref, source_retrieved_at: null, verified_at: null, verification_note: null,
  }
}
const RANK: Record<Level, number> = { critical: 0, high: 1, moderate: 2, low: 3, unknown: 4 }
const LOCALE: Record<string, string> = { te: 'te-IN', hi: 'hi-IN', en: 'en-IN' }
/** Two columns only when the container is wide enough (container-driven, not viewport-driven). */
const AUTO2: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 'var(--s5)', alignItems: 'start' }

export function alertText(a: Alert, lang: string) {
  return {
    title: (lang === 'te' && a.title_te) || (lang === 'hi' && a.title_hi) || a.title,
    body: (lang === 'te' && a.body_te) || (lang === 'hi' && a.body_hi) || a.body,
  }
}

/** Sheet: "I am near…" manual location for users without GPS. */
export function ChoosePlaceSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, tr, name } = useLang()
  const { places } = useStore()
  const sites = useSites()
  const { setManual, manual } = useMyLocation()
  const [q, setQ] = useState('')
  const groups: { title: string; types: string[] }[] = [
    { title: t('gates'), types: ['gate'] },
    { title: t('ghats'), types: ['ghat'] },
    { title: tr({ te: 'సహాయ కేంద్రాలు', hi: 'सहायता केंद्र', en: 'Help desks' }), types: ['help_desk', 'lost_found', 'police'] },
  ]
  const match = (l: Location) => !q || [l.name, l.name_te, l.name_hi, l.code].some((s) => s && s.toLowerCase().includes(q.toLowerCase()))
  const centres = (sites ?? []).map(siteAsLocation).filter(match)
  return (
    <Sheet open={open} onClose={onClose} title={t('iAmNear')}>
      <div className="stack">
        <div className="search"><MapPin size={18} aria-hidden /><input className="input" placeholder={t('search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('search')} /></div>
        {centres.length > 0 && (
          <div className="stack tight">
            <h3 className="eyebrow">{t('bathingCentres')}</h3>
            <div className="list grouped">
              {centres.map((l) => (
                <ListRow key={l.id} icon={<Waves size={20} />} title={name(l)} chevron
                  trail={manual?.locationId === l.id ? <span className="chip info">{t('chosenPlace')}</span> : undefined}
                  onClick={() => { setManual(l); onClose() }} />
              ))}
            </div>
          </div>
        )}
        {groups.map((g) => {
          // only places with a verified position can be a starting point
          const items = places.filter((l) => g.types.includes(l.type) && hasCoords(l) && match(l))
          if (!items.length) return null
          return (
            <div key={g.title} className="stack tight">
              <h3 className="eyebrow">{g.title}</h3>
              <div className="list grouped">
                {items.map((l) => (
                  <ListRow key={l.id} icon={<TypeIcon type={l.type} />} title={name(l)} chevron
                    trail={manual?.locationId === l.id ? <span className="chip info">{t('chosenPlace')}</span> : undefined}
                    onClick={() => { setManual(l); onClose() }} />
                ))}
              </div>
            </div>
          )
        })}
        {manual && <button className="btn ghost block" onClick={() => { setManual(null); onClose() }}>{tr({ te: 'ఎంచుకున్న ప్రదేశం తొలగించు', hi: 'चुना गया स्थान हटाएँ', en: 'Clear chosen place' })}</button>}
      </div>
    </Sheet>
  )
}

function CardHead({ title, to, label, extra }: { title: string; to?: string; label?: string; extra?: ReactNode }) {
  return (
    <div className="card-head">
      <h2>{title}</h2>
      <div className="row" style={{ gap: 'var(--s3)' }}>
        {extra}
        {to && label && <Link to={to} className="btn ghost sm" style={{ paddingInline: 8 }}>{label}<ChevronRight size={16} aria-hidden /></Link>}
      </div>
    </div>
  )
}

function LocationCard({ onChoose }: { onChoose: () => void }) {
  const { t, tr, name, walkText } = useLang()
  const { places } = useStore()
  const sites = useSites()
  const { pos, perm, requesting, lastError, requestGps, coords } = useMyLocation()
  // Nearest useful anchor: a festival entry gate close by, else a mapped ghat, else the nearest bathing centre (town).
  const target = useMemo(() => {
    if (!coords) return null
    const gate = nearest(places.filter((l) => l.type === 'gate' && hasCoords(l) && l.verification !== 'unavailable'), coords)
    if (gate && gate.d <= 3000) return { kind: 'gate' as const, l: gate, to: `/map?to=${gate.id}`, label: t('nearestGate') }
    const ghat = nearest(places.filter((l) => l.type === 'ghat' && hasCoords(l) && l.verification !== 'unavailable'), coords)
    if (ghat && ghat.d <= 20000) return { kind: 'ghat' as const, l: ghat, to: `/places/${ghat.id}`, label: tr({ te: 'సమీప ఘాట్', hi: 'निकटतम घाट', en: 'Nearest ghat' }) }
    const centre = nearest((sites ?? []).map(siteAsLocation), coords)
    if (centre) return { kind: 'centre' as const, l: centre, to: '/ghats', label: tr({ te: 'సమీప స్నాన కేంద్రం', hi: 'निकटतम स्नान केंद्र', en: 'Nearest bathing centre' }) }
    return null
  }, [places, sites, coords, t, tr])
  const nearestCentre = useMemo(() => (coords ? nearest((sites ?? []).map(siteAsLocation), coords) : null), [sites, coords])
  const farKm = pos?.source === 'gps' && nearestCentre ? nearestCentre.d / 1000 : 0
  const denied = perm === 'denied' || lastError === 'denied'
  return (
    <section className="card stack" aria-label={t('myLocation')}>
      <div className="row top">
        <span aria-hidden style={{ width: 40, height: 40, borderRadius: 'var(--r-md)', display: 'grid', placeItems: 'center', background: 'var(--brand-100)', color: 'var(--brand-ink)', flexShrink: 0 }}>
          {pos ? <LocateFixed size={20} /> : <MapPin size={20} />}
        </span>
        <div className="grow">
          <div className="eyebrow">{t('myLocation')}</div>
          <div className="strong">
            {pos?.source === 'gps' && <>{t('gpsFix')}{pos.accuracy && pos.accuracy >= 1 ? ` · ±${Math.round(pos.accuracy)} m` : ''}</>}
            {pos?.source === 'manual' && <>{t('chosenPlace')}: {pos.label}</>}
            {!pos && t('locationOff')}
          </div>
        </div>
        {pos && <button className="btn sm ghost" onClick={onChoose}>{t('change')}</button>}
      </div>

      {farKm > 25 && (
        <Notice tone="warn" icon={TriangleAlert}>
          {t('farFromSite')} ({fmtDist(farKm * 1000)} {t('away')}). {tr({ te: 'దూరాలు మీ ప్రస్తుత స్థానం నుండి. మీరు ఉన్న ప్రదేశాన్ని ఎంచుకోవచ్చు.', hi: 'दूरी आपके वर्तमान स्थान से है। आप अपना स्थान चुन सकते हैं।', en: 'Distances are from where you are now. You can choose a place instead.' })}
        </Notice>
      )}

      {target && pos && (
        <Link to={target.to} className="lrow" style={{ background: 'var(--brand-50)' }} aria-label={`${target.label}: ${name(target.l)}`}>
          <span className="lead" aria-hidden>{target.kind === 'centre' ? <Waves size={20} /> : <TypeIcon type={target.l.type} />}</span>
          <span className="body">
            <span className="eyebrow">{target.label}</span>
            <span className="title">{name(target.l)}</span>
            <span className="meta"><span>{fmtDist(target.l.d)}{target.l.d <= 20000 ? ` · ${walkText(walkMinutes(target.l.d))}` : ''}</span></span>
            {/* a crowd level appears only with a fresh, verified reading */}
            {target.l.monitored && target.l.density_updated_at && !target.l.is_stale && (
              <span className="row wrap" style={{ marginTop: 4 }}><StatusBadge level={target.l.density_level} stale={target.l.is_stale} /><Freshness iso={target.l.density_updated_at} source={target.l.density_source} /></span>
            )}
          </span>
          <span className="trail">{target.kind === 'gate' ? <Navigation size={20} aria-hidden className="muted" /> : <ChevronRight size={20} aria-hidden className="muted" />}</span>
        </Link>
      )}

      {!pos && (
        <>
          <p className="small muted">{denied ? t('locationDenied') : t('locationWhy')}</p>
          <div className="row wrap">
            {!denied && perm !== 'unsupported' && (
              <button className="btn tonal grow" onClick={() => void requestGps()} disabled={requesting} aria-busy={requesting || undefined}>
                {requesting ? <span className="spin" aria-hidden /> : <LocateFixed size={18} aria-hidden />}{t('useMyLocation')}
              </button>
            )}
            <button className="btn grow" onClick={onChoose}><MapPinned size={18} aria-hidden />{t('chooseManually')}</button>
          </div>
          {lastError === 'timeout' && <p className="small muted">{tr({ te: 'GPS సిగ్నల్ దొరకలేదు. బహిరంగ ప్రదేశంలో మళ్ళీ ప్రయత్నించండి.', hi: 'GPS सिग्नल नहीं मिला। खुली जगह पर पुनः प्रयास करें।', en: 'Could not get a GPS fix. Try again in the open.' })}</p>}
        </>
      )}
      {pos?.source === 'manual' && perm !== 'denied' && perm !== 'unsupported' && (
        <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => void requestGps()} disabled={requesting}>
          {requesting ? <span className="spin" aria-hidden /> : <LocateFixed size={16} aria-hidden />}{t('useMyLocation')}
        </button>
      )}
    </section>
  )
}

function CrowdCard() {
  const { t, tr, name, clock } = useLang()
  const { crowd, lastSync } = useStore()
  const { coords, nearParam } = useMyLocation()
  const [recs, setRecs] = useState<Recommendation[] | null>(null)
  useEffect(() => {
    let alive = true
    api.get<Recommendation[]>(`/crowd/recommendations?for=ghat${nearParam}&limit=4`).then((r) => { if (alive) setRecs(r) }).catch(() => { if (alive) setRecs([]) })
    return () => { alive = false }
  }, [nearParam, crowd.length])

  const title = tr({ te: 'ఇప్పుడు రద్దీ', hi: 'अभी भीड़', en: 'Live crowd' })
  const fresh = crowd.filter((c) => !c.is_stale && c.density_level !== 'unknown')
  let content: ReactNode
  if (lastSync == null && crowd.length === 0) content = <Skeleton rows={3} />
  else if (fresh.length === 0) content = (
    <EmptyState icon={Gauge} title={tr({ te: 'ఇంకా ధృవీకరించిన రద్దీ సమాచారం లేదు', hi: 'अभी सत्यापित भीड़ जानकारी नहीं', en: 'No verified crowd data yet' })}
      body={tr({ te: 'ఘాట్‌ల వద్ద కెమెరాలు లేదా సిబ్బంది నివేదించినప్పుడు రద్దీ స్థాయిలు కనిపిస్తాయి.', hi: 'घाटों पर कैमरे या कर्मचारी रिपोर्ट करेंगे तब भीड़ का स्तर दिखेगा।', en: 'Crowd levels appear when cameras or staff at the ghats report them.' })} />
  )
  else {
    const ghats = fresh.filter((c) => c.type === 'ghat')
    const dist = (c: { lat: number | null; lng: number | null }) => (coords && c.lat != null && c.lng != null ? haversineM(coords[0], coords[1], c.lat, c.lng) : null)
    const far = Number.MAX_SAFE_INTEGER
    const crowded = fresh.filter((c) => c.density_level === 'high' || c.density_level === 'critical')
      .sort((a, b) => (coords ? (dist(a) ?? far) - (dist(b) ?? far) : RANK[a.density_level] - RANK[b.density_level])).slice(0, 3)
    const alts = (recs ?? []).filter((r) => !r.location.is_stale && r.location.is_open && (r.location.density_level === 'low' || r.location.density_level === 'moderate')).slice(0, 2)
    content = (
      <div className="stack" style={{ gap: 'var(--s5)' }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 'var(--s2)' }}>{t('ghats')}</div>
          <div role="list" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 124px), 1fr))', gap: 'var(--s2)' }}>
            {LEVELS.map((l) => {
              const I = LEVEL_ICON[l]
              const n = ghats.filter((g) => g.density_level === l).length
              return (
                <div key={l} role="listitem" className="stat" style={{ padding: 'var(--s3)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', background: n ? `var(--${l}-soft)` : 'var(--surface)' }}>
                  <span className="v" style={{ color: n ? `var(--${l})` : 'var(--muted)' }}>{n}</span>
                  <span className="l row" style={{ gap: 4, color: n ? `var(--${l})` : 'var(--muted)' }}><I size={14} aria-hidden />{t(l as Key)}</span>
                </div>
              )
            })}
          </div>
        </div>
        {(crowded.length > 0 || alts.length > 0) && (
          <div style={AUTO2}>
            {crowded.length > 0 && (
              <div className="stack tight">
                <h3 className="eyebrow">{tr({ te: 'మీ దగ్గర రద్దీ ఎక్కువ', hi: 'आपके पास भीड़', en: 'Crowded near you' })}</h3>
                <div className="list">
                  {crowded.map((c) => {
                    const d = dist(c)
                    return (
                      <ListRow key={c.location_id} to={`/crowd?sel=${c.location_id}`} icon={<TypeIcon type={c.type} />} title={name(c)}
                        meta={<><StatusBadge level={c.density_level} stale={c.is_stale} />{d != null && <span>{fmtDist(d)}</span>}<Freshness iso={c.updated_at} source={c.source} /></>} chevron />
                    )
                  })}
                </div>
              </div>
            )}
            {alts.length > 0 && (
              <div className="stack tight">
                <h3 className="eyebrow">{tr({ te: 'తక్కువ రద్దీ ఉన్న ప్రత్యామ్నాయాలు', hi: 'कम भीड़ वाले विकल्प', en: 'Less crowded alternatives' })}</h3>
                <div className="list">
                  {alts.map((r) => (
                    <ListRow key={r.location.location_id} to={`/map?to=${r.location.location_id}`} tone="sage" icon={<Waves size={20} />} title={name(r.location)}
                      ariaLabel={`${t('directions')}: ${name(r.location)}`}
                      meta={<><StatusBadge level={r.location.density_level} />{r.distance_m != null && <span>{fmtDist(r.distance_m)}</span>}<Freshness iso={r.location.updated_at} source={r.location.source} /></>}
                      trail={<Navigation size={20} aria-hidden className="muted" />} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }
  return (
    <section className="card" aria-label={title}>
      <CardHead title={title} to="/crowd" label={t('seeAll')} extra={lastSync != null ? <span className="xs muted hide-mobile">{t('updated')} {clock(lastSync)}</span> : undefined} />
      {content}
      {lastSync != null && <p className="xs muted only-mobile" style={{ marginTop: 'var(--s3)' }}>{t('updated')} {clock(lastSync)}</p>}
    </section>
  )
}

function MapCard() {
  const { t } = useLang()
  const { places } = useStore()
  const sites = useSites()
  const { coords } = useMyLocation()
  // Only places with verified coordinates are drawn. Without a user position, show the mapped ghats and the bathing centres.
  const shown = useMemo<Location[]>(() => {
    const base = places.filter((l) => PREVIEW_TYPES.includes(l.type) && hasCoords(l))
    if (!coords) return [...base.filter((l) => l.type === 'ghat'), ...(sites ?? []).map(siteAsLocation)]
    return base.map((l) => ({ l, d: haversineM(coords[0], coords[1], l.lat as number, l.lng as number) }))
      .filter((x) => x.d <= 20000).sort((a, b) => a.d - b.d).slice(0, 25).map((x) => x.l)
  }, [places, sites, coords])
  const first = shown.find(hasCoords)
  const center: [number, number] | null = coords ?? (first ? [first.lat as number, first.lng as number] : null)
  return (
    <section className="card" aria-label={t('map')}>
      <CardHead title={t('map')} to="/map" label={t('openMap')} />
      {!center ? <div className="map-preview skel" aria-hidden /> : (
        <div className="map-preview">
          <LazyMap center={center} zoom={15} locations={shown} me={coords} interactive={false} fitLocations height="100%" />
        </div>
      )}
    </section>
  )
}

function NearbyCard({ onChoose }: { onChoose: () => void }) {
  const { t, tr } = useLang()
  const { places, lastSync } = useStore()
  const { coords, requestGps, requesting, perm } = useMyLocation()
  let content: ReactNode
  if (lastSync == null && places.length === 0) content = <Skeleton rows={3} />
  else if (!coords) content = (
    <Notice icon={MapPin}>
      <div className="stack tight">
        <span>{tr({ te: 'సమీప సౌకర్యాలు చూడటానికి మీ స్థానాన్ని సెట్ చేయండి.', hi: 'पास की सुविधाएँ देखने के लिए अपना स्थान सेट करें।', en: 'Set your location to see the nearest facilities.' })}</span>
        <div className="row wrap">
          {perm !== 'denied' && perm !== 'unsupported' && <button className="btn sm tonal" onClick={() => void requestGps()} disabled={requesting}>{requesting ? <span className="spin" aria-hidden /> : <LocateFixed size={16} aria-hidden />}{t('useMyLocation')}</button>}
          <button className="btn sm" onClick={onChoose}>{t('chooseManually')}</button>
        </div>
      </div>
    </Notice>
  )
  else {
    const near = places.filter((l) => NEARBY_TYPES.includes(l.type) && l.is_open && hasCoords(l) && l.verification !== 'unavailable')
      .map((l) => ({ l, d: haversineM(coords[0], coords[1], l.lat as number, l.lng as number) }))
      .filter((x) => x.d <= NEARBY_MAX_M).sort((a, b) => a.d - b.d).slice(0, 4)
    content = near.length === 0
      ? <EmptyState icon={LayoutGrid} title={tr({ te: '5 కి.మీ. లోపు సౌకర్యాలు మ్యాప్ చేయబడలేదు', hi: '5 किमी के भीतर कोई सुविधा मैप नहीं', en: 'No facilities mapped within 5 km' })}
          body={tr({ te: 'పండుగ సౌకర్యాలు (మరుగుదొడ్లు, దుస్తులు మార్చే గదులు, సహాయ కేంద్రాలు) నిర్వాహకులు ఇంకా ప్రచురించలేదు.', hi: 'उत्सव सुविधाएँ (शौचालय, वस्त्र कक्ष, सहायता केंद्र) आयोजकों ने अभी प्रकाशित नहीं कीं।', en: 'Festival facilities (toilets, changing rooms, help desks) have not been published by the organisers yet.' })}
          action={<Link className="btn tonal sm" to="/ghats">{tr({ te: 'ఘాట్‌లు చూడండి', hi: 'घाट देखें', en: 'Browse ghats' })}</Link>} />
      : <div style={{ ...AUTO2, gap: 'var(--s2)' }}>{near.map(({ l, d }) => <PlaceRow key={l.id} loc={{ ...l, distance_m: d }} />)}</div>
  }
  return (
    <section className="card" aria-label={t('facilitiesNearMe')}>
      <CardHead title={t('facilitiesNearMe')} to="/services" label={t('seeAll')} />
      {content}
    </section>
  )
}

function AlertsCard({ items, hasCritical }: { items: Alert[]; hasCritical: boolean }) {
  const { t, lang } = useLang()
  return (
    <section className="card" aria-label={t('alerts')}>
      <CardHead title={t('alerts')} to="/alerts" label={t('seeAll')} />
      {items.length === 0 ? (
        hasCritical ? <p className="small muted">{t('noAlerts')}</p> : <EmptyState icon={Info} title={t('noAlerts')} />
      ) : (
        <div className="list">
          {items.map((a) => {
            const x = alertText(a, lang)
            const I = a.severity === 'warning' ? TriangleAlert : Info
            return (
              <Link key={a.id} to="/alerts" className={`alert ${a.severity}`} style={{ textDecoration: 'none', color: 'inherit', boxShadow: 'none' }}>
                <I size={20} aria-hidden className="a-ic" />
                <div className="grow"><div className="a-title">{x.title}</div><div className="a-body clamp2">{x.body}</div></div>
              </Link>
            )
          })}
        </div>
      )}
    </section>
  )
}

export default function HomePage() {
  const { t, tr, name, lang, clock } = useLang()
  const { user, alerts, places } = useStore()
  const sites = useSites()
  const { coords } = useMyLocation()
  const [choose, setChoose] = useState(false)
  const desktop = useBreakpoint() === 'desktop'
  // the header names the bathing centre the pilgrim is at, only when they are actually near one
  const here = useMemo(() => {
    const c = coords ? nearest((sites ?? []).map(siteAsLocation), coords) : null
    return c && c.d <= 25000 ? c : null
  }, [sites, coords])
  const hasDemo = places.some((p) => p.verification === 'demo')

  const critical = alerts.filter((a) => a.severity === 'critical')
  const others = alerts.filter((a) => a.severity !== 'critical').sort((a, b) => (a.severity === b.severity ? b.created_at.localeCompare(a.created_at) : a.severity === 'warning' ? -1 : 1)).slice(0, 3)
  const hour = new Date().getHours()
  const greet = hour < 12 ? tr({ te: 'శుభోదయం', hi: 'सुप्रभात', en: 'Good morning' }) : hour < 17 ? tr({ te: 'నమస్కారం', hi: 'नमस्कार', en: 'Good afternoon' }) : tr({ te: 'శుభ సాయంత్రం', hi: 'शुभ संध्या', en: 'Good evening' })
  let today = ''
  try { today = new Date().toLocaleDateString(LOCALE[lang] ?? 'en-IN', { weekday: 'long', day: 'numeric', month: 'long' }) } catch { today = new Date().toDateString() }

  const quick = [
    { to: '/ghats', icon: Waves, key: 'findGhat' as Key, tone: '' },
    { to: '/crowd', icon: Users, key: 'crowdStatus' as Key, tone: '' },
    { to: '/parking', icon: SquareParking, key: 'findParking' as Key, tone: '' },
    { to: '/family', icon: UsersRound, key: 'familyTracker' as Key, tone: '' },
    { to: '/missing', icon: SearchCheck, key: 'findMissing' as Key, tone: '' },
    { to: '/services', icon: LayoutGrid, key: 'facilitiesNearMe' as Key, tone: '' },
    { to: '/facilities?type=medical', icon: HeartPulse, key: 'medicalHelp' as Key, tone: 'danger' },
    { to: '/emergency', icon: Siren, key: 'emergencyAssist' as Key, tone: 'danger' },
  ]

  const locationCard = <LocationCard onChoose={() => setChoose(true)} />
  const mapCard = <MapCard />
  const alertsCard = <AlertsCard items={others} hasCritical={critical.length > 0} />

  return (
    <div className="stack loose">
      {critical.map((a) => {
        const x = alertText(a, lang)
        return (
          <div key={a.id} className="alert critical" role="alert">
            <OctagonAlert size={22} aria-hidden className="a-ic" />
            <div className="grow"><div className="a-title">{x.title}</div><div className="a-body">{x.body}</div><div className="xs muted" style={{ marginTop: 4 }}>{clock(a.created_at)}</div></div>
          </div>
        )
      })}

      <header className="row between wrap" style={{ alignItems: 'flex-end', gap: 'var(--s4)' }}>
        <div className="grow" style={{ minWidth: 'min(100%, 220px)' }}>
          <div className="eyebrow">{today}</div>
          <h1 style={{ marginTop: 4 }}>{greet}{user?.name ? `, ${user.name}` : ''}</h1>
          <p className="small muted" style={{ marginTop: 2 }}>{here ? name(here) : t('tagline')}</p>
        </div>
        <div className="row wrap hide-mobile">
          <Link className="btn" to="/map"><MapPinned size={18} aria-hidden />{t('openMap')}</Link>
          <Link className="btn primary" to="/crowd"><Gauge size={18} aria-hidden />{t('crowdStatus')}</Link>
        </div>
      </header>

      <div className="layout-aside">
        <div className="stack loose" style={{ minWidth: 0 }}>
          {!desktop && locationCard}
          <nav aria-label={t('services')} className="quick-grid">
            {quick.map((q) => {
              const I = q.icon
              return <Link key={q.to} to={q.to} className="quick"><span className={`qi ${q.tone}`} aria-hidden><I size={24} /></span>{t(q.key)}</Link>
            })}
          </nav>
          <CrowdCard />
          {!desktop && mapCard}
          <NearbyCard onChoose={() => setChoose(true)} />
          {!desktop && alertsCard}
        </div>
        {desktop && (
          <aside className="stack loose" aria-label={tr({ te: 'సారాంశం', hi: 'सारांश', en: 'Summary' })}>
            {locationCard}
            {mapCard}
            {alertsCard}
          </aside>
        )}
      </div>

      <footer className="stack">
        {user && user.role !== 'pilgrim' && (
          <div className="list grouped">
            <ListRow to="/staff" icon={<Briefcase size={20} />} title={t('staffMode')} chevron />
            {(user.role === 'staff' || user.role === 'admin') && <ListRow to="/admin" icon={<MonitorCog size={20} />} title={t('admin')} chevron />}
          </div>
        )}
        {hasDemo ? <Notice icon={Info}>{t('demoNote')}</Notice> : (
          <Notice icon={Info}>
            <div className="stack tight">
              <strong>{t('dataSource')}</strong>
              <span>{tr({
                te: 'ఘాట్ మరియు సౌకర్యాల స్థానాలు: OpenStreetMap సహకారులు. అధికారిక 2027 ఘాట్ జాబితాలు, ప్రవేశ గేట్లు మరియు పండుగ పార్కింగ్ ఇంకా ప్రచురించబడలేదు.',
                hi: 'घाट और सुविधाओं के स्थान: OpenStreetMap योगदानकर्ता। आधिकारिक 2027 घाट सूची, प्रवेश द्वार और उत्सव पार्किंग अभी प्रकाशित नहीं हुए।',
                en: 'Ghat and facility positions: OpenStreetMap contributors. Official 2027 ghat lists, entry gates and festival parking are not yet published.',
              })}</span>
              <Link to="/ghats" className="btn ghost sm" style={{ alignSelf: 'flex-start', paddingInline: 8 }}>{tr({ te: 'ఘాట్‌లు చూడండి', hi: 'घाट देखें', en: 'Browse ghats' })}<ChevronRight size={16} aria-hidden /></Link>
            </div>
          </Notice>
        )}
      </footer>

      <ChoosePlaceSheet open={choose} onClose={() => setChoose(false)} />
    </div>
  )
}
