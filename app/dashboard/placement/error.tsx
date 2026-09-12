'use client'

import * as React from 'react'
import { ErrorState } from '@/components/ui/states'

export default function PlacementError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  React.useEffect(() => {
    console.error('[placement]', error)
  }, [error])

  return (
    <div className="mx-auto max-w-3xl py-10">
      <ErrorState
        title="Placement portal failed to load"
        description={
          error.message ||
          'The drive pipeline could not be read. No application status has been changed — retry when ready.'
        }
        onRetry={reset}
      />
    </div>
  )
}
