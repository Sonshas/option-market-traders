import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn(() => Promise.resolve({ data: { ok: true }, error: null }))
vi.mock('@/lib/supabase', () => ({ getSupabase: () => ({ functions: { invoke } }) }))

const { edgeErrorMessage, reportBackendIssue } = await import('./system-issues')

function edgeError(status: number, body: unknown) {
  return { context: new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }) }
}

describe('edgeErrorMessage', () => {
  beforeEach(() => invoke.mockClear())

  it('passes 4xx business messages through without reporting', async () => {
    const text = await edgeErrorMessage(edgeError(400, { error: 'Insufficient balance' }), 'Unavailable', {
      area: 'trading',
      operation: 'edge.test_4xx',
    })
    expect(text).toBe('Insufficient balance')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('hides 5xx details from users and reports them for staff', async () => {
    const text = await edgeErrorMessage(
      edgeError(500, { error: 'relation "public.wallets" does not exist' }),
      'Unavailable',
      { area: 'trading', operation: 'edge.test_5xx' },
    )
    expect(text).toBe('Unavailable')
    expect(invoke).toHaveBeenCalledTimes(1)
    const [, options] = invoke.mock.calls[0] as unknown as [string, { body: Record<string, unknown> }]
    expect(options.body).toMatchObject({ action: 'report', area: 'trading', operation: 'edge.test_5xx', code: '500' })
  })

  it('treats network failures (no response) as backend issues', async () => {
    const text = await edgeErrorMessage(new Error('Failed to fetch'), 'Unavailable', {
      area: 'trading',
      operation: 'edge.test_network',
    })
    expect(text).toBe('Unavailable')
    expect(invoke).toHaveBeenCalledTimes(1)
  })
})

describe('reportBackendIssue', () => {
  beforeEach(() => invoke.mockClear())

  it('throttles repeats of the same failure', () => {
    reportBackendIssue('wallet', 'wallets.throttle', { code: '42P01', message: 'missing' })
    reportBackendIssue('wallet', 'wallets.throttle', { code: '42P01', message: 'missing' })
    expect(invoke).toHaveBeenCalledTimes(1)
  })
})
