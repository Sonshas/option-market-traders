# REAL Market Data Plan — Smart Base Binary

**Project:** Smart Base Binary (`wkfyavcjjuyzvyeprklz`)  
**Scope:** Live market data + charts for REAL mode only. REAL order execution stays disabled.

---

## 1. Current architecture

Mode-scoped providers via `getAccountProviders(mode)`:

| Layer | Path | Role |
|-------|------|------|
| Registry | `apps/web/src/providers/registry.ts` | DEMO vs REAL wiring |
| Interface | `MarketDataProvider` in `providers/market-data/providers.ts` | `listMarkets`, `getMarket`, `getSnapshot`, `subscribeTicks`, `getStatus` |
| Hook | `hooks/useMarketData.ts` | Mode-scoped markets + snapshot + tick merge |
| Chart | `components/chart/CandleChart.tsx` | Canvas OHLC (existing) |
| Terminal | `pages/trading/TradingPage.tsx` | Markets + chart + ticket |
| Trading | `real-trading-provider.ts` | Reads only; `placeTrade` refused |
| API | `apps/api` | Health only (pre-integration); market-data REST proxy added |

Strict rule: DEMO never substitutes into REAL.

---

## 2. Existing provider(s)

| Provider | ID | Simulated | Status |
|----------|-----|-----------|--------|
| `demoMarketDataProvider` | `demo-simulated` | yes | Working — local `demo/market-engine` |
| `realMarketDataProvider` (legacy stub) | `real-disconnected` | no | Disconnected catalog / empty candles |
| **`binanceRealMarketDataProvider`** (new) | `real-binance` | no | Binance public REST + WS |

Cleanest interface: extend `MarketDataProvider` (add optional live candle subscription + connection detail). Prefer Binance over inventing a new abstraction.

---

## 3. Supported symbols

**DEMO (unchanged):** synthetic / forex catalog (`R_10`, `R_75`, `frxEURUSD`, …).

**REAL (Binance spot USDT pairs):**  
`BTCUSDT`, `ETHUSDT`, `BNBUSDT`, `SOLUSDT`, `XRPUSDT`, `ADAUSDT`, `DOGEUSDT`, `AVAXUSDT`  
(Discoverable via API `/market-data/symbols`; curated allow-list in app.)

No fake REAL symbols. Catalog-only Volatility indices are **not** used as live REAL prices.

---

## 4. REAL provider status

| Capability | Status |
|------------|--------|
| Market list | Binance allow-list when `VITE_MARKET_DATA_PROVIDER=binance` |
| Historical OHLC | REST via `apps/api` proxy → Binance `/api/v3/klines` |
| Live candles | Public WS `kline_<interval>` |
| Bid / ask | Public WS `bookTicker` |
| Order execution | **DISABLED** (`executionConfigured: false`) |

---

## 5. DEMO provider status

Unchanged: Even/Odd, Match/Differ, Over/Under, simulated candles/ticks/trades/settlement. Separate provider path.

---

## 6. Required env vars

### Frontend (`apps/web/.env`)

| Variable | Purpose | Secret? |
|----------|---------|---------|
| `VITE_MARKET_DATA_PROVIDER` | `binance` to enable; unset = NOT CONFIGURED | No |
| `VITE_MARKET_DATA_API_URL` | REST base (default `http://localhost:3001`) | No |
| `VITE_MARKET_DATA_WS_URL` | Binance WS base (default `wss://stream.binance.com:9443`) | No |
| `VITE_SUPABASE_*` | Auth / identity only | Publishable only |

### Backend (`apps/api/.env`)

| Variable | Purpose | Secret? |
|----------|---------|---------|
| `MARKET_DATA_PROVIDER` | `binance` | No |
| `MARKET_DATA_REST_URL` | Upstream REST (default `https://api.binance.com`) | No |
| `PORT`, `CORS_ORIGIN` | API listen / CORS | No |

**No Binance API key required for public market data.** Never put service-role or private exchange keys in `VITE_*`.

---

## 7. WebSocket / REST requirements

| Channel | Use | Auth |
|---------|-----|------|
| REST (proxied) | Historical klines, symbol metadata, optional ticker | None (public) |
| WebSocket (browser → Binance) | Live kline + bookTicker | None (public) |

Browser does **not** call Binance REST directly (CORS). `apps/api` proxies REST. WS is fine from the browser.

---

## 8. Candle timeframe support

REAL UI timeframes: **1m / 5m / 15m / 30m / 1h** (maps 1:1 to Binance intervals).  
DEMO may still use engine-internal short frames; chart `TIMEFRAMES` stays 1m–1h for both.

---

## 9. Reconnection strategy

- Single multiplexed WS per session (no parallel reconnect loops).
- Exponential backoff: 1s → 2s → 4s → … capped ~30s.
- On disconnect: status `reconnecting` / `disconnected`; do not label stale prices as LIVE.
- Unsubscribe previous symbol/interval before subscribe.
- Cleanup on unmount / mode switch.

---

## 10. Error handling

- Invalid / empty klines → `REAL MARKET DATA UNAVAILABLE` + explanation; empty candles; never DEMO fill-in.
- WS error / parse failure → `error` status + last-update timestamp if any.
- Unconfigured provider → `disconnected` / NOT CONFIGURED.
- No silent DEMO→REAL fallback.

---

## 11. What remains disabled for REAL trading

- `placeTrade` / quotes that accept stakes
- Deposits / withdrawals / settlement mutations
- Wallet debit/credit from market-data ticks
- Bots / copy-trading REAL execution
- Flipping `executionConfigured` / `paymentConfigured` / `complianceConfigured`

**Connecting the chart does not authorize REAL-money trading.**

---

## Implementation note (completed)

REAL path wired to **Binance public** market data:

- REST historical klines via `apps/api` `/market-data/*` proxy (CORS-safe)
- Live OHLC + bid/ask via browser WebSocket to Binance public streams
- UI connection states + REAL/DEMO separation
- Unit tests in `apps/web/src/providers/market-data/binance.test.ts`
- Status mirror: `docs/REAL_MARKET_DATA_STATUS.md`
