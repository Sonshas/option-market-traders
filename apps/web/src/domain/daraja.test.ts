import { describe, expect, it } from 'vitest'
import webSource from './daraja.ts?raw'
import denoSource from '../../../../supabase/functions/_shared/daraja.ts?raw'
import {
  DARAJA_EXPIRY_MS,
  accountReference,
  buildStkPushRequest,
  buildStkQueryRequest,
  classifyStkQuery,
  darajaBaseUrl,
  darajaPassword,
  darajaTimestamp,
  decideDarajaSettlement,
  parseDepositProvider,
  parseStkCallback,
  shouldQueryNow,
  type SettlementInput,
  type StkQueryClassification,
} from '@/domain/daraja'
import { normalizeKenyanPhone } from '@/domain/megapay'

// Public Daraja sandbox credentials from Safaricom's documentation (not our production values).
const SANDBOX_SHORTCODE = '174379'
const SANDBOX_PASSKEY = 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919'

function callback(resultCode: number | string, extra: Record<string, unknown> = {}, items?: Array<{ Name: string; Value?: unknown }>) {
  return {
    Body: {
      stkCallback: {
        MerchantRequestID: '29115-34620561-1',
        CheckoutRequestID: 'ws_CO_191220191020363925',
        ResultCode: resultCode,
        ResultDesc: 'desc',
        ...(items ? { CallbackMetadata: { Item: items } } : {}),
        ...extra,
      },
    },
  }
}

const PAID_ITEMS = [
  { Name: 'Amount', Value: 1600.0 },
  { Name: 'MpesaReceiptNumber', Value: 'NLJ7RT61SV' },
  { Name: 'Balance' },
  { Name: 'TransactionDate', Value: 20191219102115 },
  { Name: 'PhoneNumber', Value: 254712345678 },
]

describe('timestamp + password', () => {
  it('formats the timestamp in Africa/Nairobi time (UTC+3)', () => {
    expect(darajaTimestamp(new Date('2026-10-04T08:48:05Z'))).toBe('20261004114805')
    expect(darajaTimestamp(new Date('2026-10-04T21:30:05Z'))).toBe('20261005003005')
    expect(darajaTimestamp(new Date('2026-12-31T21:00:00Z'))).toBe('20270101000000')
    expect(darajaTimestamp(new Date('2026-02-28T22:59:59.999Z'))).toBe('20260301015959')
  })

  it('is base64(shortcode + passkey + timestamp), matching the Daraja docs example', () => {
    expect(darajaPassword(SANDBOX_SHORTCODE, SANDBOX_PASSKEY, '20160216165627')).toBe(
      'MTc0Mzc5YmZiMjc5ZjlhYTliZGJjZjE1OGU5N2RkNzFhNDY3Y2QyZTBjODkzMDU5YjEwZjc4ZTZiNzJhZGExZWQyYzkxOTIwMTYwMjE2MTY1NjI3',
    )
    expect(atob(darajaPassword('4088285', 'abc', '20261004114805'))).toBe('4088285abc20261004114805')
  })

  it('builds a Paybill STK push request', () => {
    const req = buildStkPushRequest({
      shortcode: '4088285',
      passkey: 'test-passkey',
      amountKes: 1600,
      msisdn: '254712345678',
      callbackUrl: 'https://optionmarkettraders.com/api/mpesa/callback',
      now: new Date('2026-10-04T08:48:05Z'),
    })
    expect(req).toEqual({
      BusinessShortCode: '4088285',
      Password: darajaPassword('4088285', 'test-passkey', '20261004114805'),
      Timestamp: '20261004114805',
      TransactionType: 'CustomerPayBillOnline',
      Amount: 1600,
      PartyA: '254712345678',
      PartyB: '4088285',
      PhoneNumber: '254712345678',
      CallBackURL: 'https://optionmarkettraders.com/api/mpesa/callback',
      AccountReference: 'OPTIONMARKET',
      TransactionDesc: 'Deposit',
    })
    expect(String(req.AccountReference)).toHaveLength(12)
  })

  it('uses OPTIONMARKET unless MPESA_ACCOUNT_REFERENCE overrides it (max 12 chars)', () => {
    expect(accountReference(undefined)).toBe('OPTIONMARKET')
    expect(accountReference('  ')).toBe('OPTIONMARKET')
    expect(accountReference(' OMTDEPOSIT ')).toBe('OMTDEPOSIT')
    expect(accountReference('OPTIONMARKETTRADERS')).toBe('OPTIONMARKET')
    const req = buildStkPushRequest({
      shortcode: '4088285',
      passkey: 'pk',
      amountKes: 1600,
      msisdn: '254712345678',
      callbackUrl: 'https://example.test/cb',
      accountReference: 'OPTIONMARKETTRADERS',
      description: 'A very long transaction description',
    })
    expect(req.AccountReference).toBe('OPTIONMARKET')
    expect(String(req.TransactionDesc).length).toBeLessThanOrEqual(13)
  })

  it('builds an STK query request with a fresh password', () => {
    const q = buildStkQueryRequest('4088285', 'pk', 'ws_CO_1', new Date('2026-10-04T08:48:05Z'))
    expect(q).toEqual({ BusinessShortCode: '4088285', Password: darajaPassword('4088285', 'pk', '20261004114805'), Timestamp: '20261004114805', CheckoutRequestID: 'ws_CO_1' })
  })

  it('selects the API host from MPESA_ENV', () => {
    expect(darajaBaseUrl('production')).toBe('https://api.safaricom.co.ke')
    expect(darajaBaseUrl(undefined)).toBe('https://api.safaricom.co.ke')
    expect(darajaBaseUrl('sandbox')).toBe('https://sandbox.safaricom.co.ke')
  })
})

