import { describe, expect, it } from 'vitest'
import webSource from './megapay.ts?raw'
import denoSource from '../../../../supabase/functions/_shared/megapay.ts?raw'
import {
  classifyMegapayStatus,
  decideWebhookRoute,
  extractWebhookFields,
  generateDepositReference,
  isDepositReference,
  isOmtReference,
  kesToUsd,
  maskPhone,
  normalizeKenyanPhone,
  parseMegapayConfig,
  validateAmountKes,
} from '@/domain/megapay'

describe('normalizeKenyanPhone', () => {
  it.each([
    ['0712345678', '254712345678'],
    ['0112345678', '254112345678'],
    ['712345678', '254712345678'],
    ['112345678', '254112345678'],
    ['+254712345678', '254712345678'],
    ['254712345678', '254712345678'],
    ['254112345678', '254112345678'],
    ['+254 712 345 678', '254712345678'],
    ['0712-345-678', '254712345678'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeKenyanPhone(input)).toBe(expected)
  })

  it.each(['', '0812345678', '071234567', '07123456789', '+15550001111', '2547123456', 'abc0712345678', '255712345678'])(
    'rejects %s',
    (input) => {
      expect(normalizeKenyanPhone(input)).toBeNull()
    },
  )

  it('masks the middle digits', () => {
    expect(maskPhone('254712345678')).toBe('254712***678')
  })
})

describe('kesToUsd', () => {
  it('converts at the default rate and rounds to cents', () => {
    expect(kesToUsd(130, 130)).toBe(1)
    expect(kesToUsd(10, 130)).toBe(0.08)
    expect(kesToUsd(100, 130)).toBe(0.77)
    expect(kesToUsd(1000, 130)).toBe(7.69)
    expect(kesToUsd(150_000, 130)).toBe(1153.85)
  })

  it('rounds half-up like Postgres numeric round', () => {
    expect(kesToUsd(1, 200)).toBe(0.01) // 0.005
    expect(kesToUsd(201, 100)).toBe(2.01)
    expect(kesToUsd(10, 128.5)).toBe(0.08)
  })

  it('returns 0 for invalid input', () => {
    expect(kesToUsd(0, 130)).toBe(0)
    expect(kesToUsd(100, 0)).toBe(0)
  })
})

describe('config + amount validation', () => {
  it('uses defaults when env is empty or invalid', () => {
    expect(parseMegapayConfig({})).toEqual({ kesPerUsd: 130, minKes: 1600, maxKes: 150_000 })
    expect(parseMegapayConfig({ KES_PER_USD: 'abc', MEGAPAY_MIN_KES: '-5', MEGAPAY_MAX_KES: '' })).toEqual({
      kesPerUsd: 130,
      minKes: 1600,
      maxKes: 150_000,
    })
  })

  it('reads overrides', () => {
    expect(parseMegapayConfig({ KES_PER_USD: '129.5', MEGAPAY_MIN_KES: '50', MEGAPAY_MAX_KES: '70000' })).toEqual({
      kesPerUsd: 129.5,
      minKes: 50,
      maxKes: 70_000,
    })
  })

  it('validates whole KES amounts within limits', () => {
    const config = parseMegapayConfig({})
    expect(validateAmountKes(1600, config)).toEqual({ ok: true, amountKes: 1600 })
    expect(validateAmountKes('5000', config)).toEqual({ ok: true, amountKes: 5000 })
    expect(validateAmountKes(1599, config).ok).toBe(false)
    expect(validateAmountKes(150_001, config).ok).toBe(false)
    expect(validateAmountKes(1600.5, config).ok).toBe(false)
    expect(validateAmountKes('abc', config).ok).toBe(false)
    expect(validateAmountKes(null, config).ok).toBe(false)
  })
})

describe('deposit reference', () => {
  it('is OMT- plus 8 unambiguous characters (12 chars total)', () => {
    for (let i = 0; i < 50; i++) {
      const ref = generateDepositReference()
      expect(ref).toHaveLength(12)
      expect(isDepositReference(ref)).toBe(true)
      expect(ref.slice(4)).not.toMatch(/[01IO]/)
    }
  })

  it('is deterministic for a given random source', () => {
    expect(generateDepositReference((length) => new Array<number>(length).fill(0))).toBe('OMT-AAAAAAAA')
  })
})

