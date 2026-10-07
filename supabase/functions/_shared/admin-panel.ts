// Pure superadmin-panel metrics shared by the web app and the admin-panel Edge Function.
// supabase/functions/_shared/admin-panel.ts must stay byte-identical to this file
// (enforced by admin-panel.test.ts).
//
// Read-only maths. Nothing here inserts, updates, or moves money.
// Periods are calendar periods in Nairobi time (UTC+3, no daylight saving); weeks start on Monday.

export const PANEL_TZ_OFFSET_MINUTES = 180
export const SIMULATED_STARTING_BALANCE = 10_000

export interface DatedAmount {
  at: string
  usd: number | null
}

export interface PeriodTotal {
  count: number
  usd: number
}

export interface PeriodSummary {
  total: PeriodTotal
  today: PeriodTotal
  week: PeriodTotal
  month: PeriodTotal
}

export interface SeriesPoint {
  label: string
  start: string
  count: number
  usd: number
}

export interface PeriodSeries {
  daily: SeriesPoint[]
  weekly: SeriesPoint[]
  monthly: SeriesPoint[]
}

const DAY_MS = 86_400_000

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** USD → KES at the given rate; null when the rate is missing or invalid. */
export function usdToKesAt(usd: number, kesPerUsd: number | null | undefined): number | null {
  if (kesPerUsd == null || !Number.isFinite(kesPerUsd) || kesPerUsd <= 0) return null
  return roundMoney(usd * kesPerUsd)
}

function localMs(ms: number, offsetMinutes: number): number {
  return ms + offsetMinutes * 60_000
}

/** UTC instant at which the local calendar day containing `ms` starts. */
export function startOfLocalDay(ms: number, offsetMinutes = PANEL_TZ_OFFSET_MINUTES): number {
  const local = localMs(ms, offsetMinutes)
  return local - (((local % DAY_MS) + DAY_MS) % DAY_MS) - offsetMinutes * 60_000
}

/** UTC instant at which the local Monday-based week containing `ms` starts. */
export function startOfLocalWeek(ms: number, offsetMinutes = PANEL_TZ_OFFSET_MINUTES): number {
  const day = startOfLocalDay(ms, offsetMinutes)
  const weekday = new Date(localMs(day, offsetMinutes)).getUTCDay()
  const sinceMonday = (weekday + 6) % 7
  return day - sinceMonday * DAY_MS
}

/** UTC instant at which the local calendar month containing `ms` starts, shifted by `monthDelta`. */
export function startOfLocalMonth(ms: number, offsetMinutes = PANEL_TZ_OFFSET_MINUTES, monthDelta = 0): number {
  const local = new Date(localMs(ms, offsetMinutes))
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + monthDelta, 1) - offsetMinutes * 60_000
}

function parsed(items: readonly DatedAmount[]): { ms: number; usd: number }[] {
  const out: { ms: number; usd: number }[] = []
  for (const item of items) {
    const ms = Date.parse(item.at)
    if (!Number.isFinite(ms)) continue
    out.push({ ms, usd: item.usd != null && Number.isFinite(item.usd) ? item.usd : 0 })
  }
  return out
}

function totalSince(rows: { ms: number; usd: number }[], from: number, to = Number.POSITIVE_INFINITY): PeriodTotal {
  let count = 0
  let usd = 0
  for (const row of rows) {
    if (row.ms < from || row.ms >= to) continue
    count += 1
    usd += row.usd
  }
  return { count, usd: roundMoney(usd) }
}

/** All-time, today, this week (Mon–), and this month totals. Rows with usd = null count with $0. */
export function summarizePeriods(items: readonly DatedAmount[], now: number, offsetMinutes = PANEL_TZ_OFFSET_MINUTES): PeriodSummary {
  const rows = parsed(items)
  return {
    total: totalSince(rows, Number.NEGATIVE_INFINITY),
    today: totalSince(rows, startOfLocalDay(now, offsetMinutes)),
    week: totalSince(rows, startOfLocalWeek(now, offsetMinutes)),
    month: totalSince(rows, startOfLocalMonth(now, offsetMinutes)),
  }
}

function isoDay(ms: number, offsetMinutes: number): string {
  return new Date(localMs(ms, offsetMinutes)).toISOString().slice(0, 10)
}

/** Oldest-first buckets: `days` days, `weeks` Monday weeks, `months` calendar months, ending with the current one. */
export function periodSeries(
  items: readonly DatedAmount[],
  now: number,
  options: { days?: number; weeks?: number; months?: number; offsetMinutes?: number } = {},
): PeriodSeries {
  const offset = options.offsetMinutes ?? PANEL_TZ_OFFSET_MINUTES
  const rows = parsed(items)
  const daily: SeriesPoint[] = []
  const today = startOfLocalDay(now, offset)
  for (let i = (options.days ?? 14) - 1; i >= 0; i--) {
    const start = today - i * DAY_MS
    daily.push({ label: isoDay(start, offset).slice(5), start: new Date(start).toISOString(), ...totalSince(rows, start, start + DAY_MS) })
  }
  const weekly: SeriesPoint[] = []
  const week = startOfLocalWeek(now, offset)
  for (let i = (options.weeks ?? 8) - 1; i >= 0; i--) {
    const start = week - i * 7 * DAY_MS
    weekly.push({ label: `Wk ${isoDay(start, offset).slice(5)}`, start: new Date(start).toISOString(), ...totalSince(rows, start, start + 7 * DAY_MS) })
  }
  const monthly: SeriesPoint[] = []
  for (let i = (options.months ?? 6) - 1; i >= 0; i--) {
    const start = startOfLocalMonth(now, offset, -i)
    const end = startOfLocalMonth(now, offset, -i + 1)
    monthly.push({ label: isoDay(start, offset).slice(0, 7), start: new Date(start).toISOString(), ...totalSince(rows, start, end) })
  }
  return { daily, weekly, monthly }
}

/** Win rate as stored (0..1). Rejects anything outside the range instead of clamping. */
export function parseWinRate(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n < 0 || n > 1) return null
  return Math.round(n * 10_000) / 10_000
}

/** Effective simulated win rate: per-user override, then global, then the fallback. */
export function effectiveWinRate(override: unknown, global: unknown, fallback: number): number {
  return parseWinRate(override) ?? parseWinRate(global) ?? fallback
}
