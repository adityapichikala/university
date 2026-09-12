'use client'

import * as React from 'react'
import { ErrorState } from '@/components/ui/states'

export default function HodError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  React.useEffect(() => {
    console.error('[hod]', error)
  }, [error])

  return (
    <div className="mx-auto max-w-3xl py-10">
      <ErrorState
        title="Department portal failed to load"
        description={
          error.message ||
          'The department overview could not be read. No leave decision has been recorded — retry when ready.'
        }
        onRetry={reset}
      />
    </div>
  )
}
