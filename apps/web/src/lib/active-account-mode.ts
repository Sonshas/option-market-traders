import type { AccountMode } from '@/types'

/** Account mode currently selected in the UI, readable outside React (Auto Trade checks it before every order). */
let active: AccountMode = 'demo'

export function setActiveAccountMode(mode: AccountMode): void {
  active = mode
}

export function getActiveAccountMode(): AccountMode {
  return active
}
