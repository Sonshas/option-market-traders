import { Link } from 'react-router-dom'
import { Card } from '@/components/ui'

export function NotFoundPage() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-ink p-6">
      <Card className="max-w-md text-center">
        <p className="font-mono text-sm text-signal">404</p>
        <h1 className="mt-2 font-display text-2xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-mist">That route is not part of the SmartBaseBinary interface.</p>
        <Link to="/" className="mt-4 inline-block text-sm text-signal hover:underline">
          Return home
        </Link>
      </Card>
    </div>
  )
}
