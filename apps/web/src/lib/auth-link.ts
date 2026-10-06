const EMAIL_OTP_TYPES = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email'] as const

export type EmailOtpTypeName = (typeof EMAIL_OTP_TYPES)[number]
export type AuthLinkPurpose = 'confirm' | 'recovery'

export type ParsedAuthLink = {
  purpose: AuthLinkPurpose | null
  code: string | null
  tokenHash: string | null
  otpType: EmailOtpTypeName | null
  error: string | null
  errorCode: string | null
  errorDescription: string | null
  hasImplicitGrant: boolean
}

export const NO_EMAIL_LINK_MESSAGE = 'No email link was opened on this page.'

const EMPTY_LINK: ParsedAuthLink = {
  purpose: null,
  code: null,
  tokenHash: null,
  otpType: null,
  error: null,
  errorCode: null,
  errorDescription: null,
  hasImplicitGrant: false,
}

function isEmailOtpType(value: string | null): value is EmailOtpTypeName {
  return Boolean(value && (EMAIL_OTP_TYPES as readonly string[]).includes(value))
}

function purposeFor(type: EmailOtpTypeName | null): AuthLinkPurpose | null {
  if (type === 'recovery') return 'recovery'
  if (type) return 'confirm'
  return null
}

function readParams(raw: string): URLSearchParams {
  const text = raw.startsWith('#') || raw.startsWith('?') ? raw.slice(1) : raw
  return new URLSearchParams(text)
}

/** Read confirmation and recovery parameters from a full URL, including the hash. */
export function parseAuthCallback(href: string): ParsedAuthLink {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return EMPTY_LINK
  }
  const search = url.searchParams
  const hash = readParams(url.hash)
  const pick = (key: string) => {
    const value = search.get(key) ?? hash.get(key)
    const trimmed = value?.trim() ?? ''
    return trimmed ? trimmed : null
  }
  const otpTypeRaw = pick('type')
  const otpType = isEmailOtpType(otpTypeRaw) ? otpTypeRaw : null
  const accessToken = pick('access_token')
  const refreshToken = pick('refresh_token')
  return {
    purpose: purposeFor(otpType),
    code: pick('code'),
    tokenHash: pick('token_hash'),
    otpType,
    error: pick('error'),
    errorCode: pick('error_code'),
    errorDescription: pick('error_description'),
    hasImplicitGrant: Boolean(accessToken && refreshToken),
  }
}

export function authLinkHasAction(link: ParsedAuthLink | null): boolean {
  if (!link) return false
  return Boolean(
    link.error ||
      link.errorCode ||
      link.errorDescription ||
      link.code ||
      link.tokenHash ||
      link.hasImplicitGrant,
  )
}

function prefer(primary: string | null, fallback: string | null): string | null {
  return primary ?? fallback
}

/** Keep the first captured link if the client later strips the hash. */
export function mergeAuthLinks(saved: ParsedAuthLink | null, live: ParsedAuthLink | null): ParsedAuthLink {
  if (!saved) return live ?? EMPTY_LINK
  if (!live) return saved
  const otpType = live.otpType ?? saved.otpType
  return {
    purpose: purposeFor(otpType),
    code: prefer(live.code, saved.code),
    tokenHash: prefer(live.tokenHash, saved.tokenHash),
    otpType,
    error: prefer(live.error, saved.error),
    errorCode: prefer(live.errorCode, saved.errorCode),
    errorDescription: prefer(live.errorDescription, saved.errorDescription),
    hasImplicitGrant: live.hasImplicitGrant || saved.hasImplicitGrant,
  }
}

/**
 * Turn Supabase auth errors into short, accurate sentences.
 * Unknown messages are returned unchanged.
 */
export function plainAuthMessage(raw: string): string {
  const text = raw.replace(/\+/g, ' ').trim()
  if (!text) return 'Something went wrong. Try again.'
  const lower = text.toLowerCase()

  if (lower.includes('email not confirmed') || lower.includes('email_not_confirmed')) {
    return 'Email not confirmed. Open the link in your inbox, or resend the confirmation email.'
  }
  if (
    lower.includes('user already registered') ||
    lower.includes('already been registered') ||
    lower.includes('already registered')
  ) {
    return 'An account with this email already exists. Log in, or reset the password.'
  }
  if (lower.includes('invalid login credentials')) {
    return 'Email or password is incorrect.'
  }
  if (
    lower.includes('already been used') ||
    lower.includes('already used') ||
    lower.includes('already confirmed')
  ) {
    return 'This link was already used. Sign in, or request a new one.'
  }
  if (
    lower.includes('otp_expired') ||
    lower.includes('email link is invalid') ||
    lower.includes('token has expired') ||
    lower.includes('link is invalid or has expired') ||
    (lower.includes('expired') && (lower.includes('link') || lower.includes('token') || lower.includes('otp')))
  ) {
    return 'This link has expired or was already used. Request a new one.'
  }
  if (
    lower.includes('weak') ||
    lower.includes('pwned') ||
    lower.includes('easy to guess') ||
    lower.includes('known to be weak')
  ) {
    return 'That password is too weak. Use at least 8 characters you do not use elsewhere.'
  }
  if (
    lower.includes('rate limit') ||
    lower.includes('only request this') ||
    lower.includes('over_request_rate_limit') ||
    lower.includes('email rate limit')
  ) {
    return 'Too many emails were requested. Wait a minute and try again.'
  }
  if (lower.includes('code verifier') || lower.includes('pkce') || lower.includes('auth code')) {
    return 'This link could not be verified in this browser. Request a new one and open it here.'
  }
  if (lower.includes('auth session missing') || lower.includes('session missing')) {
    return 'This reset link is missing or has expired. Request a new one.'
  }
  return text
}

let captured: ParsedAuthLink | null = null

export function rememberAuthCallback(href: string) {
  const parsed = parseAuthCallback(href)
  if (authLinkHasAction(parsed)) captured = parsed
}

export function peekAuthCallback(): ParsedAuthLink | null {
  return captured
}

export function currentAuthLink(href: string | null): ParsedAuthLink {
  const live = href ? parseAuthCallback(href) : null
  return mergeAuthLinks(captured, live)
}

/** Drop token, code, and error parameters after they have been handled. */
export function clearAuthCallbackFromLocation() {
  captured = null
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  for (const key of ['token_hash', 'type', 'code', 'error', 'error_code', 'error_description', 'access_token', 'refresh_token', 'expires_in', 'expires_at', 'token_type']) {
    url.searchParams.delete(key)
  }
  const search = url.searchParams.toString()
  window.history.replaceState(window.history.state, '', `${url.pathname}${search ? `?${search}` : ''}`)
}

if (typeof window !== 'undefined') {
  rememberAuthCallback(window.location.href)
}
