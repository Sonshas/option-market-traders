/**
 * Two local, virtual-money accounts share the DEMO engine:
 * - demo: the regular DEMO account
 * - practice: a real-style trading screen, labeled "Practice only", with its own virtual balance
 * Neither is ever funded with, or withdrawn as, real money.
 */
export type PracticeBook = 'demo' | 'practice'

export const PRACTICE_BOOK_STORAGE_KEY = 'sbb.book.v1'
export const PRACTICE_STORAGE_KEY = 'sbb.practice.v1'

export const PRACTICE_BOOK_LABEL: Record<PracticeBook, string> = {
  demo: 'DEMO ACCOUNT',
  practice: 'PRACTICE ACCOUNT',
}

const listeners = new Set<() => void>()
let active: PracticeBook | null = null

function readStored(): PracticeBook {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(PRACTICE_BOOK_STORAGE_KEY) === 'practice'
      ? 'practice'
      : 'demo'
  } catch {
    return 'demo'
  }
}

export function getPracticeBook(): PracticeBook {
  if (!active) active = readStored()
  return active
}

export function isPracticeBook(): boolean {
  return getPracticeBook() === 'practice'
}

export function setPracticeBook(book: PracticeBook): void {
  if (getPracticeBook() === book) return
  active = book
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(PRACTICE_BOOK_STORAGE_KEY, book)
  } catch {
    /* ignore */
  }
  listeners.forEach((listener) => listener())
}

export function subscribePracticeBook(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function practiceBookLabel(): string {
  return PRACTICE_BOOK_LABEL[getPracticeBook()]
}
