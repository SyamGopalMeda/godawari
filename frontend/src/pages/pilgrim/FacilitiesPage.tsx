/* Facilities list/map for one or more categories. URL is the source of truth:
   /facilities?type=restroom,water&accessible=1&open=1 */
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Accessibility, CalendarClock, Clock3, List, LocateFixed, MapPin, Map as MapIcon, SearchX } from 'lucide-react'
import { hasCoords, type Location } from '../../api'
import { useLang, type Key } from '../../i18n'
import { useStore } from '../../store'
import { useDistance, useMyLocation } from '../../location'
import LazyMap from '../../components/LazyMap'
import { TypeIcon } from '../../components/icons'
import { EmptyState, FilterChips, Notice, PageHead, PlaceRow, Segmented, Sheet, Skeleton, useBreakpoint } from '../../components/ui'
import { useSites } from './HomePage'

export const FACILITY_TYPES = ['ghat', 'dressing_room', 'restroom', 'water', 'medical', 'food', 'rest_area', 'police', 'help_desk', 'lost_found', 'bus_stop', 'railway_station']
/** Festival-only infrastructure: exists only once the organisers publish it (empty → "not yet published").
    Everything else is permanent public infrastructure from OpenStreetMap (empty → "none mapped"). */
export const FESTIVAL_ONLY = ['dressing_room', 'food', 'rest_area', 'help_desk', 'lost_found', 'gate', 'checkpoint']

