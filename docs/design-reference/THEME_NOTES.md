# Theme notes — TagOption + TradeWise Binary reference (internal)

Captured 2026-10-02 with headless Playwright (`apps/web/scripts/capture-reference.mjs`). Screenshots in this
folder are for internal reference only and are not shipped. Raw computed-style dump: `extracted-styles.json`.

| Site | URL | Reachable | Files |
| --- | --- | --- | --- |
| TagOption | https://tagoption.ke/ | Yes (HTTP 200) | `tagoption-{desktop,mobile}-{hero,full}.png` |
| TradeWise Binary | https://tradewisebinary.com/ | Yes (HTTP 200) | `tradewise-{desktop,mobile}-{hero,full}.png` |

Only the public landing pages were inspected. Neither site's logged-in trading app was opened (it needs an
account), so app-shell observations below come from the landing page and shipped CSS only.

## TagOption (observed)

- **Theme**: dark navy. Body `#0e0e0e`; nav `rgba(19,22,30,.85)` with blur; alt section `#191c26`; cards `#1c2030`;
  translucent surfaces `rgba(255,255,255,.04–.06)`; borders `rgba(255,255,255,.07)`.
- **Accent**: blue `#3b82f6` (buttons, links), teal `#00d4aa`. Signature gradient `linear-gradient(135deg,#3b82f6,#00d4aa)`
  on icon tiles and on the highlighted part of the H1. CTA band gradient `#3b82f6 → #4338ca`; app banner
  `#1e3a8a → #2563eb → #0ea5e9`. Radial glows of blue 12% / teal 8%.
- **Up / down**: green `#10b981`, red `#f43f5e`. Star/amber `#fbbf24`. Text: white, muted `#9ca3af`, `#6b7280`, `#d1d5db`.
- **`:root` vars in shipped CSS** (probably the trading app): `--bg-dark #0e0e0e`, `--bg-card #151717`, `--bg-panel #1d1f1f`,
  `--accent #ff444f`, `--success #4bb4b3`, `--border #323738`. Not seen rendered on the landing page.
- **Type**: IBM Plex Sans throughout. H1 72px / 800 / -1.8px tracking; H2 44px / 700.
- **Buttons**: solid blue, white text, radius 8px (nav) / 12px (hero), soft blue drop shadow; outline secondary.
- **Section order**: sticky nav → centered hero (pill badge, gradient headline, 2 CTAs, feature chips) → horizontal
  price ticker marquee → large live-chart terminal card → "Built for serious traders" 6-card feature grid →
  three numbered steps → stats band (4 big numbers) → testimonials → gradient CTA card → app-download banner →
  slim footer. Also a light/dark toggle in the nav.

## TradeWise Binary (observed)

- **Theme**: near-black. Rendered page `#000`; cards `#171717`; borders `#2a2a2a`; footer `#111`; tool section `#07080a`.
  Shipped `:root` vars describe a light variant (`--page #f3f1ed`, `--text #121212`) behind a theme toggle; the
  dark variant is what rendered by default.
- **Accent**: orange `--primary #F9670B`, pressed `#DE5C00`; band gradient `90deg #F9670B → #FF8A3D → #F9670B`;
  radial glow `rgba(249,103,11,.16)`. Muted warm greys `#a39a93`, `#d8d0c8`. `--success #22C55E`, `--danger #EF4444`.
- **Type**: Inter. H1 76px / 800 / -3.42px; H2 44px / 700 / -1.76px; orange uppercase eyebrows 13px / 700 / 1.04px tracking.
- **Shape**: pill buttons (999px); cards 16–18px radius; active step card gets an orange glow shadow.
- **Section order**: floating rounded nav → split hero (headline + phone-style ticket mock with 0–9 digit row) →
  one-line trust strip → "Choose how you want to trade" 01/02/03 contract cards (Even/Odd, Match/Differ,
  Over/Under) → interactive 4-step "how a trade works" with ticket preview → orange virtual-funds band →
  tools grid → feature columns → payments → 3 steps → account controls → responsible trading → FAQ accordion →
  CTA → 4-column footer. Mobile has a sticky bottom "Create account" bar.

## How they were combined

When the two sites disagreed, TagOption won for the base theme and app shell; TradeWise elements were blended into the landing page.

| Area | Choice |
| --- | --- |
| Base palette, app shell, charts, auth | TagOption navy + blue/teal (`apps/web/src/index.css` tokens) |
| Font | IBM Plex Sans (TagOption, already ours), 800 weight for hero |
| Primary buttons | TagOption blue, but filled `#2563eb` instead of `#3b82f6` so white text meets AA (5.2:1 vs 3.7:1) |
| Landing hero / ticker / terminal card / feature grid / steps / stats / CTA card | TagOption structure |
| Eyebrows, 01/02/03 contract cards, digit rows, interactive steps, funds band, FAQ, trust strip, sticky mobile CTA | TradeWise patterns, orange `#f9670b` as a secondary accent |
| Orange band | Darkened to `#9a3412 → #c2410c` so white text meets AA |

Final tokens: ink `#0f1117`, ink-2 `#13161e`, surface `#191c26`, surface-2 `#1c2030`, surface-3 `#252a3c`, line `#2a2f3d`,
line-strong `#3b4256`, mist `#9ca3af`, paper `#f5f7fb`, signal `#3b82f6`, signal-strong `#2563eb`, aqua `#00d4aa`,
flame `#f9670b`, call `#10b981`, put `#f43f5e`, amber/live/warn `#fbbf24`, demo `#38bdf8` (unchanged so DEMO stays distinct).

## Deliberately not copied

- Logos, brand names, photos (TradeWise hero model photo), phone/app mockup artwork, testimonial avatars.
- Marketing copy: all text is original.
- Unverifiable claims ("1M+ traders", "$2B+ traded", "150+ countries", "4.9/5", "up to 95% payout", "<1s execution",
  "zero fees", "$10 minimum"), testimonials, and the fake "live trades" feed. Our stats band shows only real values
  (market count from the live provider, 3 contract families, 10 digit outcomes, 24/7 synthetic indices).
- TagOption's static ticker numbers (AAPL/XAU/BTC). Our ticker streams genuine Deriv ticks or shows an unavailable state.
- App-download banner (we have no app), AI-scanner/auto-trade marketing, payment-method section (payments are disabled).
- Light/dark toggle: both sites have one, but the app stays dark-only for now.
