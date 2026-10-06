import { getAccountProviders } from '@/providers/registry'
import type { AccountMode, Notification, ProviderResult, SupportTicket } from '@/types'

export const notificationService = {
  async list(kind: AccountMode = 'demo'): Promise<ProviderResult<Notification[]>> {
    return getAccountProviders(kind).notifications.list(kind)
  },
}

export const supportService = {
  async listTickets(kind: AccountMode = 'demo'): Promise<ProviderResult<SupportTicket[]>> {
    return getAccountProviders(kind).support.listTickets(kind)
  },

  async createTicket(input: {
    subject: string
    message: string
    kind?: AccountMode
  }): Promise<ProviderResult<SupportTicket | null>> {
    const kind = input.kind ?? 'demo'
    return getAccountProviders(kind).support.createTicket({ ...input, kind })
  },
}
