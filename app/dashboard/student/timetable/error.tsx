'use client'

import * as React from 'react'
import { ErrorState } from '@/components/ui/states'

export default function StudentTimetableError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  React.useEffect(() => {
    console.error('[student/timetable]', error)
  }, [error])

  return (
    <div className="mx-auto max-w-3xl py-10">
      <ErrorState
        title="Timetable failed to load"
        description={
          error.message ||
          'Your schedule could not be read. Nothing has been changed — retry when ready.'
        }
        onRetry={reset}
      />
    </div>
  )
}
