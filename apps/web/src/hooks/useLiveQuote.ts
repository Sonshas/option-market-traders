import { useEffect, useState } from 'react'
import {
  getLastReceivedAt,
  getLatestBufferedTick,
  getLiveTickSource,
  subscribeTickBuffer,
} from '@/providers/market-data/tick-buffer'

export type LiveQuoteState =
  | { status: 'idle'; price: null; symbol: null }
  | { status: 'loading'; price: null; symbol: string }
  | { status: 'live'; price: number; symbol: string; receivedAt: number }
  | { status: 'error'; price: null; symbol: string; message: string }

const QUOTE_TIMEOUT_MS = 15_000

/**
 * Latest genuine quote for `symbol` from the shared market-data feed (subscribes through the existing socket, never
 * opens a new one). Never invents a value: loading until a real tick arrives, error if none arrives in time.
 */
export function useLiveQuote(symbol: string | null): LiveQuoteState {
  const [state, setState] = useState<LiveQuoteState>({ status: 'idle', price: null, symbol: null })
  useEffect(() => {
    if (!symbol) {
      setState({ status: 'idle', price: null, symbol: null })
      return
    }
    const read = (): boolean => {
      const tick = getLatestBufferedTick(symbol)
      if (!tick || tick.isSimulated) return false
      setState({ status: 'live', price: tick.price, symbol, receivedAt: getLastReceivedAt(symbol) })
      return true
    }
    const source = getLiveTickSource()
    if (!read()) {
      setState(
        source
          ? { status: 'loading', price: null, symbol }
          : { status: 'error', price: null, symbol, message: 'Live market data is not connected.' },
      )
    }
    if (!source) return
    source.ensureSubscribed(symbol)
    void source.loadRecent(symbol, 1).catch(() => undefined)
    const off = subscribeTickBuffer(symbol, () => {
      read()
    })
    const timer = window.setTimeout(() => {
      if (!getLatestBufferedTick(symbol)) {
        setState({ status: 'error', price: null, symbol, message: `No live quote received for ${symbol}. Try again.` })
      }
    }, QUOTE_TIMEOUT_MS)
    return () => {
      off()
      window.clearTimeout(timer)
    }
  }, [symbol])
  return state
}
