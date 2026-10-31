/* QR scanner using the browser's BarcodeDetector (Chrome on Android 9+). The camera permission is requested
   only when this component mounts (i.e. after the user tapped "Scan"). Unsupported phones and denied
   permission fall back to typing the code - scanning is never required. */
import { useEffect, useRef, useState } from 'react'
import { CameraOff, Keyboard, ScanLine } from 'lucide-react'
import { useLang } from '../i18n'
import { haptic } from '../prefs'

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> }
type DetectorCtor = new (opts: { formats: string[] }) => Detector

export function qrSupported(): boolean { return typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia }

export default function QrScanner({ onResult, onCancel, hint }: { onResult: (text: string) => void; onCancel: () => void; hint?: string }) {
  const { tr, t } = useLang()
  const video = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<'starting' | 'scanning' | 'denied' | 'unsupported' | 'error'>(qrSupported() ? 'starting' : 'unsupported')

  useEffect(() => {
    if (!qrSupported()) return
    let stream: MediaStream | null = null
    let timer = 0
    let stopped = false
    const Ctor = (window as unknown as { BarcodeDetector: DetectorCtor }).BarcodeDetector
    const detector = new Ctor({ formats: ['qr_code'] })
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(async (s) => {
      if (stopped) { s.getTracks().forEach((tr) => tr.stop()); return }
      stream = s
      if (video.current) { video.current.srcObject = s; await video.current.play().catch(() => {}) }
      setState('scanning')
      const tick = async () => {
        if (stopped || !video.current) return
        try {
          const codes = await detector.detect(video.current)
          if (codes[0]?.rawValue) { haptic([20, 30, 20]); onResult(codes[0].rawValue.trim()); return }
        } catch { /* frame not ready */ }
        timer = window.setTimeout(tick, 280)
      }
      void tick()
    }).catch((e: DOMException) => setState(e?.name === 'NotAllowedError' ? 'denied' : 'error'))
    return () => { stopped = true; clearTimeout(timer); stream?.getTracks().forEach((tr) => tr.stop()) }
  }, [onResult])

  if (state === 'unsupported' || state === 'denied' || state === 'error') {
    return (
      <div className="notice warn">
        <CameraOff size={18} aria-hidden />
        <div className="grow stack tight">
          <span>{state === 'denied'
            ? tr({ te: 'కెమెరా అనుమతి లేదు. కోడ్‌ను టైప్ చేయండి.', hi: 'कैमरा अनुमति नहीं है। कोड टाइप करें।', en: 'Camera permission was denied. Please type the code instead.' })
            : tr({ te: 'ఈ ఫోన్‌లో స్కానింగ్ అందుబాటులో లేదు. కోడ్‌ను టైప్ చేయండి.', hi: 'इस फ़ोन पर स्कैन उपलब्ध नहीं। कोड टाइप करें।', en: 'Scanning is not available on this phone. Please type the code instead.' })}</span>
          <button className="btn sm" onClick={onCancel}><Keyboard size={16} aria-hidden />{tr({ te: 'టైప్ చేస్తాను', hi: 'टाइप करूँगा', en: 'Type instead' })}</button>
        </div>
      </div>
    )
  }
  return (
    <div className="stack tight">
      <div style={{ position: 'relative', borderRadius: 'var(--r-lg)', overflow: 'hidden', background: '#000', aspectRatio: '1 / 1', maxHeight: '52dvh' }}>
        <video ref={video} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} aria-label={tr({ te: 'కెమెరా', hi: 'कैमरा', en: 'Camera' })} />
        <div aria-hidden style={{ position: 'absolute', inset: '18%', border: '3px solid rgba(255,255,255,.9)', borderRadius: 18, boxShadow: '0 0 0 9999px rgba(0,0,0,.35)' }} />
      </div>
      <p className="small muted row"><ScanLine size={16} aria-hidden />{state === 'starting' ? t('loading') : (hint ?? tr({ te: 'QR కోడ్‌ను చతురస్రంలో ఉంచండి', hi: 'QR कोड को चौकोर में रखें', en: 'Hold the QR code inside the square' }))}</p>
      <button className="btn block" onClick={onCancel}>{t('cancel')}</button>
    </div>
  )
}
