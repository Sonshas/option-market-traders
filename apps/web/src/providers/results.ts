import { disconnected } from '@/services/status'
import type { AccountMode, DisconnectedResult, ProviderErrorCode, ProviderResult } from '@/types'

export function okDemo<T>(data: T, message: string): ProviderResult<T> {
  return {
    status: 'ready',
    connected: true,
    message,
    data,
    accountMode: 'demo',
    isSimulated: true,
  }
}

export function okReal<T>(data: T, message: string): ProviderResult<T> {
  return {
    status: 'ready',
    connected: true,
    message,
    data,
    accountMode: 'real',
    isSimulated: false,
  }
}

export function notConnected<T>(
  data: T,
  message: string,
  code: ProviderErrorCode = 'NOT_CONNECTED',
  accountMode: AccountMode = 'real',
): DisconnectedResult<T> {
  return {
    ...disconnected(data, message),
    code,
    accountMode,
    isSimulated: false,
  }
}