describe('webhook routing', () => {
  const omtPayload = { TransactionReference: 'OMT-ABCD2345', TransactionID: 'SOFTPID1', TransactionAmount: 10 }
  const vastPayload = { TransactionReference: '8803416', TransactionID: 'SOFTPID2', TransactionAmount: 100 }
  const omt = extractWebhookFields(omtPayload)
  const vast = extractWebhookFields(vastPayload)

  it('routes OMT references here', () => {
    expect(decideWebhookRoute(omtPayload, omt, false)).toBe('omt')
    const test = { TransactionReference: 'OMT-TEST-NONEXISTENT' }
    expect(decideWebhookRoute(test, extractWebhookFields(test), false)).toBe('omt')
  })

  it('routes a matching transaction id here even without an OMT reference', () => {
    expect(decideWebhookRoute(vastPayload, vast, true)).toBe('omt')
  })

  it('forwards other JSON objects to the other site', () => {
    expect(decideWebhookRoute(vastPayload, vast, false)).toBe('vast')
    expect(decideWebhookRoute({}, extractWebhookFields({}), false)).toBe('vast')
  })

  it('never forwards empty or non-JSON bodies', () => {
    expect(decideWebhookRoute(null, extractWebhookFields(null), false)).toBe('unknown')
    expect(decideWebhookRoute('text', extractWebhookFields('text'), false)).toBe('unknown')
    expect(decideWebhookRoute([vastPayload], extractWebhookFields([vastPayload]), false)).toBe('unknown')
  })

  it('extracts fields defensively', () => {
    expect(omt).toMatchObject({ reference: 'OMT-ABCD2345', transactionId: 'SOFTPID1', amountKes: 10 })
    expect(extractWebhookFields('x')).toMatchObject({ reference: null, transactionId: null, amountKes: null })
    expect(isOmtReference(' omt-abc ')).toBe(true)
    expect(isOmtReference(123)).toBe(false)
  })
})

describe('classifyMegapayStatus', () => {
  it('treats only Completed + code 0 as paid', () => {
    const paid = classifyMegapayStatus({
      ResultCode: '200',
      TransactionStatus: 'Completed',
      TransactionCode: '0',
      TransactionReceipt: 'SIS48OB9N4',
      TransactionAmount: '10',
      TransactionReference: 'OMT-ABCD2345',
    })
    expect(paid).toMatchObject({ outcome: 'completed', amountKes: 10, receipt: 'SIS48OB9N4', reference: 'OMT-ABCD2345' })
    expect(classifyMegapayStatus({ TransactionStatus: 'Completed', TransactionCode: '' }).outcome).toBe('pending')
  })

  it('detects cancellations and failures', () => {
    expect(classifyMegapayStatus({ TransactionStatus: 'Cancelled', TransactionCode: '1032' }).outcome).toBe('cancelled')
    expect(classifyMegapayStatus({ TransactionStatus: 'Failed', TransactionCode: '1' }).outcome).toBe('failed')
    expect(classifyMegapayStatus({ TransactionStatus: '', TransactionCode: '1037' }).outcome).toBe('failed')
  })

  it('keeps unknown or pending states pending', () => {
    expect(classifyMegapayStatus({ TransactionStatus: 'Pending', TransactionCode: '' }).outcome).toBe('pending')
    expect(classifyMegapayStatus({ TransactionStatus: 'Pending', TransactionCode: '1037' }).outcome).toBe('pending')
    expect(classifyMegapayStatus({}).outcome).toBe('pending')
    expect(classifyMegapayStatus(null).outcome).toBe('pending')
  })
})

describe('Edge Function copy', () => {
  it('supabase/functions/_shared/megapay.ts is identical to src/domain/megapay.ts', () => {
    expect(denoSource.length).toBeGreaterThan(1000)
    expect(denoSource.replace(/\r\n/g, '\n')).toBe(webSource.replace(/\r\n/g, '\n'))
  })
})
