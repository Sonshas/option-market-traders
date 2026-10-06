import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

/**
 * Verifies the trading chart + Last-Digit Analysis against direct Deriv API calls.
 * Usage: APP_URL=http://localhost:5173 node scripts/verify-chart-digits.mjs
 *   SHOT_PREFIX=chart-digits (default)  SHOTS=0 to skip screenshots
 *   Live site: APP_URL=https://optionmarkettraders.com LIVE_EMAIL=… LIVE_PASSWORD=… SHOT_PREFIX=live-chart-digits
 */
const BASE = process.env.APP_URL || 'http://localhost:5173'
const SHOTS = process.env.SHOTS !== '0'
const PREFIX = process.env.SHOT_PREFIX || 'chart-digits'
const DERIV_WS = 'wss://api.derivws.com/trading/v1/options/ws/public'
const DIGIT_WINDOW = 100
const TIMEFRAMES = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600 }
/** Chart-type suite: button label → [data-mode, Deriv granularity]. */
const CANDLE_TFS = {
  '1m': ['1m', 60],
  '5m': ['5m', 300],
  '15m': ['15m', 900],
  '30m': ['30m', 1800],
  '1h': ['1h', 3600],
  '4h': ['4h', 14400],
  '1D': ['1d', 86400],
}
const here = dirname(fileURLToPath(import.meta.url))
const shotDir = resolve(here, '../../../docs/screenshots')
mkdirSync(shotDir, { recursive: true })
const isLocal = /localhost|127\.0\.0\.1/.test(BASE)

