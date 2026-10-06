import { Card, EmptyState, PageHeader, Skeleton } from '@/components/ui'
import { useNotifications } from '@/hooks/useBots'

export function NotificationsPage() {
  const { items, loading } = useNotifications()
  return (
    <div>
      <PageHeader title="Notifications" />
      <Card>
        {loading ? (
          <Skeleton className="h-32" />
        ) : items.length === 0 ? (
          <EmptyState title="No notifications yet" />
        ) : (
          <ul className="divide-y divide-line/60">
            {items.map((item) => (
              <li key={item.id} className="py-3">
                <p className="text-sm font-semibold text-paper">{item.title}</p>
                <p className="mt-0.5 text-sm text-mist">{item.body}</p>
                <p className="mt-1 text-[11px] text-mist">{new Date(item.createdAt).toLocaleString()}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
