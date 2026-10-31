/* Test setup: route relative fetches to the live backend, stub WebSocket + geolocation. */
import { afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'

export const API_BASE = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.PUSHKAR_API_BASE ?? 'http://127.0.0.1:8000'

const realFetch = globalThis.fetch
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const abs = url.startsWith('/') ? API_BASE + url : url
  return realFetch(abs, init)
}) as typeof fetch

class FakeWebSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3
  readyState = 3
  onopen: ((e: unknown) => void) | null = null
  onclose: ((e: unknown) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  onmessage: ((e: unknown) => void) | null = null
  constructor(_url: string) { /* never connects in tests */ }
  send() { /* noop */ }
  close() { /* noop */ }
}
// @ts-expect-error test stub
globalThis.WebSocket = FakeWebSocket

Object.defineProperty(globalThis.navigator, 'geolocation', {
  value: { getCurrentPosition: (_ok: unknown, err: (e: unknown) => void) => err(new Error('denied')), watchPosition: () => 0, clearWatch: () => undefined },
  configurable: true,
})
if (!('share' in navigator)) Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })

// returning user by default: the first-run introduction is tested explicitly in its own test
beforeEach(() => { try { localStorage.setItem('ps.onboarded', '1') } catch { /* ignore */ } })
afterEach(() => { cleanup(); try { localStorage.clear() } catch { /* ignore */ } })
