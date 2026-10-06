import { DEMO_USER_ID } from '@/domain/account'
import { nowIso } from '@/lib/ids'
import { DEMO_SESSION_KEY } from '@/providers/config'
import type { User } from '@/types'

export interface DemoSession {
  userId: string
  email: string
  name: string
  phone: string
  country: string
  /** Local DEMO credential only — never sent to a remote auth provider. */
  password: string
  createdAt: string
}

const CREDENTIALS_KEY = 'sbb.demo.credentials'
const listeners = new Set<() => void>()
let memory: DemoSession | null | undefined
let credentialMemory: DemoSession[] | null = null

function canUseStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined'
  } catch {
    return false
  }
}

function toUser(session: DemoSession): User {
  return {
    id: session.userId,
    email: session.email,
    name: session.name,
    role: 'trader',
    accountStatus: 'active',
    liveTradingEnabled: false,
    kycStatus: 'not_started',
    createdAt: session.createdAt,
    updatedAt: session.createdAt,
  }
}

function readCredentials(): DemoSession[] {
  if (credentialMemory) return credentialMemory
  if (!canUseStorage()) return []
  try {
    const raw = localStorage.getItem(CREDENTIALS_KEY)
    if (!raw) return []
    credentialMemory = JSON.parse(raw) as DemoSession[]
    return credentialMemory
  } catch {
    return []
  }
}

function writeCredentials(list: DemoSession[]): void {
  credentialMemory = list
  if (!canUseStorage()) return
  localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(list))
}

export function upsertDemoCredential(session: DemoSession): void {
  const list = readCredentials().filter((item) => item.email !== session.email)
  list.push(session)
  writeCredentials(list)
}

export function findDemoCredential(email: string): DemoSession | null {
  const normalized = email.trim().toLowerCase()
  return readCredentials().find((item) => item.email === normalized) ?? null
}

export function loadDemoSession(): DemoSession | null {
  if (memory !== undefined) return memory
  if (canUseStorage()) {
    const raw = localStorage.getItem(DEMO_SESSION_KEY)
    if (raw) {
      try {
        memory = JSON.parse(raw) as DemoSession
        return memory
      } catch {
        memory = null
        return null
      }
    }
  }
  memory = null
  return null
}

export function getDemoSessionUser(): User | null {
  const session = loadDemoSession()
  return session ? toUser(session) : null
}

export function getDemoSessionProfile(): DemoSession | null {
  return loadDemoSession()
}

export function saveDemoSession(input: {
  email: string
  name: string
  password?: string
  phone?: string
  country?: string
}): DemoSession {
  const existing = findDemoCredential(input.email)
  const session: DemoSession = {
    userId: DEMO_USER_ID,
    email: input.email.trim().toLowerCase(),
    name: input.name.trim() || existing?.name || 'Demo Trader',
    phone: input.phone?.trim() || existing?.phone || '',
    country: input.country?.trim() || existing?.country || '',
    password: input.password || existing?.password || '',
    createdAt: existing?.createdAt ?? nowIso(),
  }
  memory = session
  if (canUseStorage()) {
    localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(session))
  }
  if (session.password) upsertDemoCredential(session)
  listeners.forEach((listener) => listener())
  return session
}

export function clearDemoSession(): void {
  memory = null
  if (canUseStorage()) {
    localStorage.removeItem(DEMO_SESSION_KEY)
  }
  listeners.forEach((listener) => listener())
}

export function clearDemoCredentials(): void {
  credentialMemory = []
  if (canUseStorage()) {
    localStorage.removeItem(CREDENTIALS_KEY)
  }
}

export function subscribeDemoSession(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function resetDemoSessionMemory(): void {
  memory = undefined
  credentialMemory = null
}
