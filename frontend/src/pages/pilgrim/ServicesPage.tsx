/* Services directory: search everything, browse by large category tiles, jump to key services. */
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Accessibility, CarFront, Search, SearchX, Siren, UserSearch, Users, Waves } from 'lucide-react'
import { useLang, type Key } from '../../i18n'
import { useStore } from '../../store'
import { useDistance } from '../../location'
import { TypeIcon, typeMeta } from '../../components/icons'
import { EmptyState, ListRow, PlaceRow, Section, Skeleton } from '../../components/ui'
import { FESTIVAL_ONLY, LocationPrompt } from './FacilitiesPage'
import { useSites } from './HomePage'

// extra search words so "toilet", "doctor" or "పోలీస్" find the right category regardless of UI language
const WORDS: Record<string, string> = {
  ghat: 'ghat bath bathing snan ఘాట్ స్నానం घाट स्नान',
  dressing_room: 'changing dressing clothes room దుస్తులు గది वस्त्र कपड़े',
  restroom: 'toilet restroom wc bathroom మరుగుదొడ్డి టాయిలెట్ शौचालय टॉयलेट',
  water: 'water drinking తాగునీరు నీరు पानी पेयजल',
  medical: 'medical doctor hospital first aid ambulance వైద్య డాక్టర్ ఆసుపత్రి चिकित्सा डॉक्टर अस्पताल',
  food: 'food annadanam meals eat ఆహారం భోజనం అన్నదానం भोजन खाना',
  rest_area: 'rest shelter sit విశ్రాంతి विश्राम',
  police: 'police పోలీస్ पुलिस',
  help_desk: 'help desk information సహాయ కేంద్రం सहायता',
  lost_found: 'lost found missing తప్పిపోయిన खोया पाया',
  bus_stop: 'bus shuttle బస్ షటిల్ बस शटल',
  gate: 'gate entry entrance గేట్ प्रवेश गेट',
  parking: 'parking car bike పార్కింగ్ पार्किंग',
  checkpoint: 'checkpoint చెక్‌పాయింట్ चेकपॉइंट',
  railway_station: 'railway train station రైల్వే స్టేషన్ రైలు रेलवे स्टेशन ट्रेन',
}

const CATEGORIES: { types: string[]; key?: Key; label?: { te: string; hi: string; en: string } }[] = [
  { types: ['ghat'], label: { te: 'స్నాన ఘాట్‌లు', hi: 'स्नान घाट', en: 'Bathing ghats' } },
  { types: ['dressing_room'], key: 'dressing_room' },
  { types: ['restroom'], key: 'restroom' },
  { types: ['water'], key: 'water' },
  { types: ['medical'], key: 'medical' },
  { types: ['food'], key: 'food' },
  { types: ['rest_area'], key: 'rest_area' },
  { types: ['police', 'help_desk'], label: { te: 'పోలీస్ & సహాయం', hi: 'पुलिस व सहायता', en: 'Police & help desks' } },
  { types: ['lost_found'], key: 'lost_found' },
  { types: ['bus_stop'], label: { te: 'బస్ స్టేషన్లు', hi: 'बस स्टेशन', en: 'Bus stations' } },
  { types: ['railway_station'], key: 'railway_station' },
]

const TONE_BG: Record<string, [string, string]> = {
  brand: ['var(--brand-100)', 'var(--brand-ink)'], copper: ['var(--accent-soft)', 'var(--copper-700)'], sage: ['var(--sage-100)', 'var(--sage-700)'],
  accent: ['var(--saffron-100)', 'var(--saffron-700)'], danger: ['var(--danger-soft)', 'var(--danger)'],
}
function IconBox({ tone, children }: { tone: string; children: ReactNode }) {
  const [bg, fg] = TONE_BG[tone] ?? TONE_BG.brand
  return <span aria-hidden style={{ width: 48, height: 48, borderRadius: 'var(--r-lg)', display: 'grid', placeItems: 'center', background: bg, color: fg }}>{children}</span>
}