const failures = []
const log = []
function check(ok, message, detail) {
  log.push(`${ok ? 'PASS' : 'FAIL'} ${message}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(message)
}

/** Independent Deriv connection for cross-checks; reopens if Deriv closes it while idle. */
function derivClient() {
  let ws = null
  let ready = null
  let seq = 0
  const pending = new Map()
  const connect = () => {
    if (ws && ws.readyState <= 1) return ready
    ws = new WebSocket(DERIV_WS)
    const socket = ws
    ready = new Promise((res, rej) => {
      socket.onopen = res
      socket.onerror = rej
    })
    socket.onclose = () => {
      if (ws === socket) ws = null
    }
    socket.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      const p = pending.get(msg.req_id)
      if (!p) return
      pending.delete(msg.req_id)
      if (msg.error) p.reject(new Error(msg.error.message))
      else p.resolve(msg)
    }
    return ready
  }
  return {
    async request(payload) {
      await connect()
      seq += 1
      const id = seq
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`Deriv API timeout: ${JSON.stringify(payload)}`))
        }, 20000)
        pending.set(id, {
          resolve: (v) => (clearTimeout(timer), resolve(v)),
          reject: (e) => (clearTimeout(timer), reject(e)),
        })
        ws.send(JSON.stringify({ ...payload, req_id: id }))
      })
    },
    close: () => ws?.close(),
  }
}

function pipFrom(raw) {
  const n = Number(raw)
  if (Number.isInteger(n) && n >= 1 && n <= 8) return 10 ** -n
  return n > 0 ? n : 0.01
}
const digitOf = (quote, pip) => Math.round(Math.abs(quote) / pip) % 10

async function launch() {
  for (const options of [{ channel: 'msedge' }, { channel: 'chrome' }, {}]) {
    try {
      return await chromium.launch({ headless: true, ...options })
    } catch {
      /* next */
    }
  }
  throw new Error('No Chromium available')
}

async function openTrading(page, symbol) {
  await page.goto(`${BASE}/app?symbol=${symbol}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(800)
  if (page.url().includes('/login') && process.env.LIVE_EMAIL && process.env.LIVE_PASSWORD) {
    await page.getByLabel(/^Email$/i).fill(process.env.LIVE_EMAIL)
    await page.getByLabel(/^Password$/i).fill(process.env.LIVE_PASSWORD)
    await page.getByRole('button', { name: /^Log in$/i }).click()
    await page.waitForURL('**/app**', { timeout: 20000 })
    await page.goto(`${BASE}/app?symbol=${symbol}`, { waitUntil: 'domcontentloaded' })
    return
  }
  if (page.url().includes('/login')) {
    if (!isLocal) throw new Error('AUTH_REQUIRED (set LIVE_EMAIL / LIVE_PASSWORD for a non-local APP_URL)')
    // Dev-only: VITE_E2E_AUTH_BYPASS keeps this signup local.
    await page.goto(`${BASE}/register`, { waitUntil: 'domcontentloaded' })
    await page.getByLabel(/^Full name$/i).fill('Chart Verify')
    await page.getByLabel(/^Email$/i).fill(`chart-verify-${Date.now()}@example.com`)
    await page.getByLabel(/^Phone$/i).fill('+15550001111')
    await page.getByLabel(/^Password$/i).fill('demopass1')
    await page.getByLabel(/Confirm password/i).fill('demopass1')
    const terms = page.getByRole('checkbox')
    if (await terms.count()) await terms.first().check()
    await page.getByRole('button', { name: /^Create account$/i }).click()
    await page.waitForURL('**/app**', { timeout: 20000 })
    await page.goto(`${BASE}/app?symbol=${symbol}`, { waitUntil: 'domcontentloaded' })
  }
}

async function waitChart(page, { symbol, mode = 'ticks', minPoints = 1, live = true, timeout = 45000 }) {
  await page.waitForFunction(
    ({ symbol, mode, minPoints, live }) => {
      const el = document.querySelector('[data-testid="price-chart"]')
      if (!el) return false
      return (
        el.getAttribute('data-symbol') === symbol &&
        el.getAttribute('data-mode') === mode &&
        Number(el.getAttribute('data-points')) >= minPoints &&
        (!live || el.getAttribute('data-status') === 'live')
      )
    },
    { symbol, mode, minPoints, live },
    { timeout },
  )
}

const readState = (page) =>
  page.evaluate(() => {
    const chart = document.querySelector('[data-testid="price-chart"]')
    const sample = document.querySelector('[data-testid="digit-sample"]')
    const cards = [...Array(10).keys()].map((d) => document.querySelector(`[data-testid="digit-card-${d}"]`))
    return {
      symbol: chart?.getAttribute('data-symbol'),
      mode: chart?.getAttribute('data-mode'),
      status: chart?.getAttribute('data-status'),
      points: Number(chart?.getAttribute('data-points')),
      lastTime: Number(chart?.getAttribute('data-last-time')),
      lastValue: Number(chart?.getAttribute('data-last-value')),
      firstCandle: chart?.getAttribute('data-first-candle') || null,
      lastCandle: chart?.getAttribute('data-last-candle') || null,
      price: document.querySelector('[data-testid="current-price"]')?.textContent ?? '',
      lastTickMs: Number(document.querySelector('[data-testid="last-tick-time"]')?.getAttribute('data-epoch-ms')),
      digitSymbol: sample?.getAttribute('data-symbol'),
      digitSample: Number(sample?.getAttribute('data-sample')),
      digitWindow: Number(sample?.getAttribute('data-window')),
      digitText: sample?.textContent ?? '',
      firstEpoch: Number(sample?.getAttribute('data-first-epoch')),
      lastEpoch: Number(sample?.getAttribute('data-last-epoch')),
      counts: cards.map((c) => Number(c?.getAttribute('data-count') ?? NaN)),
      digitPanelText: document.querySelector('section[aria-label="Digit statistics"]')?.textContent ?? '',
      current: cards.findIndex((c) => c?.getAttribute('data-current') === 'true'),
    }
  })

async function selectSymbol(page, symbol) {
  const select = page.getByRole('combobox', { name: 'Market' }).first()
  try {
    await select.selectOption(symbol, { timeout: 15000 })
  } catch (error) {
    const seen = await page.evaluate(() =>
      [...document.querySelectorAll('select[aria-label="Market"] option')].map((o) => o.value).slice(0, 40),
    )
    throw new Error(`cannot select ${symbol}; market options: ${JSON.stringify(seen)}; ${error.message.split('\n')[0]}`)
  }
}

async function verifyTicksAgainstApi(api, page, symbol) {
  await waitChart(page, { symbol })
  const samples = []
  for (let i = 0; i < 4; i += 1) {
    const s = await readState(page)
    samples.push(s)
    await page.waitForTimeout(2600)
  }
  const hist = await api.request({ ticks_history: symbol, count: 200, end: 'latest', style: 'ticks' })
  const byEpoch = new Map(hist.history.times.map((t, i) => [t, hist.history.prices[i]]))
  const pairs = samples.map((s) => ({ epoch: s.lastTime, appQuote: s.lastValue, apiQuote: byEpoch.get(s.lastTime) }))
  log.push(`  ${symbol} app vs ticks_history: ${JSON.stringify(pairs)}`)
  check(
    pairs.every((p) => p.apiQuote !== undefined && p.apiQuote === p.appQuote),
    `${symbol}: app tick epoch/quote pairs match Deriv ticks_history`,
  )
  const first = samples[0]
  const last = samples[samples.length - 1]
  check(last.lastTime > first.lastTime, `${symbol}: chart moves as ticks arrive`, `last epoch ${first.lastTime} → ${last.lastTime}, points ${first.points} → ${last.points}`)
  const priceNum = Number(last.price.replace(/,/g, ''))
  check(priceNum === last.lastValue, `${symbol}: current price = latest Deriv tick quote`, `${last.price}`)
  check(last.lastTickMs === last.lastTime * 1000, `${symbol}: "Last tick" uses Deriv epoch`, `${new Date(last.lastTickMs).toISOString()}`)
  check(last.digitSymbol === symbol, `${symbol}: digit analysis follows selected symbol`)
  check(last.status === 'live', `${symbol}: status CONNECTED while ticks arrive`)
  return last
}

async function verifyDigitWindow(api, page, symbol, window = DIGIT_WINDOW) {
  await page.waitForFunction(
    (w) => Number(document.querySelector('[data-testid="digit-sample"]')?.getAttribute('data-sample')) === w,
    window,
  )
  const s = await readState(page)
  check(s.digitWindow === window, `${symbol}: digit row uses the fixed ${window}-tick sample`, `${s.digitWindow}`)
  const hasSelector = await page.getByRole('group', { name: 'Digit sample size' }).count()
  check(hasSelector === 0 && !/not a prediction/.test(s.digitPanelText), `${symbol}: no sample-size selector or header line`)
  const sumCounts = s.counts.reduce((a, b) => a + b, 0)
  let hist = await api.request({ ticks_history: symbol, count: window, end: s.lastEpoch, style: 'ticks' })
  if (hist.history.times.at(-1) !== s.lastEpoch) {
    // Deriv history can lag the live stream by a moment; ask again once it has indexed the tick.
    await new Promise((r) => setTimeout(r, 2000))
    hist = await api.request({ ticks_history: symbol, count: window, end: s.lastEpoch, style: 'ticks' })
  }
  const pip = pipFrom(hist.pip_size)
  const apiCounts = Array(10).fill(0)
  for (const q of hist.history.prices) apiCounts[digitOf(q, pip)] += 1
  const apiFirst = hist.history.times[0]
  const apiLast = hist.history.times.at(-1)
  if (apiFirst !== s.firstEpoch || apiLast !== s.lastEpoch) {
    log.push(`  window epochs differ: app ${s.firstEpoch}..${s.lastEpoch} api ${apiFirst}..${apiLast}`)
  }
  const lastApiDigit = digitOf(hist.history.prices.at(-1), pip)
  check(s.digitSample === window && sumCounts === window, `${symbol} window ${window}: totals match window`, `sample ${s.digitSample}, Σcounts ${sumCounts}, "${s.digitText}"`)
  const hasPercent = await page.evaluate(() =>
    [...document.querySelectorAll('section[aria-label="Digit statistics"], section[aria-label="Digit statistics"] *')].some(
      (el) => [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.includes('%')),
    ),
  )
  check(!hasPercent && s.digitPanelText.length > 0, `${symbol} window ${window}: no element in digit analysis contains "%"`)
  check(
    JSON.stringify(apiCounts) === JSON.stringify(s.counts),
    `${symbol} window ${window}: counts equal independent computation from ticks_history`,
    `app ${JSON.stringify(s.counts)} api ${JSON.stringify(apiCounts)}`,
  )
  check(s.current === lastApiDigit, `${symbol} window ${window}: highlighted digit = latest tick digit`, `${s.current}`)
  return s.counts
}

async function verifyTimeframe(api, page, symbol, tf) {
  await page.getByRole('group', { name: 'Chart interval' }).getByRole('button', { name: tf, exact: true }).click()
  await waitChart(page, { symbol, mode: tf, live: false })
  await page.waitForTimeout(1500)
  const s = await readState(page)
  const res = await api.request({
    ticks_history: symbol,
    adjust_start_time: 1,
    count: 500,
    end: 'latest',
    start: 1,
    style: 'candles',
    granularity: TIMEFRAMES[tf],
  })
  const first = JSON.parse(s.firstCandle)
  const last = JSON.parse(s.lastCandle)
  const apiFirst = res.candles.find((c) => c.epoch === first.time)
  const apiLastEpoch = res.candles.at(-1).epoch
  const same =
    apiFirst && ['open', 'high', 'low', 'close'].every((k) => Number(apiFirst[k]) === first[k])
  log.push(`  ${symbol} ${tf}: app first ${s.firstCandle} | api ${JSON.stringify(apiFirst)} | ${s.points} candles`)
  check(Boolean(same), `${symbol} ${tf}: first candle OHLC equals Deriv candles API`)
  check(
    last.time === apiLastEpoch || last.time === apiLastEpoch - TIMEFRAMES[tf],
    `${symbol} ${tf}: latest candle aligned with Deriv`,
    `app ${last.time} api ${apiLastEpoch}`,
  )
  const spacingOk = s.points > 1
  check(spacingOk, `${symbol} ${tf}: multiple real candles loaded`, `${s.points}`)
}

/** Records Deriv WebSocket traffic of a page: sockets opened, requests sent, ohlc frames received. */
function trackDerivSockets(page) {
  const t = { opened: 0, open: 0, sent: [], ohlc: [] }
  page.on('websocket', (ws) => {
    if (!/derivws\.com/.test(ws.url())) return
    t.opened += 1
    t.open += 1
    ws.on('close', () => (t.open -= 1))
    ws.on('framesent', (f) => {
      try {
        t.sent.push({ at: Date.now(), msg: JSON.parse(String(f.payload)) })
      } catch {
        /* ignore */
      }
    })
    ws.on('framereceived', (f) => {
      try {
        const msg = JSON.parse(String(f.payload))
        if (msg.msg_type === 'ohlc') t.ohlc.push({ at: Date.now(), key: `${msg.ohlc.symbol}|${msg.ohlc.granularity}` })
      } catch {
        /* ignore */
      }
    })
  })
  return t
}
const candleRequests = (t) => t.sent.filter((s) => s.msg.ticks_history && s.msg.style === 'candles').length

const readChartType = (page) =>
  page.evaluate(() => {
    const chart = document.querySelector('[data-testid="price-chart"]')
    const pressed = [...document.querySelectorAll('[aria-label="Chart type"] button[aria-pressed="true"]')]
    const interval = document.querySelector('[aria-label="Chart interval"] button[aria-pressed="true"]')
    // Green (#10b981) / red (#f43f5e) pixels drawn on the chart canvases = real up/down bars on screen.
    let up = 0
    let down = 0
    for (const canvas of chart?.querySelectorAll('canvas') ?? []) {
      if (!canvas.width || !canvas.height) continue
      const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data
      if (!data) continue
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 200) continue
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]]
        if (Math.abs(r - 16) < 14 && Math.abs(g - 185) < 14 && Math.abs(b - 129) < 14) up += 1
        else if (Math.abs(r - 244) < 14 && Math.abs(g - 63) < 14 && Math.abs(b - 94) < 14) down += 1
      }
    }
    return {
      style: chart?.getAttribute('data-style'),
      mode: chart?.getAttribute('data-mode'),
      symbol: chart?.getAttribute('data-symbol'),
      points: Number(chart?.getAttribute('data-points')),
      lastCandle: chart?.getAttribute('data-last-candle') || null,
      firstCandle: chart?.getAttribute('data-first-candle') || null,
      secondCandle: chart?.getAttribute('data-second-candle') || null,
      pressed: pressed.map((b) => b.textContent),
      pressedClass: pressed[0]?.className ?? '',
      interval: interval?.textContent ?? '',
      notice: document.querySelector('[data-testid="chart-notice"]')?.textContent ?? '',
      up,
      down,
    }
  })

