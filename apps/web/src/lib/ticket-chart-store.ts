import type { ContractOption, ContractType } from '@/types'

/** Ticket selection mirrored under the price chart so digit stats match the active contract. */
export type TicketChartSelection = {
  contractType: ContractType
  contractOption: ContractOption
  selectedDigit: number
  barrier: number
}

const DEFAULT: TicketChartSelection = {
  contractType: 'EVEN_ODD',
  contractOption: 'even',
  selectedDigit: 5,
  barrier: 5,
}

export function createTicketChartStore() {
  let state: TicketChartSelection = DEFAULT
  const listeners = new Set<() => void>()

  return {
    getSnapshot(): TicketChartSelection {
      return state
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(next: TicketChartSelection): void {
      state = next
      listeners.forEach((l) => l())
    },
  }
}

export const ticketChartStore = createTicketChartStore()
