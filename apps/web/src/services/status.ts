import { NOT_CONNECTED } from '@/lib/constants'
import type { DisconnectedResult, ServiceStatus } from '@/types'

export function disconnected<T>(data: T, message = NOT_CONNECTED): DisconnectedResult<T> {
  return {
    status: 'not_connected',
    connected: false,
    message,
    data,
  }
}

export function emptyStatus(): ServiceStatus {
  return 'not_connected'
}

/**
 * Delay helper for loading-state UI only. Does not talk to a backend.
 */
export function uiPause(ms = 280): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}
