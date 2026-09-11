'use client'

import * as React from 'react'
import { ErrorState } from '@/components/ui/states'

export default function StudentFeesError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  React.useEffect(() => {
    console.error('[student/fees]', error)
  }, [error])

  return (
    <div className="mx-auto max-w-3xl py-10">
      <ErrorState
        title="Fees failed to load"
        description={
          error.message ||
          'Your fee records could not be read. No payment has been taken — retry when ready.'
        }
        onRetry={reset}
      />
    </div>
  )
}
