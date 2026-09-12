'use client'

import * as React from 'react'
import { ErrorState } from '@/components/ui/states'

export default function AdmissionsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  React.useEffect(() => {
    console.error('[admin-admissions]', error)
  }, [error])

  return (
    <div className="mx-auto max-w-3xl py-10">
      <ErrorState
        title="Admissions failed to load"
        description={
          error.message ||
          'The application list could not be read. No decision has been recorded and nobody has been enrolled — retry when ready.'
        }
        onRetry={reset}
      />
    </div>
  )
}
