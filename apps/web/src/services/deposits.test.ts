import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: Array<{ name: string; method: string; body?: unknown }> = []
const responses = new Map<string, unknown>()

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  getSupabase: () => ({
    functions: {
      async invoke(name: string, options: { method: string; body?: unknown }) {
        calls.push({ name, method: options.method, body: options.body })
        const data = responses.get(`${options.method} ${name}`)
        return data ? { data, error: null } : { data: null, error: new Error('not found') }
      },
    },
  }),
}))

const { depositMethodLabel, depositService, resolveDepositProvider } = await import('@/services/deposits')

const megapayConfig = {
  enabled: true,
  kes_per_usd: 130,
  min_kes: 1600,
  max_kes: 150000,
  till: '5619444',
  account_name: 'option market traders phone mart',
  message: null,
}
const pending = {
  deposit_id: 'd1',
  reference: 'OMT-ABCD2345',
  status: 'PENDING',
  amount_usd: 12.31,
  amount_kes: 1600,
  receipt: null,
  failure_reason: null,
}

beforeEach(() => {
  calls.length = 0
  responses.clear()
})

describe('resolveDepositProvider', () => {
  it('defaults to megapay and only honours daraja when named', () => {
    expect(resolveDepositProvider({ provider: 'megapay' })).toBe('megapay')
    expect(resolveDepositProvider({ provider: 'daraja' })).toBe('daraja')
    expect(resolveDepositProvider({})).toBe('megapay')
    expect(resolveDepositProvider(null)).toBe('megapay')
  })

  it('labels Till for MegaPay and Paybill for Daraja', () => {
    expect(depositMethodLabel({ provider: 'megapay', till: '5619444', paybill: null })).toBe('M-Pesa (Till 5619444)')
    expect(depositMethodLabel({ provider: 'daraja', till: null, paybill: '4088285' })).toBe('M-Pesa (Paybill 4088285)')
    expect(depositMethodLabel({ provider: 'megapay', till: null, paybill: null })).toBe('M-Pesa')
  })
})

describe('depositService provider selection', () => {
  it('uses MegaPay functions for config, start and status', async () => {
    responses.set('GET megapay-deposit', megapayConfig)
    responses.set('POST megapay-deposit', pending)
    responses.set('POST megapay-status', { ...pending, status: 'COMPLETED', receipt: 'NLJ7RT61SV' })

    const config = await depositService.getConfig()
    expect(config).toEqual({
      ok: true,
      data: {
        provider: 'megapay',
        till: '5619444',
        paybill: null,
        enabled: true,
        kesPerUsd: 130,
        minKes: 1600,
        maxKes: 150000,
        accountName: 'option market traders phone mart',
        message: null,
      },
    })
    const started = await depositService.startDeposit('megapay', 1600, '254712345678')
    expect(started.ok && started.data.status).toBe('PENDING')
    const status = await depositService.checkStatus('megapay', 'd1')
    expect(status.ok && status.data.receipt).toBe('NLJ7RT61SV')
    expect(calls.map((c) => `${c.method} ${c.name}`)).toEqual([
      'GET megapay-deposit',
      'POST megapay-deposit',
      'POST megapay-status',
    ])
    expect(calls[1]!.body).toEqual({ amount_kes: 1600, phone: '254712345678' })
  })

  it('reports an error when the deposit config is unavailable', async () => {
    const config = await depositService.getConfig()
    expect(config.ok).toBe(false)
  })
})
