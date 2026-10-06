import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

/**
 * Screenshots of the trading desk (DEMO/REAL, desktop/mobile, Auto Trade running, AI BOT SCANNER open)
 * on genuine Deriv ticks. Usage: APP_URL=http://localhost:5173 node scripts/capture-desk.mjs
 */
const BASE = process.env.APP_URL || 'http://localhost:5173'
const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, '../../../docs/screenshots')
mkdirSync(outDir, { recursive: true })

const IGNORE = [/Download the React DevTools/i, /\[vite\]/i, /net::ERR_/i, /CORS policy/i]

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

async function signUp(page) {
  await page.goto(`${BASE}/register`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(400)
  if (page.url().includes('/app')) return
  await page.getByLabel(/^Full name$/i).fill('Desk Capture')
  await page.getByLabel(/^Email$/i).fill(`desk-${Date.now()}@example.com`)
  await page.getByLabel(/^Phone$/i).fill('+15550001111')
  await page.getByLabel(/^Password$/i).fill('demopass1')
  await page.getByLabel(/Confirm password/i).fill('demopass1')
  const terms = page.getByRole('checkbox')
  if (await terms.count()) await terms.first().check()
  await page.getByRole('button', { name: /^Create account$/i }).click()
  await page.waitForURL('**/app**', { timeout: 20000 })
}

async function openDesk(page, mode) {
  await page.evaluate((m) => localStorage.setItem('sbb.accountMode', m), mode)
  await page.goto(`${BASE}/app?symbol=R_100`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => /Live Deriv ticks · \d+/i.test(document.body.innerText), null, { timeout: 45000 })
  await page.waitForTimeout(3000)
}

const browser = await launch()
const results = []
const errors = []

for (const viewport of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(`${viewport.name} pageerror: ${e.message}`))
  page.on('console', (msg) => {
    if (msg.type() !== 'error' || IGNORE.some((re) => re.test(msg.text()))) return
    errors.push(`${viewport.name} console: ${msg.text()}`)
  })
  await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(600)
  if (page.url().includes('/login')) await signUp(page)

  await openDesk(page, 'demo')
  if (viewport.name === 'desktop') {
    const chart = page.getByRole('group', { name: 'Chart interval' })
    await chart.getByRole('button', { name: '1m', exact: true }).click()
    await page.getByRole('group', { name: 'Chart type' }).getByRole('button', { name: 'Candles', exact: true }).click()
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="price-chart"]')
        return el?.getAttribute('data-mode') === '1m' && Number(el.getAttribute('data-points')) > 0
      },
      null,
      { timeout: 45000 },
    )
    await page.waitForTimeout(2500)
  }
  const demoFile = resolve(outDir, `desk-${viewport.name}-demo.png`)
  await page.screenshot({ path: demoFile, fullPage: viewport.name === 'mobile' })
  results.push(demoFile)

  if (viewport.name === 'desktop') {
    await page.getByRole('group', { name: 'Chart interval' }).getByRole('button', { name: 'Tick', exact: true }).click()
  }
  await page.getByTestId('ai-bot-scanner-open').scrollIntoViewIfNeeded()
  await page.getByTestId('ai-bot-scanner-open').click()
  await page.getByTestId('ai-bot-scanner').waitFor({ timeout: 10000 })
  await page.getByTestId('ai-scanner-top-pick').waitFor({ timeout: 60000 })
  await page
    .waitForFunction(() => document.querySelectorAll('[data-testid^="ai-scanner-row-"]').length >= 3, null, { timeout: 30000 })
    .catch(async () => {
      const text = await page.getByTestId('ai-bot-scanner').innerText()
      errors.push(`${viewport.name} AI BOT SCANNER ranked fewer than 4 volatilities: ${text.replace(/\s+/g, ' ')}`)
    })
  await page.waitForTimeout(800)
  const scannerFile = resolve(outDir, `ai-bot-scanner-${viewport.name}.png`)
  await page.screenshot({ path: scannerFile })
  results.push(scannerFile)
  results.push(`${viewport.name} top pick: ${(await page.getByTestId('ai-scanner-top-pick').innerText()).replace(/\s+/g, ' ')}`)
  if (viewport.name === 'desktop') {
    await page.getByTestId('ai-scanner-load-prediction').click()
    await page.getByTestId('prediction-loaded').waitFor({ timeout: 10000 })
    await page.waitForTimeout(1500)
    const loadedFile = resolve(outDir, 'ai-bot-scanner-loaded.png')
    await page.screenshot({ path: loadedFile })
    results.push(loadedFile)
    results.push(`ticket: ${(await page.getByTestId('prediction-loaded').innerText()).replace(/\s+/g, ' ')}`)
    await page.goto(`${BASE}/app?symbol=R_100`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => /Live Deriv ticks · \d+/i.test(document.body.innerText), null, { timeout: 45000 })
  } else {
    await page.keyboard.press('Escape')
  }
  await page.waitForTimeout(300)

  if (viewport.name === 'desktop') {

    await page.getByRole('tab', { name: /EVEN \/ ODD/i }).click()
    await page.getByRole('button', { name: '$5', exact: true }).click()
    await page.getByTestId('auto-trade-start').click()
    await page.getByRole('button', { name: /Start DEMO Auto Trade/i }).click()
    await page.getByTestId('auto-trade-status').waitFor({ timeout: 10000 })
    await page.waitForTimeout(16000)
    const autoFile = resolve(outDir, 'desk-autotrade-demo.png')
    await page.screenshot({ path: autoFile })
    results.push(autoFile)
    const status = await page.getByTestId('auto-trade-status').innerText().catch(() => '')
    results.push(`auto status: ${status}`)
    const stop = page.getByTestId('auto-trade-stop')
    if (await stop.count()) await stop.click()
    await page.waitForTimeout(500)
  }

  await openDesk(page, 'real')
  const realFile = resolve(outDir, `desk-${viewport.name}-real.png`)
  await page.screenshot({ path: realFile, fullPage: viewport.name === 'mobile' })
  results.push(realFile)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
  if (overflow) errors.push(`${viewport.name} horizontal overflow on the desk`)
  await page.evaluate(() => localStorage.setItem('sbb.accountMode', 'demo'))
  await context.close()
}

await browser.close()
console.log(results.join('\n'))
if (errors.length) {
  console.error('ISSUES')
  for (const e of errors) console.error(`- ${e}`)
  process.exit(1)
}
console.log('No console errors.')
