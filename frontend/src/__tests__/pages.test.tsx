/* Integration tests: every route renders against the LIVE API (backend must be running).
   Run:  cd backend && uvicorn app.main:app --port 8000   then   cd frontend && npm test
   (set PUSHKAR_API_BASE=http://127.0.0.1:<port> if the API runs elsewhere) */
import { describe, expect, it, beforeAll } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import App from '../App'
import { API_BASE } from './setup'

let apiUp = false
beforeAll(async () => {
  try { apiUp = (await fetch(API_BASE + '/health')).ok } catch { apiUp = false }
  if (!apiUp) console.warn(`Backend not reachable at ${API_BASE}; page tests will be skipped`)
})

async function loginAs(username: string, password: string) {
  const r = await fetch(API_BASE + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })
  localStorage.setItem('ps.token', (await r.json()).access_token)
}
async function loginPilgrim(phone: string) {
  const r = await fetch(API_BASE + '/api/v1/auth/otp/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }) })
  const { dev_otp } = await r.json()
  const v = await fetch(API_BASE + '/api/v1/auth/otp/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, code: dev_otp, name: 'Test' }) })
  localStorage.setItem('ps.token', (await v.json()).access_token)
}
const freshPhone = () => '+9191' + String(Date.now()).slice(-8)
function at(path: string) { window.history.pushState({}, '', path); return render(<App />) }
const T = { timeout: 9000 }

// Telugu is the default language
const publicRoutes: [string, RegExp][] = [
  ['/', /రద్దీ స్థితి/],                         // quick action "Crowd status"
  ['/crowd', /పుష్కర ఘాట్/],                     // a ghat by its Telugu name
  ['/parking', /కంబాల/],                         // P1 Kambala Park
  ['/services', /మరుగుదొడ్లు/],                  // category tile "Toilets"
  ['/facilities?type=restroom', /మరుగుదొడ్లు/],
  ['/emergency', /112/],
  ['/alerts', /గేట్ B|స్వాగతం/],                 // seeded welcome alert
  ['/profile', /ప్రొఫైల్/],
  ['/login', /OTP/],
  ['/missing', /తప్పిపోయిన/],
  ['/admin/login', /admin/i],
]

describe('pilgrim app (public, Telugu default)', () => {
  for (const [path, expected] of publicRoutes) {
    it(`renders ${path}`, async () => {
      if (!apiUp) return
      at(path)
      await waitFor(() => expect(screen.getAllByText(expected).length).toBeGreaterThan(0), T)
    })
  }

  it('ghat directory lists bathing centres with their ghats and verification badges', async () => {
    if (!apiUp) return
    localStorage.setItem('ps.lang', 'en')
    at('/ghats')
    await waitFor(() => expect(screen.getAllByText(/Pushkar Ghat/).length).toBeGreaterThan(0), T)
    expect(screen.getAllByText(/mapped/i).length).toBeGreaterThan(0)
  })

  it('place detail shows position, nearby facilities and data source for a mapped ghat', async () => {
    if (!apiUp) return
    localStorage.setItem('ps.lang', 'en')
    const locs = await (await fetch(API_BASE + '/api/v1/locations?type=ghat')).json() as { id: number; code: string }[]
    const ghat = locs.find((l) => l.code === 'GHAT-PUSHKAR') ?? locs[0]
    at(`/places/${ghat.id}`)
    await waitFor(() => expect(screen.getAllByText(/Pushkar Ghat/).length).toBeGreaterThan(0), T)
    await waitFor(() => expect(screen.getAllByText(/Data source|OpenStreetMap|Demo data/).length).toBeGreaterThan(0), T)
  })

  it('place detail for an unknown id shows an empty state with a way back', async () => {
    if (!apiUp) return
    localStorage.setItem('ps.lang', 'en')
    at('/places/999999')
    await waitFor(() => expect(screen.getAllByRole('link').some((a) => a.getAttribute('href') === '/ghats')).toBe(true), T)
  })

  it('shows the five-tab bottom navigation', async () => {
    if (!apiUp) return
    at('/')
    const nav = await screen.findByRole('navigation', { name: 'Main' }, T)
    expect(within(nav).getAllByRole('link')).toHaveLength(5)
  })

  it('sends first-time visitors to the introduction, which starts with language choice', async () => {
    if (!apiUp) return
    localStorage.removeItem('ps.onboarded')
    at('/')
    await screen.findByText('Choose language', {}, T)
    expect(window.location.pathname).toBe('/welcome')
  })

  it('never asks for location on load: no permission prompt, a manual choice is offered', async () => {
    if (!apiUp) return
    at('/')
    await waitFor(() => expect(screen.getAllByText(/నేనే ఎంచుకుంటాను|మార్చు|నా స్థానం ఉపయోగించు/).length).toBeGreaterThan(0), T)
  })

  it('renders the map with icon pins', async () => {
    if (!apiUp) return
    const { container } = at('/map')
    await waitFor(() => expect(container.querySelectorAll('.pin').length).toBeGreaterThan(10), { timeout: 15000 })
  })

  it('switches language from the header sheet and shows crowd levels as words', async () => {
    if (!apiUp) return
    at('/crowd')
    fireEvent.click(await screen.findByRole('button', { name: /^భాష/ }, T))
    fireEvent.click(await screen.findByRole('radio', { name: /English/ }, T))
    await waitFor(() => expect(screen.getAllByText(/Light crowd|Moderate crowd|Heavy crowd|Very heavy|No recent data/).length).toBeGreaterThan(3), T)
  })

  it('emergency separates official calls from the in-app request and never claims dispatch', async () => {
    if (!apiUp) return
    localStorage.setItem('ps.lang', 'en')
    at('/emergency')
    await screen.findByText('Call official emergency services', {}, T)
    expect(screen.getAllByText(/does not call an ambulance or the police/i).length).toBeGreaterThan(0)
    expect(screen.queryByText(/dispatched/i)).toBeNull()
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(links).toContain('tel:112')
  })

  it('family page asks guests to log in and explains why', async () => {
    if (!apiUp) return
    at('/family')
    await screen.findAllByText(/లాగిన్/, {}, T)
  })
})

describe('pilgrim app (authenticated)', () => {
  it('creates a family group and shows the join code and wristband actions', async () => {
    if (!apiUp) return
    await loginPilgrim(freshPhone())
    localStorage.setItem('ps.lang', 'en')
    at('/family')
    const create = await screen.findByRole('button', { name: /create family group/i }, T)
    expect((create as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change((await screen.findAllByRole('textbox'))[0], { target: { value: 'Smoke family' } })
    expect((create as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(create)
    await screen.findAllByText(/Smoke family/, {}, T)
    await waitFor(() => expect(screen.getAllByText(/[A-Z2-9]{6}/).length).toBeGreaterThan(0), T)
    await screen.findAllByText(/Find family member/i, {}, T)
  })

  it('missing-person report is a guided flow that starts by asking who is missing', async () => {
    if (!apiUp) return
    await loginPilgrim(freshPhone())
    localStorage.setItem('ps.lang', 'en')
    at('/missing')
    await screen.findAllByText(/Someone else/i, {}, T)
    expect(screen.getByRole('progressbar')).toBeTruthy()
  })
})

describe('staff and admin', () => {
  const adminRoutes: [string, RegExp][] = [
    ['/admin', /overview|dashboard|zones|reports/i],
    ['/admin/crowd', /Pushkar Ghat|పుష్కర ఘాట్/],
    ['/admin/parking', /Kambala|కంబాల/],
    ['/admin/reports', /SOS/],
    ['/admin/alerts', /alert/i],
    ['/admin/devices', /rfid-gate-a/],
    ['/admin/audit', /audit/i],
    ['/admin/video', /Video crowd-count check/],
  ]
  for (const [path, expected] of adminRoutes) {
    it(`admin renders ${path}`, async () => {
      if (!apiUp) return
      await loginAs('admin', 'admin12345')
      at(path)
      await waitFor(() => expect(screen.getAllByText(expected).length).toBeGreaterThan(0), T)
    })
  }

  it('video check page shows the detector status and upload form', async () => {
    if (!apiUp) return
    await loginAs('staff1', 'staff12345')
    at('/admin/video')
    await screen.findByText(/Upload and count people/, {}, T)
    await waitFor(() => expect(screen.getAllByText(/ready|not installed/).length).toBeGreaterThan(0), T)
  })

  it('volunteer sees staff mode with wristband lookup', async () => {
    if (!apiUp) return
    await loginAs('helpdesk2', 'helpdesk12345')
    at('/staff')
    await waitFor(() => expect(screen.getAllByText(/wristband|రిస్ట్‌బ్యాండ్/i).length).toBeGreaterThan(0), T)
  })

  it('pilgrim is redirected away from admin', async () => {
    if (!apiUp) return
    await loginPilgrim(freshPhone())
    at('/admin')
    await waitFor(() => expect(window.location.pathname).toBe('/admin/login'), T)
  })
})
