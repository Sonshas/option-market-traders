import { DEMO_ACCOUNT_ID, DEMO_USER_ID } from '@/domain/account'
import { createId, nowIso } from '@/lib/ids'
import { loadDemoState, mutateDemoState } from '@/lib/demo-store'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase'
import { REAL_INTEGRATION } from '@/providers/config'
import { okDemo, okReal, notConnected } from '@/providers/results'
import type {
  AccountMode,
  Notification,
  NotificationKind,
  ProviderResult,
  SupportTicket,
  SupportTicketStatus,
} from '@/types'

export interface NotificationProvider {
  readonly id: string
  list(kind?: AccountMode): Promise<ProviderResult<Notification[]>>
}

export interface SupportProvider {
  readonly id: string
  listTickets(kind?: AccountMode): Promise<ProviderResult<SupportTicket[]>>
  createTicket(input: {
    subject: string
    message: string
    kind?: AccountMode
  }): Promise<ProviderResult<SupportTicket | null>>
}

function mapNotificationKind(value: string): NotificationKind {
  const allowed: NotificationKind[] = ['system', 'trading', 'wallet', 'security']
  if ((allowed as string[]).includes(value)) return value as NotificationKind
  return 'system'
}

export const demoNotificationProvider: NotificationProvider = {
  id: 'demo-local',
  async list(kind = 'demo') {
    if (kind !== 'demo') {
      return notConnected([], 'Demo notifications are isolated from REAL.', 'CROSS_MODE_FORBIDDEN')
    }
    return okDemo(loadDemoState().notifications, 'DEMO notifications.')
  },
}

export const realNotificationProvider: NotificationProvider = {
  id: 'real-backend',
  async list() {
    if (!REAL_INTEGRATION.backendConfigured || !isSupabaseConfigured) {
      return notConnected([], 'REAL ACCOUNT NOT CONNECTED. Notifications come from the backend only.')
    }
    const client = getSupabase()!
    const {
      data: { session },
    } = await client.auth.getSession()
    if (!session?.user) {
      return notConnected([], 'Sign in to load REAL notifications.')
    }

    const { data, error } = await client
      .from('notifications')
      .select(
        'id, user_id, account_id, account_mode, kind, title, body, read, is_simulated, created_at, updated_at',
      )
      .eq('user_id', session.user.id)
      .eq('is_simulated', false)
      .order('created_at', { ascending: false })

    if (error) {
      return notConnected([], `REAL notifications read failed: ${error.message}`)
    }

    const rows: Notification[] = (data ?? []).map((row) => ({
      id: row.id,
      userId: row.user_id,
      accountId: row.account_id ?? '',
      accountMode: (row.account_mode === 'demo' ? 'demo' : 'real') as AccountMode,
      kind: mapNotificationKind(row.kind),
      title: row.title,
      body: row.body,
      read: Boolean(row.read),
      isSimulated: false,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))

    return okReal(rows, rows.length ? 'REAL notifications from Supabase.' : 'No REAL notifications yet.')
  },
}

export const demoSupportProvider: SupportProvider = {
  id: 'demo-local',
  async listTickets(kind = 'demo') {
    if (kind !== 'demo') {
      return notConnected([], 'Demo support is isolated from REAL.', 'CROSS_MODE_FORBIDDEN')
    }
    return okDemo(loadDemoState().tickets, 'DEMO support tickets.')
  },
  async createTicket(input) {
    if (input.kind && input.kind !== 'demo') {
      return notConnected(null, 'Demo support is isolated from REAL.', 'CROSS_MODE_FORBIDDEN')
    }
    const now = Date.now()
    const createdAt = nowIso(now)
    const ticket: SupportTicket = {
      id: createId('tkt'),
      userId: DEMO_USER_ID,
      accountId: DEMO_ACCOUNT_ID,
      accountMode: 'demo',
      subject: input.subject,
      message: input.message,
      status: 'open',
      createdAt,
      updatedAt: createdAt,
    }
    mutateDemoState((state) => ({ ...state, tickets: [ticket, ...state.tickets] }))
    return okDemo(ticket, 'DEMO support ticket stored locally. This is not a production desk.')
  },
}

export const realSupportProvider: SupportProvider = {
  id: 'real-backend',
  async listTickets() {
    if (!REAL_INTEGRATION.backendConfigured || !isSupabaseConfigured) {
      return notConnected([], 'REAL ACCOUNT NOT CONNECTED. Support tickets are backend-only.')
    }
    const client = getSupabase()!
    const {
      data: { session },
    } = await client.auth.getSession()
    if (!session?.user) {
      return notConnected([], 'Sign in to load REAL support tickets.')
    }

    const { data, error } = await client
      .from('support_tickets')
      .select('id, user_id, account_id, account_mode, subject, message, status, created_at, updated_at')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })

    if (error) {
      return notConnected([], `REAL support tickets read failed: ${error.message}`)
    }

    const rows: SupportTicket[] = (data ?? []).map((row) => ({
      id: row.id,
      userId: row.user_id,
      accountId: row.account_id ?? '',
      accountMode: (row.account_mode === 'demo' ? 'demo' : 'real') as AccountMode,
      subject: row.subject,
      message: row.message,
      status: (row.status === 'closed' ? 'closed' : 'open') as SupportTicketStatus,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))

    return okReal(rows, rows.length ? 'REAL support tickets from Supabase.' : 'No REAL support tickets yet.')
  },

  async createTicket(input) {
    if (!REAL_INTEGRATION.backendConfigured || !isSupabaseConfigured) {
      return notConnected(null, 'REAL ACCOUNT NOT CONNECTED. Support is not accepting live tickets.')
    }
    const subject = input.subject.trim()
    const message = input.message.trim()
    if (subject.length < 3 || message.length < 3) {
      return notConnected(null, 'Subject and message are required.', 'VALIDATION')
    }

    const client = getSupabase()!
    const {
      data: { session },
    } = await client.auth.getSession()
    if (!session?.user) {
      return notConnected(null, 'Sign in to create a REAL support ticket.')
    }

    const { data: account } = await client
      .from('accounts')
      .select('id')
      .eq('user_id', session.user.id)
      .eq('account_mode', 'real')
      .maybeSingle()

    const { data, error } = await client
      .from('support_tickets')
      .insert({
        user_id: session.user.id,
        account_id: account?.id ?? null,
        account_mode: 'real',
        subject,
        message,
        status: 'open',
      })
      .select('id, user_id, account_id, account_mode, subject, message, status, created_at, updated_at')
      .single()

    if (error || !data) {
      return notConnected(null, error?.message ?? 'Failed to create support ticket.', 'NOT_CONNECTED')
    }

    const ticket: SupportTicket = {
      id: data.id,
      userId: data.user_id,
      accountId: data.account_id ?? '',
      accountMode: 'real',
      subject: data.subject,
      message: data.message,
      status: data.status === 'closed' ? 'closed' : 'open',
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    }
    return okReal(ticket, 'REAL support ticket created in Supabase.')
  },
}
