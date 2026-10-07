import { describe, expect, it } from 'vitest'
import webIndex from './index.ts?raw'
import edgeIndex from '../../../../../supabase/functions/_shared/payments/index.ts?raw'
import webMegapay from './megapay.ts?raw'
import edgeMegapay from '../../../../../supabase/functions/_shared/payments/megapay.ts?raw'
import webDaraja from './daraja.ts?raw'
import edgeDaraja from '../../../../../supabase/functions/_shared/payments/daraja.ts?raw'
import webWithdrawals from './withdrawals.ts?raw'
import edgeWithdrawals from '../../../../../supabase/functions/_shared/payments/withdrawals.ts?raw'
import webSettings from './payment-settings.ts?raw'
import edgeSettings from '../../../../../supabase/functions/_shared/payments/payment-settings.ts?raw'

describe('payments folder mirrors Edge _shared/payments', () => {
  it('keeps pure modules + index.ts byte-identical', () => {
    expect(webIndex).toBe(edgeIndex)
    expect(webMegapay).toBe(edgeMegapay)
    expect(webDaraja).toBe(edgeDaraja)
    expect(webWithdrawals).toBe(edgeWithdrawals)
    expect(webSettings).toBe(edgeSettings)
  })
})
