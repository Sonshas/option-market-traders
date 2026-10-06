import { Alert, Card, EmptyState, PageHeader, Skeleton } from '@/components/ui'
import type { ReactNode } from 'react'

export function AdminTablePage({
  title,
  subtitle,
  loading,
  message,
  children,
}: {
  title: string
  subtitle: string
  loading?: boolean
  message?: string
  children?: ReactNode
}) {
  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} />
      <Alert tone="warn">{message ?? 'Admin tools are not connected to production data.'}</Alert>
      <Card className="mt-4">
        {loading ? <Skeleton className="h-40" /> : (children ?? (
          <EmptyState title="No records" body="This list is empty until a real admin API is connected. Production data was not loaded." />
        ))}
      </Card>
    </div>
  )
}
