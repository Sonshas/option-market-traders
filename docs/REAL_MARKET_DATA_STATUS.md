# REAL Market Data Status — Smart Base Binary

**Updated:** 2026-09-20  
**Supabase project:** Smart Base Binary `wkfyavcjjuyzvyeprklz` (unchanged — no schema/financial mutations)

---

## Status summary

| Item | Status |
|------|--------|
| **REAL MARKET DATA** | **CONNECTED** (when `VITE_MARKET_DATA_PROVIDER=deriv`) |
| **REAL CHART** | **WORKING** (Deriv candles/ticks → live OHLC) |
| **REAL ORDER EXECUTION** | **DISABLED** |
| **DEMO** | **WORKING** (unchanged simulated engine) |
| **SUPABASE** | **CONNECTED** (Auth / identity; no new tables; no tick writes; no wallet/ledger mutations from this work) |

---

## Exact report

| Question | Answer |
|----------|--------|
| **Provider** | Deriv public market-data WebSocket/API |
| **WebSocket endpoint** | `wss://ws.derivws.com/websockets/v3?app_id=1089` (public test app_id; override with `VITE_DERIV_APP_ID`) |
| **Symbols** | Preferred digit indices: `R_10`, `R_25`, `R_50`, `R_75`, `R_100`, `1HZ10V`…`1HZ100V` (+ other synthetics from `active_symbols`) |
| **Timeframes** | `1m`, `5m`, `15m`, `30m`, `1h` |
| **Historical candles** | Yes — Deriv `ticks_history` style `candles` (fallback: ticks → local OHLC) |
| **Live ticks / candles** | Yes — prefers Deriv `ticks` subscribe; public test `app_id` may reject streaming, then falls back to polling genuine `ticks_history` (never fabricated) |
| **Digit contracts UI** | EVEN/ODD · MATCH/DIFFER · OVER/UNDER (analysis only) |
| **pip / last digit** | `pip_size` normalized (value or decimal-place count) → `lastDigit` from actual quote |
| **REAL trading execution** | **DISABLED** — shows `REAL TRADING EXECUTION NOT CONNECTED` |
| **DEMO unchanged** | **Yes** |

### Env vars

**Web (`apps/web/.env`):**
- `VITE_MARKET_DATA_PROVIDER=deriv`
- `VITE_DERIV_APP_ID=1089`
- `VITE_MARKET_DATA_WS_URL=wss://ws.derivws.com/websockets/v3?app_id=1089`

No private Deriv trading token / authorize call. No service-role keys in frontend.

If `VITE_MARKET_DATA_PROVIDER` is unset → **REAL MARKET DATA: NOT CONNECTED** (never DEMO fallback).

---

## Architecture

```
REAL MARKET DATA
  → MarketDataProvider (real-deriv)
  → DerivFeed WebSocket
  → tick stream
  → normalized quote (symbol, quote, epoch, pipSize, lastDigit, connectionStatus)
  → REAL chart (candles from ticks/history)
  → REAL contract UI (analysis only)
```

DEMO continues to use `demo-simulated` only.

---

## How to run locally

```bash
npm run dev -w @smartbasebinary/web
```

Open Trade terminal → **REAL ACCOUNT** → select `R_100` → confirm CONNECTED + candlesticks + last digit.

---

## Phase boundary

**STOP after REAL MARKET DATA.** Do not implement real-money execution, deposits, or withdrawals in this phase.