async function waitStyle(page, style, mode, symbol) {
  await page
    .waitForFunction(
    ({ style, mode, symbol }) => {
      const el = document.querySelector('[data-testid="price-chart"]')
      return (
        el?.getAttribute('data-style') === style &&
        el?.getAttribute('data-mode') === mode &&
        (!symbol || el?.getAttribute('data-symbol') === symbol) &&
        Number(el?.getAttribute('data-points')) > 1
      )
    },
    { style, mode, symbol },
    { timeout: 45000 },
    )
    .catch(async (error) => {
      const s = await readChartType(page)
      const el = page.getByTestId('price-chart')
      const status = await el.getAttribute('data-status')
      const text = await page.evaluate(
        () => document.querySelector('[data-testid="price-chart"] .pointer-events-none')?.textContent ?? '',
      )
      throw new Error(
        `waitStyle(${style},${mode},${symbol}) got style=${s.style} mode=${s.mode} symbol=${s.symbol} points=${s.points} status=${status} url=${page.url()} text="${text}" — ${error.message.split('\n')[0]}`,
      )
    })
  await page.waitForTimeout(400)
}

async function compareCandlesWithApi(api, page, tag, granularity) {
  const s = await readChartType(page)
  const request = () =>
    api.request({
      ticks_history: s.symbol,
      adjust_start_time: 1,
      count: 500,
      end: 'latest',
      start: 1,
      style: 'candles',
      granularity,
    })
  const res = await request().catch(() => request())
  // A rolling window can start with a partial, unaligned edge candle (1D); compare the first full bar.
  const head = JSON.parse(s.firstCandle)
  const first = head.time % granularity === 0 ? head : JSON.parse(s.secondCandle)
  const last = JSON.parse(s.lastCandle)
  const apiFirst = res.candles.find((c) => c.epoch === first.time)
  const apiLast = res.candles.at(-1).epoch
  const same = apiFirst && ['open', 'high', 'low', 'close'].every((k) => Number(apiFirst[k]) === first[k])
  check(Boolean(same), `${tag}: first bar OHLC equals Deriv candles API`, `app ${JSON.stringify(first)} api ${JSON.stringify(apiFirst)}`)
  check(
    last.time === apiLast || last.time === apiLast + granularity || last.time === apiLast - granularity,
    `${tag}: latest bar aligned with Deriv`,
    `app ${last.time} api ${apiLast}`,
  )
  check(s.points > 1, `${tag}: ${s.points} real bars loaded`)
  return s
}

