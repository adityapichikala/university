'use client'

import * as React from 'react'
import { ErrorState } from '@/components/ui/states'

export default function FinanceError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  React.useEffect(() => {
    console.error('[finance]', error)
  }, [error])

  return (
    <div className="mx-auto max-w-3xl py-10">
      <ErrorState
        title="Finance failed to load"
        description={
          error.message ||
          'Fee data could not be read. No payment has been recorded — retry when ready.'
        }
        onRetry={reset}
      />
    </div>
  )
}
