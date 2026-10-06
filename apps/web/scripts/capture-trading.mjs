import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

/**
 * Opens the trading terminal, waits for genuine Deriv ticks to render in the chart and digit
 * panel, and saves screenshots. Usage: APP_URL=https://... OUT_PREFIX=live node scripts/capture-trading.mjs
 */
const BASE = process.env.APP_URL || 'http://localhost:5173'
const PREFIX = process.env.OUT_PREFIX || 'local'
const PATHNAME = process.env.APP_PATH || '/app?symbol=R_100'
const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, '../../../docs/screenshots')
mkdirSync(outDir, { recursive: true })

async function launch() {
  for (const options of [{ channel: 'msedge' }, { channel: 'chrome' }, {}]) {
    try {
      return await chromium.launch({ headless: true, ...options })
    } catch {
      /* try next */
    }
  }
  throw new Error('No Chromium available')
}

const browser = await launch()
const results = []
for (const viewport of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  const page = await browser.newPage({ viewport })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${BASE}${PATHNAME}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(800)
  if (page.url().includes('/login') && process.env.LOCAL_SIGNUP !== '0') {
    // Dev-only: VITE_E2E_AUTH_BYPASS keeps this signup local (never used against production).
    await page.goto(`${BASE}/register`, { waitUntil: 'domcontentloaded' })
    await page.getByLabel(/^Full name$/i).fill('Chart Capture')
    await page.getByLabel(/^Email$/i).fill(`capture-${Date.now()}@example.com`)
    await page.getByLabel(/^Phone$/i).fill('+15550001111')
    await page.getByLabel(/^Password$/i).fill('demopass1')
    await page.getByLabel(/Confirm password/i).fill('demopass1')
    const terms = page.getByRole('checkbox')
    if (await terms.count()) await terms.first().check()
    await page.getByRole('button', { name: /^Create account$/i }).click()
    await page.waitForURL('**/app**', { timeout: 20000 })
    await page.evaluate(() => localStorage.setItem('sbb.accountMode', 'demo'))
    await page.goto(`${BASE}${PATHNAME}`, { waitUntil: 'domcontentloaded' })
  }
  const url = page.url()
  let tickCount = 0
  let digits = 0
  try {
    await page.waitForFunction(
      () => /Live Deriv ticks · \d+/i.test(document.body.innerText),
      null,
      { timeout: 45000 },
    )
    await page.waitForTimeout(4000)
    const text = await page.locator('body').innerText()
    tickCount = Number(/Live Deriv ticks · (\d+)/i.exec(text)?.[1] ?? 0)
    digits = await page.locator('[data-testid="recent-digits"] span').count()
  } catch (error) {
    errors.push(`chart wait: ${error.message.split('\n')[0]}`)
  }
  const file = resolve(outDir, `${PREFIX}-trading-${viewport.name}.png`)
  await page.screenshot({ path: file, fullPage: viewport.name === 'mobile' })
  results.push({ viewport: viewport.name, url, tickCount, recentDigits: digits, file, errors })
  await page.close()
}
await browser.close()
console.log(JSON.stringify(results, null, 2))
if (results.some((r) => r.tickCount === 0 || r.errors.length)) process.exit(1)