/** "Use my location / Choose manually" prompt shared by the service screens. Renders nothing once a position is known. */
export function LocationPrompt({ compact }: { compact?: boolean }) {
  const { t, tr, name } = useLang()
  const { coords, requestGps, requesting, lastError, perm, setManual } = useMyLocation()
  const { places } = useStore()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const choices = useMemo(() => {
    const s = q.trim().toLowerCase()
    return places
      .filter((p) => ['gate', 'ghat', 'help_desk', 'parking', 'medical', 'police', 'bus_stop', 'railway_station'].includes(p.type) && hasCoords(p))
      .filter((p) => !s || [p.name, p.name_te, p.name_hi, p.code].some((v) => v?.toLowerCase().includes(s)))
      .sort((a, b) => a.type.localeCompare(b.type) || name(a).localeCompare(name(b)))
  }, [places, q, name])
  if (coords) return null
  const denied = perm === 'denied' || lastError === 'denied'
  return (
    <>
      <Notice icon={MapPin} tone={denied ? 'warn' : 'info'}>
        <div className="stack tight">
          <strong>{t('locationOff')}</strong>
          {!compact && <span>{denied ? t('locationDenied') : t('locationWhy')}</span>}
          <div className="row wrap">
            {!denied && perm !== 'unsupported' && (
              <button className="btn sm primary" onClick={() => void requestGps()} disabled={requesting}>
                {requesting ? <span className="spin" aria-hidden /> : <LocateFixed size={16} aria-hidden />}{t('useMyLocation')}
              </button>
            )}
            <button className="btn sm" onClick={() => setOpen(true)}>{t('chooseManually')}</button>
          </div>
          {lastError === 'timeout' && <span className="small">{tr({ te: 'GPS సిగ్నల్ దొరకలేదు. మళ్ళీ ప్రయత్నించండి లేదా ప్రదేశం ఎంచుకోండి.', hi: 'GPS सिग्नल नहीं मिला। फिर कोशिश करें या स्थान चुनें।', en: 'Could not get a GPS fix. Try again or choose a place.' })}</span>}
        </div>
      </Notice>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('iAmNear')}>
        <div className="stack">
          <input className="input" type="search" placeholder={t('search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('search')} />
          {places.length === 0 && <Skeleton rows={4} />}
          <div className="list grouped">
            {choices.map((p) => (
              <button key={p.id} type="button" className="lrow" onClick={() => { setManual(p); setOpen(false) }}>
                <span className="lead" aria-hidden><TypeIcon type={p.type} /></span>
                <span className="body"><span className="title">{name(p)}</span><span className="meta">{t(p.type as Key)}</span></span>
              </button>
            ))}
          </div>
        </div>
      </Sheet>
    </>
  )
}

function titleFor(types: string[], accessible: boolean, t: (k: Key) => string, tr: (o: { te: string; hi: string; en: string }) => string): string {
  if (types.length === 1) return t(types[0] as Key)
  if (types.length === 2 && types.includes('police') && types.includes('help_desk')) return tr({ te: 'పోలీస్ & సహాయ కేంద్రాలు', hi: 'पुलिस व सहायता केंद्र', en: 'Police & help desks' })
  if (types.length === 0 && accessible) return tr({ te: 'సులభ ప్రవేశ సౌకర్యాలు', hi: 'सुगम सुविधाएँ', en: 'Accessible facilities' })
  return t('facilities')
}

export default function FacilitiesPage() {
  const { t, tr, num, name } = useLang()
  const { places } = useStore()
  const sites = useSites()
  const { coords } = useMyLocation()
  const dist = useDistance()
  const [params, setParams] = useSearchParams()
  const types = (params.get('type') ?? '').split(',').map((s) => s.trim()).filter((s) => FACILITY_TYPES.includes(s))
  const accessible = params.get('accessible') === '1'
  const openNow = params.get('open') === '1'
  const siteId = Number(params.get('site')) || null
  const centre = siteId ? (sites ?? []).find((x) => x.id === siteId) ?? null : null
  const [view, setView] = useState<'list' | 'map'>('list')
  const [sel, setSel] = useState<Location | null>(null)
  const bp = useBreakpoint()

  const update = (next: { types?: string[]; accessible?: boolean; open?: boolean }) => {
    const p = new URLSearchParams(params)
    const ty = next.types ?? types
    const ac = next.accessible ?? accessible
    const op = next.open ?? openNow
    if (ty.length) p.set('type', ty.join(',')); else p.delete('type')
    if (ac) p.set('accessible', '1'); else p.delete('accessible')
    if (op) p.set('open', '1'); else p.delete('open')
    if (siteId) p.set('site', String(siteId))
    setParams(p, { replace: true })
  }
  const toggleType = (ty: string) => update({ types: types.includes(ty) ? types.filter((x) => x !== ty) : [...types, ty] })

  const rows = useMemo(() => {
    const allowed = types.length ? types : FACILITY_TYPES
    const list = places.filter((p) => allowed.includes(p.type) && (!accessible || p.is_accessible) && (!openNow || p.is_open) && (!siteId || p.site_id === siteId))
    // nearest first; places without a verified position go last
    return list
      .map((p) => ({ p, d: dist(p.lat, p.lng) }))
      .sort((a, b) => (Number(a.d == null) - Number(b.d == null)) || ((a.d ?? 0) - (b.d ?? 0)) || a.p.name.localeCompare(b.p.name))
      .map((x) => x.p)
  }, [places, types, accessible, openNow, dist, siteId])

  const mapped = rows.filter(hasCoords)
  const center: [number, number] | null = coords ?? (mapped[0] ? [mapped[0].lat as number, mapped[0].lng as number] : centre ? [centre.center_lat, centre.center_lng] : null)
  const options = FACILITY_TYPES.map((ty) => ({ value: ty, label: t(ty as Key), icon: <TypeIcon type={ty} size={16} /> }))

  const desktop = bp === 'desktop'
  const filters = (
    <div className="stack tight">
      <FilterChips label={t('facilities')} options={options} selected={types} onToggle={toggleType} />
      <div className="row wrap">
        <button type="button" className={`chip ${accessible ? 'brand' : ''}`} style={{ minHeight: 44, padding: '0 14px', border: '1px solid var(--line)', fontSize: 'var(--fs-sm)' }} aria-pressed={accessible} onClick={() => update({ accessible: !accessible })}>
          <Accessibility aria-hidden />{tr({ te: 'సులభ ప్రవేశం మాత్రమే', hi: 'केवल सुगम', en: 'Accessible only' })}
        </button>
        <button type="button" className={`chip ${openNow ? 'brand' : ''}`} style={{ minHeight: 44, padding: '0 14px', border: '1px solid var(--line)', fontSize: 'var(--fs-sm)' }} aria-pressed={openNow} onClick={() => update({ open: !openNow })}>
          <Clock3 aria-hidden />{tr({ te: 'ఇప్పుడు తెరిచినవి', hi: 'अभी खुले', en: 'Open now' })}
        </button>
      </div>
    </div>
  )
  const festivalOnly = types.length > 0 && types.every((ty) => FESTIVAL_ONLY.includes(ty))
  const clearBtn = (accessible || openNow || types.length > 0)
    ? <button className="btn tonal" onClick={() => update({ types: [], accessible: false, open: false })}>{tr({ te: 'ఫిల్టర్లు తీసివేయండి', hi: 'फ़िल्टर हटाएँ', en: 'Clear filters' })}</button>
    : undefined
  const empty = (
    <div className="card">
      {festivalOnly && !accessible && !openNow ? (
        <EmptyState icon={CalendarClock} title={t('notPublished')}
          body={tr({ te: 'ఈ పండుగ సౌకర్యాలను నిర్వాహకులు ప్రచురించినప్పుడు ఇక్కడ ధృవీకరించిన స్థానాలతో కనిపిస్తాయి.', hi: 'आयोजक इन उत्सव सुविधाओं को प्रकाशित करेंगे तब ये यहाँ सत्यापित स्थानों के साथ दिखेंगी।', en: 'These festival facilities will appear here, with verified positions, once the organisers publish them.' })}
          action={clearBtn} />
      ) : types.length > 0 && !accessible && !openNow ? (
        <EmptyState icon={SearchX} title={t('noneNearby')}
          body={tr({ te: 'OpenStreetMap‌లో ఈ వర్గం సౌకర్యాలు మ్యాప్ చేయబడలేదు.', hi: 'OpenStreetMap में इस श्रेणी की कोई सुविधा मैप नहीं है।', en: 'No facilities of this kind are mapped in OpenStreetMap here.' })}
          action={clearBtn} />
      ) : (
        <EmptyState icon={SearchX} title={tr({ te: 'ఈ ఫిల్టర్లతో ఏమీ దొరకలేదు', hi: 'इन फ़िल्टर से कुछ नहीं मिला', en: 'Nothing matches these filters' })} action={clearBtn} />
      )}
    </div>
  )
  const mapPanel = (height: string) => (
    <div className="stack">
      <div className="map-panel">
        {center
          ? <LazyMap center={center} locations={mapped} me={coords} height={height} fitLocations onSelect={setSel} selectedId={sel?.id ?? null} />
          : <EmptyState icon={MapIcon} title={tr({ te: 'మ్యాప్ చేయబడిన ప్రదేశాలు లేవు', hi: 'कोई मैप किया गया स्थान नहीं', en: 'No mapped places to show' })} />}
      </div>
      {rows.length > mapped.length && <p className="xs muted">{tr({ te: `${num(rows.length - mapped.length)} ప్రదేశాల స్థానం ఇంకా ధృవీకరించబడలేదు – మ్యాప్‌లో చూపబడవు`, hi: `${num(rows.length - mapped.length)} स्थानों की स्थिति अभी सत्यापित नहीं – नक्शे पर नहीं`, en: `${num(rows.length - mapped.length)} places have no verified position yet and are not on the map` })}</p>}
      {sel ? <PlaceRow loc={sel} /> : <p className="small muted center">{tr({ te: 'వివరాల కోసం పిన్‌ను తాకండి', hi: 'विवरण के लिए पिन छुएँ', en: 'Select a pin for details' })}</p>}
    </div>
  )

  return (
    <div className="stack">
      <PageHead title={titleFor(types, accessible, t, tr)} sub={places.length ? `${centre ? `${name(centre)}${centre.district ? `, ${centre.district}` : ''} · ` : ''}${tr({ te: `${num(rows.length)} ప్రదేశాలు`, hi: `${num(rows.length)} स्थान`, en: `${num(rows.length)} places` })}` : undefined}
        actions={desktop ? undefined : <span className="hide-mobile"><Segmented label={t('facilities')} value={view} onChange={(v) => { setView(v); setSel(null) }}
          options={[{ value: 'list', label: t('listView'), icon: List }, { value: 'map', label: t('mapView'), icon: MapIcon }]} /></span>} />
      {filters}
      {!desktop && (
        <div className="only-mobile">
          <Segmented label={t('facilities')} value={view} onChange={(v) => { setView(v); setSel(null) }}
            options={[{ value: 'list', label: t('listView'), icon: List }, { value: 'map', label: t('mapView'), icon: MapIcon }]} />
        </div>
      )}
      <LocationPrompt compact />

      {places.length === 0 ? <Skeleton rows={5} /> : rows.length === 0 ? empty : desktop ? (
        <div className="layout-split">
          <div className="list">{rows.map((p) => <PlaceRow key={p.id} loc={p} onSelect={setSel} />)}</div>
          <div className="split-map">{mapPanel('calc(100dvh - var(--header-h) - 220px)')}</div>
        </div>
      ) : view === 'list' ? (
        <div className="cols-2" style={{ gap: 'var(--s2) var(--s4)' }}>{rows.map((p) => <PlaceRow key={p.id} loc={p} />)}</div>
      ) : mapPanel('60dvh')}
    </div>
  )
}
