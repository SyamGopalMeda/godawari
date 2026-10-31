/* Smart parking: find my vehicle (works without an account), map/list discovery with honest freshness,
   recommendation, zone QR scan, digital passes.
   Festival parking zones exist only once the organisers publish them. Until then the page says so and lists
   existing permanent public parking from OpenStreetMap (clearly labelled: not festival parking, availability
   unknown), and "Find my vehicle" saves the phone's current position instead of a zone.
   Phones: Find my vehicle → lots (list/map) → pass. Tablets: KPI row, lots in two columns.
   Desktop: main (KPIs + lots) with a sticky aside (Find my vehicle + digital pass). */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Ban, Bike, Bus, Car, CarFront, CircleCheck, CircleMinus, DoorOpen, ExternalLink, Footprints, Info, List as ListIcon, LocateFixed, Map as MapIcon, MapPin, Navigation, OctagonAlert, QrCode, ScanLine, Sparkles, SquareParking, Ticket, Trash2, TriangleAlert, X, type LucideIcon } from 'lucide-react'
import { api, externalDirections, fmtDist, hasCoords, type Location, type ParkingLot, type ParkingPass, type ParkingSpot } from '../../api'
import { useLang, type Key } from '../../i18n'
import { useStore } from '../../store'
import { useMyLocation } from '../../location'
import { haversineM, walkMinutes } from '../../geo'
import LazyMap from '../../components/LazyMap'
import QrScanner, { qrSupported } from '../../components/QrScanner'
import { EmptyState, Field, Freshness, LoginGate, Meter, Notice, PageHead, PlaceRow, Section, Segmented, Sheet, SubmitButton, VerificationBadge, freshnessOf, useAsync, useBreakpoint, useSubmit, useToast } from '../../components/ui'

const SPOT_KEY = 'ps.mySpot'
const STALE_SEC = 1800
/** lot_id = festival parking zone; when no zones are published the phone's position (lat/lng) is saved instead. */
interface LocalSpot { lot_id: number | null; row_label: string | null; note: string | null; saved_at: string; lat?: number | null; lng?: number | null }
const distOrNull = (a: [number, number] | null, lat: number | null, lng: number | null) => (a && lat != null && lng != null ? haversineM(a[0], a[1], lat, lng) : null)
function readSpot(): LocalSpot | null { try { const v = localStorage.getItem(SPOT_KEY); return v ? JSON.parse(v) : null } catch { return null } }
function writeSpot(s: LocalSpot | null) { try { s ? localStorage.setItem(SPOT_KEY, JSON.stringify(s)) : localStorage.removeItem(SPOT_KEY) } catch { /* private mode */ } }

const VEHICLE: Record<string, { icon: LucideIcon; label: { te: string; hi: string; en: string } }> = {
  car: { icon: Car, label: { te: 'కారు', hi: 'कार', en: 'Car' } },
  bike: { icon: Bike, label: { te: 'ద్విచక్ర వాహనం', hi: 'दोपहिया', en: 'Two-wheeler' } },
  bus: { icon: Bus, label: { te: 'బస్సు', hi: 'बस', en: 'Bus' } },
  van: { icon: CarFront, label: { te: 'వ్యాన్', hi: 'वैन', en: 'Van' } },
}
const STATUS_ICON: Record<ParkingLot['status'], LucideIcon> = { open: CircleCheck, filling: CircleMinus, full: OctagonAlert, closed: Ban }

function zoneCode(lot: ParkingLot): string { return lot.location.code.replace(/^PARK-/, '') }

/** Parse a zone QR: "PUSHKAR-PARK:<LOCATION_CODE>[:<ROW>]" or a bare location code such as "PARK-P1". */
function parseZone(text: string, lots: ParkingLot[]): { lot: ParkingLot; row: string | null } | null {
  const raw = text.trim().toUpperCase()
  let code = raw, row: string | null = null
  if (raw.startsWith('PUSHKAR-PARK:')) { const parts = text.trim().split(':'); code = (parts[1] ?? '').toUpperCase(); row = parts[2]?.trim() || null }
  const lot = lots.find((l) => l.location.code.toUpperCase() === code || zoneCode(l).toUpperCase() === code)
  return lot ? { lot, row } : null
}

function StatusChip({ s }: { s: ParkingLot['status'] }) {
  const { t } = useLang()
  const I = STATUS_ICON[s]
  return <span className={`chip ${s}`}><I aria-hidden />{t(s as Key)}</span>
}

