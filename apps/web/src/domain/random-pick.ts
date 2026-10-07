import type { ContractOption, ContractType } from '@/types'

export interface RandomDigitPick {
  symbol: string
  contractType: ContractType
  contractOption: ContractOption
  selectedDigit: number | null
  barrier: number | null
}

const CONTRACTS: ReadonlyArray<{ contractType: ContractType; options: readonly ContractOption[] }> = [
  { contractType: 'EVEN_ODD', options: ['even', 'odd'] },
  { contractType: 'MATCH_DIFFER', options: ['match', 'differ'] },
  { contractType: 'OVER_UNDER', options: ['over', 'under'] },
]

function index(random: () => number, length: number): number {
  return Math.min(length - 1, Math.floor(random() * length))
}

/**
 * Uniformly random digit contract on one of `symbols`: EVEN / ODD, MATCH / DIFFER (digit 0–9) or OVER (barrier 0–8) /
 * UNDER (barrier 1–9), so every pick can win.
 */
export function randomDigitPick(symbols: readonly string[], random: () => number = Math.random): RandomDigitPick | null {
  if (symbols.length === 0) return null
  const symbol = symbols[index(random, symbols.length)]!
  const contract = CONTRACTS[index(random, CONTRACTS.length)]!
  const contractOption = contract.options[index(random, contract.options.length)]!
  if (contract.contractType === 'MATCH_DIFFER') {
    return { symbol, contractType: contract.contractType, contractOption, selectedDigit: index(random, 10), barrier: null }
  }
  if (contract.contractType === 'OVER_UNDER') {
    const barrier = contractOption === 'over' ? index(random, 9) : 1 + index(random, 9)
    return { symbol, contractType: contract.contractType, contractOption, selectedDigit: null, barrier }
  }
  return { symbol, contractType: contract.contractType, contractOption, selectedDigit: null, barrier: null }
}
