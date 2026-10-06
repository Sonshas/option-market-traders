# Feature completion status — charts, analytics, DEMO trading, bots

Deployed: release `20261002-234926` → https://optionmarkettraders.com (asset `index-Dpjn5IjS.js`).

## Trading desk rebuild (2026-10-03)

`/app` is now a desk with the chart on the left (about 75%) and a single ticket on the right (stacked on mobile).
- **Chart.** Compact market dropdown (Favorites / Volatility indices / Other synthetic, plus a star), Line /
  Candles / OHLC, and timeframes Tick, 1m, 5m, 15m, 30m, 1h, 4h, 1D. Sub-minute candles are omitted because
  Deriv rejects them.
- **Digit row.** Counts under the chart, no percentages; extra stats sit under "More stats".
- **Ticket, in order:**
  - Contract tabs.
  - DEMO-only ▶ AUTO TRADE.
  - DIGIT SCANNER (counts-only modal; "Load setup" never trades).
  - $1–$100 presets and a ± stepper.
  - Payout line, e.g. "$19.00 USD • 90.00%".
  - DEMO risk settings (TP $20 / SL $50 / Martingale ×2, 6-loss stop, $500 max stake).
  - 1–10 tick duration with a per-market hint.
  - Two direction buttons showing their payout.
  - A compact Open / Closed / Transactions box.
- **Tick durations** for both DEMO and REAL. REAL uses `place_real_tick_trade`; see `docs/REAL_TRADING.md`.
- Screenshots: `docs/screenshots/desk-{desktop,mobile}-{demo,real}.png`, `desk-autotrade-demo.png`,
  `desk-scanner.png`.

## Theme refresh (2026-10-02)

New navy / blue-teal theme with orange accents, based on the TagOption + TradeWise Binary design language. See
`docs/design-reference/THEME_NOTES.md`. The landing page was rebuilt: the live ticker and terminal preview use real
Deriv ticks, and the stats band shows only real values. Screenshots: `docs/screenshots/landing-{desktop,mobile}.png`,
`docs/screenshots/trading-themed-{desktop,mobile}.png`, `docs/screenshots/live-landing-{desktop,mobile}.png`.

## Market data source

- **Deriv new public API**: `wss://api.derivws.com/trading/v1/options/ws/public` (no auth, read-only).
  The legacy `wss://ws.derivws.com/websockets/v3?app_id=1089` endpoint now returns Cloudflare 520 everywhere
  (it has been retired by Deriv), which is why the site showed "Market data not connected".
  `getDerivWsUrl()` ignores any stale legacy URL from env.
- New-API differences handled: `active_symbols` uses `underlying_symbol` / `underlying_symbol_name` and rejects
  `product_type`; subscription ids are UUID strings.
- Ticks live only in an in-memory buffer (max 2000 per symbol). Nothing is written to Supabase.
- DEMO and REAL both read the same genuine Deriv ticks. DEMO only differs in using a virtual balance.
  The fabricated price engine (`demo/market-engine.ts`) was deleted.

## Per page

| Page | Status |
| --- | --- |
| Trade (`/app`) | lightweight-charts tick chart (1000-tick backfill + live), candles for 1m–1h, price marker, open-trade entry lines; last-digit analysis (25–1000 window, distribution, recent digits, parity streak, even/odd + over/under ratios); honest connecting/unavailable states |
| Markets | Real-tick sparklines and % change per card, skeletons, empty state |
| Wallet / Dashboard | DEMO balance + cumulative P/L charts from local ledger/trades; REAL P/L from Supabase trades (read-only); empty states; dashboard recent activity from real transactions |
| Trade History | Summary stats, outcome/contract/market filters, CSV export, empty states |
| Bots | DEMO runner placing one DEMO trade at a time on live digits with TP/SL/loss-streak/max-runs stops; REAL shows COMING SOON |

DEMO trades require a genuine tick received within 30s, expire at entry tick time + duration, settle on the
first real tick at/after expiry (backfilled via `ticks_history` if needed), and are refunded if no exit tick
arrives within 10 minutes.

## Verification

- `npm run typecheck` — pass
- `vitest` — 66/66 tests (6 files)
- `npm run build` — pass
- `npm run verify:ui` — 39 routes at desktop + mobile, no issues
- `scripts/capture-trading.mjs` — 1002 ticks in chart, 24 recent digits (desktop + mobile)
- Live: `/` serves the new asset hash, `/app/markets` 200, Deriv public socket returns 1000 ticks from the
  `https://optionmarkettraders.com` origin.

Screenshots: `docs/screenshots/local-trading-desktop.png`, `docs/screenshots/local-trading-mobile.png`.

## Still gated (needs a decision)

- **REAL trade execution** — built and deployed 2026-10-03 as an in-house (platform-as-counterparty) engine;
  see `docs/REAL_TRADING.md`. Probability-based payouts with a 5% house margin (DEMO and REAL), $1,000 daily
  winnings limit per user. `REAL_TRADING_ENABLED=true` since 2026-10-03.
- **REAL deposits** — live via MegaPay M-Pesa (2026-10-03); see `docs/MEGAPAY_INTEGRATION.md`.
- **REAL withdrawals** — disabled ("Coming soon").
- **Register your own Deriv App ID** — recommended even for public data, so the app has its own quota and is
  not affected by further legacy shutdowns.
- Bundle is 883 kB (lightweight-charts included); code-splitting the trading route would reduce first load.
