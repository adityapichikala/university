'use client'

import * as React from 'react'
import { ErrorState } from '@/components/ui/states'

export default function StudentResultsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  React.useEffect(() => {
    console.error('[student/results]', error)
  }, [error])

  return (
    <div className="mx-auto max-w-3xl py-10">
      <ErrorState
        title="Results failed to load"
        description={
          error.message ||
          'Your transcript could not be read. Nothing has been changed — retry when ready.'
        }
        onRetry={reset}
      />
    </div>
  )
}
