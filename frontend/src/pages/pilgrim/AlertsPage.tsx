/* Notifications inbox: official advisories from the control room, most severe first.
   Tablet/desktop add a severity filter in the page header. */
import { useEffect, useState } from 'react'
import { BellOff, Clock3, Info, OctagonAlert, TriangleAlert } from 'lucide-react'
import { useLang } from '../../i18n'
import { useStore } from '../../store'
import { EmptyState, Notice, PageHead, Segmented, Skeleton, useBreakpoint, useNow } from '../../components/ui'
import { alertText } from './HomePage'

const SEV = { critical: 0, warning: 1, info: 2 } as const
type Filter = 'all' | 'critical' | 'warning' | 'info'
const CHIP: Record<keyof typeof SEV, string> = { critical: 'critical', warning: 'moderate', info: 'info' }

export default function AlertsPage() {
  const { t, tr, lang, clock, ago } = useLang()
  const { alerts, markAlertsSeen, lastSync } = useStore()
  const [filter, setFilter] = useState<Filter>('all')
  const wide = useBreakpoint() !== 'mobile'
  useNow(30000)
  useEffect(() => { markAlertsSeen() }, [alerts.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const sorted = [...alerts].sort((a, b) => SEV[a.severity] - SEV[b.severity] || b.created_at.localeCompare(a.created_at))
  const rows = wide && filter !== 'all' ? sorted.filter((a) => a.severity === filter) : sorted
  const sevLabel = (s: keyof typeof SEV) => s === 'critical'
    ? tr({ te: 'అత్యవసరం', hi: 'गंभीर', en: 'Critical' })
    : s === 'warning' ? tr({ te: 'హెచ్చరిక', hi: 'चेतावनी', en: 'Warning' }) : tr({ te: 'సమాచారం', hi: 'सूचना', en: 'Info' })

  return (
    <div className="narrow stack loose">
      <PageHead
        title={t('notifications')}
        sub={tr({ te: 'ఈవెంట్ కంట్రోల్ రూమ్ నుండి అధికారిక సూచనలు', hi: 'इवेंट कंट्रोल रूम से आधिकारिक सूचनाएँ', en: 'Official advisories from the event control room' })}
        actions={wide ? (
          <Segmented<Filter> label={tr({ te: 'వడపోత', hi: 'फ़िल्टर', en: 'Filter' })} value={filter} onChange={setFilter} options={[
            { value: 'all', label: tr({ te: 'అన్నీ', hi: 'सभी', en: 'All' }) },
            { value: 'critical', label: sevLabel('critical') },
            { value: 'warning', label: tr({ te: 'హెచ్చరికలు', hi: 'चेतावनियाँ', en: 'Warnings' }) },
            { value: 'info', label: sevLabel('info') },
          ]} />
        ) : undefined}
      />
      {lastSync == null && alerts.length === 0 ? <Skeleton rows={3} /> : rows.length === 0 ? (
        <div className="card"><EmptyState icon={BellOff} title={t('noAlerts')} body={tr({ te: 'కొత్త సూచనలు వస్తే ఇక్కడ కనిపిస్తాయి.', hi: 'नई सूचनाएँ यहाँ दिखेंगी।', en: 'New advisories will appear here.' })} /></div>
      ) : (
        <div className="list" style={{ gap: 'var(--s3)' }}>
          {rows.map((a) => {
            const x = alertText(a, lang)
            const I = a.severity === 'critical' ? OctagonAlert : a.severity === 'warning' ? TriangleAlert : Info
            return (
              <article key={a.id} className={`alert ${a.severity}`} role={a.severity === 'critical' ? 'alert' : undefined}>
                <div className="grow stack tight">
                  <div className="row between wrap" style={{ gap: 'var(--s2)' }}>
                    <span className={`chip ${CHIP[a.severity]}`}><I aria-hidden />{sevLabel(a.severity)}</span>
                    <span className="xs muted row" style={{ gap: 4 }}><Clock3 size={13} aria-hidden />{clock(a.created_at)} · {ago(a.created_at)}</span>
                  </div>
                  <h2 className="a-title" style={{ fontSize: 'var(--fs-md)' }}>{x.title}</h2>
                  <p className="a-body" style={{ marginTop: 0 }}>{x.body}</p>
                  {a.expires_at && <p className="xs muted">{tr({ te: 'వరకు చెల్లుతుంది', hi: 'तक मान्य', en: 'Valid until' })} {clock(a.expires_at)}</p>}
                </div>
              </article>
            )
          })}
        </div>
      )}
      <Notice icon={Info}>
        {tr({ te: 'యాప్ తెరిచి ఉన్నప్పుడు సూచనలు లైవ్‌గా వస్తాయి. పుష్ నోటిఫికేషన్లు ఇంకా అందుబాటులో లేవు.', hi: 'ऐप खुला रहने पर सूचनाएँ लाइव आती हैं। पुश नोटिफ़िकेशन अभी उपलब्ध नहीं हैं।', en: 'Advisories arrive live while the app is open. Push notifications are not available yet.' })}
      </Notice>
    </div>
  )
}
