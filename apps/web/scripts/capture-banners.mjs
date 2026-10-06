import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const BASE = process.env.APP_URL || 'http://localhost:5173'
const OUT = resolve(process.argv[2] || '../../docs/screenshots/banners-before')
mkdirSync(OUT, { recursive: true })

const publicRoutes = ['/login', '/signup', '/forgot-password']
const appRoutes = [
  '/app',
  '/app/dashboard',
  '/app/wallet',
  '/app/copy',
  '/app/copy/ph-01',
  '/app/history',
  '/app/transactions',
  '/app/notifications',
  '/app/support',
  '/app/profile',
  '/app/security',
]
const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]

function slug(route) {
  return route.replace(/^\//, '').replace(/\//g, '_') || 'root'
}

async function launch() {
  for (const options of [{ channel: 'msedge' }, { channel: 'chrome' }, {}]) {
    try {
      return await chromium.launch({ headless: true, ...options })
    } catch {}
  }
  throw new Error('No browser')
}

async function signIn(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(400)
  if (page.url().includes('/app')) return
  await page.getByLabel(/^Email$/i).fill(`banners-${Date.now()}@example.com`)
  await page.getByLabel(/^Password$/i).fill('demopass1')
  await page.getByRole('button', { name: /^Log in$/i }).click()
  await page.waitForURL('**/app**', { timeout: 20000 })
}

const browser = await launch()
for (const viewport of viewports) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  for (const route of publicRoutes) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/public-${slug(route)}-${viewport.name}.png`, fullPage: true })
  }
  await signIn(page)
  for (const mode of ['demo', 'real']) {
    await page.evaluate((m) => localStorage.setItem('sbb.accountMode', m), mode)
    for (const route of appRoutes) {
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1500)
      await page.screenshot({ path: `${OUT}/${mode}-${slug(route)}-${viewport.name}.png`, fullPage: true })
      process.stdout.write('.')
    }
  }
  await context.close()
}
await browser.close()
console.log(`\nSaved screenshots to ${OUT}`)
