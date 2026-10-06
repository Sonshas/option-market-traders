import { DIGIT_CONTRACT_OPTIONS } from '@/domain/digit-contracts'
import type { ContractOption, ContractType } from '@/types'

export const CONTRACT_TYPES: Array<{
  id: ContractType
  label: string
  shortLabel: string
  description: string
}> = [
  {
    id: 'EVEN_ODD',
    label: 'EVEN / ODD',
    shortLabel: 'Even / Odd',
    description: 'Predict whether the last digit of the live exit price is even or odd.',
  },
  {
    id: 'MATCH_DIFFER',
    label: 'MATCH / DIFFER',
    shortLabel: 'Match / Differ',
    description: 'Predict whether the last digit matches or differs from a selected digit (0–9).',
  },
  {
    id: 'OVER_UNDER',
    label: 'OVER / UNDER',
    shortLabel: 'Over / Under',
    description: 'Predict whether the last digit finishes over or under a barrier digit. Landing on the barrier loses.',
  },
]

export const CONTRACT_OPTIONS: Record<ContractType, ContractOption[]> = DIGIT_CONTRACT_OPTIONS

export function defaultOptionFor(type: ContractType): ContractOption {
  return CONTRACT_OPTIONS[type][0]
}

export function contractTypeLabel(type: ContractType): string {
  return CONTRACT_TYPES.find((item) => item.id === type)?.label ?? type
}

export function contractOptionLabel(option: ContractOption): string {
  return option.charAt(0).toUpperCase() + option.slice(1)
}

export function formatContractTicket(
  type: ContractType,
  option: ContractOption,
  extras?: { digit?: number | null; barrier?: number | null },
): string {
  const base = `${contractTypeLabel(type)} · ${contractOptionLabel(option)}`
  if (type === 'MATCH_DIFFER' && extras?.digit != null) return `${base} · Digit ${extras.digit}`
  if (type === 'OVER_UNDER' && extras?.barrier != null) return `${base} · Barrier ${extras.barrier}`
  return base
}

export { lastDigitOfPrice, settleDigitContract } from '@/domain/digit-contracts'