describe('phone normalisation for STK push', () => {
  it.each([
    ['0712345678', '254712345678'],
    ['0112345678', '254112345678'],
    ['+254 712 345 678', '254712345678'],
    ['254112345678', '254112345678'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeKenyanPhone(input)).toBe(expected)
  })

  it.each(['0812345678', '25571234567', '', '07123'])('rejects %s', (input) => {
    expect(normalizeKenyanPhone(input)).toBeNull()
  })
})

describe('parseStkCallback', () => {
  it('parses a successful payment', () => {
    const cb = parseStkCallback(callback(0, {}, PAID_ITEMS))
    expect(cb).toMatchObject({
      ok: true,
      checkoutRequestId: 'ws_CO_191220191020363925',
      merchantRequestId: '29115-34620561-1',
      resultCode: 0,
      outcome: 'completed',
      amountKes: 1600,
      receipt: 'NLJ7RT61SV',
      phone: '254712345678',
      transactionDate: '20191219102115',
    })
  })

  it('maps 1032 to cancelled', () => {
    expect(parseStkCallback(callback(1032))).toMatchObject({ ok: true, resultCode: 1032, outcome: 'cancelled', amountKes: null, receipt: null })
  })

  it('maps insufficient funds (1) and other codes to failed', () => {
    expect(parseStkCallback(callback(1))).toMatchObject({ ok: true, resultCode: 1, outcome: 'failed' })
    expect(parseStkCallback(callback('2001'))).toMatchObject({ ok: true, resultCode: 2001, outcome: 'failed' })
  })

  it.each([
    ['null', null],
    ['string', 'hello'],
    ['array', [callback(0)]],
    ['empty object', {}],
    ['no stkCallback', { Body: {} }],
    ['no checkout id', callback(0, { CheckoutRequestID: '' })],
    ['non-numeric result code', callback('abc')],
    ['missing result code', callback(0, { ResultCode: undefined })],
  ])('rejects malformed payload: %s', (_label, payload) => {
    expect(parseStkCallback(payload).ok).toBe(false)
  })
})

describe('classifyStkQuery', () => {
  it('treats ResultCode 0 as completed only for the same CheckoutRequestID', () => {
    const body = { ResponseCode: '0', CheckoutRequestID: 'ws_CO_1', ResultCode: '0', ResultDesc: 'The service request is processed successfully.' }
    expect(classifyStkQuery(body, 'ws_CO_1').outcome).toBe('completed')
    expect(classifyStkQuery(body, 'ws_CO_2').outcome).toBe('pending')
  })

  it('maps cancellations and failures', () => {
    expect(classifyStkQuery({ ResultCode: '1032', ResultDesc: 'Request cancelled by user' }).outcome).toBe('cancelled')
    expect(classifyStkQuery({ ResultCode: '1', ResultDesc: 'The balance is insufficient' }).outcome).toBe('failed')
    expect(classifyStkQuery({ ResultCode: '1037' }).outcome).toBe('failed')
  })

  it('keeps still-processing, errors and garbage pending', () => {
    expect(classifyStkQuery({ errorCode: '500.001.1001', errorMessage: 'The transaction is being processed' }).outcome).toBe('pending')
    expect(classifyStkQuery({ ResultCode: '4999' }).outcome).toBe('pending')
    expect(classifyStkQuery({ errorCode: '404.001.03', errorMessage: 'Invalid Access Token' }).outcome).toBe('pending')
    expect(classifyStkQuery(null).outcome).toBe('pending')
    expect(classifyStkQuery({ ResultCode: 'x' }).outcome).toBe('pending')
  })
})

