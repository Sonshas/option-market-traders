import { useSyncExternalStore } from 'react'
import { ticketChartStore } from '@/lib/ticket-chart-store'

export function useTicketChartSelection() {
  return useSyncExternalStore(ticketChartStore.subscribe, ticketChartStore.getSnapshot, ticketChartStore.getSnapshot)
}
