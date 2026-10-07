import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({
  state: { user: null as null | { id: string; email: string; role: string }, isSignedIn: false, loading: false },
}))
const access = vi.hoisted(() => ({
  state: { level: null as null | 'superadmin' | 'staff' | 'none', loading: false },
  calls: [] as Array<[boolean, string | null]>,
}))

vi.mock('@/hooks/useAuth', () => ({ useAuthSession: () => auth.state }))
vi.mock('@/hooks/useAdminAccess', () => ({
  useAdminAccess: (enabled: boolean, userId: string | null) => {
    access.calls.push([enabled, userId])
    return enabled ? access.state : { level: null, loading: false }
  },
}))
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    Navigate: ({ to }: { to: string }) => createElement('div', { 'data-redirect': to }),
  }
})

import { RequireAdmin, RequireSuperadmin, adminGuardDecision } from '@/components/RequireAdmin'
import { adminPanelService } from '@/services/admin-panel'

const SECRET = 'ADMIN-DATA'

function render(children: ReactElement = createElement('p', null, SECRET)): string {
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/admin'] }, createElement(RequireAdmin, null, children)))
}

const superadminEmail = { id: 'u-1', email: 'sonshasopunga@gmail.com', role: 'superadmin' }

beforeEach(() => {
  auth.state = { user: null, isSignedIn: false, loading: false }
  access.state = { level: null, loading: false }
  access.calls = []
})

describe('adminGuardDecision', () => {
  it('waits for auth, sends signed-out users to login, and only allows server-approved levels', () => {
    expect(adminGuardDecision({ authLoading: true, isSignedIn: false, accessLoading: false, level: null })).toBe('loading')
    expect(adminGuardDecision({ authLoading: false, isSignedIn: false, accessLoading: false, level: 'superadmin' })).toBe('login')
    expect(adminGuardDecision({ authLoading: false, isSignedIn: true, accessLoading: true, level: null })).toBe('loading')
    expect(adminGuardDecision({ authLoading: false, isSignedIn: true, accessLoading: false, level: 'none' })).toBe('deny')
    expect(adminGuardDecision({ authLoading: false, isSignedIn: true, accessLoading: false, level: null })).toBe('deny')
    expect(adminGuardDecision({ authLoading: false, isSignedIn: true, accessLoading: false, level: 'staff' })).toBe('allow')
    expect(adminGuardDecision({ authLoading: false, isSignedIn: true, accessLoading: false, level: 'superadmin' })).toBe('allow')
  })
})

describe('RequireAdmin', () => {
  it('redirects signed-out visitors to /login without asking the server', () => {
    const html = render()
    expect(html).toContain('data-redirect="/login"')
    expect(html).not.toContain(SECRET)
    expect(access.calls.every(([enabled]) => enabled === false)).toBe(true)
  })

  it('shows a loader (no admin content) while auth or the access check is pending', () => {
    auth.state = { user: null, isSignedIn: false, loading: true }
    expect(render()).not.toContain(SECRET)
    auth.state = { user: superadminEmail, isSignedIn: true, loading: false }
    access.state = { level: null, loading: true }
    const html = render()
    expect(html).toContain('admin-guard-loading')
    expect(html).not.toContain(SECRET)
  })

  it('denies a signed-in non-admin and redirects to the trade screen', () => {
    auth.state = { user: { id: 'u-2', email: 'trader@example.com', role: 'trader' }, isSignedIn: true, loading: false }
    access.state = { level: 'none', loading: false }
    const html = render()
    expect(html).toContain('data-redirect="/app/trade"')
    expect(html).not.toContain(SECRET)
  })

  it('does not trust the client email or role: the server level decides', () => {
    auth.state = { user: superadminEmail, isSignedIn: true, loading: false }
    access.state = { level: 'none', loading: false }
    expect(render()).not.toContain(SECRET)
  })

  it('renders admin content when the server says superadmin', () => {
    auth.state = { user: superadminEmail, isSignedIn: true, loading: false }
    access.state = { level: 'superadmin', loading: false }
    expect(render()).toContain(SECRET)
    expect(access.calls.at(-1)).toEqual([true, 'u-1'])
  })

  it('lets staff into /admin but blocks superadmin-only sections with a 403', () => {
    auth.state = { user: { id: 'u-3', email: 'finance@example.com', role: 'finance' }, isSignedIn: true, loading: false }
    access.state = { level: 'staff', loading: false }
    const html = render(createElement(RequireSuperadmin, null, createElement('p', null, SECRET)))
    expect(html).toContain('admin-forbidden')
    expect(html).not.toContain(SECRET)
    access.state = { level: 'superadmin', loading: false }
    expect(render(createElement(RequireSuperadmin, null, createElement('p', null, SECRET)))).toContain(SECRET)
  })
})

describe('adminPanelService.accessLevel', () => {
  it('fails closed when Supabase is not available', async () => {
    await expect(adminPanelService.accessLevel()).resolves.toBe('none')
  })
})
