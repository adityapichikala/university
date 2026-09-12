'use client'

import * as React from 'react'
import { ErrorState } from '@/components/ui/states'

export default function ParentError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  React.useEffect(() => {
    console.error('[parent]', error)
  }, [error])

  return (
    <div className="mx-auto max-w-3xl py-10">
      <ErrorState
        title="Could not load your child's record"
        description={
          error.message || 'Nothing has been changed — retry when ready.'
        }
        onRetry={reset}
      />
    </div>
  )
}
