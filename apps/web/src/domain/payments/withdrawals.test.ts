import { describe, expect, it } from 'vitest'
import webSource from './withdrawals.ts?raw'
import denoSource from '../../../../../supabase/functions/_shared/payments/withdrawals.ts?raw'
import {
  DEFAULT_WITHDRAWAL_FEE_KES,
  DEFAULT_WITHDRAWAL_MAX_KES,
  DEFAULT_WITHDRAWAL_MIN_KES,
  NO_REAL_TRADE_MESSAGE,
  WITHDRAWAL_HARD_MAX_KES,
  buildB2cRequest,
  generateWithdrawalReference,
  isOpenWithdrawalStatus,
  isWithdrawalReference,
  localPhoneDisplay,
  maskMsisdn,
  minUsdFor,
  normalizeKenyanPhone,
  parseB2cResult,
  parseWithdrawalConfig,
  parseWithdrawalMode,
  processingTimeCopy,
  quoteWithdrawal,
  usdToKes,
  validateWithdrawalAmountUsd,
  withdrawalStatusCopy,
  withdrawalStatusLabel,
  type WithdrawalConfig,
} from '@/domain/payments'

const CONFIG: WithdrawalConfig = { mode: 'manual', kesPerUsd: 130, minKes: 1000, maxKes: 150_000, feeKes: 0 }

describe('shared module', () => {
  it('web and edge copies are byte-identical', () => {
    expect(denoSource).toBe(webSource)
  })
})

describe('parseWithdrawalConfig', () => {
  it('defaults: manual mode, 130 KES/USD, KES 1,000–400,000, no fee', () => {
    expect(DEFAULT_WITHDRAWAL_MAX_KES).toBe(400_000)
    expect(DEFAULT_WITHDRAWAL_MIN_KES).toBe(1000)
    expect(parseWithdrawalConfig({})).toEqual({
      mode: 'manual',
      kesPerUsd: 130,
      minKes: DEFAULT_WITHDRAWAL_MIN_KES,
      maxKes: DEFAULT_WITHDRAWAL_MAX_KES,
      feeKes: DEFAULT_WITHDRAWAL_FEE_KES,
    })
  })

  it('owner rules: per-request cap is KES 400,000 even if the env asks for more; no-trade message is fixed', () => {
    expect(parseWithdrawalConfig({ WITHDRAWAL_MAX_KES: '1000000' }).maxKes).toBe(WITHDRAWAL_HARD_MAX_KES)
    expect(WITHDRAWAL_HARD_MAX_KES).toBe(400_000)
    const live = parseWithdrawalConfig({})
    expect(validateWithdrawalAmountUsd(3076.92, live, 5000)).toMatchObject({ ok: true, quote: { amountKes: 400_000 } })
    expect(validateWithdrawalAmountUsd(3076.93, live, 5000)).toMatchObject({ ok: false, error: expect.stringContaining('400,000') })
    expect(validateWithdrawalAmountUsd(3000, live, 2999.99)).toMatchObject({ ok: false, error: expect.stringContaining('up to') })
    expect(NO_REAL_TRADE_MESSAGE).toBe('Complete at least one REAL trade before withdrawing.')
  })

  it('reads overrides and ignores junk', () => {
    expect(
      parseWithdrawalConfig({ WITHDRAWAL_MODE: 'DARAJA_B2C', KES_PER_USD: '128.5', WITHDRAWAL_MIN_KES: '500', WITHDRAWAL_MAX_KES: '70000', WITHDRAWAL_FEE_KES: '30' }),
    ).toEqual({ mode: 'daraja_b2c', kesPerUsd: 128.5, minKes: 500, maxKes: 70000, feeKes: 30 })
    expect(parseWithdrawalConfig({ WITHDRAWAL_FEE_KES: '-5', WITHDRAWAL_MAX_KES: '10', WITHDRAWAL_MIN_KES: '100' })).toMatchObject({ feeKes: 0, minKes: 100, maxKes: 100 })
    expect(parseWithdrawalConfig({ WITHDRAWAL_FEE_KES: 'abc' }).feeKes).toBe(0)
  })

  it('parseWithdrawalMode falls back to manual', () => {
    expect(parseWithdrawalMode(undefined)).toBe('manual')
    expect(parseWithdrawalMode('b2c')).toBe('manual')
    expect(parseWithdrawalMode(' daraja_b2c ')).toBe('daraja_b2c')
  })
})

