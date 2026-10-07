import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const BASE = process.env.APP_URL || 'http://localhost:5173'

const publicRoutes = [
  '/',
  '/login',
  '/signup',
  '/register',
  '/forgot-password',
  '/verify-email',
  '/two-factor',
  '/about',
  '/contact',
  '/legal/risk',
  '/legal/terms',
  '/legal/privacy',
  '/admin',
  '/admin/users',
  '/admin/accounts',
  '/admin/deposits',
  '/admin/withdrawals',
  '/admin/trades',
  '/admin/ledger',
  '/admin/support',
  '/admin/notifications',
  '/admin/copy-traders',
  '/admin/settings',
  '/admin/audit',
  '/missing-route-404',
]

const appRoutes = [
  '/app/trade',
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

const ignoreConsole = [
  /Download the React DevTools/i,
  /\[vite\]/i,
  /net::ERR_CONNECTION_REFUSED/i,
  /Failed to load resource: net::ERR_CONNECTION_REFUSED/i,
  /Failed to load resource: net::ERR_FAILED/i,
  /Access to fetch .* blocked by CORS policy/i,
  /CORS policy/i,
]

async function launchBrowser() {
  const attempts = [{ channel: 'msedge' }, { channel: 'chrome' }, {}]
  for (const options of attempts) {
    try {
      return await chromium.launch({ headless: true, ...options })
    } catch (error) {
      console.error(`Launch failed (${options.channel || 'bundled'}): ${error.message}`)
    }
  }
  throw new Error('No usable Chrome/Edge/Chromium found.')
}

const BANNED_BANNER_TEXT = [
  /Status:\s*(NOT )?CONNECTED/i,
  /Market Data:/i,
  /NOT CONNECTED/,
  /No fake/i,
  /backend/i,
  /frontend/i,
  /Supabase/i,
  /server-side/i,
  /Live chart and prices only/i,
]

const VERIFY_PASSWORD = 'demopass1'
const VERIFY_EMAIL = `verify-ui-${Date.now()}@example.com`
const registrationLandings = []

const NAV_WIDTHS = [320, 375, 390, 414, 768, 1024, 1280, 1440, 1920]
const SCREENSHOT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url))
const DRAWER_LABELS = 'Trade/Dashboard/Wallet/Trade History/Transactions/Notifications/Support/Profile/Security'

/** Layout facts for the app shell at the current viewport. */
async function shellMetrics(page) {
  return page.evaluate(() => {
    const box = (el) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return r.width && r.height ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null
    }
    const probe = document.createElement('span')
    probe.style.color = 'var(--color-signal)'
    document.body.appendChild(probe)
    const signal = getComputedStyle(probe).color
    probe.remove()
    const active = document.querySelector('[data-testid="top-nav"] [aria-current="page"]')
    const header = document.querySelector('[data-testid="app-topbar"]')
    const clipped = [...document.querySelectorAll('[data-testid="app-topbar"] a, [data-testid="app-topbar"] button')]
      .filter((el) => el.getBoundingClientRect().width > 0 && el.scrollWidth > el.clientWidth + 1 && !el.querySelector('[data-testid="profile-name"]'))
      .map((el) => el.textContent.trim())
    const ids = ['top-nav', 'mode-switch', 'topbar-balance', 'topbar-bell', 'profile-menu-button', 'mobile-menu-button']
    const boxes = Object.fromEntries(ids.map((id) => [id, box(document.querySelector(`[data-testid="${id}"]`))]))
    const main = box(document.querySelector('main'))
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      headerOverflow: header ? header.scrollWidth > header.clientWidth + 1 : true,
      headerHeight: header?.getBoundingClientRect().height ?? 0,
      sidebar: document.querySelectorAll('nav[aria-label="Workspace"], aside.lg\\:flex').length,
      bottomNav: document.querySelectorAll('nav[aria-label="Mobile"]').length,
      copyLinks: [...document.querySelectorAll('a')].filter((a) => /copy trading/i.test(a.textContent) || a.getAttribute('href')?.startsWith('/app/copy')).length,
      activeLabel: active?.textContent.trim() ?? null,
      activeColor: active ? getComputedStyle(active).color : null,
      signal,
      clipped,
      boxes,
      main,
      bodyOverflow: getComputedStyle(document.body).overflow,
    }
  })
}

function overlaps(a, b) {
  return a && b && a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5
}

