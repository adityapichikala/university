'use client'

import * as React from 'react'
import { ErrorState } from '@/components/ui/states'

export default function RegistrarError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  React.useEffect(() => {
    console.error('[registrar]', error)
  }, [error])

  return (
    <div className="mx-auto max-w-3xl py-10">
      <ErrorState
        title="Registrar portal failed to load"
        description={
          error.message ||
          'The records could not be read. No certificate has been issued — retry when ready.'
        }
        onRetry={reset}
      />
    </div>
  )
}
