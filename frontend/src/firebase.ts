/* Firebase (project godavari-pushkaralu-17a98): Google Analytics for usage insight.
   Sign-in itself stays on the Pushkar Sahayam API so roles, consent and the audit log keep working.
   The web config below is public by design (it identifies the project, it is not a secret); restrict the API key to
   the site's domains in Google Cloud Console. Every value can be overridden with VITE_FIREBASE_* at build time.
   SDK modules are loaded lazily so they never delay the first screen, and analytics never runs in tests. */
import type { Analytics } from 'firebase/analytics'

const env = import.meta.env
export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY ?? 'AIzaSyCHcBLY7vyDO7VPyshCMgZaYy7e306BeEI',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? 'godavari-pushkaralu-17a98.firebaseapp.com',
  projectId: env.VITE_FIREBASE_PROJECT_ID ?? 'godavari-pushkaralu-17a98',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? 'godavari-pushkaralu-17a98.firebasestorage.app',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '271511028539',
  appId: env.VITE_FIREBASE_APP_ID ?? '1:271511028539:web:4ca8fdaed9c3064c0bad1e',
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID ?? 'G-5B7Y4494BJ',
}

const enabled = env.MODE !== 'test' && env.VITE_FIREBASE_DISABLED !== 'true'
let analytics: Promise<Analytics | null> | null = null

/** Initialise Firebase + Analytics once (no-op where the browser does not support it, e.g. blocked cookies). */
export function initFirebase(): Promise<Analytics | null> {
  if (!enabled || typeof window === 'undefined') return Promise.resolve(null)
  if (!analytics) {
    analytics = (async () => {
      try {
        const [{ initializeApp }, { getAnalytics, isSupported }] = await Promise.all([import('firebase/app'), import('firebase/analytics')])
        const app = initializeApp(firebaseConfig)
        return (await isSupported()) ? getAnalytics(app) : null
      } catch {
        return null
      }
    })()
  }
  return analytics
}

/** Record an analytics event (login, sign_up, password_reset, …). Never throws, never blocks the UI. */
export function track(event: string, params?: Record<string, string | number | boolean>): void {
  void initFirebase().then(async (a) => {
    if (!a) return
    try {
      const { logEvent } = await import('firebase/analytics')
      logEvent(a, event, params)
    } catch { /* analytics is best-effort */ }
  })
}
