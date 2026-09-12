'use client'

import * as React from 'react'
import { ErrorState } from '@/components/ui/states'

export default function LibrarianError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  React.useEffect(() => {
    console.error('[librarian]', error)
  }, [error])

  return (
    <div className="mx-auto max-w-3xl py-10">
      <ErrorState
        title="Library failed to load"
        description={
          error.message ||
          'Catalog and loans could not be read. Nothing has been issued — retry when ready.'
        }
        onRetry={reset}
      />
    </div>
  )
}
