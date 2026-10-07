import type { Session, User as AuthUser } from '@supabase/supabase-js'
import {
  clearDemoSession,
  findDemoCredential,
  getDemoSessionUser,
  loadDemoSession,
  saveDemoSession,
  subscribeDemoSession,
} from '@/lib/demo-session'
import {
  authLinkHasAction,
  clearAuthCallbackFromLocation,
  currentAuthLink,
  NO_EMAIL_LINK_MESSAGE,
  plainAuthMessage,
  type AuthLinkPurpose,
  type EmailOtpTypeName,
  type ParsedAuthLink,
} from '@/lib/auth-link'
import { confirmEmailRedirectUrl, resetPasswordRedirectUrl } from '@/lib/auth-redirect'
import { reportBackendIssue } from '@/services/system-issues'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase'
import { notConnected, okReal } from '@/providers/results'
import type { AccountStatus, KycStatus, ProviderResult, User, UserRole } from '@/types'

/** Local-only Playwright / verify-ui bypass. Never enable in production builds. */
export const e2eAuthBypassEnabled =
  import.meta.env.DEV && import.meta.env.VITE_E2E_AUTH_BYPASS === 'true'

export type AuthProfileExtras = {
  phone?: string
  country?: string
  timezone?: string
  displayName?: string
}

type PublicUserRow = {
  id: string
  email: string | null
  name: string | null
  role: string
  account_status: string
  live_trading_enabled: boolean
  kyc_status: string
  created_at: string
  updated_at: string
}

function authNotConfigured<T>(data: T, message?: string): ProviderResult<T> {
  return notConnected(
    data,
    message ??
      'Sign-in is temporarily unavailable. Please try again later.',
    'NOT_CONNECTED',
    'real',
  )
}

function mapRole(role: string | undefined): UserRole {
  const allowed: UserRole[] = ['trader', 'admin', 'support', 'finance', 'compliance', 'superadmin']
  if (role && (allowed as string[]).includes(role)) return role as UserRole
  return 'trader'
}

function mapAccountStatus(status: string | undefined): AccountStatus {
  if (status === 'suspended' || status === 'restricted' || status === 'active') return status
  return 'active'
}

function mapKyc(status: string | undefined): KycStatus {
  const allowed: KycStatus[] = ['not_started', 'pending', 'under_review', 'approved', 'rejected']
  if (status && (allowed as string[]).includes(status)) return status as KycStatus
  return 'not_started'
}

function userFromAuthOnly(authUser: AuthUser): User {
  const meta = authUser.user_metadata ?? {}
  const name =
    (typeof meta.name === 'string' && meta.name) ||
    (typeof meta.full_name === 'string' && meta.full_name) ||
    authUser.email?.split('@')[0] ||
    'Trader'
  const stamp = authUser.created_at ?? new Date().toISOString()
  return {
    id: authUser.id,
    email: authUser.email ?? '',
    name,
    role: 'trader',
    accountStatus: 'active',
    liveTradingEnabled: false,
    kycStatus: 'not_started',
    createdAt: stamp,
    updatedAt: stamp,
  }
}