function LotCard({ p, dist }: { p: ParkingLot; dist: number | null }) {
  const { t, tr, name, num, walkText } = useLang()
  const fresh = freshnessOf(p.updated_at, { staleSec: STALE_SEC })
  const stale = fresh === 'stale' || fresh === 'none'
  const lvl = p.status === 'full' || p.status === 'closed' ? 'critical' : p.status === 'filling' ? 'high' : p.occupancy_pct > 40 ? 'moderate' : 'low'
  const gateDist = p.nearest_gate ? distOrNull(hasCoords(p.location) ? [p.location.lat, p.location.lng] : null, p.nearest_gate.lat, p.nearest_gate.lng) : null
  const limited = p.vehicle_types.length > 0 && p.vehicle_types.length < 4
  return (
    <article className="card stack tight" aria-label={name(p.location)}>
      <div className="row top">
        <span className="chip brand" style={{ fontSize: 'var(--fs-sm)', minHeight: 32, padding: '2px 12px', fontWeight: 700 }} aria-label={tr({ te: 'జోన్', hi: 'ज़ोन', en: 'Zone' })}>{zoneCode(p)}</span>
        <div className="grow"><h3>{name(p.location)}</h3>{dist != null && <div className="xs muted">{fmtDist(dist)} · {walkText(walkMinutes(dist))}</div>}</div>
        <StatusChip s={p.status} />
      </div>
      <div className="row between wrap" style={{ alignItems: 'flex-end' }}>
        <div className="stat" style={{ color: stale ? 'var(--unknown)' : 'var(--text)' }}>
          <span className="v">{num(p.free_slots)}</span>
          <span className="l">{tr({ te: `ఖాళీ / మొత్తం ${num(p.total_slots)}`, hi: `खाली / कुल ${num(p.total_slots)}`, en: `free of ${num(p.total_slots)}` })}</span>
        </div>
        <Freshness iso={p.updated_at} source={p.source} staleSec={STALE_SEC} />
      </div>
      <Meter level={stale ? 'unknown' : lvl} pct={p.occupancy_pct} label={`${name(p.location)} ${Math.round(p.occupancy_pct)}%`} />
      {stale && <Notice tone="warn" icon={TriangleAlert}>{tr({ te: 'ఇటీవలి సమాచారం లేదు – ప్రవేశం వద్ద తనిఖీ చేయండి.', hi: 'हाल की जानकारी नहीं – प्रवेश पर जाँचें।', en: 'No recent count – check at the entry.' })}</Notice>}
      <div className="row wrap small" style={{ columnGap: 12, rowGap: 4, color: 'var(--text-2)' }}>
        {p.vehicle_types.map((v) => { const m = VEHICLE[v]; if (!m) return null; const I = m.icon; return <span key={v} className="row" style={{ gap: 4 }}><I size={16} aria-hidden />{tr(m.label)}</span> })}
      </div>
      {limited && <div className="xs muted">{tr({ te: 'పై వాహనాలకు మాత్రమే', hi: 'केवल ऊपर दिए वाहनों के लिए', en: 'Only the vehicles listed above' })}</div>}
      {p.nearest_gate && <div className="small row top" style={{ gap: 6 }}><DoorOpen size={16} aria-hidden /><span>{t('nearestGate')}: <strong>{name(p.nearest_gate)}</strong>{gateDist != null && ` · ${walkText(walkMinutes(gateDist))}`}</span></div>}
      {p.shuttle_info && <div className="small row top" style={{ gap: 6 }}><Bus size={16} aria-hidden /><span>{p.shuttle_info}</span></div>}
      <div className="divider" />
      <div className="grid2">
        <Link className="btn sm" to={`/map?to=${p.location.id}`}><Navigation size={16} aria-hidden />{t('directions')}</Link>
        {p.nearest_gate ? <Link className="btn sm tonal" to={`/map?to=${p.nearest_gate.id}`}><Footprints size={16} aria-hidden />{t('walkToGate')}</Link> : <span />}
      </div>
    </article>
  )
}

function SaveSpotSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (s: LocalSpot) => void }) {
  const { t, tr, name } = useLang()
  const { parking, user } = useStore()
  const { coords, requestGps, requesting, perm } = useMyLocation()
  const toast = useToast()
  const [lotId, setLotId] = useState<number | null>(null)
  const [row, setRow] = useState(''); const [note, setNote] = useState('')
  const [scan, setScan] = useState(false)
  const [scanErr, setScanErr] = useState<string | null>(null)
  const { run, busy, error } = useSubmit<LocalSpot>()
  useEffect(() => { if (open) { setScan(false); setScanErr(null) } }, [open])
  const onScan = useCallback((text: string) => {
    const r = parseZone(text, parking)
    setScan(false)
    if (!r) { setScanErr(tr({ te: 'ఈ QR కోడ్ పార్కింగ్ జోన్‌ది కాదు.', hi: 'यह QR कोड पार्किंग ज़ोन का नहीं है।', en: 'This QR code is not a parking zone code.' })); return }
    setScanErr(null); setLotId(r.lot.id); if (r.row) setRow(r.row)
  }, [parking, tr])
  const save = () => run(async () => {
    const s: LocalSpot = { lot_id: lotId!, row_label: row.trim() || null, note: note.trim() || null, saved_at: new Date().toISOString(), lat: coords?.[0] ?? null, lng: coords?.[1] ?? null }
    writeSpot(s)
    if (user && s.lot_id != null) await api.put<ParkingSpot>('/parking/my-spot', { lot_id: s.lot_id, row_label: s.row_label, note: s.note }).catch(() => { /* saved locally; server sync is optional */ })
    return s
  }).then((s) => { if (s) { onSaved(s); toast(t('saved')); onClose() } })
  // no festival zones published: remember the phone's current position (stays on this phone only)
  const savePosition = () => run(async () => {
    if (!coords) throw new Error(tr({ te: 'మీ స్థానం అందుబాటులో లేదు', hi: 'आपका स्थान उपलब्ध नहीं', en: 'Your position is not available' }))
    const s: LocalSpot = { lot_id: null, row_label: row.trim() || null, note: note.trim() || null, saved_at: new Date().toISOString(), lat: coords[0], lng: coords[1] }
    writeSpot(s)
    return s
  }).then((s) => { if (s) { onSaved(s); toast(t('saved')); onClose() } })
  if (parking.length === 0) {
    return (
      <Sheet open={open} onClose={onClose} title={tr({ te: 'నేను ఎక్కడ పార్క్ చేశాను', hi: 'मैंने कहाँ पार्क किया', en: 'Save where I parked' })}>
        <div className="stack">
          <Notice icon={Info}>{tr({ te: 'పండుగ పార్కింగ్ జోన్‌లు ఇంకా ప్రచురించబడలేదు. మీ వాహనం దగ్గర నిలబడి ప్రస్తుత స్థానాన్ని సేవ్ చేయండి.', hi: 'उत्सव पार्किंग ज़ोन अभी प्रकाशित नहीं हुए। अपनी गाड़ी के पास खड़े होकर वर्तमान स्थान सहेजें।', en: 'Festival parking zones have not been published yet. Stand next to your vehicle and save your current position.' })}</Notice>
          {coords
            ? <p className="small row" style={{ gap: 6 }}><LocateFixed size={16} aria-hidden />{tr({ te: 'ప్రస్తుత స్థానం సిద్ధంగా ఉంది', hi: 'वर्तमान स्थान उपलब्ध है', en: 'Current position available' })}</p>
            : <button className="btn tonal block" onClick={() => void requestGps()} disabled={requesting || perm === 'denied'}>{requesting ? <span className="spin" aria-hidden /> : <LocateFixed size={18} aria-hidden />}{t('useMyLocation')}</button>}
          {perm === 'denied' && <Notice tone="warn">{t('locationDenied')}</Notice>}
          <Field label={tr({ te: 'గమనిక', hi: 'नोट', en: 'Note' })} optional htmlFor="spot-note2" hint={tr({ te: 'ఉదా: నీలి గుడారం దగ్గర, వరుస C', hi: 'जैसे: नीले टेंट के पास, पंक्ति C', en: 'e.g. near the blue tent, row C' })}><input id="spot-note2" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          {error && <div className="err" role="alert">{error}</div>}
          <SubmitButton onClick={savePosition} busy={busy} disabled={!coords}><MapPin size={18} aria-hidden />{tr({ te: 'ఈ స్థానాన్ని సేవ్ చేయి', hi: 'यह स्थान सहेजें', en: 'Save this position' })}</SubmitButton>
          <p className="xs muted">{tr({ te: 'ఈ ఫోన్‌లోనే సేవ్ అవుతుంది; సర్వర్‌కు పంపబడదు.', hi: 'केवल इसी फ़ोन पर सहेजा जाता है; सर्वर पर नहीं भेजा जाता।', en: 'Saved on this phone only; not sent to the server.' })}</p>
        </div>
      </Sheet>
    )
  }
  return (
    <Sheet open={open} onClose={onClose} title={tr({ te: 'నేను ఎక్కడ పార్క్ చేశాను', hi: 'मैंने कहाँ पार्क किया', en: 'Save where I parked' })}>
      <div className="stack">
        {scan ? <QrScanner onResult={onScan} onCancel={() => setScan(false)} hint={tr({ te: 'జోన్ బోర్డుపై ఉన్న QR కోడ్‌ను స్కాన్ చేయండి', hi: 'ज़ोन बोर्ड पर लगा QR कोड स्कैन करें', en: 'Scan the QR code on the zone sign' })} /> : (
          <>
            {qrSupported() && <button className="btn tonal block" onClick={() => setScan(true)}><ScanLine size={18} aria-hidden />{tr({ te: 'జోన్ QR స్కాన్ చేయండి', hi: 'ज़ोन QR स्कैन करें', en: 'Scan zone QR' })}</button>}
            {scanErr && <div className="err" role="alert">{scanErr}</div>}
            <div className="stack tight" role="radiogroup" aria-label={tr({ te: 'పార్కింగ్ జోన్', hi: 'पार्किंग ज़ोन', en: 'Parking zone' })}>
              <span className="field-label">{tr({ te: 'పార్కింగ్ జోన్', hi: 'पार्किंग ज़ोन', en: 'Parking zone' })}</span>
              {parking.map((p) => (
                <button key={p.id} type="button" role="radio" aria-checked={lotId === p.id} className={`check ${lotId === p.id ? 'on' : ''}`} onClick={() => setLotId(p.id)}>
                  <span className="chip brand">{zoneCode(p)}</span><span className="grow" style={{ textAlign: 'left' }}>{name(p.location)}</span>
                  {lotId === p.id && <CircleCheck size={20} aria-hidden style={{ color: 'var(--brand-ink)' }} />}
                </button>
              ))}
            </div>
            <Field label={tr({ te: 'వరుస / స్తంభం నంబర్', hi: 'पंक्ति / खंभा संख्या', en: 'Row / pole number' })} optional htmlFor="spot-row"><input id="spot-row" className="input" value={row} onChange={(e) => setRow(e.target.value)} placeholder="C-12" /></Field>
            <Field label={tr({ te: 'గమనిక', hi: 'नोट', en: 'Note' })} optional htmlFor="spot-note" hint={tr({ te: 'ఉదా: నీలి గుడారం దగ్గర', hi: 'जैसे: नीले टेंट के पास', en: 'e.g. near the blue tent' })}><input id="spot-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            {error && <div className="err" role="alert">{error}</div>}
            <SubmitButton onClick={save} busy={busy} disabled={!lotId}>{t('save')}</SubmitButton>
            <p className="xs muted">{tr({ te: 'ఈ ఫోన్‌లోనే సేవ్ అవుతుంది. లాగిన్ అయి ఉంటే మీ ఖాతాకు కూడా.', hi: 'इसी फ़ोन पर सहेजा जाता है; लॉगिन होने पर खाते में भी।', en: 'Saved on this phone; also to your account when logged in.' })}</p>
          </>
        )}
      </div>
    </Sheet>
  )
}

function RecommendSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, tr, name } = useLang()
  const { crowd } = useStore()
  const { nearParam, coords } = useMyLocation()
  const [ghat, setGhat] = useState('')
  const [vehicle, setVehicle] = useState('car')
  const [res, setRes] = useState<ParkingLot[] | null>(null)
  const { run, busy, error } = useSubmit<ParkingLot[]>()
  const ghats = crowd.filter((c) => c.type === 'ghat')
  const go = () => run(() => api.get<ParkingLot[]>(`/parking/recommend?vehicle=${vehicle}${ghat ? `&ghat=${ghat}` : nearParam}`)).then((r) => { if (r) setRes(r) })
  return (
    <Sheet open={open} onClose={onClose} title={tr({ te: 'నాకు సరైన పార్కింగ్', hi: 'मेरे लिए पार्किंग सुझाएँ', en: 'Recommend a lot' })}>
      <div className="stack">
        <Field label={tr({ te: 'మీరు వెళ్లే ఘాట్', hi: 'आप किस घाट जा रहे हैं', en: 'Ghat you are going to' })} htmlFor="rec-ghat">
          <select id="rec-ghat" className="input" value={ghat} onChange={(e) => setGhat(e.target.value)}>
            <option value="">{coords ? t('nearMe') : tr({ te: 'ఏదైనా', hi: 'कोई भी', en: 'Any' })}</option>
            {ghats.map((g) => <option key={g.location_id} value={g.location_id}>{name(g)}</option>)}
          </select>
        </Field>
        <div className="stack tight">
          <span className="field-label">{tr({ te: 'వాహనం', hi: 'वाहन', en: 'Vehicle' })}</span>
          <div className="choice-grid" role="radiogroup">
            {Object.entries(VEHICLE).map(([k, m]) => { const I = m.icon; return <button key={k} type="button" role="radio" className="choice" aria-checked={vehicle === k} onClick={() => setVehicle(k)}><I size={24} aria-hidden />{tr(m.label)}</button> })}
          </div>
        </div>
        <SubmitButton onClick={go} busy={busy}><Sparkles size={18} aria-hidden />{t('recommended')}</SubmitButton>
        {error && <div className="err" role="alert">{error}</div>}
        {res && (res.length === 0
          ? <EmptyState icon={Ban} title={tr({ te: 'ప్రస్తుతం ఖాళీ స్థలం ఉన్న పార్కింగ్ లేదు', hi: 'अभी खाली जगह वाली कोई पार्किंग नहीं', en: 'No lot with free space right now' })} />
          : <div className="list">{res.map((p) => <LotCard key={p.id} p={p} dist={p.distance_m ?? null} />)}</div>)}
      </div>
    </Sheet>
  )
}

