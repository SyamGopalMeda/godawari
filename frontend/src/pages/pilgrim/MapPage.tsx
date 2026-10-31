/* Explore map: search, layer filters, tap-to-select place details, walking routes.
   - Only places with verified coordinates become pins or route destinations. Places named by a source but
     without a verified position appear in search results with a "Location not verified" badge and a link
     to their details page.
   - Routes come from the organisers' walkway graph (crowd-aware) when published, otherwise from OpenStreetMap
     footpaths (OSRM); the panel says which, and always offers the phone's maps app as a fallback.
   Phones: full-screen map with overlays, bottom card and a Map/List toggle.
   Tablets: same, with the card constrained to a 420 px column on the left.
   Desktop (≥1024): two panes – a 400 px side panel (search + layers + list / place details / route) and the map. */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Accessibility, ArrowLeft, Ban, ChevronDown, ChevronUp, CircleHelp, ExternalLink, Footprints, Info, List as ListIcon, LocateFixed, Map as MapIcon,
  MapPin, MapPinOff, Navigation, OctagonAlert, Phone, Route as RouteIcon, Search, TriangleAlert, Users, X,
} from 'lucide-react'
import { api, ApiError, externalDirections, fmtDist, hasCoords, type Level, type Location, type Recommendation, type Route, type RouteStep } from '../../api'
import { useLang, type Key } from '../../i18n'
import { useStore } from '../../store'
import { useMyLocation } from '../../location'
import { haversineM, walkMinutes } from '../../geo'
import MapView, { MapFabs } from '../../components/MapView'
import { TypeIcon, typeMeta, LEVEL_ICON, type Tone } from '../../components/icons'
import { EmptyState, FilterChips, Freshness, Notice, PlaceRow, Segmented, Sheet, StatusBadge, VerificationBadge, useBreakpoint } from '../../components/ui'

type Layer = 'all' | 'ghat' | 'gate' | 'transport' | 'help' | 'amenity'
const LAYERS: Record<Layer, string[] | null> = {
  all: null, ghat: ['ghat'], gate: ['gate', 'checkpoint'], transport: ['parking', 'bus_stop', 'railway_station'],
  help: ['help_desk', 'medical', 'police', 'lost_found'], amenity: ['restroom', 'water', 'dressing_room', 'food', 'rest_area'],
}
const TONE_BG: Record<Tone, [string, string]> = {
  brand: ['var(--brand-100)', 'var(--brand-ink)'], copper: ['var(--copper-100)', 'var(--copper-700)'], sage: ['var(--sage-100)', 'var(--sage-700)'],
  accent: ['var(--saffron-100)', 'var(--saffron-700)'], danger: ['var(--danger-soft)', 'var(--danger)'],
}
const iconBox = (bg: string, fg: string) => ({ width: 42, height: 42, borderRadius: 'var(--r-md)', display: 'grid', placeItems: 'center', background: bg, color: fg, flexShrink: 0 }) as const
const norm = (s?: string | null) => (s ?? '').toLowerCase()

function ChoosePlaceSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, name } = useLang()
  const { places } = useStore()
  const { setManual } = useMyLocation()
  const opts = places.filter((p) => hasCoords(p) && ['gate', 'ghat', 'help_desk', 'parking', 'bus_stop', 'railway_station'].includes(p.type))
  return (
    <Sheet open={open} onClose={onClose} title={t('iAmNear')}>
      {opts.length === 0 ? <EmptyState icon={MapPinOff} title={t('noneNearby')} /> : (
        <div className="list grouped">
          {opts.map((p) => (
            <button key={p.id} type="button" className="lrow" onClick={() => { setManual(p); onClose() }}>
              <span className={`lead ${typeMeta(p.type).tone === 'brand' ? '' : typeMeta(p.type).tone}`} aria-hidden><TypeIcon type={p.type} /></span>
              <span className="body"><span className="title">{name(p)}</span><span className="meta">{t((p.type in LAYER_KEYS ? p.type : 'other') as Key)}</span></span>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  )
}
// place types that have an i18n label key
const LAYER_KEYS: Record<string, true> = {
  ghat: true, gate: true, checkpoint: true, parking: true, help_desk: true, medical: true, restroom: true, water: true, dressing_room: true, food: true,
  rest_area: true, police: true, lost_found: true, bus_stop: true, shuttle: true, railway_station: true, other: true,
}
const typeKey = (type: string) => (type in LAYER_KEYS ? type : 'other') as Key

export default function MapPage() {
  const { t, tr, name, walkText, ago } = useLang()
  const { places, site } = useStore()
  const { coords, requestGps, requesting, perm, pos } = useMyLocation()
  const bp = useBreakpoint()
  const desktop = bp === 'desktop'
  const [params, setParams] = useSearchParams()
  const to = params.get('to') ? Number(params.get('to')) : null
  const selParam = params.get('sel') ? Number(params.get('sel')) : null
  const [layer, setLayer] = useState<Layer>('all')
  const [mode, setMode] = useState<'map' | 'list'>('map')
  const [selId, setSelId] = useState<number | null>(selParam)
  const [focus, setFocus] = useState<[number, number] | null>(null)
  const [legend, setLegend] = useState(false)
  const [choose, setChoose] = useState(false)
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [accessible, setAccessible] = useState(false)
  const [avoid, setAvoid] = useState(true)
  const [route, setRoute] = useState<Route | null>(null)
  const [routeErr, setRouteErr] = useState<string | null>(null)
  const [routeErrCode, setRouteErrCode] = useState<number | null>(null)
  const [routeLoading, setRouteLoading] = useState(false)
  const [stepsOpen, setStepsOpen] = useState(false)

  useEffect(() => { if (selParam) setSelId(selParam) }, [selParam])

  const dest = to ? places.find((l) => l.id === to) ?? null : null
  const destMapped = !!dest && hasCoords(dest)
  // a closed or over-capacity destination: never route there; offer verified alternatives of the same type
  const destBlocked = (l: Location) => !l.is_open || (l.monitored && !l.is_stale && l.density_level === 'critical')
  const [alts, setAlts] = useState<Recommendation[]>([])
  const blocked = !!dest && destBlocked(dest)
  useEffect(() => {
    if (!dest || !blocked) { setAlts([]); return }
    let alive = true
    api.get<Recommendation[]>(`/crowd/recommendations?for=${dest.type}${coords ? `&near=${coords[0]},${coords[1]}` : ''}&limit=6`)
      .then((r) => { if (alive) setAlts(r.filter((x) => x.location.location_id !== dest.id && x.location.lat != null && x.location.is_open && !x.location.is_stale && (x.location.density_level === 'low' || x.location.density_level === 'moderate')).slice(0, 3)) })
      .catch(() => { if (alive) setAlts([]) })
    return () => { alive = false }
  }, [dest?.id, blocked]) // eslint-disable-line react-hooks/exhaustive-deps
  const goTo = (id: number) => setParams({ to: String(id) })
  const sel = selId ? places.find((l) => l.id === selId) ?? null : null

  useEffect(() => { if (sel && !to && hasCoords(sel)) setFocus([sel.lat, sel.lng]) }, [sel?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const qq = query.trim().toLowerCase()
  const matches = (l: Location) => !qq || [l.name, l.name_te, l.name_hi, l.code].some((x) => norm(x).includes(qq))
  const inLayer = (l: Location) => { const f = LAYERS[layer]; return !f || f.includes(l.type) }

  // pins: mapped places only (never a place without verified coordinates)
  const shown = useMemo(() => {
    const base = places.filter((l) => hasCoords(l) && inLayer(l) && matches(l))
    const extra = [to, selId].filter((x): x is number => !!x && !base.some((l) => l.id === x))
    return [...base, ...places.filter((l) => extra.includes(l.id) && hasCoords(l))]
  }, [places, layer, qq, to, selId]) // eslint-disable-line react-hooks/exhaustive-deps

  // list / search results: mapped first (by distance when known), then places without a verified position
  const listed = useMemo(() => {
    const arr = places.filter((l) => inLayer(l) && matches(l))
    const d = (l: Location) => (coords && hasCoords(l) ? haversineM(coords[0], coords[1], l.lat, l.lng) : Number.POSITIVE_INFINITY)
    return arr.sort((a, b) => Number(!hasCoords(a)) - Number(!hasCoords(b)) || d(a) - d(b) || a.name.localeCompare(b.name))
  }, [places, layer, qq, coords]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setRouteErrCode(null)
    if (!to || !coords) { setRoute(null); setRouteErr(null); return }
    if (!dest) return // wait for place data so a closed / over-capacity destination is known before asking for a route
    if (!hasCoords(dest)) { setRoute(null); setRouteErr('unverified'); setRouteErrCode(409); setRouteLoading(false); return }
    if (blocked) { setRoute(null); setRouteErr('blocked'); setRouteLoading(false); return }
    let alive = true
    setRouteErr(null); setRouteLoading(true)
    api.get<Route>(`/routes?from=${coords[0]},${coords[1]}&to=${to}&accessible=${accessible}&avoid_crowd=${avoid}`)
      .then((r) => { if (alive) setRoute(r) })
      .catch((e) => {
        if (!alive) return
        const code = (e as ApiError).status ?? 0
        setRoute(null)
        setRouteErrCode(code)
        setRouteErr(code === 404
          ? tr({ te: 'ప్రస్తుతం నడక మార్గం లేదు (మూసివేసిన లేదా చాలా రద్దీ ప్రాంతాలు). దగ్గరలోని సిబ్బందిని అడగండి.', hi: 'अभी पैदल मार्ग उपलब्ध नहीं (बंद या बहुत भीड़ वाले क्षेत्र)। पास के कर्मचारी से पूछें।', en: 'No walkable route right now (closed or very crowded areas). Ask nearby staff.' })
          : (e as Error).message)
      })
      .finally(() => { if (alive) setRouteLoading(false) })
    return () => { alive = false }
  }, [to, dest?.id, coords?.[0], coords?.[1], accessible, avoid, blocked]) // eslint-disable-line react-hooks/exhaustive-deps

  const firstMapped = places.find(hasCoords)
  const center: [number, number] = coords ?? (sel && hasCoords(sel) ? [sel.lat, sel.lng] : firstMapped ? [firstMapped.lat, firstMapped.lng] : site ? [site.center_lat, site.center_lng] : [17.0084, 81.7669])
  const fitAll = !coords && !dest && !sel && !focus
  const chips: { value: Layer; label: string }[] = [
    { value: 'all', label: tr({ te: 'అన్నీ', hi: 'सभी', en: 'All' }) }, { value: 'ghat', label: t('ghats') }, { value: 'gate', label: t('gates') },
    { value: 'transport', label: tr({ te: 'పార్కింగ్ & రవాణా', hi: 'पार्किंग व परिवहन', en: 'Parking & transport' }) },
    { value: 'help', label: tr({ te: 'సహాయం', hi: 'सहायता', en: 'Help' }) }, { value: 'amenity', label: t('facilities') },
  ]
  const straight = dest && coords && hasCoords(dest) ? haversineM(coords[0], coords[1], dest.lat, dest.lng) : null
  const select = (l: Location | null) => {
    setSelId(l?.id ?? null)
    const next = new URLSearchParams(params)
    next.delete('sel')
    if (l && !to) next.set('sel', String(l.id))
    setParams(next, { replace: true })
  }
  const startRoute = (l: Location) => { setSelId(null); setParams({ to: String(l.id) }); setMode('map') }
  const endRoute = () => { setParams({}); setRoute(null); setRouteErr(null); setRouteErrCode(null) }
  const legendLabel = tr({ te: 'చిహ్నాల అర్థం', hi: 'संकेतों का अर्थ', en: 'Map legend' })
  const layerChips = <FilterChips label={tr({ te: 'పొరలు', hi: 'परतें', en: 'Layers' })} options={chips} selected={layer} onToggle={(v) => setLayer(v)} />
  const searchLabel = tr({ te: 'ఘాట్ లేదా ప్రదేశం వెతకండి', hi: 'घाट या स्थान खोजें', en: 'Search ghats and places' })
  const searchBox = (autoFocus = false) => (
    <div className="search" role="search">
      <Search size={18} aria-hidden />
      <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={searchLabel} aria-label={searchLabel} autoFocus={autoFocus} />
    </div>
  )

  /* ---- localized walking steps (OSRM maneuvers) */
  const dirWord = (m?: string | null): string => {
    switch (m) {
      case 'left': return tr({ te: 'ఎడమ', hi: 'बाएँ', en: 'left' })
      case 'right': return tr({ te: 'కుడి', hi: 'दाएँ', en: 'right' })
      case 'slight left': return tr({ te: 'కొంచెం ఎడమ', hi: 'थोड़ा बाएँ', en: 'slight left' })
      case 'slight right': return tr({ te: 'కొంచెం కుడి', hi: 'थोड़ा दाएँ', en: 'slight right' })
      case 'sharp left': return tr({ te: 'పూర్తిగా ఎడమ', hi: 'तीखा बाएँ', en: 'sharp left' })
      case 'sharp right': return tr({ te: 'పూర్తిగా కుడి', hi: 'तीखा दाएँ', en: 'sharp right' })
      case 'uturn': return tr({ te: 'వెనుకకు', hi: 'यू-टर्न', en: 'U-turn' })
      case 'straight': return tr({ te: 'నేరుగా', hi: 'सीधे', en: 'straight' })
      default: return ''
    }
  }
  const stepText = (s: RouteStep, destName: string): string => {
    if (!s.maneuver) return s.instruction
    const dir = dirWord(s.modifier)
    const on = s.name ? tr({ te: ` (${s.name})`, hi: ` (${s.name})`, en: ` onto ${s.name}` }) : ''
    switch (s.maneuver) {
      case 'depart':
        return dir ? tr({ te: `${dir} వైపు బయలుదేరండి${on}`, hi: `${dir} की ओर चलें${on}`, en: `Head ${dir}${on}` }) : tr({ te: `బయలుదేరండి${on}`, hi: `चलना शुरू करें${on}`, en: `Start walking${on}` })
      case 'arrive':
        return tr({ te: `${destName} చేరుకోండి`, hi: `${destName} पहुँचें`, en: `Arrive at ${destName}` })
      case 'turn': case 'end of road': case 'fork': case 'on ramp': case 'off ramp': case 'merge':
        if (s.modifier === 'straight') return tr({ te: `నేరుగా కొనసాగండి${on}`, hi: `सीधे चलते रहें${on}`, en: `Continue straight${on}` })
        return dir ? tr({ te: `${dir} వైపు తిరగండి${on}`, hi: `${dir} मुड़ें${on}`, en: `Turn ${dir}${on}` }) : s.instruction
      case 'continue': case 'new name': case 'notification':
        return tr({ te: `నేరుగా కొనసాగండి${on}`, hi: `सीधे चलते रहें${on}`, en: `Continue${dir && s.modifier !== 'straight' ? ` ${dir}` : ''}${on}` })
      case 'roundabout': case 'rotary': case 'roundabout turn': case 'exit roundabout': case 'exit rotary': {
        const exit = /exit (\d+)/.exec(s.instruction)?.[1]
        return exit
          ? tr({ te: `రౌండ్‌అబౌట్ వద్ద ${exit}వ నిష్క్రమణ తీసుకోండి${on}`, hi: `गोलचक्कर पर ${exit}वाँ निकास लें${on}`, en: `At the roundabout take exit ${exit}${on}` })
          : tr({ te: `రౌండ్‌అబౌట్ దాటండి${on}`, hi: `गोलचक्कर पार करें${on}`, en: `Go through the roundabout${on}` })
      }
      default:
        return s.instruction
    }
  }

  const mapsAppLink = (primary: boolean) => dest && hasCoords(dest)
    ? <a className={`btn ${primary ? 'primary block' : 'sm'}`} href={externalDirections(dest.lat, dest.lng)} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} aria-hidden />{t('openInMaps')}</a>
    : null

  const locationPrompt = (
    <Notice icon={LocateFixed}>
      <div className="stack tight">
        <span>{t('locationWhy')}</span>
        {perm === 'denied' && <span>{t('locationDenied')}</span>}
        <div className="row wrap">
          <button className="btn sm primary" onClick={() => void requestGps()} disabled={requesting || perm === 'denied'}>{requesting ? <span className="spin" aria-hidden /> : <LocateFixed size={16} aria-hidden />}{t('useMyLocation')}</button>
          <button className="btn sm" onClick={() => setChoose(true)}><MapPin size={16} aria-hidden />{t('chooseManually')}</button>
        </div>
      </div>
    </Notice>
  )

  /* ---- route panel (overlay card on phones/tablets, side panel on desktop) */
  const renderRoute = (panel: boolean): ReactNode => {
    if (!dest) return null
    const showSteps = panel || stepsOpen
    const destName = name(dest)
    return (
      <>
        <div className="row top">
          {panel
            ? <button className="btn icon sm ghost" onClick={endRoute} aria-label={tr({ te: 'అన్ని ప్రదేశాలు', hi: 'सभी स्थान', en: 'All places' })}><ArrowLeft size={20} aria-hidden /></button>
            : <span style={iconBox('var(--brand-100)', 'var(--brand-ink)')} aria-hidden><RouteIcon size={22} /></span>}
          <div className="grow"><div className="eyebrow">{t('directions')}</div><h2 className="clamp2">{destName}</h2></div>
          {!panel && <button className="btn icon ghost" onClick={endRoute} aria-label={t('close')}><X size={22} aria-hidden /></button>}
        </div>
        {!destMapped ? (
          <Notice tone="warn" icon={MapPinOff}>
            <div className="stack tight">
              <span>{tr({ te: 'ఈ ప్రదేశం స్థానం ఇంకా ధృవీకరించబడలేదు – దారి చూపడం సాధ్యం కాదు.', hi: 'इस स्थान की स्थिति अभी सत्यापित नहीं है – मार्ग उपलब्ध नहीं।', en: "This location's position has not been verified yet – directions are unavailable." })}</span>
              <Link className="btn sm" to={`/places/${dest.id}`} style={{ alignSelf: 'flex-start' }}><Info size={16} aria-hidden />{t('viewDetails')}</Link>
            </div>
          </Notice>
        ) : !coords ? (
          <div className="stack tight">
            <p className="small">{tr({ te: 'మీరు ఎక్కడి నుండి బయలుదేరుతున్నారు?', hi: 'आप कहाँ से चल रहे हैं?', en: 'Where are you starting from?' })}</p>
            {perm === 'denied' && <Notice tone="warn">{t('locationDenied')}</Notice>}
            <div className="grid2">
              <button className="btn primary" onClick={() => void requestGps()} disabled={requesting || perm === 'denied'}>{requesting ? <span className="spin" aria-hidden /> : <LocateFixed size={18} aria-hidden />}{t('useMyLocation')}</button>
              <button className="btn" onClick={() => setChoose(true)}><MapPin size={18} aria-hidden />{t('chooseManually')}</button>
            </div>
            <div className="row">{mapsAppLink(false)}</div>
          </div>
        ) : (
          <>
            {routeLoading && !route && <div className="skel block" aria-busy="true" />}
            {route && (
              <div className="grid2">
                <div className="kpi"><div className="v">{fmtDist(route.distance_m)}</div><div className="l">{t('distance')}</div></div>
                <div className="kpi"><div className="v">{Math.round(route.eta_min)} {t('minShort')}</div><div className="l">{t('eta')}</div></div>
              </div>
            )}
            {route && pos?.source === 'manual' && <span className="chip neutral" style={{ alignSelf: 'flex-start' }}><MapPin aria-hidden />{t('chosenPlace')}: {pos.label}</span>}
            {routeErr && (routeErr === 'blocked' || destBlocked(dest)
              ? <Notice tone="danger" icon={OctagonAlert}>
                  <div className="strong">{!dest.is_open
                    ? tr({ te: `${destName} ప్రస్తుతం మూసివేయబడింది.`, hi: `${destName} अभी बंद है।`, en: `${destName} is closed right now.` })
                    : tr({ te: `${destName} వద్ద అత్యధిక రద్దీ ఉంది. భద్రత కోసం అక్కడికి మార్గం చూపడం లేదు.`, hi: `${destName} पर अत्यधिक भीड़ है। सुरक्षा के लिए वहाँ का मार्ग नहीं दिखाया जा रहा।`, en: `${destName} is over its safe capacity. For safety, no route is offered there right now.` })}</div>
                  {alts.length > 0
                    ? <div className="stack tight" style={{ marginTop: 8 }}>
                        <span>{tr({ te: 'తక్కువ రద్దీ ఉన్న ప్రత్యామ్నాయాలు:', hi: 'कम भीड़ वाले विकल्प:', en: 'Less crowded alternatives:' })}</span>
                        {alts.map((r) => (
                          <button key={r.location.location_id} className="btn sm" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4, padding: '8px 12px', textAlign: 'left', height: 'auto' }} onClick={() => goTo(r.location.location_id)}>
                            <span>{name(r.location)}</span><StatusBadge level={r.location.density_level} stale={r.location.is_stale} />
                          </button>
                        ))}
                      </div>
                    : <div style={{ marginTop: 6 }}>{tr({ te: 'ప్రస్తుతం ధృవీకరించిన ప్రత్యామ్నాయం లేదు. సిబ్బందిని అడగండి.', hi: 'अभी कोई सत्यापित विकल्प नहीं। कर्मचारी से पूछें।', en: 'No verified alternative right now. Please ask staff.' })}</div>}
                </Notice>
              : routeErrCode === 409
                ? <Notice tone="warn" icon={MapPinOff}>
                    <div className="stack tight">
                      <span>{tr({ te: 'ఈ ప్రదేశం స్థానం ఇంకా ధృవీకరించబడలేదు – దారి చూపడం సాధ్యం కాదు.', hi: 'इस स्थान की स्थिति अभी सत्यापित नहीं है – मार्ग उपलब्ध नहीं।', en: "This location's position has not been verified yet – directions are unavailable." })}</span>
                      <Link className="btn sm" to={`/places/${dest.id}`} style={{ alignSelf: 'flex-start' }}><Info size={16} aria-hidden />{t('viewDetails')}</Link>
                    </div>
                  </Notice>
                : routeErrCode === 404
                  ? <Notice tone="warn" icon={TriangleAlert}>{routeErr}{straight != null && <div className="small">{tr({ te: 'సరళ రేఖ దూరం', hi: 'सीधी दूरी', en: 'Straight-line distance' })}: {fmtDist(straight)}</div>}</Notice>
                  : <Notice tone="warn" icon={TriangleAlert}>
                      <div className="stack tight">
                        <span>{tr({ te: 'నడక దారి సేవ ప్రస్తుతం అందుబాటులో లేదు. మీ ఫోన్ మ్యాప్స్ యాప్ ఉపయోగించండి.', hi: 'पैदल मार्ग सेवा अभी उपलब्ध नहीं। अपने फ़ोन का मैप्स ऐप उपयोग करें।', en: "Walking directions are temporarily unavailable. Use your phone's maps app." })}</span>
                        {straight != null && <span className="small">{tr({ te: 'సరళ రేఖ దూరం', hi: 'सीधी दूरी', en: 'Straight-line distance' })}: {fmtDist(straight)}</span>}
                        {mapsAppLink(true)}
                      </div>
                    </Notice>)}
            <div className="stack tight">
              <label className={`check ${accessible ? 'on' : ''}`} style={{ padding: 'var(--s2) var(--s3)' }}><input type="checkbox" checked={accessible} onChange={(e) => setAccessible(e.target.checked)} /><span className="small strong row" style={{ gap: 6 }}><Accessibility size={16} aria-hidden />{tr({ te: 'సులభ మార్గం', hi: 'सुगम मार्ग', en: 'Accessible route' })}</span></label>
              <label className={`check ${avoid ? 'on' : ''}`} style={{ padding: 'var(--s2) var(--s3)' }}><input type="checkbox" checked={avoid} onChange={(e) => setAvoid(e.target.checked)} /><span className="small strong row" style={{ gap: 6 }}><Users size={16} aria-hidden />{t('avoidCrowd')}</span></label>
            </div>
            {route?.provider === 'osrm' && route.notes.length > 0 && (
              <Notice icon={Info}><ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: 4 }}>{route.notes.map((n) => <li key={n}>{n}</li>)}</ul></Notice>
            )}
            {route?.crowd_notes.map((n) => <Notice key={n} tone="warn" icon={TriangleAlert}>{n}</Notice>)}
            {route && route.avoided_zones.length > 0 && <div className="small muted row top"><Ban size={16} aria-hidden />{tr({ te: 'తప్పించిన ప్రాంతాలు', hi: 'टाले गए क्षेत्र', en: 'Avoided' })}: {route.avoided_zones.join(', ')}</div>}
            {route && (
              <>
                {panel
                  ? <h3 className="row" style={{ gap: 6 }}><Footprints size={16} aria-hidden />{tr({ te: 'దశలు', hi: 'चरण', en: 'Steps' })} ({route.steps.length})</h3>
                  : <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setStepsOpen((x) => !x)} aria-expanded={stepsOpen}>
                      <Footprints size={16} aria-hidden />{tr({ te: 'దశలు', hi: 'चरण', en: 'Steps' })} ({route.steps.length}){stepsOpen ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
                    </button>}
                {showSteps && (
                  <ol className="small" style={{ margin: 0, paddingLeft: '1.3rem', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {route.steps.map((s, i) => (
                      <li key={i}>
                        <span>{route.provider === 'osrm' ? stepText(s, destName) : s.instruction}</span>
                        {s.distance_m > 0 && <span className="muted"> · {fmtDist(s.distance_m)}</span>}
                        {s.zone_level && s.zone_level !== 'low' && <> <StatusBadge level={s.zone_level} /></>}
                      </li>
                    ))}
                  </ol>
                )}
                {route.provider === 'osrm'
                  ? <p className="xs muted">{route.attribution ?? 'OpenStreetMap'}</p>
                  : <p className="xs muted">{tr({ te: 'ఈవెంట్ నడక మార్గాలపై, రద్దీని పరిగణించి లెక్కించిన మార్గం.', hi: 'इवेंट के पैदल मार्गों पर, भीड़ को ध्यान में रखकर बना मार्ग।', en: 'Walking route over event walkways; crowd-aware.' })}</p>}
              </>
            )}
            {!(routeErrCode && routeErrCode !== 404 && routeErrCode !== 409 && routeErr !== 'blocked') && <div className="row">{mapsAppLink(false)}</div>}
          </>
        )}
      </>
    )
  }

  /* ---- selected place details */
  const renderPlace = (panel: boolean): ReactNode => {
    if (!sel) return null
    const phone = typeof sel.details?.phone === 'string' ? sel.details.phone : null
    const d = coords && hasCoords(sel) ? haversineM(coords[0], coords[1], sel.lat, sel.lng) : null
    const [bg, fg] = TONE_BG[typeMeta(sel.type).tone]
    const mapped = hasCoords(sel)
    return (
      <>
        {panel && <button className="btn sm ghost" style={{ alignSelf: 'flex-start', marginLeft: -8 }} onClick={() => select(null)}><ArrowLeft size={16} aria-hidden />{tr({ te: 'అన్ని ప్రదేశాలు', hi: 'सभी स्थान', en: 'All places' })}</button>}
        <div className="row top">
          <span style={iconBox(bg, fg)} aria-hidden><TypeIcon type={sel.type} /></span>
          <div className="grow">
            <h2 className="clamp2">{name(sel)}</h2>
            <div className="small muted row wrap" style={{ columnGap: 8, rowGap: 2 }}>
              <span>{t(typeKey(sel.type))}</span>
              {d != null && <span>{fmtDist(d)} · {walkText(walkMinutes(d, sel.is_accessible))}</span>}
              {sel.is_accessible && <span className="row" style={{ gap: 3 }}><Accessibility size={14} aria-hidden />{t('accessible')}</span>}
              {!sel.is_open && <span className="chip closed">{t('closed')}</span>}
            </div>
          </div>
          {!panel && <button className="btn icon ghost" onClick={() => select(null)} aria-label={t('close')}><X size={22} aria-hidden /></button>}
        </div>
        <div className="row wrap" style={{ gap: 6 }}>
          <VerificationBadge v={mapped ? sel.verification : 'unverified'} compact />
          {sel.source && (
            <span className="xs muted" style={{ overflowWrap: 'anywhere' }}>
              {t('dataSource')}: {sel.source_ref ? <a href={sel.source_ref} target="_blank" rel="noopener noreferrer">{sel.source}</a> : sel.source}
              {sel.source_retrieved_at && <> · {ago(sel.source_retrieved_at)}</>}
            </span>
          )}
        </div>
        {sel.monitored && (sel.density_updated_at
          ? <div className="row wrap"><StatusBadge level={sel.density_level} stale={sel.is_stale} /><Freshness iso={sel.density_updated_at} source={sel.density_source} /></div>
          : <span className="small muted row" style={{ gap: 6 }}><CircleHelp size={16} aria-hidden />{t('noVerifiedCrowd')}</span>)}
        {!mapped && <Notice tone="warn" icon={MapPinOff}>{t('vUnverified')}</Notice>}
        <div className="row wrap">
          {mapped && <button className="btn primary grow" onClick={() => startRoute(sel)}><Navigation size={18} aria-hidden />{t('directions')}</button>}
          <Link className="btn" to={`/places/${sel.id}`}><Info size={18} aria-hidden />{t('viewDetails')}</Link>
          {phone && <a className="btn" href={`tel:${phone}`} aria-label={`${t('call')} ${name(sel)}`}><Phone size={18} aria-hidden />{t('call')}</a>}
        </div>
      </>
    )
  }

  const onPick = (x: Location) => { setMode('map'); setSearchOpen(false); select(x); if (hasCoords(x)) setFocus([x.lat, x.lng]) }
  const placeRows = (items: Location[]) => (
    <div className="list">
      {/* mapped places select on the map; unmapped places open their details page (PlaceRow default) */}
      {items.map((l) => (hasCoords(l) ? <PlaceRow key={l.id} loc={l} onSelect={onPick} /> : <PlaceRow key={l.id} loc={l} />))}
    </div>
  )
  const placeList = listed.length === 0
    ? <EmptyState icon={MapPin} title={tr({ te: 'ఏమీ దొరకలేదు', hi: 'कुछ नहीं मिला', en: 'Nothing found' })} body={qq ? tr({ te: 'వేరే పేరుతో లేదా అన్ని పొరలతో ప్రయత్నించండి.', hi: 'दूसरे नाम से या सभी परतों के साथ खोजें।', en: 'Try another name or the "All" layer.' }) : undefined} />
    : placeRows(listed)
  const unmappedCount = listed.filter((l) => !hasCoords(l)).length

  const legendSheet = (
    <Sheet open={legend} onClose={() => setLegend(false)} title={tr({ te: 'మ్యాప్ చిహ్నాలు', hi: 'नक्शे के संकेत', en: 'Map legend' })}>
      <div className="stack">
        <div className="stack tight">
          {(['low', 'moderate', 'high', 'critical', 'unknown'] as Level[]).map((l) => { const I = LEVEL_ICON[l]; return <div key={l} className="row"><span className={`status ${l}`}><I aria-hidden />{t(l as Key)}</span></div> })}
        </div>
        <p className="small muted">{tr({ te: 'ప్రతి గుర్తుపై రంగుతో పాటు ఆకారం గల చిన్న బ్యాడ్జ్ ఉంటుంది. 15 నిమిషాల కంటే పాత సమాచారం "తాజా సమాచారం లేదు"గా చూపబడుతుంది.', hi: 'हर पिन पर रंग के साथ आकार वाला छोटा बैज होता है। 15 मिनट से पुरानी जानकारी "ताज़ा जानकारी नहीं" दिखती है।', en: 'Monitored pins carry a shape-coded badge, not just a colour. Data older than 15 minutes is shown as "No recent data".' })}</p>
        <div className="stack tight small">
          <span className="fresh live"><span className="live-dot" aria-hidden />{t('fLive')}: {tr({ te: 'కెమెరా / RFID నుండి', hi: 'कैमरा / RFID से', en: 'from camera / RFID counters' })}</span>
          <span className="fresh">{t('fStaff')}: {tr({ te: 'సిబ్బంది నమోదు చేశారు', hi: 'कर्मचारी द्वारा दर्ज', en: 'entered by staff on site' })}</span>
        </div>
        <div className="stack tight">
          <h3>{t('dataSource')}</h3>
          <div className="row wrap" style={{ gap: 6 }}><VerificationBadge v="official" /><VerificationBadge v="source" /><VerificationBadge v="unverified" /></div>
          <Notice icon={CircleHelp}>{tr({
            te: 'ఘాట్ స్థానాలు OpenStreetMap సహకారుల నుండి; నిర్వాహకులు ఇంకా నిర్ధారించలేదు. 2027 అధికారిక ఘాట్ జాబితా ఇంకా ప్రచురించబడలేదు. ధృవీకరించని స్థానాలు మ్యాప్‌పై చూపబడవు.',
            hi: 'घाट स्थान OpenStreetMap योगदानकर्ताओं से; आयोजकों ने अभी पुष्टि नहीं की। 2027 की आधिकारिक घाट सूची अभी प्रकाशित नहीं हुई। असत्यापित स्थान नक्शे पर नहीं दिखाए जाते।',
            en: 'Ghat positions come from OpenStreetMap contributors and are not yet confirmed by the organisers. The official 2027 ghat list has not been published. Places without a verified position are never shown on the map.',
          })}</Notice>
        </div>
      </div>
    </Sheet>
  )

  const map = (fabsBottom: number) => (
    <MapView center={center} locations={shown} me={coords} route={route?.polyline ?? null} fitRoute={!!route} fitLocations={fitAll} onSelect={dest ? undefined : select} selectedId={to ?? selId} focus={focus}>
      <MapFabs me={coords} bottom={fabsBottom} />
    </MapView>
  )

  /* ================================================================ desktop: side panel + map */
  if (desktop) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '400px minmax(0, 1fr)', height: 'calc(100dvh - var(--header-h))' }}>
        <aside aria-label={t('explore')} style={{ background: 'var(--surface)', borderRight: '1px solid var(--line)', overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div className="stack tight" style={{ padding: 'var(--s5) var(--s5) var(--s4)', borderBottom: '1px solid var(--line)' }}>
            <div className="row between">
              <h1 style={{ fontSize: 'var(--fs-xl)' }}>{t('explore')}</h1>
              <button className="btn sm ghost" onClick={() => setLegend(true)}><Info size={16} aria-hidden />{tr({ te: 'చిహ్నాలు', hi: 'संकेत', en: 'Legend' })}</button>
            </div>
            {!dest && searchBox()}
            {!dest && layerChips}
          </div>
          <div className="stack" style={{ padding: 'var(--s5)' }}>
            {dest ? renderRoute(true) : sel ? renderPlace(true) : (
              <>
                {!coords && locationPrompt}
                <div className="row between small muted wrap">
                  <span>{listed.length} {tr({ te: 'ప్రదేశాలు', hi: 'स्थान', en: 'places' })}{unmappedCount > 0 && ` · ${unmappedCount} ${tr({ te: 'స్థానం ధృవీకరించబడలేదు', hi: 'स्थान सत्यापित नहीं', en: 'without verified position' })}`}</span>
                  {coords && <span>{tr({ te: 'దూరం ప్రకారం', hi: 'दूरी के अनुसार', en: 'Sorted by distance' })}</span>}
                </div>
                {placeList}
              </>
            )}
          </div>
        </aside>
        <div style={{ position: 'relative', minWidth: 0 }}>
          {map(16)}
          {!coords && !dest && (
            <div className="map-fabs" style={{ bottom: 172 }}>
              <button className="fab" onClick={() => void requestGps()} aria-label={t('useMyLocation')} disabled={requesting}>{requesting ? <span className="spin" aria-hidden /> : <LocateFixed size={22} aria-hidden />}</button>
            </div>
          )}
        </div>
        <ChoosePlaceSheet open={choose} onClose={() => setChoose(false)} />
        {legendSheet}
      </div>
    )
  }

  /* ================================================================ phones and tablets */
  const tablet = bp === 'tablet'
  const bottom: ReactNode = dest
    ? <div className="map-card stack tight" role="region" aria-label={t('directions')} style={{ maxHeight: '55dvh', overflow: 'auto' }}>{renderRoute(false)}</div>
    : sel ? <div className="map-card stack tight" role="region" aria-label={name(sel)} style={{ maxHeight: '55dvh', overflow: 'auto' }}>{renderPlace(false)}</div> : null

  const showSearch = searchOpen || !!qq
  const toolbar = (
    <div className="map-ui top" style={mode === 'list' ? { position: 'static', padding: 'var(--s3) var(--gutter) 0' } : undefined}>
      <div className="row" style={{ gap: 'var(--s2)' }}>
        <div style={{ width: 188, flexShrink: 0, boxShadow: mode === 'map' ? 'var(--sh-2)' : undefined, borderRadius: 'var(--r-md)' }}>
          <Segmented label={t('mapView')} value={mode} onChange={setMode} options={[{ value: 'map', label: t('mapView'), icon: MapIcon }, { value: 'list', label: t('listView'), icon: ListIcon }]} />
        </div>
        <span className="grow" />
        {!dest && <button className={`fab ${showSearch ? 'active' : ''}`} onClick={() => { if (showSearch) { setSearchOpen(false); setQuery('') } else setSearchOpen(true) }} aria-label={searchLabel} aria-expanded={showSearch}>{showSearch ? <X size={22} aria-hidden /> : <Search size={22} aria-hidden />}</button>}
        <button className="fab" onClick={() => setLegend(true)} aria-label={legendLabel}><Info size={22} aria-hidden /></button>
      </div>
      {!dest && showSearch && <div style={mode === 'map' ? { boxShadow: 'var(--sh-2)', borderRadius: 'var(--r-md)' } : undefined}>{searchBox(searchOpen && !qq)}</div>}
      {/* map mode: search results float under the box (mapped → select on map, unmapped → details) */}
      {!dest && mode === 'map' && qq && (
        <div className="card pad-sm" style={{ maxHeight: '45dvh', overflowY: 'auto', boxShadow: 'var(--sh-3)' }}>
          {listed.length === 0 ? <p className="small muted">{tr({ te: 'ఏమీ దొరకలేదు', hi: 'कुछ नहीं मिला', en: 'Nothing found' })}</p> : placeRows(listed.slice(0, 20))}
        </div>
      )}
      {!(mode === 'map' && qq) && layerChips}
    </div>
  )

  return (
    <div>
      {mode === 'map' ? (
        <div style={{ position: 'relative' }}>
          {map(bottom && !tablet ? 220 : 12)}
          {toolbar}
          {!coords && !dest && (
            <div className="map-fabs" style={{ bottom: bottom && !tablet ? 380 : 172 }}>
              <button className="fab" onClick={() => void requestGps()} aria-label={t('useMyLocation')} disabled={requesting}>{requesting ? <span className="spin" aria-hidden /> : <LocateFixed size={22} aria-hidden />}</button>
            </div>
          )}
          {bottom && <div className="map-ui bottom" style={tablet ? { right: 'auto', width: 420, maxWidth: 'calc(100% - 88px)' } : { right: 72 }}>{bottom}</div>}
        </div>
      ) : (
        <div style={{ paddingBottom: 'calc(var(--nav-h) + var(--s6) + env(safe-area-inset-bottom))' }}>
          {toolbar}
          <div className="stack tight" style={{ padding: 'var(--s3) var(--gutter)', maxWidth: 760 }}>
            {!coords && locationPrompt}
            {unmappedCount > 0 && <p className="xs muted">{unmappedCount} {tr({ te: 'ప్రదేశాల స్థానం ధృవీకరించబడలేదు – మ్యాప్‌పై చూపబడవు.', hi: 'स्थानों की स्थिति सत्यापित नहीं – नक्शे पर नहीं दिखाए जाते।', en: 'places have no verified position and are not shown on the map.' })}</p>}
            {placeList}
          </div>
        </div>
      )}
      <ChoosePlaceSheet open={choose} onClose={() => setChoose(false)} />
      {legendSheet}
    </div>
  )
}
