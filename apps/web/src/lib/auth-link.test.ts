import { describe, expect, it } from 'vitest'
import { mergeAuthLinks, parseAuthCallback, plainAuthMessage } from '@/lib/auth-link'

describe('parseAuthCallback', () => {
  it('reads a recovery token hash', () => {
    const link = parseAuthCallback(
      'https://optionmarkettraders.com/reset-password?token_hash=abc&type=recovery',
    )
    expect(link.purpose).toBe('recovery')
    expect(link.tokenHash).toBe('abc')
    expect(link.otpType).toBe('recovery')
  })

  it('reads a PKCE code and an implicit grant hash', () => {
    expect(parseAuthCallback('https://optionmarkettraders.com/auth/confirm?code=xyz').code).toBe('xyz')
    const implicit = parseAuthCallback(
      'https://optionmarkettraders.com/reset-password#access_token=a&refresh_token=b&type=recovery',
    )
    expect(implicit.hasImplicitGrant).toBe(true)
    expect(implicit.purpose).toBe('recovery')
  })

  it('keeps a captured hash after the client clears it', () => {
    const saved = parseAuthCallback(
      'https://optionmarkettraders.com/auth/confirm#access_token=a&refresh_token=b&type=signup',
    )
    const live = parseAuthCallback('https://optionmarkettraders.com/auth/confirm')
    const merged = mergeAuthLinks(saved, live)
    expect(merged.hasImplicitGrant).toBe(true)
    expect(merged.purpose).toBe('confirm')
  })

  it('reads an expired-link error from the hash', () => {
    const link = parseAuthCallback(
      'https://optionmarkettraders.com/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    )
    expect(link.errorCode).toBe('otp_expired')
    expect(plainAuthMessage(link.errorDescription ?? '')).toBe(
      'This link has expired or was already used. Request a new one.',
    )
  })
})

describe('plainAuthMessage', () => {
  it('keeps unknown errors and maps the auth cases people hit', () => {
    expect(plainAuthMessage('Email not confirmed')).toBe(
      'Email not confirmed. Open the link in your inbox, or resend the confirmation email.',
    )
    expect(plainAuthMessage('User already registered')).toMatch(/already exists/)
    expect(plainAuthMessage('Invalid login credentials')).toBe('Email or password is incorrect.')
    expect(plainAuthMessage('Password should be at least 6 characters.')).toBe(
      'Password should be at least 6 characters.',
    )
    expect(plainAuthMessage('Password is known to be weak and easy to guess')).toMatch(/too weak/)
    expect(plainAuthMessage('For security purposes, you can only request this once every 60 seconds')).toMatch(
      /Wait a minute/,
    )
    expect(plainAuthMessage('Something unexpected from the server')).toBe('Something unexpected from the server')
  })
})