const completed: StkQueryClassification = { outcome: 'completed', resultCode: '0', description: 'ok' }
const base: SettlementInput = { status: 'PENDING', expectedKes: 1600, ageMs: 40_000, query: null, callback: null }

describe('decideDarajaSettlement', () => {
  it('credits only when the STK query confirms payment', () => {
    expect(decideDarajaSettlement({ ...base, callback: { amountKes: 1600, receipt: 'NLJ7RT61SV' } })).toEqual({ action: 'wait' })
    expect(decideDarajaSettlement({ ...base, query: completed, callback: { amountKes: 1600, receipt: 'NLJ7RT61SV' } })).toEqual({
      action: 'credit',
      amountKes: 1600,
      receipt: 'NLJ7RT61SV',
    })
    expect(decideDarajaSettlement({ ...base, query: completed })).toEqual({ action: 'credit', amountKes: 1600, receipt: null })
  })

  it('rejects an amount mismatch instead of crediting', () => {
    expect(decideDarajaSettlement({ ...base, query: completed, callback: { amountKes: 1, receipt: 'X' } })).toMatchObject({
      action: 'fail',
      status: 'FAILED',
      kind: 'amount_mismatch',
    })
  })

  it('fails or cancels from the query outcome', () => {
    expect(decideDarajaSettlement({ ...base, query: { outcome: 'cancelled', resultCode: '1032', description: 'Request cancelled by user' } })).toMatchObject({
      action: 'fail',
      status: 'CANCELLED',
    })
    expect(decideDarajaSettlement({ ...base, query: { outcome: 'failed', resultCode: '1', description: 'insufficient' } })).toMatchObject({
      action: 'fail',
      status: 'FAILED',
      kind: 'daraja_failed',
    })
  })

  it('expires after 10 minutes but still credits an expired deposit if payment is confirmed later', () => {
    expect(decideDarajaSettlement({ ...base, ageMs: DARAJA_EXPIRY_MS + 1 })).toMatchObject({ action: 'fail', kind: 'expired' })
    expect(decideDarajaSettlement({ ...base, status: 'FAILED', failureKind: 'expired', query: completed })).toMatchObject({ action: 'credit' })
    expect(decideDarajaSettlement({ ...base, status: 'FAILED', failureKind: 'daraja_failed', query: completed })).toEqual({ action: 'none' })
  })

  it('credits a duplicate callback only once', () => {
    const row = { status: 'PENDING', credits: 0 }
    const deliver = () => {
      const decision = decideDarajaSettlement({ ...base, status: row.status, query: completed, callback: { amountKes: 1600, receipt: 'NLJ7RT61SV' } })
      if (decision.action === 'credit') {
        row.credits += 1
        row.status = 'COMPLETED'
      }
      return decision.action
    }
    expect(deliver()).toBe('credit')
    expect(deliver()).toBe('none')
    expect(deliver()).toBe('none')
    expect(row.credits).toBe(1)
  })
})

describe('provider + query pacing', () => {
  it('defaults DEPOSIT_PROVIDER to daraja', () => {
    expect(parseDepositProvider(undefined)).toBe('daraja')
    expect(parseDepositProvider('')).toBe('daraja')
    expect(parseDepositProvider('DARAJA')).toBe('daraja')
    expect(parseDepositProvider(' MegaPay ')).toBe('megapay')
    expect(parseDepositProvider('other')).toBe('daraja')
  })

  it('queries after 30 s (or right after a callback) and at most every 10 s', () => {
    expect(shouldQueryNow(5_000, null, false)).toBe(false)
    expect(shouldQueryNow(31_000, null, false)).toBe(true)
    expect(shouldQueryNow(5_000, null, true)).toBe(true)
    expect(shouldQueryNow(60_000, 3_000, true)).toBe(false)
    expect(shouldQueryNow(60_000, 11_000, false)).toBe(true)
  })
})

describe('Edge Function copy', () => {
  it('supabase/functions/_shared/daraja.ts is identical to src/domain/daraja.ts', () => {
    expect(denoSource.length).toBeGreaterThan(1000)
    expect(denoSource.replace(/\r\n/g, '\n')).toBe(webSource.replace(/\r\n/g, '\n'))
  })
})
