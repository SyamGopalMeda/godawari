/* Ghats & bathing centres directory.
   Bathing centres (towns) come from the database (GET /sites) in upstream → downstream order and are grouped by state.
   Ghats are listed under their centre with their verification level: positions from OpenStreetMap ("source"),
   confirmed by the organisers ("official"), or named by a written source without a verified position ("unverified",
   never drawn on a map or routed to). Nothing here is invented: centres without a mapped ghat say so. */
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CalendarClock, ChevronRight, ExternalLink, LayoutGrid, List as ListIcon, Map as MapIcon, Navigation, Search, SearchX, Waves } from 'lucide-react'
import { api, externalDirections, fmtDist, hasCoords, type Location, type Site } from '../../api'
import { useLang } from '../../i18n'
import { useStore } from '../../store'
import { useDistance, useMyLocation } from '../../location'
import { walkMinutes } from '../../geo'
import { TypeIcon } from '../../components/icons'
import LazyMap from '../../components/LazyMap'
import { EmptyState, FilterChips, Notice, PageHead, Segmented, Skeleton, VerificationBadge, useBreakpoint } from '../../components/ui'
import { siteAsLocation, useSites } from './HomePage'

type StateFilter = 'all' | 'Telangana' | 'Andhra Pradesh'

function matches(q: string, ...vals: (string | null | undefined)[]) {
  return vals.some((v) => v && v.toLowerCase().includes(q))
}

function GhatRow({ g }: { g: Location }) {
  const { t, name, walkText } = useLang()
  const dist = useDistance()
  const d = dist(g.lat, g.lng)
  const mapped = hasCoords(g)
  return (
    <div className="lrow" style={{ border: 0, borderRadius: 0, boxShadow: 'none' }}>
      <span className="lead" aria-hidden><TypeIcon type="ghat" /></span>
      <Link to={`/places/${g.id}`} className="body" style={{ textDecoration: 'none', color: 'inherit' }}>
        <span className="title">{name(g)}</span>
        <span className="meta">
          <VerificationBadge v={mapped ? g.verification : 'unverified'} compact />
          {d != null && <span>{fmtDist(d)}{d <= 20000 ? ` · ${walkText(walkMinutes(d))}` : ''}</span>}
          {!g.is_open && <span className="chip closed">{t('closed')}</span>}
        </span>
      </Link>
      <span className="trail">
        <Link className="btn sm ghost" to={`/places/${g.id}`}>{t('viewDetails')}</Link>
        {mapped && g.verification !== 'unavailable' && (
          <Link className="btn icon sm tonal" to={`/map?to=${g.id}`} aria-label={`${t('directions')}: ${name(g)}`}><Navigation size={20} aria-hidden /></Link>
        )}
      </span>
    </div>
  )
}

