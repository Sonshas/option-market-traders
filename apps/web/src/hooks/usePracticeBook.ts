import { useSyncExternalStore } from 'react'
import { getPracticeBook, setPracticeBook, subscribePracticeBook, type PracticeBook } from '@/lib/practice-book'

export function usePracticeBook(): { book: PracticeBook; isPractice: boolean; setBook: (book: PracticeBook) => void } {
  const book = useSyncExternalStore(subscribePracticeBook, getPracticeBook, getPracticeBook)
  return { book, isPractice: book === 'practice', setBook: setPracticeBook }
}
