'use client'

import * as React from 'react'
import { ErrorState } from '@/components/ui/states'

export default function TeacherAssignmentsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  React.useEffect(() => {
    console.error('[teacher/assignments]', error)
  }, [error])

  return (
    <div className="mx-auto max-w-3xl py-10">
      <ErrorState
        title="Assignments failed to load"
        description={
          error.message ||
          'Your assignment list could not be read. Nothing has been changed — retry when ready.'
        }
        onRetry={reset}
      />
    </div>
  )
}
