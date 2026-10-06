import { useEffect, useState } from 'react'
import { useAccountMode } from '@/hooks/useAccountMode'
import { loadDemoState, subscribeDemoStore } from '@/lib/demo-store'
import { botService } from '@/services/bots'
import { copyTradingService } from '@/services/copy-trading'
import { notificationService, supportService } from '@/services/notifications'
import type { Bot, BotRun, CopyTrade, CopyTrader, Notification, SupportTicket } from '@/types'

export function useBots() {
  const { kind } = useAccountMode()
  const [bots, setBots] = useState<Bot[]>([])
  const [runs, setRuns] = useState<BotRun[]>([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const load = () => {
      void Promise.all([botService.listBots(kind), botService.listRuns(kind)]).then(([botsResult, runsResult]) => {
        if (cancelled) return
        setBots(botsResult.data)
        setRuns(kind === 'demo' ? loadDemoState().botRuns : runsResult.data)
        setMessage(botsResult.message)
        setLoading(false)
      })
    }

    load()
    const unsubscribe = kind === 'demo' ? subscribeDemoStore(load) : () => undefined
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [kind])

  return { bots, runs, message, loading, kind }
}

export function useCopyTraders() {
  const { kind } = useAccountMode()
  const [traders, setTraders] = useState<CopyTrader[]>([])
  const [copies, setCopies] = useState<CopyTrade[]>([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const load = () => {
      void Promise.all([copyTradingService.listTraders(kind), copyTradingService.listCopies(kind)]).then(
        ([tradersResult, copiesResult]) => {
          if (cancelled) return
          setTraders(tradersResult.data)
          setCopies(kind === 'demo' ? loadDemoState().copyTrades : copiesResult.data)
          setMessage(tradersResult.message)
          setLoading(false)
        },
      )
    }

    load()
    const unsubscribe = kind === 'demo' ? subscribeDemoStore(load) : () => undefined
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [kind])

  return { traders, copies, message, loading, kind }
}

export function useNotifications() {
  const { kind } = useAccountMode()
  const [items, setItems] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const load = () => {
      void notificationService.list(kind).then((result) => {
        if (cancelled) return
        setItems(kind === 'demo' ? loadDemoState().notifications : result.data)
        setLoading(false)
      })
    }

    load()
    const unsubscribe = kind === 'demo' ? subscribeDemoStore(load) : () => undefined
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [kind])

  return { items, loading }
}

export function useSupportTickets() {
  const { kind } = useAccountMode()
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const load = () => {
      void supportService.listTickets(kind).then((result) => {
        if (cancelled) return
        setTickets(kind === 'demo' ? loadDemoState().tickets : result.data)
        setLoading(false)
      })
    }

    load()
    const unsubscribe = kind === 'demo' ? subscribeDemoStore(load) : () => undefined
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [kind])

  return { tickets, loading }
}
