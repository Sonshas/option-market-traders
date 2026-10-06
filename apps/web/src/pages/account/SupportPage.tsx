import { useState, type FormEvent } from 'react'
import { Button, Card, EmptyState, Input, PageHeader, Textarea } from '@/components/ui'
import { useSupportTickets } from '@/hooks/useBots'
import { supportService } from '@/services/notifications'

export function SupportPage() {
  const { tickets, loading } = useSupportTickets()
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const next: Record<string, string> = {}
    if (subject.trim().length < 3) next.subject = 'Enter a subject of at least 3 characters.'
    if (message.trim().length < 10) next.message = 'Enter a message of at least 10 characters.'
    setErrors(next)
    if (Object.keys(next).length) return
    setBusy(true)
    const created = await supportService.createTicket({ subject, message })
    setResult(
      created.connected
        ? 'Your message was saved in this browser. Live support tickets are coming soon.'
        : 'Your ticket could not be submitted. Please try again later.',
    )
    setBusy(false)
  }

  return (
    <div>
      <PageHeader title="Support" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <form className="space-y-3" onSubmit={(event) => void onSubmit(event)}>
            <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} error={errors.subject} />
            <Textarea label="Message" value={message} onChange={(e) => setMessage(e.target.value)} error={errors.message} />
            {result ? <p className="text-sm text-mist">{result}</p> : null}
            <Button type="submit" disabled={busy}>
              {busy ? 'Sending…' : 'Submit ticket'}
            </Button>
          </form>
        </Card>
        <Card>
          {loading ? null : tickets.length === 0 ? (
            <EmptyState title="No tickets yet" />
          ) : (
            <ul className="divide-y divide-line/60">
              {tickets.map((ticket) => (
                <li key={ticket.id} className="py-3">
                  <p className="text-sm font-semibold text-paper">{ticket.subject}</p>
                  <p className="mt-0.5 line-clamp-2 text-sm text-mist">{ticket.message}</p>
                  <p className="mt-1 text-[11px] uppercase text-mist">{ticket.status}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