function userFromPublicRow(row: PublicUserRow, fallbackEmail: string): User {
  return {
    id: row.id,
    email: row.email ?? fallbackEmail,
    name: row.name ?? fallbackEmail.split('@')[0] ?? 'Trader',
    role: mapRole(row.role),
    accountStatus: mapAccountStatus(row.account_status),
    liveTradingEnabled: Boolean(row.live_trading_enabled),
    kycStatus: mapKyc(row.kyc_status),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function hydrateUser(authUser: AuthUser): Promise<User> {
  const client = getSupabase()
  if (!client) return userFromAuthOnly(authUser)

  const { data, error } = await client
    .from('users')
    .select('id, email, name, role, account_status, live_trading_enabled, kyc_status, created_at, updated_at')
    .eq('id', authUser.id)
    .maybeSingle()

  if (error) reportBackendIssue('auth', 'users.profile', error)
  if (error || !data) {
    return userFromAuthOnly(authUser)
  }
  return userFromPublicRow(data as PublicUserRow, authUser.email ?? '')
}

async function resolveSessionUser(session: Session | null): Promise<User | null> {
  if (!session?.user) return null
  return hydrateUser(session.user)
}

function emailLinkKey(link: ParsedAuthLink): string {
  if (!authLinkHasAction(link)) return 'empty'
  return [link.tokenHash, link.code, link.errorCode, link.errorDescription, link.otpType, link.hasImplicitGrant ? 'implicit' : ''].join('|')
}

function linkFailure(message: string): ProviderResult<{ purpose: AuthLinkPurpose; hasSession: boolean } | null> {
  return notConnected(null, plainAuthMessage(message), 'VALIDATION', 'real')
}

function linkSuccess(
  purpose: AuthLinkPurpose,
  hasSession: boolean,
): ProviderResult<{ purpose: AuthLinkPurpose; hasSession: boolean } | null> {
  clearAuthCallbackFromLocation()
  const message =
    purpose === 'recovery'
      ? 'Reset link verified. Choose a new password.'
      : hasSession
        ? 'Email confirmed. You are signed in.'
        : 'Email confirmed. You can sign in.'
  return okReal({ purpose, hasSession }, message)
}

const emailLinkResults = new Map<
  string,
  Promise<ProviderResult<{ purpose: AuthLinkPurpose; hasSession: boolean } | null>>
>()

async function exchangeEmailLink(
  link: ParsedAuthLink,
): Promise<ProviderResult<{ purpose: AuthLinkPurpose; hasSession: boolean } | null>> {
  if (!authLinkHasAction(link)) {
    return {
      status: 'empty',
      connected: false,
      message: NO_EMAIL_LINK_MESSAGE,
      data: null,
      code: 'VALIDATION',
      accountMode: 'real',
      isSimulated: false,
    }
  }
  if (link.error || link.errorCode || link.errorDescription) {
    return linkFailure(link.errorDescription || link.error || link.errorCode || 'Auth error')
  }

  const client = getSupabase()!
  const purpose: AuthLinkPurpose = link.purpose === 'recovery' ? 'recovery' : 'confirm'

  if (link.tokenHash) {
    const otpType: EmailOtpTypeName | null = link.otpType
    if (!otpType) {
      return linkFailure('This link is missing or has expired. Request a new one.')
    }
    const { data, error } = await client.auth.verifyOtp({
      token_hash: link.tokenHash,
      type: otpType,
    })
    if (error) return linkFailure(error.message)
    return linkSuccess(purpose, Boolean(data.session))
  }

  if (link.code) {
    const codeStillInUrl =
      typeof window !== 'undefined' && new URL(window.location.href).searchParams.has('code')
    if (!codeStillInUrl) {
      const existing = await client.auth.getSession()
      if (existing.error) return linkFailure(existing.error.message)
      if (existing.data.session) {
        return linkSuccess(purpose, true)
      }
    }
    const { data, error } = await client.auth.exchangeCodeForSession(link.code)
    if (error) return linkFailure(error.message)
    return linkSuccess(purpose, Boolean(data.session))
  }

  if (link.hasImplicitGrant) {
    const { data, error } = await client.auth.getSession()
    if (error) return linkFailure(error.message)
    if (!data.session) {
      return linkFailure('This link has expired or was already used. Request a new one.')
    }
    return linkSuccess(purpose, true)
  }

  return linkFailure('This link is missing or has expired. Request a new one.')
}

/**
 * Supabase Auth service (REAL/production auth path).
 *
 * DEMO trading stays in the local demo-store after login — it does not write
 * simulated trades into REAL ledger/trade tables. Signup trigger creates both
 * demo and real accounts+wallets in Supabase; DEMO mode still simulates locally.
 */
export const authService = {
  async signIn(input: { email: string; password: string }): Promise<ProviderResult<User | null>> {
    if (e2eAuthBypassEnabled) {
      if (!input.email.trim() || input.password.length < 8) {
        return notConnected(null, 'Enter a valid email and a password of at least 8 characters.', 'VALIDATION', 'real')
      }
      const stored = findDemoCredential(input.email)
      if (stored && stored.password && stored.password !== input.password) {
        return notConnected(null, 'Incorrect password for this local E2E account.', 'VALIDATION', 'real')
      }
      saveDemoSession({
        email: input.email,
        name: stored?.name ?? input.email.split('@')[0] ?? 'E2E Trader',
        password: stored?.password || input.password,
        phone: stored?.phone,
        country: stored?.country,
      })
      return okReal(getDemoSessionUser(), 'E2E auth bypass session started (local only).')
    }
    if (!isSupabaseConfigured) return authNotConfigured(null)
    if (!input.email.trim() || input.password.length < 8) {
      return notConnected(
        null,
        'Enter a valid email and a password of at least 8 characters.',
        'VALIDATION',
        'real',
      )
    }
    const client = getSupabase()!
    const { data, error } = await client.auth.signInWithPassword({
      email: input.email.trim(),
      password: input.password,
    })
    if (error) {
      return notConnected(null, plainAuthMessage(error.message), 'VALIDATION', 'real')
    }
    const user = await resolveSessionUser(data.session)
    return okReal(user, `Signed in as ${user?.email ?? input.email}.`)
  },

  async signUp(input: {
    name: string
    email: string
    password: string
    phone?: string
    country?: string
  }): Promise<ProviderResult<User | null>> {
    if (e2eAuthBypassEnabled) {
      if (input.name.trim().length < 2 || !input.email.trim() || input.password.length < 8) {
        return notConnected(null, 'Name, email, and an 8+ character password are required.', 'VALIDATION', 'real')
      }
      const existing = findDemoCredential(input.email)
      if (existing) {
        return notConnected(null, 'A local E2E account with this email already exists. Log in instead.', 'VALIDATION', 'real')
      }
      saveDemoSession({
        email: input.email,
        name: input.name,
        password: input.password,
        phone: input.phone,
        country: input.country,
      })
      return okReal(getDemoSessionUser(), 'E2E auth bypass account created (local only).')
    }
    if (!isSupabaseConfigured) return authNotConfigured(null)
    if (input.name.trim().length < 2 || !input.email.trim() || input.password.length < 8) {
      return notConnected(
        null,
        'Name, email, and an 8+ character password are required.',
        'VALIDATION',
        'real',
      )
    }
    const client = getSupabase()!
    const emailRedirectTo =
      typeof window !== 'undefined' ? confirmEmailRedirectUrl(window.location.origin) : undefined
    const { data, error } = await client.auth.signUp({
      email: input.email.trim(),
      password: input.password,
      options: {
        emailRedirectTo,
        data: {
          name: input.name.trim(),
          phone: input.phone?.trim() || undefined,
          country: input.country?.trim() || undefined,
        },
      },
    })
    if (error) {
      return notConnected(null, plainAuthMessage(error.message), 'VALIDATION', 'real')
    }
    if (!data.session) {
      return {
        status: 'empty',
        connected: false,
        message:
          'Account created. Check your email and open the confirmation link to verify your account, then sign in.',
        data: null,
        code: 'VALIDATION',
        accountMode: 'real',
        isSimulated: false,
      }
    }
    const user = await resolveSessionUser(data.session)
    return okReal(
      user,
      `Account created for ${user?.email ?? input.email}. Demo/real wallets are provisioned by the signup trigger.`,
    )
  },

  async requestPasswordReset(email: string): Promise<ProviderResult<null>> {
    if (e2eAuthBypassEnabled) {
      return okReal(null, 'E2E bypass: password reset is simulated locally (no email sent).')
    }
    if (!isSupabaseConfigured) return authNotConfigured(null)
    if (!email.trim()) {
      return notConnected(null, 'Enter a valid email.', 'VALIDATION', 'real')
    }
    const client = getSupabase()!
    const redirectTo =
      typeof window !== 'undefined' ? resetPasswordRedirectUrl(window.location.origin) : undefined
    const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
      redirectTo,
    })
    if (error) {
      return notConnected(null, plainAuthMessage(error.message), 'VALIDATION', 'real')
    }
    return okReal(
      null,
      'If an account exists for that email, a password reset link has been sent.',
    )
  },

  /**
   * Exchange a confirmation or recovery link (token hash, PKCE code, or implicit hash).
   * Safe to call twice for the same link: the first result is reused.
   */
  async consumeEmailLink(): Promise<
    ProviderResult<{ purpose: AuthLinkPurpose; hasSession: boolean } | null>
  > {
    if (e2eAuthBypassEnabled) {
      return okReal(null, 'E2E bypass: email links are not exchanged.')
    }
    if (!isSupabaseConfigured) return authNotConfigured(null)
    const href = typeof window !== 'undefined' ? window.location.href : null
    const link = currentAuthLink(href)
    const key = emailLinkKey(link)
    const cached = emailLinkResults.get(key)
    if (cached) return cached
    const pending = exchangeEmailLink(link)
    if (key !== 'empty') emailLinkResults.set(key, pending)
    return pending
  },

  async updatePassword(password: string): Promise<ProviderResult<null>> {
    if (e2eAuthBypassEnabled) {
      return okReal(null, 'E2E bypass: password update is simulated locally.')
    }
    if (!isSupabaseConfigured) return authNotConfigured(null)
    if (password.length < 8) {
      return notConnected(null, 'Password must be at least 8 characters.', 'VALIDATION', 'real')
    }
    const client = getSupabase()!
    const { error } = await client.auth.updateUser({ password })
    if (error) {
      return notConnected(null, plainAuthMessage(error.message), 'VALIDATION', 'real')
    }
    return okReal(null, 'Password updated. You can sign in with the new password.')
  },

  async resendVerification(email: string): Promise<ProviderResult<null>> {
    if (e2eAuthBypassEnabled) {
      return okReal(null, 'E2E bypass: verification resend is simulated locally.')
    }
    if (!isSupabaseConfigured) return authNotConfigured(null)
    if (!email.trim()) {
      return notConnected(null, 'Enter a valid email.', 'VALIDATION', 'real')
    }
    const client = getSupabase()!
    const emailRedirectTo =
      typeof window !== 'undefined' ? confirmEmailRedirectUrl(window.location.origin) : undefined
    const { error } = await client.auth.resend({
      type: 'signup',
      email: email.trim(),
      options: { emailRedirectTo },
    })
    if (error) {
      return notConnected(null, plainAuthMessage(error.message), 'VALIDATION', 'real')
    }
    return okReal(null, 'Verification email resent if the address is pending confirmation.')
  },

  async verifyTwoFactor(_code: string): Promise<ProviderResult<null>> {
    return notConnected(
      null,
      'Authenticator 2FA is not enabled for this project yet. Screen is ready for a future TOTP wiring.',
      'NOT_CONNECTED',
      'real',
    )
  },

  async getSession(): Promise<ProviderResult<User | null>> {
    if (e2eAuthBypassEnabled) {
      const user = getDemoSessionUser()
      if (!user) {
        return {
          status: 'empty',
          connected: false,
          message: 'No E2E session.',
          data: null,
          accountMode: 'real',
          isSimulated: false,
        }
      }
      return okReal(user, `E2E bypass session active for ${user.email}.`)
    }
    if (!isSupabaseConfigured) return authNotConfigured(null)
    const client = getSupabase()!
    const { data, error } = await client.auth.getSession()
    if (error) {
      return notConnected(null, plainAuthMessage(error.message), 'NOT_CONNECTED', 'real')
    }
    const user = await resolveSessionUser(data.session)
    if (!user) {
      return {
        status: 'empty',
        connected: false,
        message: 'No active session. Sign in to continue.',
        data: null,
        accountMode: 'real',
        isSimulated: false,
      }
    }
    return okReal(user, `Session active for ${user.email}.`)
  },

  async signOut(): Promise<ProviderResult<null>> {
    if (e2eAuthBypassEnabled) {
      clearDemoSession()
      return okReal(null, 'E2E bypass session cleared.')
    }
    if (!isSupabaseConfigured) return authNotConfigured(null)
    const client = getSupabase()!
    const { error } = await client.auth.signOut()
    if (error) {
      return notConnected(null, plainAuthMessage(error.message), 'NOT_CONNECTED', 'real')
    }
    return okReal(null, 'Signed out. DEMO local practice data is unchanged.')
  },

  /** Profile extras from auth user_metadata + optional profiles row. */
  async getProfileExtras(): Promise<AuthProfileExtras> {
    if (e2eAuthBypassEnabled) {
      const session = loadDemoSession()
      return {
        phone: session?.phone,
        country: session?.country,
        displayName: session?.name,
        timezone: 'UTC',
      }
    }
    const client = getSupabase()
    if (!client) return {}
    const { data: sessionData } = await client.auth.getSession()
    const authUser = sessionData.session?.user
    if (!authUser) return {}
    const meta = authUser.user_metadata ?? {}
    const extras: AuthProfileExtras = {
      phone: typeof meta.phone === 'string' ? meta.phone : undefined,
      country: typeof meta.country === 'string' ? meta.country : undefined,
      displayName: typeof meta.name === 'string' ? meta.name : undefined,
    }
    const { data: profile } = await client
      .from('profiles')
      .select('display_name, timezone')
      .eq('user_id', authUser.id)
      .maybeSingle()
    if (profile) {
      extras.displayName = profile.display_name ?? extras.displayName
      extras.timezone = profile.timezone
    }
    return extras
  },

  /** Subscribe to auth state; returns unsubscribe. */
  onAuthStateChange(callback: (user: User | null) => void): () => void {
    if (e2eAuthBypassEnabled) {
      const emit = () => callback(getDemoSessionUser())
      emit()
      return subscribeDemoSession(emit)
    }
    const client = getSupabase()
    if (!client) {
      callback(null)
      return () => undefined
    }
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      void resolveSessionUser(session).then(callback)
    })
    return () => data.subscription.unsubscribe()
  },
}
