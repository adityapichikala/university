'use client'

import * as React from 'react'
import { ErrorState } from '@/components/ui/states'

/**
 * Route-level error boundary. Catches anything thrown while a panel is
 * loading — including a revoked permission mid-session.
 */
export default function AdminGovernanceError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  React.useEffect(() => {
    console.error('[admin/governance]', error)
  }, [error])

  return (
    <div className="mx-auto max-w-3xl py-10">
      <ErrorState
        title="Governance panel failed to load"
        description={
          error.message ||
          'The access control data could not be read. Nothing has been changed — retry when ready.'
        }
        onRetry={reset}
      />
    </div>
  )
}
