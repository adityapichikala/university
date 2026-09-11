'use client'

import * as React from 'react'
import { ErrorState } from '@/components/ui/states'

/** Route-level error boundary for the audit log. */
export default function AuditLogError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  React.useEffect(() => {
    console.error('[admin/audit]', error)
  }, [error])

  return (
    <div className="mx-auto max-w-3xl py-10">
      <ErrorState
        title="Audit log failed to load"
        description={
          error.message ||
          'The audit trail could not be read. Nothing has been changed — retry when ready.'
        }
        onRetry={reset}
      />
    </div>
  )
}