describe('usdToKes / quoteWithdrawal', () => {
  it.each([
    [10, 130, 1300],
    [7.7, 130, 1001],
    [7.69, 130, 1000],
    [0.01, 130, 1],
    [1153.85, 130, 150001],
    [10.1, 130, 1313],
    [1, 128.5, 129], // 128.5 rounds half up
    [0, 130, 0],
    [-5, 130, 0],
  ])('%s USD at %s → KES %s', (usd, rate, kes) => {
    expect(usdToKes(usd, rate)).toBe(kes)
  })

  it('charges no fee: net equals gross', () => {
    expect(quoteWithdrawal(10, CONFIG)).toEqual({ amountUsd: 10, amountKes: 1300, feeKes: 0, netKes: 1300 })
    expect(quoteWithdrawal(10, { kesPerUsd: 130, feeKes: 30 })).toEqual({ amountUsd: 10, amountKes: 1300, feeKes: 0, netKes: 1300 })
  })

  it('minUsdFor reaches the KES minimum', () => {
    const min = minUsdFor(CONFIG)
    expect(min).toBe(7.7)
    expect(usdToKes(min, 130)).toBeGreaterThanOrEqual(CONFIG.minKes)
  })
})

describe('validateWithdrawalAmountUsd', () => {
  it('accepts a valid amount within balance', () => {
    const result = validateWithdrawalAmountUsd('25', CONFIG, 100)
    expect(result).toEqual({ ok: true, amountUsd: 25, quote: { amountUsd: 25, amountKes: 3250, feeKes: 0, netKes: 3250 } })
  })

  it('accepts exactly the available balance and two decimals', () => {
    expect(validateWithdrawalAmountUsd(12.34, CONFIG, 12.34).ok).toBe(true)
    expect(validateWithdrawalAmountUsd('10.10', CONFIG, null).ok).toBe(true)
  })

  it.each([
    ['', 'Enter an amount in USD.'],
    ['abc', 'Enter an amount in USD.'],
    ['0', 'Enter an amount in USD.'],
    ['-3', 'Enter an amount in USD.'],
    ['1.234', 'Use at most two decimal places.'],
    ['5', 'Minimum withdrawal is KES 1,000 (about $7.70).'],
    ['2000', 'Maximum withdrawal is KES 150,000 per request.'],
  ])('rejects %s', (input, error) => {
    expect(validateWithdrawalAmountUsd(input, CONFIG, 5000)).toEqual({ ok: false, error })
  })

  it('rejects more than the available balance', () => {
    expect(validateWithdrawalAmountUsd('50', CONFIG, 49.99)).toEqual({ ok: false, error: 'You can withdraw up to $49.99.' })
  })

  it('ignores a configured fee', () => {
    const feeConfig = { ...CONFIG, minKes: 1, feeKes: 1300 }
    expect(validateWithdrawalAmountUsd('10', feeConfig, 100).ok).toBe(true)
  })
})

describe('phone helpers', () => {
  it('reuses the deposit normaliser (2547… / 2541…)', () => {
    expect(normalizeKenyanPhone('0712 345 678')).toBe('254712345678')
    expect(normalizeKenyanPhone('0112345678')).toBe('254112345678')
    expect(normalizeKenyanPhone('0812345678')).toBeNull()
  })

  it('displays and masks', () => {
    expect(localPhoneDisplay('254712345678')).toBe('0712345678')
    expect(localPhoneDisplay(null)).toBe('')
    expect(localPhoneDisplay('bogus')).toBe('bogus')
    expect(maskMsisdn('254712345678')).toBe('254712***678')
    expect(maskMsisdn(null)).toBe('')
  })
})

describe('references', () => {
  it('generates OMT-W- + 8 unambiguous characters', () => {
    const ref = generateWithdrawalReference()
    expect(ref).toMatch(/^OMT-W-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/)
    expect(ref.length).toBeLessThan(20)
    expect(isWithdrawalReference(ref)).toBe(true)
    expect(isWithdrawalReference('OMT-ABCDEFGH')).toBe(false)
    expect(isWithdrawalReference(null)).toBe(false)
  })

  it('is deterministic for a given byte source', () => {
    expect(generateWithdrawalReference(() => new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]))).toBe('OMT-W-ABCDEFGH')
  })
})

describe('buildB2cRequest', () => {
  it('matches the Daraja B2C v3 payload', () => {
    const payload = buildB2cRequest({
      originatorConversationId: 'OMT-W-ABCDEFGH',
      initiatorName: 'apiuser',
      securityCredential: 'ENCRYPTED',
      shortcode: '600000',
      amountKes: 1300,
      msisdn: '254712345678',
      resultUrl: 'https://optionmarkettraders.com/api/mpesa/b2c/result',
      timeoutUrl: 'https://optionmarkettraders.com/api/mpesa/b2c/timeout',
    })
    expect(payload).toEqual({
      OriginatorConversationID: 'OMT-W-ABCDEFGH',
      InitiatorName: 'apiuser',
      SecurityCredential: 'ENCRYPTED',
      CommandID: 'BusinessPayment',
      Amount: 1300,
      PartyA: '600000',
      PartyB: '254712345678',
      Remarks: 'Withdrawal',
      QueueTimeOutURL: 'https://optionmarkettraders.com/api/mpesa/b2c/timeout',
      ResultURL: 'https://optionmarkettraders.com/api/mpesa/b2c/result',
      Occasion: 'Withdrawal',
    })
  })
})