export default function ServicesPage() {
  const { t, tr, num } = useLang()
  const { places } = useStore()
  const sites = useSites()
  const dist = useDistance()
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()

  const results = useMemo(() => {
    if (!query) return []
    const terms = query.split(/\s+/)
    return places
      .filter((p) => {
        const hay = [p.name, p.name_te, p.name_hi, p.code, t(p.type as Key), WORDS[p.type] ?? ''].join(' ').toLowerCase()
        return terms.every((w) => hay.includes(w))
      })
      .map((p) => ({ p, d: dist(p.lat, p.lng) }))
      // nearest first; places without a verified position go last
      .sort((a, b) => (Number(a.d == null) - Number(b.d == null)) || ((a.d ?? 0) - (b.d ?? 0)) || a.p.name.localeCompare(b.p.name))
      .slice(0, 30)
      .map((x) => x.p)
  }, [places, query, dist, t])

  const count = (types: string[]) => places.filter((p) => types.includes(p.type) && p.is_open).length
  const accessibleCount = places.filter((p) => p.is_accessible && p.is_open).length
  const ghatsMapped = (sites ?? []).reduce((n, x) => n + x.ghats_mapped, 0)
  const ghatsTotal = (sites ?? []).reduce((n, x) => n + x.ghats_total, 0)

  const tileGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 'var(--s3)' } as const

  return (
    <div className="stack loose">
      <header className="stack tight">
        <h1>{t('services')}</h1>
        <p className="muted">{tr({ te: 'సౌకర్యాలు, పార్కింగ్ మరియు సహాయం కనుగొనండి', hi: 'सुविधाएँ, पार्किंग और सहायता खोजें', en: 'Find facilities, parking and help' })}</p>
      </header>
      <div className="search" role="search" style={{ maxWidth: 640 }}>
        <Search size={20} aria-hidden />
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('search')}
          placeholder={tr({ te: 'మరుగుదొడ్లు, నీరు, గేట్ B… వెతకండి', hi: 'शौचालय, पानी, गेट B… खोजें', en: 'Search toilets, water, Gate B…' })} />
      </div>

      {query ? (
        <Section title={tr({ te: 'ఫలితాలు', hi: 'परिणाम', en: 'Results' })}>
          <LocationPrompt compact />
          {places.length === 0 ? <Skeleton rows={4} /> : results.length === 0 ? (
            <div className="card">
              <EmptyState icon={SearchX} title={tr({ te: `"${q}" కోసం ఏమీ దొరకలేదు`, hi: `"${q}" के लिए कुछ नहीं मिला`, en: `Nothing found for "${q}"` })}
                body={tr({ te: 'వేరే పదం ప్రయత్నించండి లేదా క్రింది వర్గాలు చూడండి.', hi: 'दूसरा शब्द आज़माएँ या श्रेणियाँ देखें।', en: 'Try another word, or browse the categories.' })}
                action={<button className="btn tonal" onClick={() => setQ('')}>{tr({ te: 'వర్గాలు చూపించు', hi: 'श्रेणियाँ दिखाएँ', en: 'Show categories' })}</button>} />
            </div>
          ) : (
            <div className="cols-2" style={{ gap: 'var(--s2) var(--s4)' }}>{results.map((p) => <PlaceRow key={p.id} loc={p} />)}</div>
          )}
        </Section>
      ) : (
        <>
          <Section title={tr({ te: 'సౌకర్యాలు', hi: 'सुविधाएँ', en: 'Facilities' })}>
            <div style={tileGrid}>
              {CATEGORIES.map((c) => {
                const label = c.key ? t(c.key) : tr(c.label!)
                const isGhat = c.types[0] === 'ghat'
                const n = count(c.types)
                const tone = typeMeta(c.types[0]).tone
                // festival-only facilities with nothing published say so instead of "0 open"
                const unpublished = !isGhat && n === 0 && c.types.every((ty) => FESTIVAL_ONLY.includes(ty))
                const meta = isGhat
                  ? (sites ? tr({ te: `${num(ghatsMapped)}/${num(ghatsTotal)} మ్యాప్ చేయబడినవి`, hi: `${num(ghatsMapped)}/${num(ghatsTotal)} मैप किए गए`, en: `${num(ghatsMapped)} of ${num(ghatsTotal)} mapped` }) : null)
                  : places.length === 0 ? null : unpublished ? t('notPublished') : `${num(n)} ${tr({ te: 'తెరిచి', hi: 'खुले', en: 'open' })}`
                return (
                  <Link key={c.types.join()} to={isGhat ? '/ghats' : `/facilities?type=${c.types.join(',')}`} className="tile" aria-label={meta ? `${label}, ${meta}` : label}>
                    <IconBox tone={tone}><TypeIcon type={c.types[0]} size={24} /></IconBox>
                    <span>{label}</span>
                    {meta && <span className="xs muted" style={{ fontWeight: 500 }}>{meta}</span>}
                  </Link>
                )
              })}
              <Link to="/facilities?accessible=1" className="tile">
                <IconBox tone="sage"><Accessibility size={24} /></IconBox>
                <span>{tr({ te: 'సులభ ప్రవేశం', hi: 'सुगम सुविधाएँ', en: 'Accessible' })}</span>
                {places.length > 0 && <span className="xs muted" style={{ fontWeight: 500 }}>{num(accessibleCount)} {tr({ te: 'తెరిచి', hi: 'खुले', en: 'open' })}</span>}
              </Link>
            </div>
          </Section>

          <Section title={t('services')}>
            <div className="cols-2" style={{ gap: 'var(--s2) var(--s4)' }}>
              <ListRow to="/crowd" icon={<Waves size={22} />} title={t('crowdStatus')} meta={tr({ te: 'ఘాట్‌లు, గేట్ల వద్ద ప్రస్తుత రద్దీ', hi: 'घाटों व गेटों पर अभी की भीड़', en: 'Current crowd at ghats and gates' })} chevron />
              <ListRow to="/parking" icon={<CarFront size={22} />} title={tr({ te: 'పార్కింగ్ & నా వాహనం', hi: 'पार्किंग व मेरी गाड़ी', en: 'Parking & find my vehicle' })} meta={tr({ te: 'ఖాళీ స్థలాలు, పాస్, వాహనం ఎక్కడ', hi: 'खाली जगह, पास, गाड़ी कहाँ', en: 'Free spaces, passes, where you parked' })} chevron />
              <ListRow to="/missing" tone="accent" icon={<UserSearch size={22} />} title={t('findMissing')} meta={tr({ te: 'నివేదించండి, సహాయ కేంద్రాల్లో ఉన్నవారు', hi: 'रिपोर्ट करें, सहायता केंद्रों पर मिले लोग', en: 'Report, or see people at help desks' })} chevron />
              <ListRow to="/family" tone="copper" icon={<Users size={22} />} title={t('familyTracker')} meta={tr({ te: 'రిస్ట్‌బ్యాండ్ చెక్‌పాయింట్ వివరాలు', hi: 'रिस्टबैंड चेकपॉइंट जानकारी', en: 'Wristband checkpoint detections' })} chevron />
              <ListRow to="/emergency" tone="danger" icon={<Siren size={22} />} title={t('emergencyAssist')} meta={tr({ te: '112, 108, 100 మరియు సమీప సహాయం', hi: '112, 108, 100 और निकट सहायता', en: '112, 108, 100 and nearest help' })} chevron />
            </div>
          </Section>
        </>
      )}
    </div>
  )
}
