'use client'

import * as React from 'react'
import { ErrorState } from '@/components/ui/states'

export default function StudentAnnouncementsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  React.useEffect(() => {
    console.error('[student/announcements]', error)
  }, [error])

  return (
    <div className="mx-auto max-w-3xl py-10">
      <ErrorState
        title="Announcements failed to load"
        description={
          error.message ||
          'Your notice board could not be read. Your read receipts are unaffected — retry when ready.'
        }
        onRetry={reset}
      />
    </div>
  )
}
