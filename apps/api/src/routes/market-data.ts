import { Router, type Request, type Response } from 'express'

const DEFAULT_REST = 'https://api.binance.com'

const ALLOWED_SYMBOLS = new Set([
  'BTCUSDT',
  'ETHUSDT',
  'BNBUSDT',
  'SOLUSDT',
  'XRPUSDT',
  'ADAUSDT',
  'DOGEUSDT',
  'AVAXUSDT',
])

const ALLOWED_INTERVALS = new Set(['1m', '5m', '15m', '30m', '1h'])

function restBase(): string {
  return (process.env.MARKET_DATA_REST_URL || DEFAULT_REST).replace(/\/$/, '')
}

function providerEnabled(): boolean {
  const id = (process.env.MARKET_DATA_PROVIDER || 'binance').toLowerCase()
  return id === 'binance'
}

/**
 * Public Binance market-data proxy (no API key).
 * Avoids browser CORS when fetching historical klines.
 */
export function createMarketDataRouter(): Router {
  const router = Router()

  router.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: providerEnabled() ? 'ok' : 'disabled',
      provider: process.env.MARKET_DATA_PROVIDER || 'binance',
      authRequired: false,
      note: 'Binance public market data — no private API key required.',
    })
  })

  router.get('/symbols', (_req: Request, res: Response) => {
    if (!providerEnabled()) {
      res.status(503).json({ error: 'Market data provider disabled' })
      return
    }
    res.status(200).json({
      provider: 'binance',
      symbols: [...ALLOWED_SYMBOLS],
      intervals: [...ALLOWED_INTERVALS],
    })
  })

  router.get('/klines', async (req: Request, res: Response) => {
    if (!providerEnabled()) {
      res.status(503).json({ error: 'Market data provider disabled' })
      return
    }

    const symbol = String(req.query.symbol ?? '')
      .trim()
      .toUpperCase()
    const interval = String(req.query.interval ?? '1m').trim()
    const limitRaw = Number(req.query.limit ?? 200)
    const limit = Number.isFinite(limitRaw) ? Math.min(1000, Math.max(1, Math.floor(limitRaw))) : 200

    if (!ALLOWED_SYMBOLS.has(symbol)) {
      res.status(400).json({ error: `Symbol not allowed: ${symbol || '(empty)'}` })
      return
    }
    if (!ALLOWED_INTERVALS.has(interval)) {
      res.status(400).json({ error: `Interval not allowed: ${interval}` })
      return
    }

    const url = `${restBase()}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`

    try {
      const upstream = await fetch(url, {
        headers: { Accept: 'application/json' },
      })
      if (!upstream.ok) {
        const text = await upstream.text().catch(() => '')
        res.status(502).json({
          error: `Upstream Binance error (${upstream.status})`,
          detail: text.slice(0, 500),
        })
        return
      }
      const rows = (await upstream.json()) as unknown
      if (!Array.isArray(rows)) {
        res.status(502).json({ error: 'Invalid upstream klines payload' })
        return
      }

      const candles = rows
        .map((row) => {
          if (!Array.isArray(row) || row.length < 5) return null
          const time = Number(row[0])
          const open = Number(row[1])
          const high = Number(row[2])
          const low = Number(row[3])
          const close = Number(row[4])
          if (![time, open, high, low, close].every(Number.isFinite)) return null
          return {
            time: Math.floor(time / 1000),
            open,
            high,
            low,
            close,
          }
        })
        .filter((c): c is NonNullable<typeof c> => c != null)

      if (candles.length === 0) {
        res.status(502).json({ error: 'Empty or invalid klines from upstream' })
        return
      }

      res.status(200).json({
        provider: 'binance',
        symbol,
        interval,
        candles,
      })
    } catch (err) {
      res.status(502).json({
        error: 'Failed to fetch Binance klines',
        detail: err instanceof Error ? err.message : 'unknown',
      })
    }
  })

  router.get('/ticker', async (req: Request, res: Response) => {
    if (!providerEnabled()) {
      res.status(503).json({ error: 'Market data provider disabled' })
      return
    }
    const symbol = String(req.query.symbol ?? '')
      .trim()
      .toUpperCase()
    if (!ALLOWED_SYMBOLS.has(symbol)) {
      res.status(400).json({ error: `Symbol not allowed: ${symbol || '(empty)'}` })
      return
    }
    const url = `${restBase()}/api/v3/ticker/bookTicker?symbol=${encodeURIComponent(symbol)}`
    try {
      const upstream = await fetch(url, { headers: { Accept: 'application/json' } })
      if (!upstream.ok) {
        res.status(502).json({ error: `Upstream ticker error (${upstream.status})` })
        return
      }
      const data = (await upstream.json()) as {
        symbol?: string
        bidPrice?: string
        askPrice?: string
      }
      const bid = Number(data.bidPrice)
      const ask = Number(data.askPrice)
      res.status(200).json({
        provider: 'binance',
        symbol,
        bid: Number.isFinite(bid) ? bid : null,
        ask: Number.isFinite(ask) ? ask : null,
        timestamp: Date.now(),
      })
    } catch (err) {
      res.status(502).json({
        error: 'Failed to fetch book ticker',
        detail: err instanceof Error ? err.message : 'unknown',
      })
    }
  })

  return router
}
