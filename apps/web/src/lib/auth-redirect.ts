export const TRADE_ROUTE = '/app/trade'
export const DASHBOARD_ROUTE = '/app/dashboard'
export const CONFIRM_EMAIL_ROUTE = '/auth/confirm'
export const RESET_PASSWORD_ROUTE = '/reset-password'

function originBase(origin: string): string {
  return origin.replace(/\/+$/, '')
}

/** Where signup and resend confirmation emails should return. */
export function confirmEmailRedirectUrl(origin: string): string {
  return `${originBase(origin)}${CONFIRM_EMAIL_ROUTE}`
}

/** Where password-recovery emails should return. */
export function resetPasswordRedirectUrl(origin: string): string {
  return `${originBase(origin)}${RESET_PASSWORD_ROUTE}`
}

/** Only same-origin app paths are honoured; anything else falls back to the trade desk. */
function safeAppPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const path = value.trim()
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return null
  const bare = path.split(/[?#]/)[0] ?? ''
  if (bare === '/login' || bare === '/signup' || bare === '/register') return null
  return path
}

/**
 * Where to send a user after login: a protected-route `redirect` query param or
 * `from` router state wins, otherwise the trade desk.
 */
export function resolvePostAuthPath(search: string, state: unknown): string {
  const params = new URLSearchParams(search)
  const fromQuery = safeAppPath(params.get('redirect')) ?? safeAppPath(params.get('from'))
  if (fromQuery) return fromQuery
  if (state && typeof state === 'object' && 'from' in state) {
    const fromState = safeAppPath((state as { from?: unknown }).from)
    if (fromState) return fromState
  }
  return TRADE_ROUTE
}

export function tradeRedirectUrl(origin: string): string {
  return `${origin}${TRADE_ROUTE}`
}
