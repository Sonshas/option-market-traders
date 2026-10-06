import type { ContractType, Market, Timeframe } from '@/types'
import { REAL_FEED_LABEL } from '@/providers/market-data/env'

const DIGIT_CONTRACTS: ContractType[] = ['EVEN_ODD', 'MATCH_DIFFER', 'OVER_UNDER']
const DURATIONS_MS = [15_000, 30_000, 60_000, 120_000, 300_000]

/** Curated Binance spot symbols for REAL mode — no synthetic placeholders. */
export const BINANCE_REAL_MARKETS: Array<{
  symbol: string
  displayName: string
}> = [
  { symbol: 'BTCUSDT', displayName: 'Bitcoin / USDT' },
  { symbol: 'ETHUSDT', displayName: 'Ethereum / USDT' },
  { symbol: 'BNBUSDT', displayName: 'BNB / USDT' },
  { symbol: 'SOLUSDT', displayName: 'Solana / USDT' },
  { symbol: 'XRPUSDT', displayName: 'XRP / USDT' },
  { symbol: 'ADAUSDT', displayName: 'Cardano / USDT' },
  { symbol: 'DOGEUSDT', displayName: 'Dogecoin / USDT' },
  { symbol: 'AVAXUSDT', displayName: 'Avalanche / USDT' },
]

export const BINANCE_TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d']

const INTERVAL_MAP: Record<string, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
}

export function toBinanceInterval(timeframe: Timeframe): string | null {
  return INTERVAL_MAP[timeframe] ?? null
}

export function isBinanceSymbol(symbol: string): boolean {
  return BINANCE_REAL_MARKETS.some((m) => m.symbol === symbol.toUpperCase())
}

export function buildBinanceMarketCatalog(
  lastPrices: Map<string, number>,
  priceStatus: Market['priceStatus'],
): Market[] {
  return BINANCE_REAL_MARKETS.map((item) => {
    const lastPrice = lastPrices.get(item.symbol) ?? null
    return {
      symbol: item.symbol,
      displayName: item.displayName,
      category: 'crypto' as const,
      contractKinds: [...DIGIT_CONTRACTS],
      durationsMs: [...DURATIONS_MS],
      lastPrice,
      priceStatus: lastPrice != null ? priceStatus : 'disconnected',
      feedLabel: REAL_FEED_LABEL,
      isSimulated: false,
    }
  })
}

export function timeframeToMs(timeframe: Timeframe): number {
  switch (timeframe) {
    case '1m':
      return 60_000
    case '5m':
      return 300_000
    case '15m':
      return 900_000
    case '30m':
      return 1_800_000
    case '1h':
      return 3_600_000
    case '4h':
      return 14_400_000
    case '1d':
      return 86_400_000
    default:
      return 60_000
  }
}
