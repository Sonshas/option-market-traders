// Internal design-reference capture: screenshots + computed style summary of external landing pages.
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const outDir = resolve(import.meta.dirname, '../../../docs/design-reference')
mkdirSync(outDir, { recursive: true })

const sites = [
  { id: 'tagoption', url: 'https://tagoption.ke/' },
  { id: 'tradewise', url: 'https://tradewisebinary.com/' },
]

const browser = await chromium.launch()
const report = {}

for (const site of sites) {
  for (const vp of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
    const page = await ctx.newPage()
    try {
      const res = await page.goto(site.url, { waitUntil: 'networkidle', timeout: 45000 })
      await page.waitForTimeout(2500)
      // scroll through to trigger lazy/reveal animations
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 600) {
          window.scrollTo(0, y)
          await new Promise((r) => setTimeout(r, 150))
        }
        window.scrollTo(0, 0)
      })
      await page.waitForTimeout(800)
      await page.screenshot({ path: resolve(outDir, `${site.id}-${vp.name}-hero.png`) })
      await page.screenshot({ path: resolve(outDir, `${site.id}-${vp.name}-full.png`), fullPage: true })
      if (vp.name === 'desktop') {
        const data = await page.evaluate(() => {
          const colorCount = {}
          const bump = (k, v) => {
            if (!v || v === 'rgba(0, 0, 0, 0)' || v === 'none') return
            colorCount[k] ??= {}
            colorCount[k][v] = (colorCount[k][v] ?? 0) + 1
          }
          const fonts = {}
          for (const el of document.querySelectorAll('body *')) {
            const cs = getComputedStyle(el)
            const rect = el.getBoundingClientRect()
            if (rect.width === 0 || rect.height === 0) continue
            bump('bg', cs.backgroundColor)
            bump('color', cs.color)
            bump('border', cs.borderTopWidth !== '0px' ? cs.borderTopColor : null)
            if (cs.backgroundImage.includes('gradient')) bump('gradient', cs.backgroundImage.slice(0, 260))
            fonts[cs.fontFamily] = (fonts[cs.fontFamily] ?? 0) + 1
          }
          const top = (o, n = 14) =>
            Object.entries(o ?? {})
              .sort((a, b) => b[1] - a[1])
              .slice(0, n)
          const sections = [...document.querySelectorAll('section, header, footer, nav')].map((s) => {
            const h = s.querySelector('h1,h2,h3')
            const cs = getComputedStyle(s)
            return {
              tag: s.tagName,
              heading: h?.textContent?.trim().slice(0, 80) ?? null,
              bg: cs.backgroundColor,
              bgImage: cs.backgroundImage.slice(0, 160),
              height: Math.round(s.getBoundingClientRect().height),
            }
          })
          const sample = (sel) => {
            const el = document.querySelector(sel)
            if (!el) return null
            const cs = getComputedStyle(el)
            return {
              text: el.textContent?.trim().slice(0, 60),
              font: cs.fontFamily,
              size: cs.fontSize,
              weight: cs.fontWeight,
              color: cs.color,
              bg: cs.backgroundColor,
              bgImage: cs.backgroundImage.slice(0, 200),
              radius: cs.borderRadius,
              padding: cs.padding,
              lineHeight: cs.lineHeight,
              letterSpacing: cs.letterSpacing,
            }
          }
          const buttons = [...document.querySelectorAll('a, button')]
            .filter((b) => {
              const cs = getComputedStyle(b)
              return cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.backgroundImage.includes('gradient')
            })
            .slice(0, 8)
            .map((b) => {
              const cs = getComputedStyle(b)
              return {
                text: b.textContent?.trim().slice(0, 40),
                bg: cs.backgroundColor,
                bgImage: cs.backgroundImage.slice(0, 200),
                color: cs.color,
                radius: cs.borderRadius,
                padding: cs.padding,
                weight: cs.fontWeight,
                shadow: cs.boxShadow.slice(0, 120),
              }
            })
          const rootVars = {}
          for (const sheet of document.styleSheets) {
            try {
              for (const rule of sheet.cssRules) {
                if (rule.selectorText === ':root' || rule.selectorText === ':root, :host') {
                  for (const prop of rule.style) if (prop.startsWith('--')) rootVars[prop] = rule.style.getPropertyValue(prop).trim()
                }
              }
            } catch {}
          }
          return {
            title: document.title,
            body: sample('body'),
            h1: sample('h1'),
            h2: sample('h2'),
            p: sample('p'),
            buttons,
            topBg: top(colorCount.bg),
            topColor: top(colorCount.color),
            topBorder: top(colorCount.border, 8),
            gradients: top(colorCount.gradient, 10),
            fonts: top(fonts, 6),
            sections,
            rootVars: Object.fromEntries(Object.entries(rootVars).slice(0, 80)),
          }
        })
        report[site.id] = { status: res?.status(), finalUrl: page.url(), ...data }
      }
    } catch (err) {
      report[site.id] ??= { error: String(err) }
    }
    await ctx.close()
  }
}

await browser.close()
writeFileSync(resolve(outDir, 'extracted-styles.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(Object.fromEntries(Object.entries(report).map(([k, v]) => [k, v.error ?? v.status])), null, 2))
