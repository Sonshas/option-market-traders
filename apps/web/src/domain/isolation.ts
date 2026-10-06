import type { AccountMode, FinancialRecord } from '@/types'
import { CROSS_MODE_FORBIDDEN } from '@/domain/errors'

export const CROSS_MODE_ERROR = CROSS_MODE_FORBIDDEN

export function assertSameMode(expected: AccountMode, actual: AccountMode, context = 'record'): void {
  if (expected !== actual) {
    throw new Error(`${CROSS_MODE_FORBIDDEN}: ${context} is ${actual}, expected ${expected}`)
  }
}

export function filterByAccountMode<T extends { accountMode: AccountMode }>(
  records: T[],
  mode: AccountMode,
): T[] {
  return records.filter((record) => record.accountMode === mode)
}

export function hasSingleAccountMode(records: Array<{ accountMode: AccountMode }>): boolean {
  const modes = new Set(records.map((record) => record.accountMode))
  return modes.size <= 1
}

export function rejectMixedModes(records: Array<{ accountMode: AccountMode }>): void {
  if (!hasSingleAccountMode(records)) {
    throw new Error(`${CROSS_MODE_FORBIDDEN}: demo and real records cannot share a collection`)
  }
}

export function isDemoRecord(record: Pick<FinancialRecord, 'accountMode'> & { isSimulated?: boolean }): boolean {
  return record.accountMode === 'demo'
}

export function isRealRecord(record: Pick<FinancialRecord, 'accountMode'> & { isSimulated?: boolean }): boolean {
  return record.accountMode === 'real' && record.isSimulated === false
}

export function assertRealNotSimulated(record: { accountMode: AccountMode; isSimulated: boolean }): void {
  if (record.accountMode === 'real' && record.isSimulated) {
    throw new Error(`${CROSS_MODE_FORBIDDEN}: real financial records cannot be simulated`)
  }
}