function CentreCard({ site, ghats }: { site: Site; ghats: Location[] }) {
  const { t, tr, name, num } = useLang()
  const dist = useDistance()
  const d = dist(site.center_lat, site.center_lng)
  const mapped = ghats.filter(hasCoords).length
  return (
    <section className="card stack" aria-labelledby={`site-${site.id}`} style={{ gap: 'var(--s3)' }}>
      <div className="row top" style={{ gap: 'var(--s3)' }}>
        <span aria-hidden style={{ width: 44, height: 44, borderRadius: 'var(--r-md)', display: 'grid', placeItems: 'center', background: 'var(--brand-100)', color: 'var(--brand-ink)', flexShrink: 0 }}><Waves size={22} /></span>
        <div className="grow">
          <h2 id={`site-${site.id}`} style={{ fontSize: 'var(--fs-lg)' }}>{name(site)}</h2>
          <div className="small muted">
            {[site.district, site.state].filter(Boolean).join(', ')}
            {d != null && <> · {fmtDist(d)} {t('away')}</>}
          </div>
          <div className="xs muted" style={{ marginTop: 2 }}>
            {tr({ te: `${num(mapped)}/${num(ghats.length)} ఘాట్‌లు మ్యాప్ చేయబడినవి`, hi: `${num(mapped)}/${num(ghats.length)} घाट मैप किए गए`, en: `${num(mapped)} of ${num(ghats.length)} ghats mapped` })}
            {' · '}
            {tr({ te: `${num(site.facilities)} సౌకర్యాలు`, hi: `${num(site.facilities)} सुविधाएँ`, en: `${num(site.facilities)} facilities` })}
          </div>
        </div>
      </div>

      {ghats.length > 0 && <div className="list grouped">{ghats.map((g) => <GhatRow key={g.id} g={g} />)}</div>}

      {mapped === 0 && (
        <Notice icon={CalendarClock}>
          {tr({
            te: '2027 కోసం ఘాట్ స్థానాలు ఇంకా ప్రచురించబడలేదు – పట్టణ స్థానం OpenStreetMap నుండి.',
            hi: '2027 के घाट स्थान अभी प्रकाशित नहीं – नगर की स्थिति OpenStreetMap से।',
            en: 'Ghat locations for 2027 not yet published – town position from OpenStreetMap.',
          })}
        </Notice>
      )}

      <div className="row wrap" style={{ gap: 'var(--s2)' }}>
        {mapped === 0 && (
          <a className="btn sm" href={externalDirections(site.center_lat, site.center_lng)} target="_blank" rel="noopener noreferrer">
            <Navigation size={16} aria-hidden />{t('openInMaps')}
          </a>
        )}
        {site.facilities > 0 && (
          <Link className="btn sm ghost" to={`/facilities?site=${site.id}`}><LayoutGrid size={16} aria-hidden />{tr({ te: 'సమీప సౌకర్యాలు', hi: 'पास की सुविधाएँ', en: 'Nearby facilities' })}</Link>
        )}
        {site.source_ref && (
          <a className="btn sm ghost" href={site.source_ref} target="_blank" rel="noopener noreferrer" aria-label={`${t('dataSource')}: OpenStreetMap – ${name(site)}`}>
            <ExternalLink size={16} aria-hidden />OpenStreetMap
          </a>
        )}
      </div>
    </section>
  )
}