describe('parseB2cResult', () => {
  const success = {
    Result: {
      ResultType: 0,
      ResultCode: 0,
      ResultDesc: 'The service request is processed successfully.',
      OriginatorConversationID: 'OMT-W-ABCDEFGH',
      ConversationID: 'AG_20240706_2010364430d9bbdaf872',
      TransactionID: 'SG632NMUAB',
      ResultParameters: {
        ResultParameter: [
          { Key: 'TransactionAmount', Value: 1300 },
          { Key: 'TransactionReceipt', Value: 'SG632NMUAB' },
          { Key: 'ReceiverPartyPublicName', Value: '254712345678 - JANE DOE' },
          { Key: 'TransactionCompletedDateTime', Value: '06.07.2024 22:48:52' },
        ],
      },
    },
  }

  it('parses a successful result', () => {
    expect(parseB2cResult(success)).toEqual({
      ok: true,
      resultCode: 0,
      resultDesc: 'The service request is processed successfully.',
      outcome: 'completed',
      originatorConversationId: 'OMT-W-ABCDEFGH',
      conversationId: 'AG_20240706_2010364430d9bbdaf872',
      transactionId: 'SG632NMUAB',
      receipt: 'SG632NMUAB',
      amountKes: 1300,
      receiverName: '254712345678 - JANE DOE',
      completedAt: '06.07.2024 22:48:52',
    })
  })

  it('parses a failure without parameters', () => {
    const failed = parseB2cResult({
      Result: { ResultType: 0, ResultCode: 2001, ResultDesc: 'The initiator information is invalid.', OriginatorConversationID: 'OMT-W-ABCDEFGH', ConversationID: 'AG_x' },
    })
    expect(failed).toMatchObject({ ok: true, outcome: 'failed', resultCode: 2001, receipt: null, amountKes: null })
  })

  it.each([
    [null, 'missing_result'],
    ['string', 'missing_result'],
    [{ Body: {} }, 'missing_result'],
    [{ Result: { ResultCode: 0 } }, 'missing_conversation_ids'],
    [{ Result: { ResultCode: 'x', OriginatorConversationID: 'a' } }, 'invalid_result_code'],
    [{ Result: { ResultCode: 0, OriginatorConversationID: 'a'.repeat(101) } }, 'invalid_conversation_ids'],
  ])('rejects malformed %j', (payload, error) => {
    expect(parseB2cResult(payload)).toEqual({ ok: false, error })
  })
})

describe('status copy', () => {
  it('labels', () => {
    expect(withdrawalStatusLabel('PENDING')).toBe('Request received')
    expect(withdrawalStatusLabel('PROCESSING')).toBe('Being sent to M-Pesa')
    expect(withdrawalStatusLabel('COMPLETED')).toBe('Withdrawal completed')
    expect(withdrawalStatusLabel('FAILED')).toBe('Could not be sent')
  })

  it('never claims success before COMPLETED', () => {
    const base = { netKes: 1300, msisdn: '254712345678' }
    expect(withdrawalStatusCopy({ ...base, status: 'PENDING' })).toBe('Request received. KES 1,300 will be sent to 0712345678.')
    expect(withdrawalStatusCopy({ ...base, status: 'PROCESSING' })).toBe('Being sent to M-Pesa (0712345678).')
    expect(withdrawalStatusCopy({ ...base, status: 'COMPLETED', receipt: 'SG632NMUAB' })).toBe(
      'Withdrawal completed — KES 1,300 sent to 0712345678 (receipt SG632NMUAB).',
    )
    expect(withdrawalStatusCopy({ ...base, status: 'FAILED', failureReason: 'Number not registered' })).toBe(
      'Could not be sent: Number not registered. Your balance has been refunded.',
    )
    for (const status of ['PENDING', 'PROCESSING']) {
      expect(withdrawalStatusCopy({ ...base, status })).not.toMatch(/success|completed|processed|has been sent|was sent/i)
    }
  })

  it('open statuses and processing-time copy', () => {
    expect(isOpenWithdrawalStatus('PENDING')).toBe(true)
    expect(isOpenWithdrawalStatus('PROCESSING')).toBe(true)
    expect(isOpenWithdrawalStatus('COMPLETED')).toBe(false)
    expect(processingTimeCopy('manual')).toContain('typically within 24 hours')
    expect(processingTimeCopy('daraja_b2c')).toContain('usually within minutes')
  })
})
