import { describe, expect, it } from 'vitest'
import {
  CONFIRM_EMAIL_ROUTE,
  RESET_PASSWORD_ROUTE,
  TRADE_ROUTE,
  confirmEmailRedirectUrl,
  resetPasswordRedirectUrl,
  resolvePostAuthPath,
  tradeRedirectUrl,
} from '@/lib/auth-redirect'

describe('resolvePostAuthPath', () => {
  it('defaults to the trade route', () => {
    expect(resolvePostAuthPath('', null)).toBe(TRADE_ROUTE)
    expect(resolvePostAuthPath('', {})).toBe(TRADE_ROUTE)
  })

  it('honours a redirect query param', () => {
    expect(resolvePostAuthPath('?redirect=%2Fapp%2Fwallet', null)).toBe('/app/wallet')
  })

  it('honours protected-route from state', () => {
    expect(resolvePostAuthPath('', { from: '/app/history?x=1' })).toBe('/app/history?x=1')
  })

  it('rejects off-site and auth-page targets', () => {
    expect(resolvePostAuthPath('?redirect=https://evil.example', null)).toBe(TRADE_ROUTE)
    expect(resolvePostAuthPath('?redirect=//evil.example', null)).toBe(TRADE_ROUTE)
    expect(resolvePostAuthPath('', { from: '/login' })).toBe(TRADE_ROUTE)
  })

  it('builds the email confirmation redirect on the current origin', () => {
    expect(tradeRedirectUrl('https://optionmarkettraders.com')).toBe('https://optionmarkettraders.com/app/trade')
    expect(confirmEmailRedirectUrl('https://optionmarkettraders.com/')).toBe(
      `https://optionmarkettraders.com${CONFIRM_EMAIL_ROUTE}`,
    )
    expect(resetPasswordRedirectUrl('https://optionmarkettraders.com')).toBe(
      `https://optionmarkettraders.com${RESET_PASSWORD_ROUTE}`,
    )
  })
})