export default function GhatsPage() {
  const { t, tr, name, num } = useLang()
  const { places, lastSync } = useStore()
  const sites = useSites()
  const { coords } = useMyLocation()
  const nav = useNavigate()
  const bp = useBreakpoint()
  const desktop = bp === 'desktop'
  const [q, setQ] = useState('')
  const [stateF, setStateF] = useState<StateFilter>('all')
  const [view, setView] = useState<'list' | 'map'>('list')
  const [serverIds, setServerIds] = useState<Set<number> | null>(null)
  const [selSite, setSelSite] = useState<Site | null>(null)
  const query = q.trim().toLowerCase()

  // server-side search (names in all three languages, codes, town names), debounced
  useEffect(() => {
    if (!query) { setServerIds(null); return }
    let alive = true
    const id = window.setTimeout(() => {
      api.get<Location[]>(`/locations?type=ghat&q=${encodeURIComponent(query)}`)
        .then((r) => { if (alive) setServerIds(new Set(r.map((x) => x.id))) })
        .catch(() => { if (alive) setServerIds(null) })
    }, 250)
    return () => { alive = false; clearTimeout(id) }
  }, [query])

  const ghats = useMemo(() => places.filter((p) => p.type === 'ghat'), [places])

  const groups = useMemo(() => {
    if (!sites) return []
    const visible = sites
      .filter((s) => stateF === 'all' || s.state === stateF)
      .map((s) => {
        const own = ghats.filter((g) => g.site_id === s.id)
        const siteHit = !query || matches(query, s.name, s.name_te, s.name_hi, s.district)
        const hits = query ? own.filter((g) => serverIds?.has(g.id) || matches(query, g.name, g.name_te, g.name_hi, g.code)) : own
        return { site: s, ghats: siteHit ? own : hits, show: siteHit || hits.length > 0 }
      })
      .filter((x) => x.show)
      .map((x) => ({ ...x, ghats: [...x.ghats].sort((a, b) => Number(!hasCoords(a)) - Number(!hasCoords(b)) || a.name.localeCompare(b.name)) }))
    const byState = new Map<string, typeof visible>()
    for (const v of visible) {
      const k = v.site.state ?? tr({ te: 'ఇతర', hi: 'अन्य', en: 'Other' })
      byState.set(k, [...(byState.get(k) ?? []), v])
    }
    return [...byState.entries()]
  }, [sites, ghats, stateF, query, serverIds, tr])

  const shownSites = groups.flatMap(([, v]) => v)
  const mapLocs = useMemo<Location[]>(() => [
    ...shownSites.flatMap((x) => x.ghats).filter((g) => hasCoords(g) && g.verification !== 'unavailable'),
    ...shownSites.map((x) => siteAsLocation(x.site)),
  ], [shownSites])
  const totalMapped = (sites ?? []).reduce((n, s) => n + s.ghats_mapped, 0)
  const totalGhats = (sites ?? []).reduce((n, s) => n + s.ghats_total, 0)
  const firstPoint = mapLocs.find(hasCoords)
  const center: [number, number] | null = coords ?? (firstPoint ? [firstPoint.lat as number, firstPoint.lng as number] : null)

  const onMapSelect = (l: Location | null) => {
    if (!l) { setSelSite(null); return }
    if (l.id > 0) { nav(`/places/${l.id}`); return }
    setSelSite((sites ?? []).find((s) => s.id === -l.id) ?? null)
  }

  const stateOptions: { value: StateFilter; label: string }[] = [
    { value: 'all', label: tr({ te: 'అన్నీ', hi: 'सभी', en: 'All' }) },
    { value: 'Telangana', label: tr({ te: 'తెలంగాణ', hi: 'तेलंगाना', en: 'Telangana' }) },
    { value: 'Andhra Pradesh', label: tr({ te: 'ఆంధ్రప్రదేశ్', hi: 'आंध्र प्रदेश', en: 'Andhra Pradesh' }) },
  ]
  const viewSwitch = (
    <Segmented label={t('mapView')} value={view} onChange={(v) => { setView(v); setSelSite(null) }}
      options={[{ value: 'list', label: t('listView'), icon: ListIcon }, { value: 'map', label: t('mapView'), icon: MapIcon }]} />
  )

  const list = sites === null ? <Skeleton rows={4} /> : groups.length === 0 ? (
    <div className="card">
      <EmptyState icon={SearchX} title={tr({ te: `"${q}" కోసం ఏమీ దొరకలేదు`, hi: `"${q}" के लिए कुछ नहीं मिला`, en: `Nothing found for "${q}"` })}
        body={tr({ te: 'ఘాట్ లేదా పట్టణం పేరు ప్రయత్నించండి.', hi: 'घाट या नगर का नाम आज़माएँ।', en: 'Try the name of a ghat or a town.' })}
        action={<button className="btn tonal" onClick={() => { setQ(''); setStateF('all') }}>{tr({ te: 'అన్నీ చూపించు', hi: 'सब दिखाएँ', en: 'Show all' })}</button>} />
    </div>
  ) : (
    <div className="stack loose">
      {groups.map(([state, items]) => (
        <section key={state} className="stack" aria-label={state}>
          <h2 className="eyebrow">{state === 'Telangana' ? stateOptions[1].label : state === 'Andhra Pradesh' ? stateOptions[2].label : state} · {num(items.length)}</h2>
          {items.map((x) => <CentreCard key={x.site.id} site={x.site} ghats={x.ghats} />)}
        </section>
      ))}
    </div>
  )

  const mapPanel = (height: string) => (
    <div className="stack">
      <div className="map-panel">
        {center
          ? <LazyMap center={center} zoom={8} locations={mapLocs} me={coords} height={height} fitLocations onSelect={onMapSelect} selectedId={selSite ? -selSite.id : null} />
          : <div className="map-wrap skel" style={{ height }} aria-busy="true" />}
      </div>
      {selSite ? (
        <div className="card pad-sm row between wrap">
          <div className="grow"><strong>{name(selSite)}</strong><div className="xs muted">{[selSite.district, selSite.state].filter(Boolean).join(', ')}</div></div>
          <a className="btn sm" href={externalDirections(selSite.center_lat, selSite.center_lng)} target="_blank" rel="noopener noreferrer"><Navigation size={16} aria-hidden />{t('openInMaps')}</a>
        </div>
      ) : (
        <p className="xs muted">{tr({
          te: 'ఘాట్ పిన్‌ను తాకితే వివరాలు, పట్టణ పిన్‌ను తాకితే దిశలు. ధృవీకరించిన స్థానం ఉన్న ప్రదేశాలు మాత్రమే మ్యాప్‌లో ఉంటాయి.',
          hi: 'घाट पिन छूने पर विवरण, नगर पिन छूने पर दिशा। केवल सत्यापित स्थान वाले स्थान नक्शे पर हैं।',
          en: 'Select a ghat pin for details or a town pin for directions. Only places with a verified position appear on the map.',
        })}</p>
      )}
    </div>
  )

  return (
    <div className="stack loose">
      <div className="stack">
        <PageHead
          title={tr({ te: 'ఘాట్‌లు & స్నాన కేంద్రాలు', hi: 'घाट व स्नान केंद्र', en: 'Ghats & bathing centres' })}
          sub={tr({
            te: 'స్థానాలు OpenStreetMap నుండి; అధికారిక 2027 ఘాట్ జాబితా నిర్వాహకులు ఇంకా ప్రచురించలేదు',
            hi: 'स्थान OpenStreetMap से; आधिकारिक 2027 घाट सूची आयोजकों ने अभी प्रकाशित नहीं की',
            en: 'Positions from OpenStreetMap; official 2027 ghat list not yet published by the organisers',
          })}
          actions={bp === 'tablet' ? <div style={{ width: 240 }}>{viewSwitch}</div> : undefined}
        />
        {sites && (
          <div className="kpis">
            <div className="kpi"><div className="v">{num(sites.length)}</div><div className="l">{t('bathingCentres')}</div></div>
            <div className="kpi"><div className="v">{num(totalMapped)}<span className="muted" style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>/{num(totalGhats)}</span></div><div className="l">{tr({ te: 'మ్యాప్ చేయబడిన ఘాట్‌లు', hi: 'मैप किए गए घाट', en: 'Ghats with a verified position' })}</div></div>
          </div>
        )}
        <div className="search" role="search" style={{ maxWidth: 640 }}>
          <Search size={20} aria-hidden />
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('search')}
            placeholder={tr({ te: 'ఘాట్ లేదా పట్టణం వెతకండి (ఉదా. పుష్కర, భద్రాచలం)', hi: 'घाट या नगर खोजें (जैसे पुष्कर, भद्राचलम)', en: 'Search a ghat or town (e.g. Pushkar, Bhadrachalam)' })} />
        </div>
        <FilterChips label={tr({ te: 'రాష్ట్రం', hi: 'राज्य', en: 'State' })} options={stateOptions} selected={stateF} onToggle={(v) => setStateF(v)} />
        {bp === 'mobile' && viewSwitch}
        {lastSync == null && places.length === 0 && <Skeleton rows={1} kind="line" />}
      </div>

      {desktop ? (
        <div className="layout-split">
          <div style={{ minWidth: 0 }}>{list}</div>
          <div className="split-map">{mapPanel('calc(100dvh - var(--header-h) - 160px)')}</div>
        </div>
      ) : view === 'map' ? mapPanel('62dvh') : list}

      <Notice>
        <div className="stack tight">
          <strong>{t('dataSource')}</strong>
          <span>{tr({
            te: 'పట్టణాలు మరియు ఘాట్ స్థానాలు © OpenStreetMap సహకారులు (ODbL). స్నాన కేంద్రాల జాబితా: వికీపీడియా “గోదావరి మహా పుష్కరం”. నిర్వాహకులు అధికారిక ఘాట్‌లు, ప్రవేశ గేట్లు, పార్కింగ్ ప్రచురించినప్పుడు కంట్రోల్ రూమ్ వాటిని ధృవీకరించి ఇక్కడ చేరుస్తుంది.',
            hi: 'नगर और घाट स्थान © OpenStreetMap योगदानकर्ता (ODbL)। स्नान केंद्रों की सूची: विकिपीडिया “गोदावरी महा पुष्करम”। आयोजक आधिकारिक घाट, प्रवेश द्वार और पार्किंग प्रकाशित करेंगे तब कंट्रोल रूम उन्हें सत्यापित कर यहाँ जोड़ेगा।',
            en: 'Town and ghat positions © OpenStreetMap contributors (ODbL). Bathing-centre list: Wikipedia “Godavari Maha Pushkaram”. When the organisers publish official ghats, entry gates and parking, the control room verifies and adds them here.',
          })}</span>
          <Link to="/services" className="btn ghost sm" style={{ alignSelf: 'flex-start', paddingInline: 8 }}>{t('services')}<ChevronRight size={16} aria-hidden /></Link>
        </div>
      </Notice>
    </div>
  )
}
