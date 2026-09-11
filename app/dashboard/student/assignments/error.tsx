'use client'

import * as React from 'react'
import { ErrorState } from '@/components/ui/states'

export default function StudentAssignmentsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  React.useEffect(() => {
    console.error('[student/assignments]', error)
  }, [error])

  return (
    <div className="mx-auto max-w-3xl py-10">
      <ErrorState
        title="Assignments failed to load"
        description={
          error.message ||
          'Your assignment feed could not be read. Nothing has been submitted or changed — retry when ready.'
        }
        onRetry={reset}
      />
    </div>
  )
}
