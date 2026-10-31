/* Mobile UX audit: renders every pilgrim screen in a phone viewport (Chrome via playwright-core) in
   Telugu, Hindi and English and checks for horizontal overflow, small touch targets and console errors.
   Screenshots + a JSON report go to --out.

   Needs: API on :8000 (uvicorn) and the Vite dev server on :5173.
     node scripts/ux-audit.mjs --out ../docs/screenshots --width 360 [--langs te,hi,en] [--shots en]
*/
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d }
const OUT = path.resolve(arg('out', './ux-audit-out'))
const WIDTH = Number(arg('width', '360'))
const HEIGHT = Number(arg('height', '780'))
// --viewports 360x780,768x1024,1440x900 overrides --width/--height
const VIEWPORTS = (arg('viewports', `${WIDTH}x${HEIGHT}`)).split(',').map((v) => { const [w, h] = v.split('x').map(Number); return { w, h } })
const ADMIN_ROUTES = arg('admin', 'yes') === 'yes'
const LANGS = arg('langs', 'te,hi,en').split(',')
const SHOT_LANGS = arg('shots', 'en,te').split(',')
const APP = arg('app', 'http://localhost:5173')
const API = arg('api', 'http://127.0.0.1:8000') + '/api/v1'
const CHROME = arg('chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe')
const SITE = { latitude: 17.0026, longitude: 81.7801 } // inside the demo riverfront (near Gate B)
fs.mkdirSync(OUT, { recursive: true })

async function j(method, url, body, headers = {}) {
  const r = await fetch(API + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined })
  const t = await r.text(); let d = null; try { d = t ? JSON.parse(t) : null } catch { d = t }
  if (!r.ok && r.status !== 409) throw new Error(`${method} ${url} ${r.status} ${t.slice(0, 200)}`)
  return d
}

/* ---------- REAL mode: verified dataset only. No crowd readings, alerts, devices or detections are posted:
   screenshots must show exactly what a pilgrim would see today. Only a pilgrim login is created. */
async function seedReal() {
  const admin = (await j('POST', '/auth/login', { username: 'admin', password: 'admin12345' })).access_token
  const phone = '+91922' + String(Date.now()).slice(-7)
  const { dev_otp } = await j('POST', '/auth/otp/request', { phone })
  const tok = await j('POST', '/auth/otp/verify', { phone, code: dev_otp, name: 'Ravi' })
  const ghats = await j('GET', '/locations?type=ghat')
  const pushkar = ghats.find((g) => g.code.startsWith('GHAT-RAJAHMUNDRY') && g.name === 'Pushkar Ghat')
  const unmapped = ghats.find((g) => g.lat == null)
  return { real: true, admin, vol: admin, token: tok.access_token, pushkar: pushkar.id, unmapped: unmapped?.id ?? pushkar.id, chinnu: null }
}