async function waitLiveBar(page, before, timeout = 25000) {
  try {
    await page.waitForFunction(
      (prev) => {
        const v = document.querySelector('[data-testid="price-chart"]')?.getAttribute('data-last-candle')
        return Boolean(v) && v !== prev
      },
      before,
      { timeout },
    )
    return true
  } catch {
    return false
  }
}

async function verifyChartTypes(api, label, pageOptions, { accountSwitch }) {
  const page = await browser.newPage(pageOptions)
  watch(page, `${label}-types`)
  const t = trackDerivSockets(page)
  await openTrading(page, 'R_100')
  await waitChart(page, { symbol: 'R_100', live: false })
  const types = page.getByRole('group', { name: 'Chart type' })
  const intervals = page.getByRole('group', { name: 'Chart interval' })
  const lineState = await readChartType(page)
  check(lineState.style === 'line' && lineState.mode === 'ticks', `${label}: opens on Line / Tick`)

  // Candles from Tick: must react (move to 1m) instead of being a dead button.
  await types.getByRole('button', { name: 'Candles', exact: true }).click()
  const notice = await page
    .getByTestId('chart-notice')
    .textContent({ timeout: 3000 })
    .catch(() => '')
  await waitStyle(page, 'candles', '1m', 'R_100')
  let s = await readChartType(page)
  s.notice = notice
  check(s.pressed.join() === 'Candles' && /text-signal/.test(s.pressedClass), `${label}: Candles tab selected in signal blue`, s.pressedClass)
  check(s.interval === '1m' && /switched Tick to 1m/.test(s.notice), `${label}: Tick → 1m with visible notice`, s.notice)
  await compareCandlesWithApi(api, page, `${label} Candles 1m`, 60)
  check(s.up > 0 && s.down > 0, `${label} Candles: green up and red down bodies drawn`, `up px ${s.up}, down px ${s.down}`)
  check(await waitLiveBar(page, s.lastCandle), `${label} Candles: live ohlc update reached the chart`)
  if (SHOTS) await page.screenshot({ path: resolve(shotDir, `chart-candles-${label}.png`) })

  // OHLC on the same data: no history refetch, same bars, still live.
  const requestsBefore = candleRequests(t)
  const candlesPoints = (await readChartType(page)).points
  await types.getByRole('button', { name: 'OHLC', exact: true }).click()
  await waitStyle(page, 'ohlc', '1m', 'R_100')
  s = await readChartType(page)
  check(s.pressed.join() === 'OHLC' && /text-signal/.test(s.pressedClass), `${label}: OHLC tab selected in signal blue`)
  check(s.interval === '1m', `${label}: OHLC keeps the 1m timeframe`)
  check(s.up > 0 && s.down > 0, `${label} OHLC: green/red bars drawn`, `up px ${s.up}, down px ${s.down}`)
  check(Math.abs(s.points - candlesPoints) <= 1, `${label} OHLC: same bar set as Candles`, `${candlesPoints} → ${s.points}`)
  await compareCandlesWithApi(api, page, `${label} OHLC 1m`, 60)
  check(await waitLiveBar(page, s.lastCandle), `${label} OHLC: live ohlc update reached the chart`)
  if (SHOTS) await page.screenshot({ path: resolve(shotDir, `chart-ohlc-${label}.png`) })
  await types.getByRole('button', { name: 'Candles', exact: true }).click()
  await waitStyle(page, 'candles', '1m', 'R_100')
  check(candleRequests(t) === requestsBefore, `${label}: switching Candles ↔ OHLC sends no new Deriv history request`, `${requestsBefore} → ${candleRequests(t)}`)

  // Every timeframe in both chart types, verified against Deriv.
  let style = 'candles'
  for (const [button, [mode, granularity]] of Object.entries(CANDLE_TFS)) {
    if (button === '1m') continue
    await intervals.getByRole('button', { name: button, exact: true }).click()
    await waitStyle(page, style, mode, 'R_100')
    await compareCandlesWithApi(api, page, `${label} ${style} ${button}`, granularity)
    style = style === 'candles' ? 'ohlc' : 'candles'
    const before = candleRequests(t)
    await types.getByRole('button', { name: style === 'ohlc' ? 'OHLC' : 'Candles', exact: true }).click()
    await waitStyle(page, style, mode, 'R_100')
    const after = await readChartType(page)
    check(after.up + after.down > 0 && candleRequests(t) === before, `${label} ${style} ${button}: bars drawn, no refetch`, `px ${after.up + after.down}`)
  }

  // Market switch in a candle mode: old ohlc stream is forgotten, only the new one keeps streaming.
  await intervals.getByRole('button', { name: '1m', exact: true }).click()
  await waitStyle(page, style, '1m', 'R_100')
  const forgetsBefore = t.sent.filter((x) => x.msg.forget).length
  await selectSymbol(page, 'R_50')
  await waitStyle(page, style, '1m', 'R_50')
  await compareCandlesWithApi(api, page, `${label} ${style} R_50 1m`, 60)
  check(await waitLiveBar(page, (await readChartType(page)).lastCandle), `${label} R_50: live bars after market switch`)
  await page.waitForTimeout(3000)
  const since = Date.now() - 2500
  const streams = [...new Set(t.ohlc.filter((o) => o.at >= since).map((o) => o.key))]
  check(streams.length === 1 && streams[0] === 'R_50|60', `${label}: only the selected market's ohlc stream is live`, JSON.stringify(streams))
  check(t.sent.filter((x) => x.msg.forget).length > forgetsBefore, `${label}: previous stream forgotten on market switch`)

  if (accountSwitch) {
    const reqs = t.sent.length
    const before = await readChartType(page)
    await page.getByRole('button', { name: 'Real', exact: true }).first().click()
    await page.waitForTimeout(2500)
    const real = await readChartType(page)
    const historyAfter = t.sent.slice(reqs).filter((x) => x.msg.ticks_history && x.msg.style === 'candles')
    check(
      real.style === before.style && real.mode === before.mode && real.symbol === before.symbol && real.points > 1,
      `${label}: REAL keeps chart type, timeframe, market and bars`,
      `${real.style} ${real.mode} ${real.symbol} ${real.points}`,
    )
    check(historyAfter.length === 0, `${label}: DEMO → REAL does not refetch or resubscribe candles`, `${historyAfter.length} candle requests`)
    check(await waitLiveBar(page, real.lastCandle), `${label}: live bars continue in REAL`)
    await page.getByRole('button', { name: 'Demo', exact: true }).first().click()
    await page.waitForTimeout(1500)
    const demo = await readChartType(page)
    check(demo.style === before.style && demo.points > 1, `${label}: back to DEMO keeps the chart`)
  }

  // Tick from a candle mode: draws a line, never a broken candle chart.
  await intervals.getByRole('button', { name: 'Tick', exact: true }).click()
  await waitStyle(page, 'line', 'ticks', 'R_50')
  check((await readChartType(page)).pressed.join() === 'Line', `${label}: Tick switches the chart to Line`)

  check(t.opened === 1 && t.open === 1, `${label}: one shared Deriv WebSocket`, `opened ${t.opened}, open ${t.open}`)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  check(overflow <= 1, `${label}: no horizontal overflow in candle modes`, `${overflow}px`)
  await page.close()
}

