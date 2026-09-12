'use client'

import * as React from 'react'
import { ErrorState } from '@/components/ui/states'

export default function TeacherAnnouncementsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  React.useEffect(() => {
    console.error('[teacher/announcements]', error)
  }, [error])

  return (
    <div className="mx-auto max-w-3xl py-10">
      <ErrorState
        title="Announcements failed to load"
        description={
          error.message ||
          'The broadcast board could not be read. Nothing has been posted — retry when ready.'
        }
        onRetry={reset}
      />
    </div>
  )
}
