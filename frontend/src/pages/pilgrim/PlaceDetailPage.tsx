/* Place details (any ghat or facility): position, directions, verified crowd, nearby facilities and provenance.
   Places without a verified position get no map and no directions - only an explanation. Crowd levels appear
   only from a fresh reading. Festival-only categories with no data say "not yet published", never invented. */
import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Copy, ExternalLink, Gauge, Info, MapPinOff, Navigation, ShieldCheck, Waves } from 'lucide-react'
import { api, externalDirections, fmtDist, hasCoords, osmLink, type Location, type Nearby, type Verification } from '../../api'
import { useLang, type Key } from '../../i18n'
import { useStore } from '../../store'
import { useMyLocation } from '../../location'
import { haversineM, walkMinutes } from '../../geo'
import { TypeIcon } from '../../components/icons'
import LazyMap from '../../components/LazyMap'
import { EmptyState, Freshness, Notice, PageHead, PlaceRow, Skeleton, StatusBadge, VerificationBadge, useAsync, useBreakpoint, useToast } from '../../components/ui'
import { useSites } from './HomePage'

const PERMANENT = ['medical', 'police', 'restroom', 'water', 'parking', 'bus_stop', 'railway_station']
const FESTIVAL = ['gate', 'help_desk', 'dressing_room', 'lost_found']
const LOCALE: Record<string, string> = { te: 'te-IN', hi: 'hi-IN', en: 'en-IN' }

