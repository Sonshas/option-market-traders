import { describe, expect, it } from 'vitest'
import webWinRate from './win-rate.ts?raw'
import webSettle from './settle.ts?raw'
import webDigitVisual from './digit-visual.ts?raw'
import webIndex from './index.ts?raw'
import edgeWinRate from '../../../../../supabase/functions/_shared/outcome/win-rate.ts?raw'
import edgeSettle from '../../../../../supabase/functions/_shared/outcome/settle.ts?raw'
import edgeDigitVisual from '../../../../../supabase/functions/_shared/outcome/digit-visual.ts?raw'
import edgeIndex from '../../../../../supabase/functions/_shared/outcome/index.ts?raw'
import hostSchema from '../../../../../supabase/migrations/20260920111952_smartbasebinary_host_schema.sql?raw'
import { hostSchemaSection } from '../host-schema-section'
import {
  ACCOUNT_WIN_RATE,
  ACCOUNT_WINNING_DIGIT_COUNT,
  accountDigitPayoutRate,
  calculateAccountTradeResult,
  settleDigitContract,
} from '@/domain/outcome'
import {
  contractSettlementHeadline,
  settlementSampleWinRate,
  winRateNudge,
} from '@/domain/outcome/digit-graph'
import { settleDigitContract as settleViaDigitContracts } from '@/domain/digit-contracts'

const settleMigration = hostSchemaSection(hostSchema, '20261005200000_natural_contract_settlement.sql')

describe('outcome folder mirrors Edge _shared/outcome', () => {
  it('keeps win-rate.ts / settle.ts / digit-visual.ts / index.ts byte-identical', () => {
    expect(webWinRate).toBe(edgeWinRate)
    expect(webSettle).toBe(edgeSettle)
    expect(webDigitVisual).toBe(edgeDigitVisual)
    expect(webIndex).toBe(edgeIndex)
  })
})

describe('natural settlement via outcome/settle', () => {
  it('keeps legacy win-rate helpers for stats/pricing formulas', () => {
    expect(ACCOUNT_WIN_RATE).toBe(0.9)
    expect(ACCOUNT_WINNING_DIGIT_COUNT).toBe(9)
    expect(accountDigitPayoutRate()).toBe(0.0555)
  })

  it('settles EVEN/ODD from the final digit', () => {
    expect(settleDigitContract({ contractOption: 'even', exitPrice: 0, exitDigit: 2 })).toBe('won')
    expect(settleDigitContract({ contractOption: 'even', exitPrice: 0, exitDigit: 1 })).toBe('lost')
    expect(settleDigitContract({ contractOption: 'odd', exitPrice: 0, exitDigit: 9 })).toBe('won')
    expect(calculateAccountTradeResult(0, 'even')).toBe('WIN')
    expect(calculateAccountTradeResult(1, 'even')).toBe('LOSS')
  })

  it('matches digit-contracts settleDigitContract', () => {
    const selection = {
      contractType: 'MATCH_DIFFER' as const,
      contractOption: 'match' as const,
      selectedDigit: 7,
      barrier: null,
      exitPrice: 0,
      exitDigit: 7,
    }
    expect(settleDigitContract(selection)).toBe('won')
    expect(settleViaDigitContracts(selection)).toBe('won')
    expect(settleDigitContract({ ...selection, exitDigit: 6 })).toBe('lost')
  })
})

describe('digit graph copy', () => {
  it('labels every contract side', () => {
    expect(
      contractSettlementHeadline({
        contractType: 'EVEN_ODD',
        contractOption: 'odd',
        selectedDigit: 5,
        barrier: 5,
      }),
    ).toContain('ODD')
  })

  it('nudges sample win rate toward 90%', () => {
    expect(settlementSampleWinRate(100, 90)).toBe(90)
    expect(winRateNudge(90)).toContain('matches')
  })
})

describe('SQL settle_real_trade natural rule', () => {
  it('uses natural contract branches', () => {
    expect(settleMigration.replace(/\s+/g, ' ')).toContain("t.contract_option = 'even'")
    expect(settleMigration.replace(/\s+/g, ' ')).not.toContain(
      "v_outcome := case when v_digit between 0 and 8 then 'won' else 'lost' end;",
    )
  })
})