async function verifyNavigation(browser, issues) {
  mkdirSync(SCREENSHOT_DIR, { recursive: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(`nav pageerror: ${error.message}`))
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !ignoreConsole.some((re) => re.test(msg.text()))) errors.push(`nav console: ${msg.text()}`)
  })

  const before = registrationLandings.length
  await ensureAuthSession(page, `verify-nav-${Date.now()}@example.com`)
  const landing = registrationLandings[before]
  if (landing !== '/app/trade') issues.push(`registration landed on ${landing ?? 'unknown'} instead of /app/trade`)

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForURL('**/app/**', { timeout: 10000 })
  if (new URL(page.url()).pathname !== '/app/trade') issues.push(`signed-in /login landed on ${page.url()} instead of /app/trade`)

  for (const width of NAV_WIDTHS) {
    const tag = `nav ${width}px`
    await page.setViewportSize({ width, height: width < 768 ? 812 : 900 })
    await page.goto(`${BASE}/app/trade`, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('app-topbar').waitFor({ timeout: 10000 })
    await page.waitForTimeout(500)
    const m = await shellMetrics(page)
    if (m.scrollWidth > m.innerWidth) issues.push(`${tag} horizontal scroll (${m.scrollWidth} > ${m.innerWidth})`)
    if (m.headerOverflow) issues.push(`${tag} top bar overflows`)
    if (m.sidebar) issues.push(`${tag} sidebar still present`)
    if (m.bottomNav) issues.push(`${tag} bottom nav still present`)
    if (m.copyLinks) issues.push(`${tag} Copy Trading link present`)
    if (m.clipped.length) issues.push(`${tag} clipped top bar text: ${m.clipped.join(', ')}`)
    if (!m.main || m.main.left > 0.5 || Math.abs(m.main.right - width) > 0.5) issues.push(`${tag} trade page is not full width`)
    for (const [id, b] of Object.entries(m.boxes)) {
      if (b && (b.left < -0.5 || b.right > width + 0.5)) issues.push(`${tag} ${id} outside viewport`)
    }
    const visible = Object.entries(m.boxes).filter(([, b]) => b)
    for (let i = 0; i < visible.length; i += 1) {
      for (let j = i + 1; j < visible.length; j += 1) {
        if (overlaps(visible[i][1], visible[j][1])) issues.push(`${tag} ${visible[i][0]} overlaps ${visible[j][0]}`)
      }
    }
    for (const id of ['mode-switch', 'profile-menu-button']) {
      if (!m.boxes[id]) issues.push(`${tag} ${id} not visible`)
    }

    if (width >= 768) {
      if (!m.boxes['top-nav']) issues.push(`${tag} top nav not visible`)
      if (!m.boxes['topbar-bell']) issues.push(`${tag} notifications bell not visible`)
      if (!m.boxes['topbar-balance']) issues.push(`${tag} balance not visible`)
      if (m.activeLabel !== 'Trade') issues.push(`${tag} active nav item is ${m.activeLabel}, expected Trade`)
      if (m.activeColor !== m.signal) issues.push(`${tag} active item colour ${m.activeColor} is not signal ${m.signal}`)
      const hasMore = (await page.getByTestId('nav-more').count()) > 0
      if (width >= 1280 && hasMore) issues.push(`${tag} should show every item inline`)
      if (width < 1280 && !hasMore) issues.push(`${tag} missing More menu`)
      if (width === 1440) await page.screenshot({ path: `${SCREENSHOT_DIR}nav-desktop-1440.png` })
      if (width === 1024) {
        await page.screenshot({ path: `${SCREENSHOT_DIR}nav-laptop-1024.png` })
        await page.getByTestId('nav-more').click()
        await page.getByRole('menu', { name: 'More pages' }).getByRole('menuitem', { name: 'Transactions' }).click()
        await page.waitForURL('**/app/transactions', { timeout: 10000 })
        // The URL changes before React re-renders the bar; give the highlight a moment instead of racing it.
        await page.locator('[data-testid="nav-more"][aria-current="page"]').waitFor({ timeout: 3000 }).catch(() => {})
        const more = await page.getByTestId('nav-more').getAttribute('aria-current')
        if (more !== 'page') issues.push(`${tag} More not highlighted on a More page`)
        await page.goto(`${BASE}/app/wallet`, { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(300)
        const wallet = await page.getByTestId('top-nav').getByRole('link', { name: 'Wallet' }).getAttribute('aria-current')
        if (wallet !== 'page') issues.push(`${tag} Wallet not active on /app/wallet`)
      }
      if (width === 1280) {
        await page.getByTestId('profile-menu-button').click()
        const items = (await page.getByRole('menu', { name: 'Account' }).getByRole('menuitem').allInnerTexts()).map((t) => t.trim())
        for (const label of ['Profile', 'Security', 'Log out']) {
          if (!items.includes(label)) issues.push(`${tag} profile menu missing ${label}`)
        }
        await page.keyboard.press('Escape')
        await page.getByTestId('topbar-bell').click()
        await page.waitForURL('**/app/notifications', { timeout: 10000 })
      }
    } else {
      if (!m.boxes['mobile-menu-button']) issues.push(`${tag} hamburger not visible`)
      if (m.headerHeight < 44) issues.push(`${tag} top bar shorter than 44px`)
      if (width === 375) await page.screenshot({ path: `${SCREENSHOT_DIR}nav-mobile-375.png` })
      const drawer = page.getByRole('dialog', { name: 'Menu' })
      await page.getByTestId('mobile-menu-button').click()
      await drawer.waitFor({ timeout: 5000 })
      const labels = (await drawer.getByRole('navigation', { name: 'Mobile menu' }).getByRole('link').allInnerTexts()).map((t) =>
        t.trim().replace(/\s*\d+\+?$/, ''),
      )
      if (labels.join('/') !== DRAWER_LABELS) issues.push(`${tag} drawer items ${labels.join('/')}`)
      const open = await shellMetrics(page)
      if (open.bodyOverflow !== 'hidden') issues.push(`${tag} drawer does not lock body scroll`)
      if (open.scrollWidth > open.innerWidth) issues.push(`${tag} drawer causes horizontal scroll`)
      if (open.copyLinks) issues.push(`${tag} drawer has a Copy Trading link`)
      const panel = await drawer.boundingBox()
      if (!panel || panel.width > width || panel.height > (width < 768 ? 812 : 900) + 1) issues.push(`${tag} drawer does not fit the screen`)
      if (width === 375) await page.screenshot({ path: `${SCREENSHOT_DIR}nav-mobile-drawer.png` })
      await page.keyboard.press('Escape')
      if (await drawer.isVisible().catch(() => false)) issues.push(`${tag} drawer did not close on Escape`)
      await page.getByTestId('mobile-menu-button').click()
      await page.mouse.click(width - 10, 400)
      if (await drawer.isVisible().catch(() => false)) issues.push(`${tag} drawer did not close on backdrop tap`)
      await page.getByTestId('mobile-menu-button').click()
      await page.getByTestId('mobile-drawer-close').click()
      if (await drawer.isVisible().catch(() => false)) issues.push(`${tag} drawer did not close on close button`)
      await page.getByTestId('mobile-menu-button').click()
      await drawer.getByRole('link', { name: 'Wallet' }).click()
      await page.waitForURL('**/app/wallet', { timeout: 10000 })
      if (await drawer.isVisible().catch(() => false)) issues.push(`${tag} drawer did not close on selection`)
      if ((await page.evaluate(() => getComputedStyle(document.body).overflow)) === 'hidden') {
        issues.push(`${tag} body scroll still locked after drawer closed`)
      }
    }
    process.stdout.write('.')
  }

  issues.push(...errors)
  await context.close()
}

async function forceDemoMode(page) {
  await page.evaluate(() => {
    localStorage.setItem('sbb.accountMode', 'demo')
  })
  if (!page.url().includes('/app')) {
    await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' })
  }
  const demoToggle = page.getByRole('button', { name: /^Demo$/i })
  if (await demoToggle.count()) {
    await demoToggle.click()
    await page.waitForTimeout(200)
  }
}

async function ensureAuthSession(page, email = VERIFY_EMAIL) {
  // Already signed in? Auth pages redirect to /app — reuse session for DEMO checks.
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(400)
  if (page.url().includes('/app')) {
    await forceDemoMode(page)
    return
  }

  await page.goto(`${BASE}/register`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(300)
  if (page.url().includes('/app')) {
    await forceDemoMode(page)
    return
  }

  await page.getByLabel(/^Full name$/i).fill('Verify UI Trader')
  await page.getByLabel(/^Email$/i).fill(email)
  await page.getByLabel(/^Phone$/i).fill('+15550001111')
  await page.getByLabel(/^Password$/i).fill(VERIFY_PASSWORD)
  await page.getByLabel(/Confirm password/i).fill(VERIFY_PASSWORD)
  const terms = page.getByRole('checkbox')
  if (await terms.count()) {
    const checked = await terms.first().isChecked().catch(() => false)
    if (!checked) await terms.first().check()
  }
  await page.getByRole('button', { name: /^Create account$/i }).click()
  try {
    await page.waitForURL('**/app/**', { timeout: 20000 })
    registrationLandings.push(new URL(page.url()).pathname)
  } catch {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
    if (page.url().includes('/app')) {
      await forceDemoMode(page)
      return
    }
    await page.getByLabel(/^Email$/i).fill(email)
    await page.getByLabel(/^Password$/i).fill(VERIFY_PASSWORD)
    await page.getByRole('button', { name: /^Log in$/i }).click()
    await page.waitForURL('**/app**', { timeout: 20000 })
  }
  await forceDemoMode(page)
}

async function resetDemo(page) {
  await page.goto(`${BASE}/admin/settings`, { waitUntil: 'domcontentloaded' })
  const reset = page.getByRole('button', { name: /Reset DEMO data/i })
  if (await reset.count()) {
    await reset.click()
  }
  await ensureAuthSession(page, VERIFY_EMAIL)
}

async function placeContract(page, typeLabel, optionLabel) {
  await page.getByRole('tab', { name: new RegExp(typeLabel, 'i') }).click()
  await page.waitForTimeout(200)
  if (/MATCH/i.test(typeLabel)) {
    await page.getByRole('button', { name: /^5$/, exact: true }).first().click()
  }
  if (/OVER/i.test(typeLabel)) {
    await page.getByRole('button', { name: /^5$/, exact: true }).first().click()
  }
  await placeDemoInstantly(page, optionLabel.toLowerCase(), typeLabel)
}

/** DEMO trades open straight from the direction button: no dialog, and the trade lands in Open trades. */
async function placeDemoInstantly(page, option, label) {
  const openTab = page.getByTestId('ticket-trades').getByRole('tab', { name: /^Open \(/i })
  const openCount = async () => Number(((await openTab.innerText().catch(() => '')).match(/\((\d+)\)/) ?? [])[1] ?? NaN)
  const before = await openCount()
  const button = page.getByTestId(`direction-${option}`)
  await button.waitFor({ state: 'visible', timeout: 20000 })
  await page.waitForFunction((id) => !document.querySelector(`[data-testid="direction-${id}"]`)?.disabled, option, { timeout: 30000 })
  await button.click()
  await page.waitForTimeout(150)
  if (await page.getByRole('dialog').isVisible().catch(() => false)) throw new Error(`${label}: DEMO trade still opens a dialog`)
  await page.getByTestId('ticket-message').filter({ hasText: /^Trade placed/ }).waitFor({ timeout: 10000 })
  await page.waitForFunction(
    (n) => {
      const tab = [...document.querySelectorAll('[data-testid="ticket-trades"] [role="tab"]')].find((t) => /^Open \(/.test(t.textContent ?? ''))
      return Number((tab?.textContent ?? '').match(/\((\d+)\)/)?.[1]) > n
    },
    Number.isFinite(before) ? before : -1,
    { timeout: 10000 },
  )
}

const TICKET_TABS = { EVEN_ODD: /EVEN \/ ODD/i, OVER_UNDER: /OVER \/ UNDER/i, MATCH_DIFFER: /MATCH \/ DIFFER/i }
const LOAD_FIRST = 'Load a prediction before starting Auto Trade.'
const MODE_BANNERS = [
  /REAL ACTIVE/,
  /DEMO TRADE OPENED/,
  /REAL trade opened/,
  /You are trading on/i,
  /can lose your stake/i,
  /REAL limits checked by the server/,
  /min \$1\.00 · max \$500\.00/i,
]

/** No removed banner text and no empty banner boxes left in the trade ticket. */
async function ticketBannerIssues(page, label) {
  const found = []
  const text = await page.getByTestId('trade-ticket').innerText().catch(() => '')
  for (const banner of MODE_BANNERS) if (banner.test(text)) found.push(`${label}: ticket shows removed banner ${banner}`)
  const empty = await page.getByTestId('trade-ticket').evaluate((el) =>
    [...el.querySelectorAll('p, div[role="status"], div[role="alert"], p[role="alert"]')].filter((node) => {
      const r = node.getBoundingClientRect()
      return r.height > 0 && !node.textContent?.trim() && !node.querySelector('input, button, svg, canvas, img')
    }).length,
  )
  if (empty > 0) found.push(`${label}: ${empty} empty banner container(s) in the ticket`)
  return found
}

/** Opens the AI BOT SCANNER, waits for its single result and checks it shows exactly one prediction + one volatility. */
async function scanOnce(page, issues, label, screenshot) {
  await page.getByTestId('ai-bot-scanner-open').scrollIntoViewIfNeeded()
  await page.getByTestId('ai-bot-scanner-open').click()
  const dialog = page.getByTestId('ai-bot-scanner')
  const loadButton = page.getByTestId('ai-scanner-load-prediction')
  await loadButton.waitFor({ timeout: 10000 })
  const result = page.getByTestId('ai-scanner-result')
  if (!(await result.count()) && !(await loadButton.isDisabled())) issues.push(`${label}: LOAD PREDICTION enabled before the scan finished`)
  await result.waitFor({ timeout: 90000 })
  const shown = await dialog.evaluate((el) => ({
    results: el.querySelectorAll('[data-testid="ai-scanner-result"]').length,
    predictions: el.querySelectorAll('[data-testid="ai-scanner-prediction"]').length,
    volatilities: el.querySelectorAll('[data-testid="ai-scanner-volatility"]').length,
    loadButtons: [...el.querySelectorAll('button')].filter((b) => /^\s*Load/i.test(b.textContent ?? '')).length,
    lists: el.querySelectorAll('ol, ul, li').length,
    text: el.innerText,
  }))
  const top = await result.evaluate((el) => ({
    id: el.dataset.id,
    symbol: el.dataset.symbol,
    contract: el.dataset.contract,
    option: el.dataset.option,
    target: el.dataset.target,
    prediction: el.querySelector('[data-testid="ai-scanner-prediction"]')?.textContent?.trim() ?? '',
    volatility: el.querySelector('[data-testid="ai-scanner-volatility"]')?.textContent?.trim() ?? '',
  }))
  if (shown.results !== 1 || shown.predictions !== 1 || shown.volatilities !== 1) {
    issues.push(`${label}: scanner must show exactly one prediction and one volatility (${JSON.stringify(shown)})`)
  }
  if (shown.loadButtons !== 1) issues.push(`${label}: scanner shows ${shown.loadButtons} Load buttons (want only LOAD PREDICTION)`)
  if (shown.lists > 0) issues.push(`${label}: scanner still shows a ranked list`)
  if (!/Prediction:/.test(shown.text) || !/Volatility:/.test(shown.text)) issues.push(`${label}: scanner missing "Prediction:" / "Volatility:" labels`)
  if (!/^(EVEN|ODD|OVER \d|UNDER \d|MATCH \d|DIFFER \d)$/.test(top.prediction)) issues.push(`${label}: odd prediction text "${top.prediction}"`)
  if (!/^\d+( \(1s\))?$/.test(top.volatility)) issues.push(`${label}: volatility "${top.volatility}" is not a single display name`)
  if (/%|accura|win rate|guarantee|confidence/i.test(shown.text)) issues.push(`${label}: scanner claims accuracy / shows percentages`)
  if (!/Based on recent Deriv tick counts\. Past ticks do not predict future results\./.test(shown.text)) {
    issues.push(`${label}: scanner honesty note missing`)
  }
  if (screenshot) await dialog.screenshot({ path: `${SCREENSHOT_DIR}${screenshot}` })
  return { top, loadButton }
}

/** Ticket facts after LOAD PREDICTION. */
async function ticketState(page) {
  return page.evaluate(() => ({
    market: document.querySelector('select[aria-label="Market"]')?.value,
    tab: document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('aria-label') ?? '',
    target: document.querySelector('[data-testid="target-digit"] span')?.textContent ?? '',
    loadedSide: document.querySelector('[data-loaded="true"]')?.getAttribute('data-testid')?.replace('direction-', '') ?? '',
    confirmation: document.querySelector('[data-testid="prediction-loaded"]')?.textContent ?? '',
    scannerOpen: Boolean(document.querySelector('[data-testid="ai-bot-scanner"]')),
    dialogs: document.querySelectorAll('[role="dialog"]').length,
  }))
}

/** AI BOT SCANNER: LOAD PREDICTION must fill the ticket with exactly the displayed result and place nothing. */
async function verifyLoadPrediction(page, issues, tag, mode, contract) {
  await page.evaluate((m) => localStorage.setItem('sbb.accountMode', m), mode)
  await page.goto(`${BASE}/app/trade?symbol=R_100`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('tab', { name: TICKET_TABS[contract] }).waitFor({ timeout: 20000 })
  await page.getByRole('tab', { name: TICKET_TABS[contract] }).click()
  const label = `${tag} ${mode.toUpperCase()} ${contract}`
  try {
    const { top, loadButton } = await scanOnce(page, issues, label)
    if (top.contract !== contract) issues.push(`${label}: prediction did not follow the ticket contract tab (${top.contract})`)
    await loadButton.click()
    await page
      .waitForFunction(
        (symbol) => document.querySelector('select[aria-label="Market"]')?.value === symbol && document.querySelector('[data-testid="prediction-loaded"]'),
        top.symbol,
        { timeout: 8000 },
      )
      .catch(() => undefined)
    const ticket = await ticketState(page)
    const want = `prediction ${top.prediction} on ${top.symbol}`
    if (ticket.market !== top.symbol) issues.push(`${label}: ticket market ${ticket.market} ≠ ${top.symbol} (${want})`)
    if (!TICKET_TABS[contract].test(ticket.tab)) issues.push(`${label}: ticket contract ${ticket.tab} ≠ ${contract} (${want})`)
    if (ticket.loadedSide !== top.option) issues.push(`${label}: ticket side ${ticket.loadedSide || 'none'} ≠ ${top.option} (${want})`)
    if (top.target !== '' && ticket.target !== top.target) issues.push(`${label}: ticket digit ${ticket.target} ≠ ${top.target} (${want})`)
    const expected = `PREDICTION LOADED · ${top.prediction} · Volatility ${top.volatility} · READY TO TRADE`
    if (ticket.confirmation.trim() !== expected) issues.push(`${label}: loaded state "${ticket.confirmation}" ≠ "${expected}"`)
    if (ticket.scannerOpen) issues.push(`${label}: scanner stayed open after LOAD PREDICTION`)
    if (ticket.dialogs > 0) issues.push(`${label}: LOAD PREDICTION opened a trade dialog`)
    return { top, ticket }
  } catch (error) {
    issues.push(`${label}: ${error.message.split('\n')[0]}`)
    return null
  } finally {
    await page.evaluate(() => localStorage.setItem('sbb.accountMode', 'demo'))
  }
}

/** One DEMO trade from the store by id: status and exit digit. */
async function demoTradeById(page, id) {
  return page.evaluate((tradeId) => {
    for (let i = 0; i < localStorage.length; i += 1) {
      try {
        const value = JSON.parse(localStorage.getItem(localStorage.key(i)) ?? 'null')
        if (value && Array.isArray(value.trades) && value.wallet) {
          const t = value.trades.find((item) => item.id === tradeId)
          return t ? { status: t.status, exitDigit: t.exitDigit ?? null } : null
        }
      } catch {
        // not JSON
      }
    }
    return null
  }, id)
}

/**
 * Digit-strip trade animation (DEMO only): exactly one cursor circle while the trade runs, the cursor ends on the
 * trade's exit digit, no WON / LOST before settlement and the result ~3 s after the final digit is shown.
 */
async function verifyTradeAnimation(page, issues, tag) {
  const label = `${tag} trade animation`
  try {
    await page.evaluate(() => localStorage.setItem('sbb.accountMode', 'demo'))
    await page.goto(`${BASE}/app/trade?symbol=R_100`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('tab', { name: /EVEN \/ ODD/i }).waitFor({ timeout: 20000 })
    await page.getByRole('tab', { name: /EVEN \/ ODD/i }).click()
    await page.waitForFunction(() => Number(document.querySelector('[data-testid="digit-sample"]')?.getAttribute('data-sample')) > 0, null, { timeout: 30000 })
    await page.evaluate(() => {
      const log = []
      window.__tradeAnimLog = log
      window.__tradeAnimTimer = setInterval(() => {
        const cursor = document.querySelector('[data-testid="digit-cursor"]')
        const line = document.querySelector('[data-testid="trade-anim-status"], [data-testid="trade-anim-result"]')
        log.push({
          t: performance.now(),
          circles: document.querySelectorAll('[data-testid="digit-cursor-circle"]').length,
          tradeId: cursor?.dataset.tradeId ?? line?.dataset.tradeId ?? '',
          status: cursor?.dataset.status ?? line?.dataset.status ?? '',
          digit: cursor?.dataset.digit ?? '',
          text: line?.textContent ?? '',
        })
      }, 100)
    })
    const before = new Set((await demoTrades(page)).map((t) => t.id))
    await placeDemoInstantly(page, 'even', label)
    const placed = (await demoTrades(page)).find((t) => !before.has(t.id))
    if (!placed) throw new Error('placed trade not found in the DEMO store')

    const cursor = page.locator(`[data-testid="digit-cursor"][data-trade-id="${placed.id}"]`)
    await page.locator(`[data-testid="digit-cursor"][data-trade-id="${placed.id}"][data-status="running"]`).waitFor({ timeout: 15000 })
    const running = await page.locator('[data-testid=digit-cursor-circle]').count()
    if (running !== 1) issues.push(`${label}: ${running} cursor circles while running (want exactly 1)`)
    const digitSample = page.getByTestId('digit-sample')
    await digitSample.scrollIntoViewIfNeeded()
    if (tag === 'desktop') {
      await page.waitForTimeout(400)
      await digitSample.screenshot({ path: `${SCREENSHOT_DIR}trade-anim-running-desktop.png` })
    }

    await page.locator(`[data-testid="digit-cursor"][data-trade-id="${placed.id}"][data-status="settling"]`).waitFor({ timeout: 60000 })
    if (/\b(WON|LOST)\b/.test(await digitSample.innerText())) issues.push(`${label}: WON/LOST shown while the final digit is held`)
    if (tag === 'desktop') await digitSample.screenshot({ path: `${SCREENSHOT_DIR}trade-anim-settled-desktop.png` })

    await page.locator(`[data-testid="trade-anim-result"][data-trade-id="${placed.id}"]`).waitFor({ timeout: 8000 })
    if (tag === 'mobile') await digitSample.screenshot({ path: `${SCREENSHOT_DIR}trade-anim-result-mobile.png` })
    const finalDigit = Number(await cursor.getAttribute('data-digit'))
    const resultText = (await page.getByTestId('trade-anim-result').innerText()).trim()
    const log = await page.evaluate(() => {
      clearInterval(window.__tradeAnimTimer)
      return window.__tradeAnimLog
    })
    const stored = await demoTradeById(page, placed.id)
    if (!stored || stored.status === 'open') throw new Error('trade not settled in the DEMO store')

    if (stored.status === 'cancelled') {
      if (!/^REFUNDED/.test(resultText)) issues.push(`${label}: refunded trade shows "${resultText}"`)
    } else {
      if (finalDigit !== stored.exitDigit) issues.push(`${label}: cursor ended on ${finalDigit}, exit digit is ${stored.exitDigit}`)
      const want = `${stored.status === 'won' ? 'WON' : 'LOST'} · Final digit ${stored.exitDigit} · Prediction EVEN`
      if (!resultText.startsWith(want)) issues.push(`${label}: result "${resultText}" ≠ "${want} …"`)
    }

    const mine = log.filter((s) => s.tradeId === placed.id)
    const maxCircles = Math.max(0, ...log.map((s) => s.circles))
    if (maxCircles > 1) issues.push(`${label}: ${maxCircles} cursor circles at once`)
    const settlingAt = mine.find((s) => s.status === 'settling')?.t
    const resultAt = mine.find((s) => /^(WON|LOST|REFUNDED)/.test(s.text))?.t
    if (mine.some((s) => s.t < (settlingAt ?? Infinity) && /\b(WON|LOST)\b/.test(s.text))) issues.push(`${label}: WON/LOST shown before settlement`)
    if (stored.status !== 'cancelled' && settlingAt != null && resultAt != null) {
      const hold = resultAt - settlingAt
      if (hold < 2700 || hold > 4000) issues.push(`${label}: result appeared ${Math.round(hold)} ms after the final digit (want ~3000)`)
    }
    console.log(`\n${label}: ${resultText} (exit digit ${stored.exitDigit}, hold ${settlingAt != null && resultAt != null ? Math.round(resultAt - settlingAt) : '?'} ms)`)
  } catch (error) {
    issues.push(`${label}: ${error.message.split('\n')[0]}`)
  }
}

/** Trades placed so far, read from the DEMO store: id, symbol, side, bot run. */
async function demoTrades(page) {
  return page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      try {
        const value = JSON.parse(localStorage.getItem(key) ?? 'null')
        if (value && Array.isArray(value.trades) && value.wallet) {
          return value.trades.map((t) => ({ id: t.id, symbol: t.symbol, option: t.contractOption, botRunId: t.botRunId ?? null }))
        }
      } catch {
        // not JSON
      }
    }
    return []
  })
}

/**
 * DEMO end to end: Auto Trade blocked without a prediction (T3), scan → exactly one result, load, run Auto Trade and
 * check every placed trade matches the loaded side and market, a rescan clears the prediction and blocks Auto Trade
 * until the new one is loaded (T6), and no account-mode banners (T9).
 */
async function verifyPredictionAutoTrade(page, issues, tag) {
  const shots = tag === 'desktop'
  const label = `${tag} prediction→auto`
  try {
    await page.evaluate(() => localStorage.setItem('sbb.accountMode', 'demo'))
    await page.goto(`${BASE}/app/trade?symbol=R_100`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('tab', { name: /EVEN \/ ODD/i }).waitFor({ timeout: 20000 })
    await page.getByRole('tab', { name: /EVEN \/ ODD/i }).click()
    await page.waitForTimeout(1500)

    // T3: no loaded prediction → blocked with the message, nothing placed.
    const before = await demoTrades(page)
    const start = page.getByTestId('auto-trade-start')
    await start.scrollIntoViewIfNeeded()
    if ((await start.getAttribute('data-blocked')) !== 'no-prediction') issues.push(`${label}: Auto Trade not blocked without a prediction`)
    // aria-disabled (still tappable so it can explain why) — Playwright needs force to click it.
    await start.click({ force: true })
    await page.waitForTimeout(300)
    const blockedText = (await page.getByTestId('auto-trade-error').innerText().catch(() => '')).trim()
    if (blockedText !== LOAD_FIRST) issues.push(`${label}: T3 message "${blockedText}" ≠ "${LOAD_FIRST}"`)
    if (await page.getByRole('dialog').count()) issues.push(`${label}: T3 opened the start dialog without a prediction`)
    if ((await demoTrades(page)).length !== before.length) issues.push(`${label}: T3 placed a trade without a prediction`)
    if (shots) await page.getByTestId('trade-ticket').screenshot({ path: `${SCREENSHOT_DIR}autotrade-blocked.png` })

    // Scan → one result → load.
    const { top, loadButton } = await scanOnce(page, issues, label, shots ? 'scanner-one-prediction.png' : null)
    await loadButton.click()
    await page.waitForFunction(
      (symbol) => document.querySelector('select[aria-label="Market"]')?.value === symbol && document.querySelector('[data-testid="prediction-loaded"]'),
      top.symbol,
      { timeout: 15000 },
    )
    const loadedText = (await page.getByTestId('prediction-loaded').innerText()).trim()
    const expected = `PREDICTION LOADED · ${top.prediction} · Volatility ${top.volatility} · READY TO TRADE`
    if (loadedText !== expected) issues.push(`${label}: loaded state "${loadedText}" ≠ "${expected}"`)
    const direction = page.getByTestId('auto-direction')
    if (!(await direction.innerText()).includes(top.prediction)) issues.push(`${label}: Auto Trade panel does not show the loaded direction`)
    if (await page.getByText(/Auto direction/).count()) issues.push(`${label}: Auto direction selector still present`)
    if (shots) await page.getByTestId('trade-ticket').screenshot({ path: `${SCREENSHOT_DIR}prediction-loaded.png` })
    else {
      await page.getByTestId('auto-trade-panel').scrollIntoViewIfNeeded()
      await page.screenshot({ path: `${SCREENSHOT_DIR}prediction-loaded-mobile.png`, fullPage: false })
    }

    // Start DEMO Auto Trade and let it place a few trades.
    await page.waitForFunction(() => !document.querySelector('[data-testid="auto-trade-start"]')?.disabled, null, { timeout: 30000 })
    await page.getByTestId('auto-trade-start').click()
    await page.getByTestId('auto-trade-stop').waitFor({ timeout: 10000 })
    if (!(await page.getByTestId('ai-bot-scanner-open').isDisabled())) issues.push(`${label}: scanner not disabled while Auto Trade runs`)
    await page
      .waitForFunction(
        (n) => {
          for (let i = 0; i < localStorage.length; i += 1) {
            try {
              const v = JSON.parse(localStorage.getItem(localStorage.key(i)) ?? 'null')
              if (v && Array.isArray(v.trades) && v.wallet) return v.trades.filter((t) => t.botRunId).length >= n
            } catch {
              // not JSON
            }
          }
          return false
        },
        before.filter((t) => t.botRunId).length + 2,
        { timeout: 60000 },
      )
      .catch(() => issues.push(`${label}: Auto Trade placed fewer than 2 trades in 60s`))
    if (shots) await page.getByTestId('trade-ticket').screenshot({ path: `${SCREENSHOT_DIR}autotrade-running-loaded.png` })
    const bodyText = await page.locator('body').innerText()
    for (const banner of MODE_BANNERS) if (banner.test(bodyText)) issues.push(`${label}: T9 mode banner ${banner} shown`)
    if (await page.getByTestId('auto-trade-stop').isVisible().catch(() => false)) await page.getByTestId('auto-trade-stop').click()
    await page.waitForTimeout(500)

    const autoTrades = (await demoTrades(page)).filter((t) => t.botRunId && !before.some((b) => b.id === t.id))
    if (autoTrades.length === 0) issues.push(`${label}: no Auto Trade trades recorded`)
    for (const trade of autoTrades) {
      if (trade.symbol !== top.symbol || trade.option !== top.option) {
        issues.push(`${label}: Auto Trade placed ${trade.option} on ${trade.symbol}, loaded was ${top.option} on ${top.symbol}`)
      }
    }

    // T6: a rescan clears the loaded prediction; Auto Trade is blocked until the new one is loaded.
    const second = await scanOnce(page, issues, `${label} rescan`)
    if (second.top.id === top.id) issues.push(`${label}: rescan reused the previous result id`)
    await page.getByTestId('ai-bot-scanner').getByRole('button', { name: 'Close', exact: true }).click()
    if (await page.getByTestId('prediction-loaded').count()) issues.push(`${label}: T6 prediction still loaded after a new scan`)
    if ((await page.getByTestId('auto-trade-start').getAttribute('data-blocked')) !== 'no-prediction') {
      issues.push(`${label}: T6 Auto Trade not blocked after a new scan`)
    }
    await page.getByTestId('auto-trade-start').click({ force: true })
    if ((await page.getByTestId('auto-trade-error').innerText().catch(() => '')).trim() !== LOAD_FIRST) {
      issues.push(`${label}: T6 blocked message missing`)
    }
    const reopened = await scanOnce(page, issues, `${label} reload`)
    await reopened.loadButton.click()
    await page.getByTestId('prediction-loaded').waitFor({ timeout: 15000 })
    if ((await page.getByTestId('auto-trade-start').getAttribute('data-blocked')) === 'no-prediction') {
      issues.push(`${label}: T6 Auto Trade still blocked after loading the new prediction`)
    }

    // Manual ticket change clears the prediction.
    const otherTab = reopened.top.contract === 'EVEN_ODD' ? /MATCH \/ DIFFER/i : /EVEN \/ ODD/i
    await page.getByRole('tab', { name: otherTab }).click()
    const cleared = (await page.getByTestId('prediction-cleared').innerText().catch(() => '')).trim()
    if (cleared !== 'Prediction cleared — ticket changed') issues.push(`${label}: manual change did not clear the prediction ("${cleared}")`)
  } catch (error) {
    issues.push(`${label}: ${error.message.split('\n')[0]}`)
  }
}

const WITHDRAW_FN = '**/functions/v1/mpesa-withdraw*'
const ADMIN_WITHDRAW_FN = '**/functions/v1/admin-withdrawals*'

function withdrawConfigBody(overrides = {}) {
  return {
    enabled: true,
    has_real_trade: true,
    eligibility_message: null,
    mode: 'manual',
    method: 'mpesa',
    currency: 'USD',
    kes_per_usd: 130,
    min_kes: 1000,
    max_kes: 400000,
    min_usd: 7.7,
    fee_kes: 0,
    processing_copy: 'Withdrawals are paid to your M-Pesa number. Processing time: typically within 24 hours.',
    message: null,
    ...overrides,
  }
}

/**
 * REAL M-Pesa withdrawals: the Edge Function is mocked (no real request is ever created, no payout happens);
 * the checks are about the UI contract — the "Soon" tag is gone, the owner's eligibility copy is exact, DEMO
 * stays simulated, and nothing claims success before the server says COMPLETED.
 */
async function verifyWithdrawals(page, viewportName, issues) {
  const label = `${viewportName} withdrawals`
  const shot = (name) => `${SCREENSHOT_DIR}${name}`
  try {
    // DEMO funds cannot be withdrawn: Withdraw switches to the REAL account and never simulates a payout.
    await page.evaluate(() => localStorage.setItem('sbb.accountMode', 'demo'))
    await page.goto(`${BASE}/app/wallet`, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForTimeout(400)
    const demoWithdraw = page.getByTestId('wallet-withdraw')
    if (!(await demoWithdraw.count())) issues.push(`${label}: Withdraw button missing in DEMO`)
    else {
      await demoWithdraw.click()
      await page.waitForTimeout(300)
      if (await page.getByRole('button', { name: /Confirm DEMO withdrawal/i }).count()) issues.push(`${label}: DEMO withdrawal simulation still opens`)
      if ((await page.evaluate(() => localStorage.getItem('sbb.accountMode'))) !== 'real') issues.push(`${label}: DEMO Withdraw did not switch to REAL`)
      await page.keyboard.press('Escape')
      await page.evaluate(() => localStorage.setItem('sbb.accountMode', 'demo'))
    }
    await page.goto(`${BASE}/app/trade`, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForTimeout(400)
    const demoDesk = page.locator('[data-testid="desk-withdraw"]:visible').first()
    if (await demoDesk.count()) {
      if (/Soon/.test(await demoDesk.innerText())) issues.push(`${label}: DEMO desk withdraw shows Soon`)
    }

    // REAL: mocked config (eligible, manual mode). The signed-in verify user has a $0 REAL balance.
    await page.route(WITHDRAW_FN, (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Complete at least one REAL trade before withdrawing.' }) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(withdrawConfigBody()) })
    })
    await page.evaluate(() => localStorage.setItem('sbb.accountMode', 'real'))
    await page.goto(`${BASE}/app/trade`, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForTimeout(600)
    const desk = page.locator('[data-testid="desk-withdraw"]:visible').first()
    if (!(await desk.count())) {
      if (viewportName === 'desktop') issues.push(`${label}: REAL desk withdraw button missing`)
    } else if (!(await desk.isVisible())) {
      // Hidden at this viewport; the wallet page covers the panel below.
    } else {
      const text = await desk.innerText()
      if (/Soon/i.test(text)) issues.push(`${label}: REAL desk withdraw still shows "Soon"`)
      if (await desk.isDisabled()) issues.push(`${label}: REAL desk withdraw is disabled`)
      await desk.click()
      await page.getByTestId('real-withdraw-panel').waitFor({ timeout: 10000 })
      const panel = page.getByTestId('real-withdraw-panel')
      const panelText = await panel.innerText()
      if (!/Withdraw to M-Pesa/.test(panelText)) issues.push(`${label}: desk panel title missing`)
      if (/fee.*(tax|release|compliance|AI)/i.test(panelText)) issues.push(`${label}: panel shows a disallowed fee notice`)
      if (/success|processed successfully/i.test(panelText)) issues.push(`${label}: panel claims success before COMPLETED`)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
      if (await page.getByTestId('real-withdraw-panel').count()) issues.push(`${label}: Escape did not close the desk withdraw panel`)
    }

    await page.goto(`${BASE}/app/wallet`, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForTimeout(600)
    const walletButton = page.getByTestId('wallet-withdraw')
    if (!(await walletButton.count())) issues.push(`${label}: wallet Withdraw button missing`)
    else {
      if (/Soon/i.test(await walletButton.innerText())) issues.push(`${label}: wallet Withdraw still shows "Soon"`)
      await walletButton.click()
      await page.getByTestId('real-withdraw-panel').waitFor({ timeout: 10000 })
      await page.waitForTimeout(600)
      const panel = page.getByTestId('real-withdraw-panel')
      const text = await panel.innerText()
      if (!/Minimum KES 1,000/.test(text) || !/Maximum KES 400,000/.test(text)) {
        if (!/No REAL balance to withdraw/.test(text)) issues.push(`${label}: limits (KES 1,000 / 400,000) not shown`)
      }
      if (!/No REAL balance to withdraw\./.test(text) && !/Available REAL balance/.test(text)) issues.push(`${label}: balance block missing`)
      if (/Soon/.test(text)) issues.push(`${label}: panel mentions Soon`)
      await panel.scrollIntoViewIfNeeded()
      await panel.screenshot({ path: shot(viewportName === 'desktop' ? 'withdraw-panel-desktop.png' : 'withdraw-panel-mobile.png') })
    }

    // Owner rule copy: without a settled REAL trade the panel shows only the fixed sentence.
    await page.unroute(WITHDRAW_FN)
    await page.route(WITHDRAW_FN, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(withdrawConfigBody({ has_real_trade: false, eligibility_message: 'Complete at least one REAL trade before withdrawing.' })),
      }),
    )
    await page.goto(`${BASE}/app/wallet?action=withdraw`, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.getByTestId('real-withdraw-panel').waitFor({ timeout: 10000 })
    await page.getByTestId('withdraw-needs-trade').waitFor({ timeout: 10000 })
    const needs = await page.getByTestId('withdraw-needs-trade').innerText()
    if (!/^Complete at least one REAL trade before withdrawing\./m.test(needs.trim())) issues.push(`${label}: eligibility copy wrong ("${needs.trim()}")`)
    if (await page.getByTestId('real-withdraw-form').count()) issues.push(`${label}: form rendered although the user has no settled REAL trade`)
    if (/fee|compliance|tax/i.test(needs)) issues.push(`${label}: eligibility block mentions fees/compliance`)
    await page.unroute(WITHDRAW_FN)

    // Admin page renders the REAL tab with actions (list mocked with one PENDING example; nothing is sent).
    if (viewportName === 'desktop') {
      await page.route(ADMIN_WITHDRAW_FN, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            mode: 'manual',
            fee_kes: 0,
            kes_per_usd: 130,
            withdrawals: [
              {
                id: '11111111-1111-4111-8111-111111111111',
                user_id: '22222222-2222-4222-8222-222222222222',
                user_email: 'example.trader@example.com',
                user_name: 'Example Trader (UI preview)',
                status: 'PENDING',
                provider: 'manual',
                amount_usd: 40,
                amount_kes: 5200,
                fee_kes: 0,
                net_kes: 5200,
                msisdn: '254712345678',
                reference: 'OMT-W-EXAMPLE1',
                receipt: null,
                failure_reason: null,
                admin_note: null,
                created_at: new Date().toISOString(),
                processing_at: null,
                completed_at: null,
                failed_at: null,
              },
            ],
          }),
        }),
      )
      await page.goto(`${BASE}/admin/withdrawals`, { waitUntil: 'domcontentloaded', timeout: 20000 })
      await page.getByTestId('real-withdrawals-admin').waitFor({ timeout: 10000 })
      await page.getByTestId('admin-withdrawal-row').first().waitFor({ timeout: 10000 })
      const adminText = await page.getByTestId('real-withdrawals-admin').innerText()
      for (const needle of ['Mark processing', 'Complete (money sent)', 'Fail + refund', 'OMT-W-EXAMPLE1', '0712345678', 'KES 5,200']) {
        if (!adminText.includes(needle)) issues.push(`${label}: admin page missing "${needle}"`)
      }
      await page.screenshot({ path: shot('admin-withdrawals.png'), fullPage: false })
      await page.unroute(ADMIN_WITHDRAW_FN)
    }
  } catch (error) {
    issues.push(`${label}: ${error.message.split('\n')[0]}`)
    await page.unroute(WITHDRAW_FN).catch(() => {})
    await page.unroute(ADMIN_WITHDRAW_FN).catch(() => {})
  } finally {
    await page.evaluate(() => localStorage.setItem('sbb.accountMode', 'demo')).catch(() => {})
  }
}

async function main() {
  const browser = await launchBrowser()
  const issues = []

  for (const viewport of process.env.VERIFY_NAV_ONLY ? [] : viewports) {
    const context = await browser.newContext({ viewport })
    const page = await context.newPage()
    const consoleErrors = []
    page.on('pageerror', (error) => {
      consoleErrors.push(`${viewport.name} pageerror: ${error.message}`)
    })
    page.on('response', (response) => {
      if (response.status() >= 500) consoleErrors.push(`${viewport.name} HTTP ${response.status()} ${response.url()}`)
    })
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return
      const text = msg.text()
      if (ignoreConsole.some((re) => re.test(text))) return
      consoleErrors.push(`${viewport.name} console: ${text}`)
    })

    for (const route of publicRoutes) {
      const url = `${BASE}${route}`
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
      const status = response?.status() ?? 0
      if (status >= 400) issues.push(`${viewport.name} ${route} HTTP ${status}`)
      await page.waitForTimeout(200)
      const bodyText = (await page.locator('body').innerText()).trim()
      if (!bodyText || bodyText.length < 20) issues.push(`${viewport.name} ${route} blank or nearly empty`)
      if (await page.locator('text=Page not found').count()) {
        if (route !== '/missing-route-404') issues.push(`${viewport.name} ${route} rendered 404`)
      } else if (route === '/missing-route-404') {
        issues.push(`${viewport.name} ${route} did not render 404`)
      }
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      )
      if (overflow && viewport.name === 'mobile') issues.push(`${viewport.name} ${route} horizontal overflow`)
      process.stdout.write('.')
    }

    await ensureAuthSession(page)

    for (const route of appRoutes) {
      const url = `${BASE}${route}`
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
      const status = response?.status() ?? 0
      if (status >= 400) issues.push(`${viewport.name} ${route} HTTP ${status}`)
      await page.waitForTimeout(250)
      if (page.url().includes('/login')) issues.push(`${viewport.name} ${route} redirected to login unexpectedly`)
      const bodyText = (await page.locator('body').innerText()).trim()
      if (!bodyText || bodyText.length < 20) issues.push(`${viewport.name} ${route} blank or nearly empty`)
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      )
      if (overflow && viewport.name === 'mobile') issues.push(`${viewport.name} ${route} horizontal overflow`)
      for (const banned of BANNED_BANNER_TEXT) {
        if (banned.test(bodyText)) issues.push(`${viewport.name} ${route} shows status banner text ${banned}`)
      }
      process.stdout.write('.')
    }

    await page.goto(`${BASE}/app/markets`, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForTimeout(250)
    if (new URL(page.url()).pathname !== '/app/trade') issues.push(`${viewport.name} /app/markets did not redirect to /app/trade`)
    await page.goto(`${BASE}/app?symbol=R_100`, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForTimeout(250)
    if (!page.url().endsWith('/app/trade?symbol=R_100')) {
      issues.push(`${viewport.name} /app?symbol=R_100 should redirect to /app/trade?symbol=R_100, got ${page.url()}`)
    }
    if (await page.getByRole('link', { name: /^Markets$/i }).count()) {
      issues.push(`${viewport.name} Markets nav link still present`)
    }

    await page.evaluate(() => localStorage.setItem('sbb.accountMode', 'real'))
    for (const route of appRoutes) {
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
      await page.waitForTimeout(600)
      const bodyText = await page.locator('body').innerText()
      if (!/REAL ACCOUNT|REAL/.test(bodyText)) issues.push(`${viewport.name} REAL ${route} missing REAL badge`)
      for (const banned of BANNED_BANNER_TEXT) {
        if (banned.test(bodyText)) issues.push(`${viewport.name} REAL ${route} shows status banner text ${banned}`)
      }
      process.stdout.write('.')
    }
    await page.evaluate(() => localStorage.setItem('sbb.accountMode', 'demo'))

    await verifyWithdrawals(page, viewport.name, issues)

    if (viewport.name === 'desktop') {
      await resetDemo(page)

      await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(800)
      if (page.url().includes('/login')) issues.push('desktop session lost after resetDemo')

      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(400)
      if (page.url().includes('/login')) issues.push('desktop session lost after refresh')

      await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(800)
      await page.getByRole('tab', { name: /EVEN \/ ODD/i }).waitFor({ timeout: 15000 })
      if (await page.getByRole('button', { name: /CALL \/ BUY/i }).count()) {
        issues.push('desktop still shows CALL / BUY primary button')
      }
      if (await page.getByRole('button', { name: /PUT \/ SELL/i }).count()) {
        issues.push('desktop still shows PUT / SELL primary button')
      }
      if (!(await page.getByText(/DEMO ACCOUNT/i).count())) {
        issues.push('desktop missing DEMO ACCOUNT label')
      }
      if (!(await page.getByText(/SIMULATED|DEMO/i).count())) {
        issues.push('desktop missing SIMULATED/DEMO chart labelling')
      }

      // Competitor-style desk: chart toolbar, compact market select, presets, direction payouts, no markets sidebar.
      const chartTypes = page.getByRole('group', { name: 'Chart type' })
      for (const label of ['Line', 'Candles', 'OHLC']) {
        if (!(await chartTypes.getByRole('button', { name: label, exact: true }).count())) {
          issues.push(`desktop chart type ${label} missing`)
        }
      }
      const intervals = page.getByRole('group', { name: 'Chart interval' })
      for (const label of ['Tick', '1m', '4h', '1D']) {
        if (!(await intervals.getByRole('button', { name: label, exact: true }).count())) {
          issues.push(`desktop timeframe ${label} missing`)
        }
      }
      if (await intervals.getByRole('button', { name: /^(1s|5s|15s|30s)$/ }).count()) {
        issues.push('desktop shows a sub-minute timeframe Deriv cannot serve')
      }
      await intervals.getByRole('button', { name: '1m', exact: true }).click()
      await chartTypes.getByRole('button', { name: 'Candles', exact: true }).click()
      await page.waitForTimeout(800)
      if ((await page.getByTestId('price-chart').getAttribute('data-style')) !== 'candles') {
        issues.push('desktop Candles chart type did not apply')
      }
      await intervals.getByRole('button', { name: 'Tick', exact: true }).click()
      if (!(await page.getByTestId('market-select').count())) issues.push('desktop compact market select missing')
      if (!(await page.getByRole('button', { name: '$50', exact: true }).count())) issues.push('desktop $50 stake preset missing')
      await page.getByRole('tab', { name: /EVEN \/ ODD/i }).click()
      await page.getByRole('button', { name: '$10', exact: true }).click()
      const evenLabel = (await page.getByTestId('direction-even').getAttribute('aria-label')) ?? ''
      if (!/Payout \$19\.00/.test(evenLabel)) issues.push(`desktop EVEN button payout label wrong: ${evenLabel}`)
      if (!/\$19\.00 USD • 90\.00%/.test(await page.getByTestId('payout-line').innerText())) {
        issues.push('desktop payout line missing "$19.00 USD • 90.00%"')
      }
      if (!/Each tick ≈ (1 second|2 seconds)/.test(await page.getByTestId('tick-hint').innerText())) {
        issues.push('desktop tick hint missing')
      }
      const digitRow = await page.getByTestId('digit-sample').innerText().catch(() => '')
      if (/%/.test(digitRow)) issues.push('desktop digit row shows percentages')
      if (/Past ticks; not a prediction|Last digits/i.test(digitRow)) issues.push('desktop digit row still shows the header line')
      if (await page.getByRole('group', { name: 'Digit sample size' }).count()) issues.push('desktop digit row still has sample-size buttons')
      if ((await page.getByTestId('digit-sample').getAttribute('data-window')) !== '100') issues.push('desktop digit row is not fixed at 100 ticks')

      const scannerOpen = page.getByTestId('ai-bot-scanner-open')
      if (!/AI BOT SCANNER/.test((await scannerOpen.innerText().catch(() => '')) ?? '')) {
        issues.push('ticket button is not labelled "AI BOT SCANNER"')
      }
      await scannerOpen.click()
      const scanner = page.getByTestId('ai-bot-scanner')
      await scanner.waitFor({ timeout: 10000 })
      if (!/AI BOT SCANNER/.test(await scanner.innerText())) issues.push('scanner title is not "AI BOT SCANNER"')
      if (!/LOAD PREDICTION/.test(await page.getByTestId('ai-scanner-load-prediction').innerText())) issues.push('LOAD PREDICTION button missing')
      await page.keyboard.press('Escape')
      await verifyPredictionAutoTrade(page, issues, 'desktop')
      // Each page load refetches every volatility; give Deriv's ticks_history rate limit time to recover.
      await page.waitForTimeout(15000)
      await verifyLoadPrediction(page, issues, 'desktop', 'demo', 'OVER_UNDER')
      await verifyLoadPrediction(page, issues, 'desktop', 'real', 'MATCH_DIFFER')
      await page.goto(`${BASE}/app?symbol=R_100`, { waitUntil: 'domcontentloaded' }).catch(() => undefined)
      await page.getByRole('tab', { name: /EVEN \/ ODD/i }).waitFor({ timeout: 15000 })
      await page.waitForTimeout(1500)

      if (!(await page.getByTestId('auto-trade-start').count())) issues.push('desktop DEMO Auto Trade button missing')
      const riskSettings = page.getByTestId('risk-settings')
      if (!(await riskSettings.count())) issues.push('desktop DEMO risk settings missing')
      else {
        const riskText = await riskSettings.first().innerText()
        for (const label of ['Multiplier', 'Target Profit', 'Stop Loss', 'Direction']) {
          if (!riskText.includes(label)) issues.push(`Auto Trade settings missing "${label}"`)
        }
        for (const removed of ['Auto direction', 'Auto Trade settings', 'Target digit', 'Stop after losses', 'Max stake', 'insufficient balance']) {
          if (riskText.includes(removed)) issues.push(`Auto Trade settings still show "${removed}"`)
        }
      }

      const closedTab = page.getByRole('tab', { name: /^Closed/i })
      await closedTab.waitFor({ timeout: 10000 })
      await closedTab.click()
      await page.getByRole('tab', { name: /^Transactions$/i }).click()
      await page.getByRole('tab', { name: /^Open \(/i }).click()

      try {
        await placeContract(page, 'EVEN / ODD', 'EVEN')
        await placeContract(page, 'MATCH / DIFFER', 'MATCH')
        await placeContract(page, 'OVER / UNDER', 'OVER')
      } catch (error) {
        issues.push(`desktop contract flow: ${error.message}`)
      }

      // Contract type switch must keep ticket mounted (no blank panel)
      await page.getByRole('tab', { name: /EVEN \/ ODD/i }).click()
      await page.getByRole('tab', { name: /MATCH \/ DIFFER/i }).click()
      await page.getByRole('tab', { name: /OVER \/ UNDER/i }).click()
      if (!(await page.getByText(/Selected contract|Barrier|Digit/i).count())) {
        issues.push('desktop trading panel blank after contract type switch')
      }

      await page.getByRole('button', { name: /^Real$/i }).click()
      if (await page.getByRole('dialog').count()) {
        issues.push('desktop DEMO → REAL switch must be instant (no confirmation dialog)')
      }
      await page.waitForTimeout(400)
      if (!(await page.getByText(/REAL ACCOUNT/i).count())) {
        issues.push('desktop REAL mode missing REAL ACCOUNT label')
      }
      const realBody = await page.locator('body').innerText()
      for (const banned of BANNED_BANNER_TEXT) {
        if (banned.test(realBody)) issues.push(`desktop REAL trade page still shows status banner text ${banned}`)
      }
      await page.getByRole('tab', { name: /EVEN \/ ODD/i }).click()
      const reviewDisabled = await page
        .getByTestId('direction-even')
        .isDisabled()
        .catch(() => true)
      if (!(await page.getByTestId('auto-trade-disabled').count())) {
        issues.push('desktop REAL ticket must show Auto Trade as DEMO-only')
      }
      if (await page.getByTestId('auto-trade-start').count()) issues.push('desktop REAL ticket offers Auto Trade start')
      if (await page.getByTestId('risk-settings').count()) issues.push('desktop REAL ticket shows Auto Trade risk settings')
      const realStatus = (await page.getByTestId('real-trade-status').first().innerText().catch(() => '')).trim()
      if (await page.getByText(/Real trading not available yet/i).count()) {
        issues.push('desktop REAL ticket still shows "Real trading not available yet"')
      }
      if (reviewDisabled) {
        // Signed out, paused (REAL_TRADING_ENABLED=false) or unsupported market: a clear reason must be shown.
        if (!realStatus) issues.push('desktop REAL ticket disabled without a reason')
      }
      for (const banner of MODE_BANNERS) {
        if (banner.test(realBody)) issues.push(`desktop REAL trade page shows account-mode banner ${banner}`)
      }
      issues.push(...(await ticketBannerIssues(page, 'desktop REAL')))
      await page.getByTestId('trade-ticket').screenshot({ path: `${SCREENSHOT_DIR}ticket-clean-desktop.png` })
      if (await page.getByText(/Live chart and prices only/i).count()) {
        issues.push('desktop REAL verbose status note should be removed')
      }

      // DEMO must not show REAL wallet amounts as DEMO funds
      const bodyReal = await page.locator('body').innerText()
      if (/Demo Balance \$/i.test(bodyReal) && /REAL ACCOUNT/i.test(bodyReal)) {
        // Demo Balance label can appear in wallet dual-stat; ensure banner is REAL
        if (!(await page.getByText(/REAL ACCOUNT/i).count())) {
          issues.push('desktop REAL banner missing while checking mode separation')
        }
      }
      await page.getByRole('button', { name: /^Demo$/i }).click()
      await page.waitForTimeout(400)
      if (!(await page.getByText(/DEMO ACCOUNT/i).count())) {
        issues.push('desktop failed to restore DEMO mode')
      }

      await page.goto(`${BASE}/app/wallet`, { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: /DEMO Deposit/i }).click()
      await page.getByRole('button', { name: /Confirm DEMO deposit/i }).click()
      await page.waitForTimeout(400)

      await page.goto(`${BASE}/app/copy`, { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: /Copy DEMO/i }).first().click()
      await page.getByRole('button', { name: /Start DEMO copy/i }).click()
      await page.waitForTimeout(400)

      await page.goto(`${BASE}/app/profile`, { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: /^Log out$/i }).click()
      await page.waitForURL('**/login**', { timeout: 10000 })
      await page.getByLabel(/^Email$/i).fill(VERIFY_EMAIL)
      await page.getByLabel(/^Password$/i).fill(VERIFY_PASSWORD)
      await page.getByRole('button', { name: /^Log in$/i }).click()
      await page.waitForURL('**/app/**', { timeout: 10000 })
      if (new URL(page.url()).pathname !== '/app/trade') issues.push(`login landed on ${page.url()} instead of /app/trade`)

      // A protected-route `from` target wins over the trade default.
      await page.goto(`${BASE}/app/profile`, { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: /^Log out$/i }).click()
      await page.waitForURL('**/login**', { timeout: 10000 })
      await page.goto(`${BASE}/app/history`, { waitUntil: 'domcontentloaded' })
      await page.waitForURL('**/login**', { timeout: 10000 })
      await page.getByLabel(/^Email$/i).fill(VERIFY_EMAIL)
      await page.getByLabel(/^Password$/i).fill(VERIFY_PASSWORD)
      await page.getByRole('button', { name: /^Log in$/i }).click()
      await page.waitForURL('**/app/**', { timeout: 10000 })
      if (new URL(page.url()).pathname !== '/app/history') {
        issues.push(`login from a protected route landed on ${page.url()} instead of /app/history`)
      }
    }

    if (viewport.name === 'mobile') {
      await ensureAuthSession(page, VERIFY_EMAIL)
      await verifyPredictionAutoTrade(page, issues, 'mobile')
      await verifyLoadPrediction(page, issues, 'mobile', 'demo', 'MATCH_DIFFER')
      await verifyLoadPrediction(page, issues, 'mobile', 'real', 'EVEN_ODD')
      await page.goto(`${BASE}/app/trade`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(400)
      if (await page.getByRole('navigation', { name: 'Mobile' }).count()) {
        issues.push('mobile bottom nav should be replaced by the drawer')
      }
      await page.getByTestId('mobile-menu-button').click()
      await page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'Dashboard' }).click()
      await page.waitForURL('**/app/dashboard', { timeout: 10000 })
      await page.getByTestId('mobile-menu-button').click()
      await page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'Trade', exact: true }).click()
      await page.waitForURL('**/app/trade', { timeout: 10000 })
      await page.waitForTimeout(400)
      await page.getByRole('button', { name: /^Demo$/i }).first().click()
      await page.waitForTimeout(300)
      const digitRow = page.getByTestId('digit-sample')
      try {
        await page.waitForFunction(() => Number(document.querySelector('[data-testid="digit-sample"]')?.getAttribute('data-sample')) >= 100, null, { timeout: 30000 })
        const rowText = await digitRow.innerText()
        if (/Past ticks; not a prediction|Last digits/i.test(rowText)) issues.push('mobile digit row still shows the header line')
        if (await page.getByRole('group', { name: 'Digit sample size' }).count()) issues.push('mobile digit row still has sample-size buttons')
        await digitRow.scrollIntoViewIfNeeded()
        await digitRow.screenshot({ path: `${SCREENSHOT_DIR}digit-row-clean-mobile.png` })
      } catch (error) {
        issues.push(`mobile digit row: ${error.message.split('\n')[0]}`)
      }
      await page.getByRole('tab', { name: /EVEN \/ ODD/i }).click()
      try {
        await placeDemoInstantly(page, 'odd', 'mobile EVEN / ODD')
        await page.getByTestId('ticket-trades').getByRole('tab', { name: /^Open \(/i }).click()
        await page.getByTestId('ticket-trade').first().scrollIntoViewIfNeeded()
        await page.screenshot({ path: `${SCREENSHOT_DIR}demo-trade-instant-mobile.png` })
      } catch (error) {
        issues.push(`mobile instant DEMO trade: ${error.message.split('\n')[0]}`)
      }

      await page.getByRole('button', { name: /^Real$/i }).click()
      if (await page.getByRole('dialog').count()) {
        issues.push('mobile DEMO → REAL switch must be instant (no confirmation dialog)')
      }
      await page.waitForTimeout(300)
      if (!(await page.getByText(/REAL ACCOUNT/i).count())) issues.push('mobile REAL mode missing REAL ACCOUNT label')
      await page.getByRole('tab', { name: /EVEN \/ ODD/i }).waitFor({ timeout: 15000 })
      issues.push(...(await ticketBannerIssues(page, 'mobile REAL')))
      await page.getByTestId('trade-ticket').scrollIntoViewIfNeeded()
      await page.screenshot({ path: `${SCREENSHOT_DIR}ticket-clean-mobile.png` })
      await page.getByRole('button', { name: /^Demo$/i }).click()
      await page.waitForTimeout(300)
      if (!(await page.getByText(/DEMO ACCOUNT/i).count())) issues.push('mobile failed to restore DEMO mode')
    }

    await verifyTradeAnimation(page, issues, viewport.name)

    issues.push(...consoleErrors)
    await context.close()
  }

  await verifyNavigation(browser, issues)

  await browser.close()
  if (issues.length) {
    console.error('VERIFICATION ISSUES')
    for (const issue of issues) console.error(`- ${issue}`)
    process.exit(1)
  }
  console.log(
    `Verified ${publicRoutes.length + appRoutes.length} routes at desktop and mobile, including DEMO/REAL digit-contract flows. No issues.`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
