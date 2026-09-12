'use client'

import * as React from 'react'
import { ErrorState } from '@/components/ui/states'

export default function WardenError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  React.useEffect(() => {
    console.error('[warden]', error)
  }, [error])

  return (
    <div className="mx-auto max-w-3xl py-10">
      <ErrorState
        title="Hostel failed to load"
        description={
          error.message ||
          'Rooms and allocations could not be read. No bed has been moved — retry when ready.'
        }
        onRetry={reset}
      />
    </div>
  )
}
