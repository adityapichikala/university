'use client'

import * as React from 'react'
import { ErrorState } from '@/components/ui/states'

export default function DepartmentsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  React.useEffect(() => {
    console.error('[admin-departments]', error)
  }, [error])

  return (
    <div className="mx-auto max-w-3xl py-10">
      <ErrorState
        title="Departments failed to load"
        description={
          error.message ||
          'The department structure could not be read. Nothing has been created, renamed or reassigned — retry when ready.'
        }
        onRetry={reset}
      />
    </div>
  )
}
