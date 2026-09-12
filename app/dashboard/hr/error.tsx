'use client'

import * as React from 'react'
import { ErrorState } from '@/components/ui/states'

export default function HrError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  React.useEffect(() => {
    console.error('[hr]', error)
  }, [error])

  return (
    <div className="mx-auto max-w-3xl py-10">
      <ErrorState
        title="HR portal failed to load"
        description={
          error.message ||
          'The employee record could not be read. No leave decision has been recorded — retry when ready.'
        }
        onRetry={reset}
      />
    </div>
  )
}
