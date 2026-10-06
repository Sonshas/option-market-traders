import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

/**
 * Screenshots the public landing page once the live ticker has genuine prices.
 * Usage: APP_URL=https://... OUT_PREFIX=landing node scripts/capture-landing.mjs
 */
const BASE = process.env.APP_URL || 'http://localhost:5173'
const PREFIX = process.env.OUT_PREFIX || 'landing'
const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, '../../../docs/screenshots')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ headless: true })
const results = []
for (const viewport of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  const page = await browser.newPage({ viewport })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  let tickerItems = 0
  try {
    await page.waitForFunction(() => document.querySelectorAll('#markets li').length > 0, null, { timeout: 45000 })
    await page.waitForTimeout(3000)
    tickerItems = (await page.locator('#markets ul').first().locator('li').count())
  } catch (error) {
    errors.push(`ticker wait: ${error.message.split('\n')[0]}`)
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
  await page.screenshot({ path: resolve(outDir, `${PREFIX}-${viewport.name}.png`) })
  await page.screenshot({ path: resolve(outDir, `${PREFIX}-${viewport.name}-full.png`), fullPage: true })
  results.push({ viewport: viewport.name, tickerItems, overflow, errors })
  await page.close()
}
await browser.close()
console.log(JSON.stringify(results, null, 2))
if (results.some((r) => r.errors.length || r.overflow)) process.exit(1)
