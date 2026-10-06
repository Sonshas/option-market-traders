// Verifies the landing hero video, photo sections and live ticker in a real browser.
//   APP_URL=http://localhost:5173 node scripts/verify-landing-media.mjs
//   APP_URL=https://optionmarkettraders.com SCREENSHOTS=1 node scripts/verify-landing-media.mjs
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const BASE = (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '')
const SCREENSHOTS = process.env.SCREENSHOTS === '1'
const SHOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/screenshots')

const viewports = [
  { name: 'desktop', options: { viewport: { width: 1440, height: 900 } }, video: 'hero-trading-desk-v1', other: 'hero-trading-mobile-v1' },
  {
    name: 'mobile',
    options: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
    video: 'hero-trading-mobile-v1',
    other: 'hero-trading-desk-v1',
  },
]

const ignoreConsole = [/Download the React DevTools/i, /\[vite\]/i]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(page, fn, arg, timeout = 15000) {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 200 })
    return true
  } catch {
    return false
  }
}

async function check(browser, vp) {
  const context = await browser.newContext(vp.options)
  const page = await context.newPage()
  const failures = []
  const consoleErrors = []
  const mediaRequests = []

  page.on('console', (msg) => {
    if (msg.type() === 'error' && !ignoreConsole.some((re) => re.test(msg.text()))) consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`))
  page.on('request', (req) => {
    if (new URL(req.url()).pathname.startsWith('/media/')) mediaRequests.push(req.url())
  })
  page.on('requestfailed', (req) => {
    const path = new URL(req.url()).pathname
    // Chromium aborts a range request when it switches to a new one; that is not a failure.
    if (path.startsWith('/media/') && req.failure()?.errorText !== 'net::ERR_ABORTED') {
      failures.push(`request failed ${path}: ${req.failure()?.errorText}`)
    }
  })
  page.on('response', (res) => {
    const path = new URL(res.url()).pathname
    if (path.startsWith('/media/') && res.status() >= 400) failures.push(`HTTP ${res.status()} ${path}`)
  })

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })

  const hasVideo = await waitFor(page, () => !!document.querySelector('video[data-hero-video]'), null, 10000)
  if (!hasVideo) failures.push('hero <video> not found')

  await waitFor(page, () => {
    const v = document.querySelector('video[data-hero-video]')
    return !!v && v.readyState >= 2 && !v.paused
  })
  const v1 = await page.evaluate(() => {
    const v = document.querySelector('video[data-hero-video]')
    if (!v) return null
    return {
      variant: v.dataset.heroVideo,
      currentSrc: v.currentSrc,
      readyState: v.readyState,
      paused: v.paused,
      muted: v.muted,
      loop: v.loop,
      currentTime: v.currentTime,
      objectFit: getComputedStyle(v).objectFit,
      coversHero: (() => {
        const r = v.getBoundingClientRect()
        const h = v.closest('section').getBoundingClientRect()
        return Math.abs(r.width - h.width) < 2 && Math.abs(r.height - h.height) < 2
      })(),
      posterShown: !!document.querySelector('[data-hero-poster]'),
    }
  })
  await sleep(1200)
  const t2 = await page.evaluate(() => document.querySelector('video[data-hero-video]')?.currentTime ?? -1)

  const video = v1 ? { ...v1, currentTimeAfter: t2, advancing: t2 !== v1.currentTime && t2 > 0 } : null
  if (video) {
    if (!video.currentSrc) failures.push('video has no currentSrc')
    if (!video.currentSrc.includes(vp.video)) failures.push(`expected ${vp.video}, got ${video.currentSrc}`)
    if (video.readyState < 2) failures.push(`readyState ${video.readyState}`)
    if (video.paused) failures.push('video is paused')
    if (!video.muted) failures.push('video is not muted')
    if (!video.loop) failures.push('video does not loop')
    if (!video.advancing) failures.push(`currentTime not advancing (${video.currentTime} -> ${t2})`)
    if (video.objectFit !== 'cover') failures.push(`object-fit is ${video.objectFit}`)
    if (!video.coversHero) failures.push('video does not cover the hero')
    if (video.posterShown) failures.push('poster fallback shown although autoplay should work')
  }

  if (SCREENSHOTS) {
    mkdirSync(SHOT_DIR, { recursive: true })
    await page.screenshot({ path: resolve(SHOT_DIR, `home-hero-${vp.name}.png`) })
  }

  const tickerBefore = await page.evaluate(() => document.querySelector('#markets')?.textContent ?? '')

  // Scroll every image into view so lazy images load, then confirm they decoded.
  const imgCount = await page.locator('main img').count()
  for (let i = 0; i < imgCount; i += 1) {
    const img = page.locator('main img').nth(i)
    await img.scrollIntoViewIfNeeded().catch(() => {})
    await img.evaluate((el) => (el.complete ? null : new Promise((r) => { el.onload = el.onerror = r; setTimeout(r, 10000) }))).catch(() => {})
  }
  const images = await page.evaluate(() =>
    [...document.querySelectorAll('main img')].map((img) => ({
      src: img.currentSrc || img.src,
      naturalWidth: img.naturalWidth,
      loading: img.getAttribute('loading'),
      decoding: img.getAttribute('decoding'),
    })),
  )
  for (const img of images) {
    if (!img.naturalWidth) failures.push(`broken image ${img.src}`)
  }
  const photos = images.filter((img) => img.src.includes('/media/images/') && !img.src.includes('poster'))
  if (photos.length < 4) failures.push(`expected 4 photo sections, found ${photos.length}`)
  for (const img of photos) {
    if (img.loading !== 'lazy' || img.decoding !== 'async') failures.push(`photo not lazy/async: ${img.src}`)
  }

  const overflow = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }))
  if (overflow.scrollWidth > overflow.innerWidth) failures.push(`horizontal scroll ${overflow.scrollWidth} > ${overflow.innerWidth}`)

  const tickerUpdated = await waitFor(
    page,
    (before) => {
      const now = document.querySelector('#markets')?.textContent ?? ''
      return now !== before && /\d/.test(now)
    },
    tickerBefore,
    20000,
  )
  if (!tickerUpdated) failures.push('live ticker did not update within 20s')

  if (mediaRequests.some((u) => u.includes(vp.other))) failures.push(`${vp.name} also requested ${vp.other}`)

  if (SCREENSHOTS && vp.name === 'desktop') {
    await page.evaluate(() => window.scrollTo(0, 0))
    await sleep(800)
    await page.screenshot({ path: resolve(SHOT_DIR, 'home-sections-desktop.png'), fullPage: true })
  }

  failures.push(...consoleErrors.map((e) => `console: ${e}`))
  await context.close()
  return { name: vp.name, video, images: images.length, photos: photos.length, overflow, tickerUpdated, mediaRequests: [...new Set(mediaRequests.map((u) => new URL(u).pathname))], failures }
}

const browser = await chromium.launch()
let failed = false
try {
  for (const vp of viewports) {
    const result = await check(browser, vp)
    console.log(JSON.stringify(result, null, 2))
    if (result.failures.length) failed = true
  }
} finally {
  await browser.close()
}
console.log(failed ? `FAIL landing media checks on ${BASE}` : `PASS landing media checks on ${BASE}`)
process.exit(failed ? 1 : 0)