function Passes() {
  const { t, tr, name, ago } = useLang()
  const { parking } = useStore()
  const toast = useToast()
  const [passes, setPasses] = useState<ParkingPass[]>([])
  const [lot, setLot] = useState(''); const [vno, setVno] = useState(''); const [vt, setVt] = useState('car'); const [touched, setTouched] = useState(false)
  const { run, busy, error } = useSubmit<ParkingPass>()
  useEffect(() => { api.get<ParkingPass[]>('/parking/passes/mine').then(setPasses).catch(() => {}) }, [])
  const vErr = touched && vno.replace(/\s/g, '').length < 4 ? tr({ te: 'కనీసం 4 అక్షరాలు', hi: 'कम से कम 4 अक्षर', en: 'At least 4 characters' }) : null
  const lotName = (id: number) => { const l = parking.find((p) => p.id === id); return l ? `${zoneCode(l)} · ${name(l.location)}` : `#${id}` }
  const submit = () => { setTouched(true); if (vno.replace(/\s/g, '').length < 4 || !lot) return; void run(() => api.post<ParkingPass>('/parking/passes', { lot_id: Number(lot), vehicle_number: vno, vehicle_type: vt })).then((p) => { if (p) { setPasses((x) => [p, ...x]); setVno(''); setTouched(false); toast(tr({ te: 'పాస్ సిద్ధం', hi: 'पास तैयार', en: 'Pass ready' })) } }) }
  return (
    <div className="stack">
      <div className="card stack">
        <div className="card-head" style={{ marginBottom: 0 }}><h3 className="row" style={{ gap: 8 }}><Ticket size={18} aria-hidden />{t('getPass')}</h3></div>
        <Field label={tr({ te: 'పార్కింగ్ జోన్', hi: 'पार्किंग ज़ोन', en: 'Parking zone' })} htmlFor="pass-lot">
          <select id="pass-lot" className="input" value={lot} onChange={(e) => setLot(e.target.value)}>
            <option value="">—</option>
            {parking.filter((p) => p.status !== 'closed').map((p) => <option key={p.id} value={p.id}>{zoneCode(p)} · {name(p.location)}</option>)}
          </select>
        </Field>
        <Field label={t('vehicleNumber')} htmlFor="pass-vno" error={vErr} hint="AP05 AB 1234">
          <input id="pass-vno" className="input" autoCapitalize="characters" value={vno} aria-invalid={!!vErr} onBlur={() => setTouched(true)} onChange={(e) => setVno(e.target.value.toUpperCase())} />
        </Field>
        <div className="choice-grid" role="radiogroup" aria-label={tr({ te: 'వాహనం', hi: 'वाहन', en: 'Vehicle' })}>
          {Object.entries(VEHICLE).map(([k, m]) => { const I = m.icon; return <button key={k} type="button" role="radio" className="choice" aria-checked={vt === k} onClick={() => setVt(k)}><I size={22} aria-hidden />{tr(m.label)}</button> })}
        </div>
        {error && <div className="err" role="alert">{error}</div>}
        <SubmitButton onClick={submit} busy={busy} disabled={!lot}><Ticket size={18} aria-hidden />{t('getPass')}</SubmitButton>
      </div>
      {passes.map((p) => (
        <div key={p.id} className="card stack tight">
          <div className="row between wrap"><strong>{p.vehicle_number}</strong><span className={`chip ${p.status === 'issued' ? 'brand' : 'neutral'}`}>{p.status === 'issued' ? tr({ te: 'చెల్లుబాటు', hi: 'मान्य', en: 'Valid' }) : p.status === 'used' ? tr({ te: 'ఉపయోగించబడింది', hi: 'उपयोग हुआ', en: 'Used' }) : p.status}</span></div>
          <div className="qr" style={{ fontSize: 'var(--fs-lg)' }} aria-label={tr({ te: 'పాస్ కోడ్', hi: 'पास कोड', en: 'Pass code' })}><QrCode size={20} aria-hidden style={{ verticalAlign: 'middle', marginRight: 6 }} />{p.qr_token}</div>
          <div className="small muted">{lotName(p.lot_id)} · {ago(p.issued_at)}</div>
          <div className="small">{tr({ te: 'పార్కింగ్ ప్రవేశం వద్ద దీన్ని చూపించండి', hi: 'पार्किंग प्रवेश पर इसे दिखाएँ', en: 'Show this at the parking entry' })}</div>
        </div>
      ))}
    </div>
  )
}