/* ---------- realistic data through the real API (no mocks) */
async function seed() {
  const health = await fetch(API.replace(/\/api\/v1$/, '') + '/health').then((r) => r.json()).catch(() => ({}))
  if (health.seed_mode === 'real') return seedReal()
  const admin = (await j('POST', '/auth/login', { username: 'admin', password: 'admin12345' })).access_token
  const A = { Authorization: `Bearer ${admin}` }
  const crowd = await j('GET', '/crowd/status')
  const mix = { 'GHAT-GOWTHAMI': 0.25, 'GHAT-KOTILINGALA': 0.62, 'GHAT-PUSHKAR': 0.93, 'GHAT-SARASWATHI': 0.35, 'GHAT-PADMAVATHI': 0.3, 'GATE-A': 0.3, 'GATE-B': 0.82, 'GATE-C': 0.5, 'GATE-D': 0.2 }
  await j('POST', '/crowd/readings', crowd.map((c) => ({ location_id: c.location_id, count: Math.round((c.capacity || 1000) * (mix[c.code] ?? 0.4)), source: 'manual' })), A)
  await j('POST', '/crowd/readings', { count: 13950, source: 'camera' }, { 'X-Device-Key': 'pk_demo_cam_pushkar' })
  const alerts = await j('GET', '/alerts/active')
  if (!alerts.some((a) => a.title.startsWith('Gate B'))) {
    await j('POST', '/alerts', { title: 'Gate B entry slowed', body: 'Heavy crowd at Gate B. Use Gate A or Gate C. Senior citizens: Gate D.', title_te: 'గేట్ B వద్ద ప్రవేశం నెమ్మదిగా ఉంది', body_te: 'గేట్ B వద్ద ఎక్కువ రద్దీ. గేట్ A లేదా గేట్ C ఉపయోగించండి. వృద్ధులు: గేట్ D.', title_hi: 'गेट B पर प्रवेश धीमा', body_hi: 'गेट B पर भारी भीड़। गेट A या गेट C का उपयोग करें। वरिष्ठ नागरिक: गेट D।', severity: 'warning', expires_in_minutes: 240 }, A)
  }
  // pilgrim with a family: one child detected at a checkpoint, one senior not yet detected
  // a fresh test number per run: the API allows 5 OTP requests per phone per hour (abuse control)
  const phone = '+91922' + String(Date.now()).slice(-7)
  const { dev_otp } = await j('POST', '/auth/otp/request', { phone })
  const tok = await j('POST', '/auth/otp/verify', { phone, code: dev_otp, name: 'Ravi' })
  const P = { Authorization: `Bearer ${tok.access_token}` }
  let fam = (await j('GET', '/families/mine', null, P))[0]
  if (!fam) fam = await j('POST', '/families', { name: 'Ravi family' }, P)
  const has = (n) => fam.members.find((m) => m.display_name === n)
  if (!has('Chinnu')) await j('POST', `/families/${fam.id}/members`, { display_name: 'Chinnu', age_group: 'child', relation: 'son', is_vulnerable: true }, P)
  if (!has('Amma')) await j('POST', `/families/${fam.id}/members`, { display_name: 'Amma', age_group: 'senior', relation: 'mother', is_vulnerable: true }, P)
  fam = (await j('GET', '/families/mine', null, P))[0]
  const chinnu = fam.members.find((m) => m.display_name === 'Chinnu'), amma = fam.members.find((m) => m.display_name === 'Amma')
  // unique wristbands per run (issued by staff, as at a help desk)
  const run = String(Date.now()).slice(-6)
  const tagChild = `UX-${run}-C`, tagSenior = `UX-${run}-S`
  await j('POST', '/rfid/tags', { uids: [tagChild, tagSenior] }, A)
  await j('POST', `/families/${fam.id}/members/${chinnu.id}/tag`, { tag_uid: tagChild, consent: true }, P)
  await j('POST', `/families/${fam.id}/members/${amma.id}/tag`, { tag_uid: tagSenior, consent: true }, P)
  await j('POST', '/rfid/sightings', [{ tag_uid: tagChild, direction: 'in', rssi: -52 }], { 'X-Device-Key': 'pk_demo_rfid_cp_2' })
  const vol = (await j('POST', '/auth/login', { username: 'helpdesk2', password: 'helpdesk12345' })).access_token
  return { admin, vol, token: tok.access_token, pushkar: crowd.find((c) => c.code === 'GHAT-PUSHKAR').location_id, chinnu: chinnu.id }
}

const ROUTES = (s) => [
  { name: 'welcome', path: '/welcome', fresh: true },
  { name: 'home', path: '/' },
  { name: 'explore', path: '/map', map: true },
  { name: 'route', path: `/map?to=${s.pushkar}`, map: true },
  { name: 'crowd', path: '/crowd' },
  { name: 'parking', path: '/parking' },
  { name: 'services', path: '/services' },
  { name: 'facilities', path: '/facilities?type=restroom,water' },
  { name: 'family', path: '/family' },
  { name: 'missing', path: '/missing' },
  ...(s.chinnu ? [{ name: 'missing-member', path: `/missing?member=${s.chinnu}` }] : []),
  { name: 'ghats', path: '/ghats' },
  { name: 'place-ghat', path: `/places/${s.pushkar}` },
  { name: 'place-unmapped', path: `/places/${s.unmapped}` },
  { name: 'emergency', path: '/emergency' },
  { name: 'alerts', path: '/alerts' },
  { name: 'profile', path: '/profile' },
  { name: 'login', path: '/login', guest: true },
  { name: 'home-guest-nolocation', path: '/', guest: true, noGeo: true },
  { name: 'staff', path: '/staff', as: 'vol' },
  ...(ADMIN_ROUTES ? [
    { name: 'admin-dashboard', path: '/admin', as: 'admin' },
    { name: 'admin-crowd', path: '/admin/crowd', as: 'admin' },
    { name: 'admin-reports', path: '/admin/reports', as: 'admin' },
    { name: 'admin-devices', path: '/admin/devices', as: 'admin' },
    { name: 'admin-locations', path: '/admin/locations', as: 'admin' },
    { name: 'admin-video', path: '/admin/video', as: 'admin' },
  ] : []),
]

