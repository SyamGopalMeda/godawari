/* Display & interaction preferences: theme, sunlight contrast, text size, haptics. Per-device, in localStorage. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export interface Prefs { theme: 'system' | 'light' | 'dark'; contrast: 'normal' | 'high'; text: 'normal' | 'large'; haptics: boolean }
const DEFAULTS: Prefs = { theme: 'light', contrast: 'normal', text: 'normal', haptics: true }
const KEY = 'ps.prefs'

function read(): Prefs { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return DEFAULTS } }

let hapticsOn = read().haptics
/** Short vibration on supported Android devices. Never used for errors that need attention only by sound/sight. */
export function haptic(pattern: number | number[] = 12) {
  if (!hapticsOn) return
  try { navigator.vibrate?.(pattern) } catch { /* unsupported */ }
}

interface Ctx { prefs: Prefs; set: <K extends keyof Prefs>(k: K, v: Prefs[K]) => void }
const PrefsCtx = createContext<Ctx | null>(null)

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(read)
  useEffect(() => {
    const el = document.documentElement
    if (prefs.theme === 'system') delete el.dataset.theme; else el.dataset.theme = prefs.theme
    if (prefs.contrast === 'high') el.dataset.contrast = 'high'; else delete el.dataset.contrast
    if (prefs.text === 'large') el.dataset.text = 'large'; else delete el.dataset.text
    hapticsOn = prefs.haptics
    try { localStorage.setItem(KEY, JSON.stringify(prefs)) } catch { /* private mode */ }
  }, [prefs])
  const set = useCallback(<K extends keyof Prefs>(k: K, v: Prefs[K]) => setPrefs((p) => ({ ...p, [k]: v })), [])
  const value = useMemo(() => ({ prefs, set }), [prefs, set])
  return <PrefsCtx.Provider value={value}>{children}</PrefsCtx.Provider>
}

export function usePrefs(): Ctx {
  const c = useContext(PrefsCtx)
  if (!c) throw new Error('PrefsProvider missing')
  return c
}