function useVerificationText() {
  const { tr } = useLang()
  return (v: Verification) => ({
    official: tr({ te: 'ఈవెంట్ నిర్వాహకులు / కంట్రోల్ రూమ్ ఈ స్థానాన్ని నిర్ధారించారు.', hi: 'इस स्थान की पुष्टि आयोजकों / कंट्रोल रूम ने की है।', en: 'Position confirmed by the event organisers or the control room.' }),
    source: tr({ te: 'స్థానం OpenStreetMap (స్వచ్ఛంద సేవకులు నిర్వహించే పబ్లిక్ మ్యాప్) నుండి. నిర్వాహకులు ఇంకా నిర్ధారించలేదు.', hi: 'स्थान OpenStreetMap (स्वयंसेवकों द्वारा बनाया सार्वजनिक नक्शा) से। आयोजकों ने अभी पुष्टि नहीं की।', en: 'Position taken from OpenStreetMap, a public map maintained by volunteers. Not yet confirmed by the organisers.' }),
    unverified: tr({ te: 'ప్రచురిత మూలంలో పేరు ఉంది, కానీ ఖచ్చితమైన స్థానం ఇంకా ధృవీకరించబడలేదు.', hi: 'प्रकाशित स्रोत में नाम है, पर सटीक स्थान अभी सत्यापित नहीं।', en: 'Named by a published source, but its exact position has not been verified.' }),
    unavailable: tr({ te: 'కంట్రోల్ రూమ్ దీనిని అందుబాటులో లేదని గుర్తించింది.', hi: 'कंट्रोल रूम ने इसे अनुपलब्ध चिह्नित किया है।', en: 'Marked unavailable by the control room.' }),
    demo: tr({ te: 'సింథటిక్ డెమో డేటా – నిజమైన స్థానం కాదు.', hi: 'कृत्रिम डेमो डेटा – वास्तविक स्थान नहीं।', en: 'Synthetic demo data – not a real place.' }),
  }[v] ?? '')
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

export default function PlaceDetailPage() {
  const { id } = useParams()
  const { t, tr, name, lang, clock, ago, num, walkText } = useLang()
  const { crowd } = useStore()
  const sites = useSites()
  const { coords } = useMyLocation()
  const toast = useToast()
  const desktop = useBreakpoint() === 'desktop'
  const vText = useVerificationText()
  const placeId = Number(id)

  const { data: loc, error, loading } = useAsync(() => api.get<Location>(`/locations/${placeId}`), [placeId])
  const mapped = !!loc && hasCoords(loc) && loc.verification !== 'unavailable'
  const near = useAsync<Nearby | null>(() => (mapped ? api.get<Nearby>(`/locations/${placeId}/nearby?radius_m=2500&per_type=5`) : Promise.resolve(null)), [placeId, mapped])

  const site = loc ? (sites ?? []).find((s) => s.id === loc.site_id) ?? null : null
  const live = crowd.find((c) => c.location_id === placeId) ?? null
  const freshReading = !!live && !live.is_stale && !!live.updated_at && live.density_level !== 'unknown'
  const d = loc && coords && hasCoords(loc) ? haversineM(coords[0], coords[1], loc.lat, loc.lng) : null

  const otherNames = useMemo(() => {
    if (!loc) return ''
    const all = [loc.name, loc.name_te, loc.name_hi].filter((x): x is string => !!x)
    const shown = name(loc)
    return [...new Set(all)].filter((x) => x !== shown).join(' · ')
  }, [loc, name])

  if (loading && !loc) return <div className="stack"><Skeleton rows={1} kind="line" /><Skeleton rows={4} /></div>
  if (error || !loc) {
    return (
      <div className="card">
        <EmptyState icon={MapPinOff} title={tr({ te: 'ప్రదేశం కనబడలేదు', hi: 'स्थान नहीं मिला', en: 'Place not found' })}
          body={tr({ te: 'ఈ ప్రదేశం తొలగించబడి ఉండవచ్చు.', hi: 'यह स्थान हटाया गया हो सकता है।', en: 'This place may have been removed.' })}
          action={<Link className="btn tonal" to="/ghats">{tr({ te: 'ఘాట్‌లు చూడండి', hi: 'घाट देखें', en: 'Browse ghats' })}</Link>} />
      </div>
    )
  }

  // unknown types (added later by admins) fall back to a generic label instead of failing
  const typeLabel = (() => { try { return t(loc.type as Key) || t('other') } catch { return t('other') } })()
  const retrieved = loc.source_retrieved_at ? new Date(loc.source_retrieved_at).toLocaleDateString(LOCALE[lang] ?? 'en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : null
  const copyCoords = () => {
    if (!hasCoords(loc)) return
    const txt = `${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}`
    void navigator.clipboard?.writeText(txt).then(() => toast(t('copied')), () => toast(txt, 'info'))
  }

  /* ------------------------------------------------------------------ cards */
  const positionCard = (
    <section className="card stack" aria-label={tr({ te: 'స్థానం', hi: 'स्थान', en: 'Position' })}>
      <div className="card-head" style={{ marginBottom: 0 }}><h2>{tr({ te: 'స్థానం', hi: 'स्थान', en: 'Position' })}</h2><VerificationBadge v={hasCoords(loc) ? loc.verification : 'unverified'} /></div>
      {hasCoords(loc) ? (
        <>
          <div className="map-preview" style={{ height: 260 }}>
            <LazyMap center={[loc.lat, loc.lng]} zoom={16} locations={[loc]} me={coords} height="100%" />
          </div>
          <div className="row between wrap">
            <span className="small" style={{ fontFamily: 'ui-monospace, Menlo, Consolas, monospace' }}>{loc.lat.toFixed(6)}, {loc.lng.toFixed(6)}</span>
            <button className="btn sm ghost" onClick={copyCoords}><Copy size={16} aria-hidden />{tr({ te: 'కాపీ', hi: 'कॉपी', en: 'Copy' })}</button>
          </div>
          {d != null && <p className="small">{fmtDist(d)} {t('away')}{d <= 20000 ? ` · ${walkText(walkMinutes(d, loc.is_accessible))}` : ''}</p>}
        </>
      ) : (
        <Notice tone="warn" icon={MapPinOff}>
          <strong>{tr({ te: 'స్థానం ఇంకా ధృవీకరించబడలేదు – దిశలు అందుబాటులో లేవు.', hi: 'स्थान अभी सत्यापित नहीं – दिशा उपलब्ध नहीं।', en: 'Location not yet verified – no directions available.' })}</strong>
          <div>{tr({ te: 'నిర్వాహకులు / అడ్మిన్‌లు ధృవీకరించిన స్థానాన్ని చేర్చగలరు.', hi: 'आयोजक / एडमिन सत्यापित स्थान जोड़ सकते हैं।', en: 'Organisers and admins can add the verified position.' })}</div>
        </Notice>
      )}
    </section>
  )

  const directionsCard = mapped && hasCoords(loc) ? (
    <section className="card stack tight" aria-label={t('directions')}>
      <h2 style={{ marginBottom: 'var(--s2)' }}>{t('directions')}</h2>
      <Link className="btn primary block" to={`/map?to=${loc.id}`}><Navigation size={18} aria-hidden />{tr({ te: 'నడక దారి', hi: 'पैदल मार्ग', en: 'Walking directions' })}</Link>
      <a className="btn block" href={externalDirections(loc.lat, loc.lng)} target="_blank" rel="noopener noreferrer"><ExternalLink size={18} aria-hidden />{t('openInMaps')}</a>
      <a className="btn ghost block" href={osmLink(loc.lat, loc.lng)} target="_blank" rel="noopener noreferrer">{tr({ te: 'OpenStreetMap‌లో చూడండి', hi: 'OpenStreetMap पर देखें', en: 'View on OpenStreetMap' })}</a>
    </section>
  ) : null

  const crowdCard = loc.type === 'ghat' || loc.monitored ? (
    <section className="card stack" aria-label={t('crowdStatus')}>
      <h2>{t('crowdStatus')}</h2>
      {freshReading && live ? (
        <div className="stack tight">
          <StatusBadge level={live.density_level} stale={live.is_stale} size="lg" />
          {live.current_count != null && <span className="small"><strong>{num(live.current_count)}</strong> {t('people')}{live.capacity ? ` · ${Math.round((live.current_count / live.capacity) * 100)}% ${tr({ te: 'సురక్షిత సామర్థ్యం', hi: 'सुरक्षित क्षमता का', en: 'of safe capacity' })}` : ''}</span>}
          <Freshness iso={live.updated_at} source={live.source} />
        </div>
      ) : (
        <Notice icon={Gauge}>
          <strong>{t('noVerifiedCrowd')}</strong>
          <div>{tr({ te: 'ఈ ఘాట్ వద్ద కెమెరాలు లేదా సిబ్బంది నివేదించినప్పుడు మాత్రమే రద్దీ వివరాలు ఇక్కడ కనిపిస్తాయి.', hi: 'इस घाट पर कैमरे या कर्मचारी रिपोर्ट करेंगे तभी भीड़ के आँकड़े यहाँ दिखेंगे।', en: 'Crowd figures appear here only when cameras or staff at this ghat report them.' })}</div>
          {live?.updated_at && <div className="xs" style={{ marginTop: 4 }}>{tr({ te: 'చివరి రీడింగ్', hi: 'अंतिम रीडिंग', en: 'Last reading' })} {ago(live.updated_at)}</div>}
        </Notice>
      )}
    </section>
  ) : null

  const nearbyCard = mapped ? (
    <section className="card stack" aria-label={tr({ te: 'సమీప సౌకర్యాలు', hi: 'पास की सुविधाएँ', en: 'Nearby facilities' })}>
      <div className="card-head" style={{ marginBottom: 0 }}>
        <h2>{tr({ te: 'సమీప సౌకర్యాలు', hi: 'पास की सुविधाएँ', en: 'Nearby facilities' })}</h2>
        <span className="xs muted">{tr({ te: '2.5 కి.మీ. లోపు', hi: '2.5 किमी के भीतर', en: 'within 2.5 km' })}</span>
      </div>
      {near.loading && !near.data ? <Skeleton rows={3} /> : near.error ? (
        <Notice tone="warn">{near.error}</Notice>
      ) : (
        <div className="cols-2" style={{ gap: 'var(--s5)' }}>
          {[...PERMANENT, ...FESTIVAL].map((ty) => {
            const rows = near.data?.groups[ty] ?? []
            const festival = FESTIVAL.includes(ty)
            return (
              <div key={ty} className="stack tight" style={{ minWidth: 0 }}>
                <h3 className="row" style={{ gap: 8, fontSize: 'var(--fs-sm)' }}><TypeIcon type={ty} size={18} />{t(ty as Key)}</h3>
                {rows.length === 0 ? (
                  <p className="small muted">{festival ? t('notPublished') : t('noneNearby')}</p>
                ) : (
                  <div className="list">
                    {rows.map((r) => (
                      <div key={r.id} className="stack" style={{ gap: 2 }}>
                        <PlaceRow loc={r} showStatus={false} />
                        {typeof r.details?.opening_hours === 'string' && <span className="xs muted" style={{ paddingLeft: 'var(--s4)' }}>{tr({ te: 'సమయాలు', hi: 'समय', en: 'Hours' })}: {r.details.opening_hours}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  ) : null

  const sourceCard = (
    <section className="card stack" aria-label={t('dataSource')}>
      <h2>{t('dataSource')}</h2>
      <dl className="kv">
        <dt>{t('source')}</dt><dd>{loc.source ?? '—'}</dd>
        {loc.source_ref && <><dt>{tr({ te: 'సూచన', hi: 'संदर्भ', en: 'Reference' })}</dt><dd><a className="btn sm ghost" href={loc.source_ref} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: 'anywhere', padding: '0 8px', marginLeft: -8 }}>{hostOf(loc.source_ref)}<ExternalLink size={13} aria-hidden /></a></dd></>}
        {retrieved && <><dt>{tr({ te: 'సేకరించిన తేదీ', hi: 'प्राप्ति तिथि', en: 'Retrieved' })}</dt><dd>{retrieved}</dd></>}
        <dt>{tr({ te: 'ధృవీకరణ', hi: 'सत्यापन', en: 'Verification' })}</dt><dd><VerificationBadge v={hasCoords(loc) ? loc.verification : 'unverified'} /></dd>
        {loc.verified_at && <><dt>{tr({ te: 'ధృవీకరించిన సమయం', hi: 'सत्यापन समय', en: 'Verified on' })}</dt><dd>{new Date(loc.verified_at).toLocaleDateString(LOCALE[lang] ?? 'en-IN')} {clock(loc.verified_at)}</dd></>}
        {loc.verification_note && <><dt>{tr({ te: 'గమనిక', hi: 'टिप्पणी', en: 'Note' })}</dt><dd style={{ fontWeight: 500 }}>{loc.verification_note}</dd></>}
      </dl>
      <p className="small muted">{vText(hasCoords(loc) ? loc.verification : 'unverified')}</p>
      <Notice icon={ShieldCheck}>{tr({
        te: 'తప్పు కనిపించిందా? సహాయ కేంద్రం లేదా కంట్రోల్ రూమ్‌కు తెలియజేయండి – అడ్మిన్ సరిదిద్దుతారు.',
        hi: 'कोई गलती दिखी? सहायता केंद्र या कंट्रोल रूम को बताएँ – एडमिन सुधार करेंगे।',
        en: 'Spotted a mistake? Tell staff at a help desk or the control room so an admin can correct it.',
      })}</Notice>
    </section>
  )

  const header = (
    <div className="stack tight">
      <PageHead
        title={name(loc)}
        sub={[typeLabel, site ? name(site) : null, site?.district, site?.state].filter(Boolean).join(' · ')}
        actions={<VerificationBadge v={hasCoords(loc) ? loc.verification : 'unverified'} />}
      />
      {otherNames && <p className="small muted" style={{ marginTop: 'calc(-1 * var(--s4))' }}>{otherNames}</p>}
      {!loc.is_open && <Notice tone="danger" icon={Info}>{tr({ te: 'ఈ ప్రదేశం ప్రస్తుతం మూసివేయబడింది.', hi: 'यह स्थान अभी बंद है।', en: 'This place is currently closed.' })}</Notice>}
      {loc.verification === 'demo' && <Notice icon={Info}>{t('demoNote')}</Notice>}
    </div>
  )

  return (
    <div className="stack loose">
      {header}
      {desktop ? (
        <div className="layout-aside">
          <div className="stack loose" style={{ minWidth: 0 }}>{crowdCard}{nearbyCard}{sourceCard}</div>
          <aside className="stack loose">{positionCard}{directionsCard}</aside>
        </div>
      ) : (
        <div className="stack loose">{positionCard}{directionsCard}{crowdCard}{nearbyCard}{sourceCard}</div>
      )}
      {site && (
        <Link to="/ghats" className="btn ghost" style={{ alignSelf: 'flex-start' }}><Waves size={18} aria-hidden />{tr({ te: 'అన్ని ఘాట్‌లు & స్నాన కేంద్రాలు', hi: 'सभी घाट व स्नान केंद्र', en: 'All ghats & bathing centres' })}</Link>
      )}
    </div>
  )
}