async function audit(page) {
  return page.evaluate(() => {
    const MIN = window.innerWidth >= 1024 ? 32 : 40
    const W = window.innerWidth
    const out = { overflowX: document.documentElement.scrollWidth - W, wide: [], smallTargets: [] }
    const inMap = (el) => !!el.closest('.leaflet-container')
    for (const el of document.querySelectorAll('body *')) {
      if (inMap(el)) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none') continue
      // ignore descendants of horizontally scrollable containers (chip rows) - scrolling is intended there
      let p = el.parentElement, scroller = false
      while (p) { const s = getComputedStyle(p); if (s.overflowX === 'auto' || s.overflowX === 'scroll') { scroller = true; break } p = p.parentElement }
      if (!scroller && r.right > W + 1 && out.wide.length < 8) out.wide.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} right=${Math.round(r.right)} "${(el.textContent || '').trim().slice(0, 30)}"`)
      const interactive = el.matches('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=radio]')
      if (interactive && !el.closest('.sr-only') && (r.height < MIN || r.width < MIN) && el.type !== 'checkbox' && out.smallTargets.length < 8) {
        out.smallTargets.push(`${el.tagName.toLowerCase()} ${Math.round(r.width)}x${Math.round(r.height)} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)}"`)
      }
    }
    const vis = (sel) => { const e = document.querySelector(sel); if (!e) return false; const cs = getComputedStyle(e); return cs.display !== 'none' && e.getBoundingClientRect().width > 0 }
    out.shell = { bottomNav: vis('.bottom-nav'), sidebar: vis('.sidebar'), wideSidebar: (document.querySelector('.sidebar')?.getBoundingClientRect().width || 0) > 200 }
    return out
  })
}
function shellProblem(shell, w, isShell) {
  if (!isShell) return null
  if (w < 768) return shell.bottomNav && !shell.sidebar ? null : 'phone should show bottom tabs only'
  if (w < 1024) return !shell.bottomNav && shell.sidebar && !shell.wideSidebar ? null : 'tablet should show the rail only'
  return !shell.bottomNav && shell.wideSidebar ? null : 'desktop should show the full sidebar only'
}

;(async () => {
  const s = await seed()
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const report = []
  for (const vp of VIEWPORTS) {
  for (const lang of LANGS) {
    for (const r of ROUTES(s)) {
      const ctx = await browser.newContext({
        viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.w >= 1024 ? 1 : 2, isMobile: vp.w < 1024, hasTouch: vp.w < 1024,
        geolocation: r.noGeo ? undefined : SITE, permissions: r.noGeo ? [] : ['geolocation'], locale: lang === 'en' ? 'en-IN' : `${lang}-IN`,
      })
      const token = r.as === 'admin' ? s.admin : r.as === 'vol' ? s.vol : s.token
      await ctx.addInitScript(({ lang, token, fresh, guest }) => {
        try {
          localStorage.setItem('ps.lang', lang)
          if (!fresh) localStorage.setItem('ps.onboarded', '1'); else localStorage.removeItem('ps.onboarded')
          if (token && !guest) localStorage.setItem('ps.token', token); else localStorage.removeItem('ps.token')
        } catch { /* ignore */ }
      }, { lang, token, fresh: !!r.fresh, guest: !!r.guest })
      const page = await ctx.newPage()
      const errors = []
      page.on('console', (m) => { if (m.type() === 'error' && !/tile\.openstreetmap|ERR_|favicon|WebSocket|fonts\.g/.test(m.text())) errors.push(m.text().slice(0, 160)) })
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 160)))
      await page.goto(APP + r.path, { waitUntil: 'networkidle' }).catch(() => {})
      await page.waitForTimeout(r.map ? 2200 : 1200)
      const a = await audit(page)
      const isShell = !r.fresh && !r.path.startsWith('/admin')
      const shell = shellProblem(a.shell, vp.w, isShell)
      if (shell) errors.push('shell: ' + shell)
      report.push({ viewport: `${vp.w}x${vp.h}`, lang, route: r.name, path: r.path, ...a, errors })
      if (SHOT_LANGS.includes(lang)) await page.screenshot({ path: path.join(OUT, `${r.name}-${lang}-${vp.w}.png`), fullPage: !r.map })
      const flag = a.overflowX > 1 || a.wide.length || errors.length || a.smallTargets.length ? '  <-- CHECK' : ''
      console.log(`${vp.w}x${vp.h} ${lang} ${r.name.padEnd(22)} overflowX=${a.overflowX} wide=${a.wide.length} small=${a.smallTargets.length} errors=${errors.length}${flag}`)
      await ctx.close()
    }
  }
  }
  // offline: load once online, then reload with the network cut - the saved snapshot must render with its time
  {
    const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, geolocation: SITE, permissions: ['geolocation'] })
    await ctx.addInitScript(() => { try { localStorage.setItem('ps.lang', 'en'); localStorage.setItem('ps.onboarded', '1') } catch { /* */ } })
    const page = await ctx.newPage()
    await page.goto(APP + '/', { waitUntil: 'networkidle' }); await page.waitForTimeout(1000)
    await ctx.setOffline(true)
    await page.evaluate(() => window.dispatchEvent(new Event('offline')))
    await page.waitForTimeout(600)
    await page.screenshot({ path: path.join(OUT, 'offline-en.png'), fullPage: false })
    const banner = await page.locator('.netbar.offline').count()
    report.push({ lang: 'en', route: 'offline', banner })
    console.log(`en offline               netbar.offline=${banner}`)
    await ctx.close()
  }
  await browser.close()
  fs.writeFileSync(path.join(OUT, 'ux-audit-report.json'), JSON.stringify(report, null, 2))
  const bad = report.filter((x) => x.overflowX > 1 || (x.wide && x.wide.length) || (x.errors && x.errors.length) || (x.smallTargets && x.smallTargets.length))
  console.log(`\n${report.length} renders, ${bad.length} with overflow or errors. Report: ${path.join(OUT, 'ux-audit-report.json')}`)
})().catch((e) => { console.error(e); process.exit(1) })