const watchdog = setTimeout(() => {
  console.log(log.join('\n'))
  console.log('\nFAIL watchdog: chart check exceeded 15 minutes')
  process.exit(1)
}, 15 * 60_000)
watchdog.unref()

const api = derivClient()
const browser = await launch()
const consoleErrors = []
function watch(page, label) {
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`[${label}] ${m.text()}`)
  })
  page.on('pageerror', (e) => consoleErrors.push(`[${label}] pageerror ${e.message}`))
}

try {
  // Deriv throttles bursts of ticks_history from one IP; pause between suites.
  const cooldown = () => new Promise((r) => setTimeout(r, Number(process.env.COOLDOWN_MS ?? 60000)))
  if (process.env.MOBILE_ONLY !== '1') {
    await verifyChartTypes(api, 'desktop', { viewport: { width: 1440, height: 900 } }, { accountSwitch: true })
    await cooldown()
  }
  await verifyChartTypes(
    api,
    'mobile',
    { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
    { accountSwitch: false },
  )
  if (process.env.TYPES_ONLY === '1') throw new Error('TYPES_ONLY')
  await cooldown()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  watch(page, 'desktop')
  await openTrading(page, 'R_100')
  const r100 = await verifyTicksAgainstApi(api, page, 'R_100')
  if (SHOTS) await page.screenshot({ path: resolve(shotDir, `${PREFIX}-desktop-ticks.png`) })

  await verifyDigitWindow(api, page, 'R_100')

  let prev = r100
  for (const sym of ['R_50', 'R_25']) {
    await selectSymbol(page, sym)
    const s = await verifyTicksAgainstApi(api, page, sym)
    check(s.price !== prev.price && s.symbol !== prev.symbol, `switch ${prev.symbol} → ${sym}: price and chart changed`, `${prev.price} → ${s.price}`)
    await verifyDigitWindow(api, page, sym)
    prev = s
  }

  for (const tf of Object.keys(TIMEFRAMES)) {
    await verifyTimeframe(api, page, 'R_25', tf)
    if (tf === '5m' && SHOTS) await page.screenshot({ path: resolve(shotDir, `${PREFIX}-desktop-candles.png`) })
  }
  await page.close()

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  watch(mobile, 'mobile')
  await openTrading(mobile, 'R_100')
  await waitChart(mobile, { symbol: 'R_100' })
  await mobile.waitForTimeout(2500)
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  check(overflow <= 1, 'mobile: no horizontal overflow', `${overflow}px`)
  if (SHOTS) await mobile.screenshot({ path: resolve(shotDir, `${PREFIX}-mobile-ticks.png`), fullPage: true })
  await mobile.getByRole('group', { name: 'Chart interval' }).getByRole('button', { name: '5m', exact: true }).click()
  await waitChart(mobile, { symbol: 'R_100', mode: '5m', live: false })
  await mobile.waitForTimeout(1500)
  if (SHOTS) await mobile.screenshot({ path: resolve(shotDir, `${PREFIX}-mobile-candles.png`), fullPage: true })
  await mobile.close()
} catch (error) {
  if (error.message !== 'TYPES_ONLY') check(false, `run aborted: ${error.message.split('\n')[0]}`)
} finally {
  await browser.close()
  api.close()
}

check(consoleErrors.length === 0, 'no console errors', consoleErrors.slice(0, 5).join(' | '))
console.log(log.join('\n'))
console.log(failures.length ? `\n${failures.length} check(s) failed.` : '\nAll chart/digit checks passed.')
process.exit(failures.length ? 1 : 0)
