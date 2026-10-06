import { useMemo } from 'react'
import { Badge } from '@/components/ui'
import { cn } from '@/lib/cn'
import { buildMarketSections } from '@/domain/market-sections'
import { useMarketFavorites } from '@/hooks/useMarketFavorites'
import type { Market } from '@/types'

function liveBadge(market: Market | null): { tone: 'signal' | 'warn' | 'demo'; label: string } {
  if (!market) return { tone: 'warn', label: 'OFFLINE' }
  if (market.isSimulated) return { tone: 'demo', label: 'DEMO' }
  if (market.priceStatus === 'live') return { tone: 'signal', label: 'LIVE' }
  if (market.priceStatus === 'connecting' || market.priceStatus === 'reconnecting') return { tone: 'warn', label: 'CONNECTING' }
  return { tone: 'warn', label: market.lastPrice != null ? 'DELAYED' : 'OFFLINE' }
}

/** Compact market picker for the chart toolbar, grouped by section (Favorites first). */
export function MarketSelect({
  markets,
  selected,
  onSelect,
}: {
  markets: Market[]
  selected: string
  onSelect: (symbol: string) => void
}) {
  const { favorites, toggle } = useMarketFavorites()
  const sections = useMemo(() => buildMarketSections(markets, favorites), [markets, favorites])
  const current = markets.find((market) => market.symbol === selected) ?? null
  const badge = liveBadge(current)
  const isFavorite = favorites.includes(selected)

  return (
    <div className="flex min-w-0 shrink-0 items-center gap-1.5" data-testid="market-select">
      <Badge tone={badge.tone}>{badge.label}</Badge>
      <label className="min-w-0">
        <span className="sr-only">Market</span>
        <select
          value={selected}
          onChange={(event) => onSelect(event.target.value)}
          aria-label="Market"
          title={current?.displayName}
          className="h-8 w-[min(15rem,52vw)] truncate rounded-lg border border-line bg-ink-2 px-2 text-sm font-semibold text-paper outline-none focus:border-signal focus:ring-2 focus:ring-signal/25"
        >
          {markets.length === 0 ? <option value={selected}>{selected || 'Loading markets…'}</option> : null}
          {sections.map((section) =>
            section.items.length === 0 ? null : (
              <optgroup key={section.id} label={section.label}>
                {section.items.map((market) => (
                  <option key={`${section.id}-${market.symbol}`} value={market.symbol}>
                    {market.displayName}
                  </option>
                ))}
              </optgroup>
            ),
          )}
        </select>
      </label>
      <button
        type="button"
        aria-pressed={isFavorite}
        aria-label={isFavorite ? `Remove ${selected} from favorites` : `Add ${selected} to favorites`}
        onClick={() => selected && toggle(selected)}
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line text-sm',
          isFavorite ? 'text-amber' : 'text-mist hover:text-paper',
        )}
      >
        ★
      </button>
    </div>
  )
}
