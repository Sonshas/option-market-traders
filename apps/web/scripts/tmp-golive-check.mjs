import { chromium } from 'playwright'

const BASE = 'https://optionmarkettraders.com'
const out = process.env.SHOT_DIR || '.'
const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.getByLabel(/^Email$/i).fill('sbb-golive-check@example.invalid')
await page.getByLabel(/^Password$/i).fill('GoLive-Check-7731!')
await page.getByRole('button', { name: /^Log in$/i }).click()
await page.waitForURL('**/app**', { timeout: 30000 })
await page.evaluate(() => localStorage.setItem('sbb.accountMode', 'real'))
await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(8000)

const status = (await page.getByTestId('real-trade-status').first().innerText().catch(() => '')).trim()
const review = page.getByRole('button', { name: /REVIEW EVEN/i }).first()
const reviewText = (await review.innerText().catch(() => '')).replace(/\s+/g, ' ')
const reviewDisabled = await review.isDisabled().catch(() => null)
const account = await page.getByText(/REAL ACCOUNT/i).count()
const rate = (await page.getByText('Profit rate').first().locator('..').innerText().catch(() => '')).replace(/\s+/g, ' ')
await page.screenshot({ path: `${out}/golive-real-ticket.png`, fullPage: false })

await page.getByRole('tab', { name: /over/i }).first().click()
await page.getByRole('button', { name: '9', exact: true }).first().click()
await page.waitForTimeout(500)
const warning = (await page.getByTestId('cannot-win-warning').first().innerText().catch(() => '')).trim()
const payoutRow = (await page.getByText('Potential payout').first().locator('..').innerText().catch(() => '')).replace(/\s+/g, ' ')
const profitRow = (await page.getByText('Potential profit').first().locator('..').innerText().catch(() => '')).replace(/\s+/g, ' ')
await page.screenshot({ path: `${out}/golive-over9.png`, fullPage: false })

console.log(JSON.stringify({ account, status, reviewText, reviewDisabled, rate, warning, payoutRow, profitRow, errors }, null, 2))
await browser.close()