export default function ParkingPage() {
  const { t, tr, name, ago, walkText, num } = useLang()
  const { parking, user, lastSync } = useStore()
  const { coords, requestGps, requesting, perm, nearParam } = useMyLocation()
  const bp = useBreakpoint()
  const desktop = bp === 'desktop'
  const mobile = bp === 'mobile'
  const [spot, setSpot] = useState<LocalSpot | null>(readSpot)
  const noZones = parking.length === 0 && !!lastSync
  // existing permanent public parking from OpenStreetMap (shown only while no festival zones are published)
  const osm = useAsync(() => (noZones ? api.get<Location[]>(`/locations?type=parking&has_coords=true${nearParam}&limit=60`) : Promise.resolve([] as Location[])), [noZones, nearParam])
  const [saveOpen, setSaveOpen] = useState(false)
  const [recOpen, setRecOpen] = useState(false)
  const [view, setView] = useState<'list' | 'map'>('list')
  const [selId, setSelId] = useState<number | null>(null)

  useEffect(() => {
    if (!user || spot) return
    api.get<ParkingSpot | null>('/parking/my-spot').then((s) => { if (s) { const v = { lot_id: s.lot_id, row_label: s.row_label, note: s.note, saved_at: s.saved_at }; writeSpot(v); setSpot(v) } }).catch(() => {})
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  const dist = (p: ParkingLot) => distOrNull(coords, p.location.lat, p.location.lng)
  const sorted = useMemo(() => [...parking].sort((a, b) => (coords ? (dist(a) ?? Infinity) - (dist(b) ?? Infinity) : b.free_slots - a.free_slots)), [parking, coords]) // eslint-disable-line react-hooks/exhaustive-deps
  const spotLot = spot && spot.lot_id != null ? parking.find((p) => p.id === spot.lot_id) ?? null : null
  const spotPos = spot && !spotLot && spot.lat != null && spot.lng != null ? { lat: spot.lat, lng: spot.lng } : null
  const sel = selId ? parking.find((p) => p.location.id === selId) ?? null : null
  const osmSel = selId && noZones ? (osm.data ?? []).find((l) => l.id === selId) ?? null : null
  const mapLocs: Location[] = (noZones ? (osm.data ?? []) : parking.map((p) => p.location)).filter(hasCoords)
  const firstMapped = mapLocs.find(hasCoords)
  const center: [number, number] = coords ?? (firstMapped && hasCoords(firstMapped) ? [firstMapped.lat, firstMapped.lng] : [17.0084, 81.7669])
  const clear = () => { writeSpot(null); setSpot(null) }
  const freeTotal = parking.reduce((a, p) => a + (p.status === 'closed' ? 0 : p.free_slots), 0)
  const fullCount = parking.filter((p) => p.status === 'full' || p.status === 'closed').length

  const recommendLabel = tr({ te: 'పార్కింగ్ సిఫార్సు', hi: 'पार्किंग सुझाएँ', en: 'Recommend a lot' })

  const findVehicle: ReactNode = (
    <Section title={tr({ te: 'నా వాహనం కనుగొనండి', hi: 'मेरी गाड़ी खोजें', en: 'Find my vehicle' })}>
      {spot && spotLot ? (
        <div className="card tint stack">
          <div className="row top">
            <span className="chip brand" style={{ fontSize: 'var(--fs-lg)', minHeight: 40, padding: '4px 14px', fontWeight: 700 }}>{zoneCode(spotLot)}</span>
            <div className="grow">
              <h3>{name(spotLot.location)}</h3>
              <div className="small">{spot.row_label && <strong>{tr({ te: 'వరుస/స్తంభం', hi: 'पंक्ति/खंभा', en: 'Row/pole' })} {spot.row_label}</strong>}{spot.note ? ` · ${spot.note}` : ''}</div>
              <div className="xs muted">{tr({ te: 'సేవ్ చేసింది', hi: 'सहेजा', en: 'Saved' })} {ago(spot.saved_at)}{coords && ` · ${fmtDist(dist(spotLot) ?? 0)} · ${walkText(walkMinutes(dist(spotLot) ?? 0))}`}</div>
            </div>
            <button className="btn icon sm ghost" onClick={clear} aria-label={tr({ te: 'సేవ్ చేసిన స్థలాన్ని తొలగించు', hi: 'सहेजी जगह हटाएँ', en: 'Clear saved spot' })}><Trash2 size={18} aria-hidden /></button>
          </div>
          <div className="grid2">
            <Link className="btn primary" to={`/map?to=${spotLot.location.id}`}><Navigation size={18} aria-hidden />{t('directions')}</Link>
            {spotLot.nearest_gate ? <Link className="btn" to={`/map?to=${spotLot.nearest_gate.id}`}><Footprints size={18} aria-hidden />{t('walkToGate')}</Link> : <button className="btn" onClick={() => setSaveOpen(true)}>{t('change')}</button>}
          </div>
        </div>
      ) : spotPos ? (
        <div className="card tint stack">
          <div className="row top">
            <span style={{ width: 48, height: 48, borderRadius: 'var(--r-lg)', display: 'grid', placeItems: 'center', background: 'var(--brand-100)', color: 'var(--brand-ink)', flexShrink: 0 }} aria-hidden><Car size={24} /></span>
            <div className="grow">
              <h3>{tr({ te: 'సేవ్ చేసిన వాహన స్థానం', hi: 'सहेजा गया वाहन स्थान', en: 'Saved vehicle position' })}</h3>
              {(spot?.note || spot?.row_label) && <div className="small">{[spot?.row_label, spot?.note].filter(Boolean).join(' · ')}</div>}
              <div className="xs muted">{tr({ te: 'సేవ్ చేసింది', hi: 'सहेजा', en: 'Saved' })} {ago(spot!.saved_at)}{(() => { const d = distOrNull(coords, spotPos.lat, spotPos.lng); return d != null ? ` · ${fmtDist(d)} · ${walkText(walkMinutes(d))}` : '' })()}</div>
            </div>
            <button className="btn icon sm ghost" onClick={clear} aria-label={tr({ te: 'సేవ్ చేసిన స్థలాన్ని తొలగించు', hi: 'सहेजी जगह हटाएँ', en: 'Clear saved spot' })}><Trash2 size={18} aria-hidden /></button>
          </div>
          <div className="grid2">
            <a className="btn primary" href={externalDirections(spotPos.lat, spotPos.lng)} target="_blank" rel="noopener noreferrer"><ExternalLink size={18} aria-hidden />{t('openInMaps')}</a>
            <button className="btn" onClick={() => setSaveOpen(true)}>{t('change')}</button>
          </div>
        </div>
      ) : (
        <button className="card clickable row" style={{ width: '100%', textAlign: 'left', color: 'inherit', gap: 'var(--s4)' }} onClick={() => setSaveOpen(true)}>
          <span style={{ width: 48, height: 48, borderRadius: 'var(--r-lg)', display: 'grid', placeItems: 'center', background: 'var(--brand-100)', color: 'var(--brand-ink)', flexShrink: 0 }} aria-hidden><MapPin size={24} /></span>
          <span className="grow"><span className="strong" style={{ display: 'block' }}>{tr({ te: 'నేను ఎక్కడ పార్క్ చేశానో సేవ్ చేయండి', hi: 'मैंने कहाँ पार्क किया, सहेजें', en: 'Save where I parked' })}</span><span className="small muted">{tr({ te: 'తిరిగి వచ్చేటప్పుడు సులభంగా కనుగొనండి', hi: 'लौटते समय आसानी से ढूँढें', en: 'Find your vehicle easily on the way back' })}</span></span>
        </button>
      )}
    </Section>
  )

  const kpis: ReactNode = parking.length > 0 && (
    <div className="kpis" aria-label={tr({ te: 'సారాంశం', hi: 'सारांश', en: 'Summary' })}>
      <div className="kpi"><div className="v">{num(parking.length)}</div><div className="l row" style={{ gap: 4 }}><SquareParking size={14} aria-hidden />{tr({ te: 'పార్కింగ్ ప్రాంతాలు', hi: 'पार्किंग क्षेत्र', en: 'Parking areas' })}</div></div>
      <div className="kpi"><div className="v" style={{ color: 'var(--low)' }}>{num(freeTotal)}</div><div className="l row" style={{ gap: 4, color: 'var(--low)' }}><CircleCheck size={14} aria-hidden />{tr({ te: 'ఖాళీ స్థలాలు', hi: 'खाली जगहें', en: 'Free spaces' })}</div></div>
      <div className="kpi"><div className="v" style={{ color: fullCount ? 'var(--critical)' : undefined }}>{num(fullCount)}</div><div className="l row" style={{ gap: 4 }}><OctagonAlert size={14} aria-hidden />{tr({ te: 'నిండినవి / మూసినవి', hi: 'भरे / बंद', en: 'Full or closed' })}</div></div>
    </div>
  )

  const osmRows = osm.data ?? []
  const publicParking: ReactNode = (
    <div className="stack loose">
      <div className="card stack tight">
        <div className="row top" style={{ gap: 'var(--s3)' }}>
          <span style={{ width: 44, height: 44, borderRadius: 'var(--r-md)', display: 'grid', placeItems: 'center', background: 'var(--moderate-soft)', color: 'var(--moderate)', flexShrink: 0 }} aria-hidden><SquareParking size={22} /></span>
          <div className="grow">
            <h3>{tr({ te: 'పండుగ పార్కింగ్ జోన్‌లు', hi: 'उत्सव पार्किंग ज़ोन', en: 'Festival parking zones' })}</h3>
            <p className="small muted">{tr({ te: 'పండుగ పార్కింగ్ జోన్‌లను నిర్వాహకులు ఇంకా ప్రచురించలేదు. ప్రచురించిన వెంటనే ఖాళీ స్థలాలు, ప్రవేశాలు, డిజిటల్ పాస్‌లు ఇక్కడ కనిపిస్తాయి.', hi: 'आयोजकों ने उत्सव पार्किंग ज़ोन अभी प्रकाशित नहीं किए। प्रकाशित होते ही खाली जगहें, प्रवेश और डिजिटल पास यहाँ दिखेंगे।', en: 'Festival parking zones have not been published by the organisers yet. Free spaces, entries and digital passes will appear here once they are.' })}</p>
          </div>
        </div>
      </div>
      <Section title={tr({ te: 'ఉన్న పబ్లిక్ పార్కింగ్ (OpenStreetMap)', hi: 'मौजूदा सार्वजनिक पार्किंग (OpenStreetMap)', en: 'Existing public parking (OpenStreetMap)' })}>
        <Notice icon={Info}>{tr({ te: 'శాశ్వత పబ్లిక్ పార్కింగ్ – పండుగ పార్కింగ్ కాదు; ఖాళీ ఉందో లేదో తెలియదు.', hi: 'स्थायी सार्वजनिक पार्किंग – उत्सव पार्किंग नहीं; खाली जगह की जानकारी उपलब्ध नहीं।', en: 'Permanent public parking – not festival parking; availability unknown.' })}</Notice>
        {!coords && (
          <Notice icon={LocateFixed}>
            <div className="row between wrap"><span>{tr({ te: 'దూరం ప్రకారం చూపడానికి మీ స్థానం అవసరం.', hi: 'दूरी से क्रम के लिए आपका स्थान चाहिए।', en: 'Share your location to sort by distance.' })}</span>
              <button className="btn sm primary" onClick={() => void requestGps()} disabled={requesting || perm === 'denied'}>{t('useMyLocation')}</button></div>
          </Notice>
        )}
        {osm.loading && !osm.data ? <div className="skel block" style={{ height: 120 }} aria-busy="true" />
          : osmRows.length === 0 ? <EmptyState icon={SquareParking} title={t('noneNearby')} />
          : (
            <>
              <div style={{ width: mobile ? '100%' : 240 }}><Segmented label={t('mapView')} value={view} onChange={setView} options={[{ value: 'list', label: t('listView'), icon: ListIcon }, { value: 'map', label: t('mapView'), icon: MapIcon }]} /></div>
              {view === 'list'
                ? <div className={mobile ? 'list' : 'cols-2'}>{osmRows.map((l) => <PlaceRow key={l.id} loc={l} trail={<VerificationBadge v={l.verification} compact />} />)}</div>
                : (
                  <div className="stack tight">
                    <div className="map-panel"><LazyMap center={center} locations={mapLocs} me={coords} fitLocations onSelect={(l) => setSelId(l?.id ?? null)} selectedId={selId} /></div>
                    {osmSel ? <PlaceRow loc={osmSel} trail={<VerificationBadge v={osmSel.verification} compact />} /> : <p className="small muted">{tr({ te: 'వివరాల కోసం పార్కింగ్ గుర్తును నొక్కండి', hi: 'विवरण के लिए पार्किंग पिन दबाएँ', en: 'Tap a parking pin for details' })}</p>}
                  </div>
                )}
            </>
          )}
      </Section>
    </div>
  )

  const lots: ReactNode = noZones ? publicParking : (
    <Section title={tr({ te: 'పార్కింగ్ ప్రాంతాలు', hi: 'पार्किंग क्षेत्र', en: 'Parking areas' })} action={mobile ? { label: tr({ te: 'సిఫార్సు', hi: 'सुझाव', en: 'Recommend' }), onClick: () => setRecOpen(true) } : undefined}>
      <div className="row between wrap">
        <div style={{ width: mobile ? '100%' : 240 }}><Segmented label={t('mapView')} value={view} onChange={setView} options={[{ value: 'list', label: t('listView'), icon: ListIcon }, { value: 'map', label: t('mapView'), icon: MapIcon }]} /></div>
      </div>
      {!coords && (
        <Notice icon={LocateFixed}>
          <div className="row between wrap"><span>{tr({ te: 'దూరం ప్రకారం చూపడానికి మీ స్థానం అవసరం.', hi: 'दूरी से क्रम के लिए आपका स्थान चाहिए।', en: 'Share your location to sort by distance.' })}</span>
            <button className="btn sm primary" onClick={() => void requestGps()} disabled={requesting || perm === 'denied'}>{t('useMyLocation')}</button></div>
        </Notice>
      )}
      {parking.length === 0 ? (lastSync ? <EmptyState icon={Car} title={tr({ te: 'పార్కింగ్ సమాచారం లేదు', hi: 'पार्किंग जानकारी नहीं', en: 'No parking information yet' })} /> : <div className="skel block" style={{ height: 160 }} aria-busy="true" />)
        : view === 'list' ? <div className={mobile ? 'list' : 'auto-grid'}>{sorted.map((p) => <LotCard key={p.id} p={p} dist={dist(p)} />)}</div>
        : (
          <div className="stack tight">
            <div className="map-panel">
              <LazyMap center={center} locations={mapLocs} me={coords} fitLocations onSelect={(l) => setSelId(l?.id ?? null)} selectedId={selId} />
            </div>
            {sel ? (
              <div className="stack tight" style={{ maxWidth: 560 }}>
                <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn sm ghost" onClick={() => setSelId(null)}><X size={16} aria-hidden />{t('close')}</button></div>
                <LotCard p={sel} dist={dist(sel)} />
              </div>
            ) : <p className="small muted">{tr({ te: 'వివరాల కోసం పార్కింగ్ గుర్తును నొక్కండి', hi: 'विवरण के लिए पार्किंग पिन दबाएँ', en: 'Tap a parking pin for details' })}</p>}
          </div>
        )}
    </Section>
  )

  const passes: ReactNode = (
    <Section title={t('getPass')}>
      {noZones
        ? <Notice icon={Ticket}>{tr({ te: 'నిర్వాహకులు పార్కింగ్ జోన్‌లను ప్రచురించిన తర్వాత డిజిటల్ పాస్‌లు అందుబాటులోకి వస్తాయి.', hi: 'आयोजकों द्वारा पार्किंग ज़ोन प्रकाशित होने के बाद डिजिटल पास उपलब्ध होंगे।', en: 'Digital passes become available once the organisers publish parking zones.' })}</Notice>
        : (
          <LoginGate reason={tr({ te: 'పాస్ మీ ఫోన్ నంబర్‌కు లింక్ అవుతుంది, ప్రవేశం వద్ద స్కాన్ చేస్తారు.', hi: 'पास आपके फ़ोन नंबर से जुड़ता है और प्रवेश पर स्कैन होता है।', en: 'A pass is linked to your phone number and scanned at the entry.' })}>
            <Passes />
          </LoginGate>
        )}
    </Section>
  )

  return (
    <div>
      <PageHead title={t('parking')} actions={mobile || noZones ? undefined : <button className="btn" onClick={() => setRecOpen(true)}><Sparkles size={18} aria-hidden />{recommendLabel}</button>} />
      {desktop ? (
        <div className="layout-aside">
          <div className="stack loose">
            {kpis}
            {lots}
          </div>
          <aside className="stack loose">
            {findVehicle}
            {passes}
          </aside>
        </div>
      ) : (
        <div className="stack loose">
          {findVehicle}
          {!mobile && kpis}
          {lots}
          {passes}
        </div>
      )}
      <SaveSpotSheet open={saveOpen} onClose={() => setSaveOpen(false)} onSaved={setSpot} />
      <RecommendSheet open={recOpen} onClose={() => setRecOpen(false)} />
    </div>
  )
}
