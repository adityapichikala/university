'use client'

import * as React from 'react'
import { ErrorState } from '@/components/ui/states'

export default function MyLeaveError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  React.useEffect(() => {
    console.error('[leave]', error)
  }, [error])

  return (
    <div className="mx-auto max-w-3xl py-10">
      <ErrorState
        title="My Leave failed to load"
        description={
          error.message ||
          'Your leave history could not be read. No request has been filed or withdrawn — retry when ready.'
        }
        onRetry={reset}
      />
    </div>
  )
}
