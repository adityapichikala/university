'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/toast'

/**
 * Shared write path for the officer portals.
 *
 * Every mutation goes through the guarded REST route — not a shortcut straight
 * to the database — so the screen and the API can never disagree about what a
 * user is allowed to do. A 403 from the server is surfaced verbatim rather
 * than being pre-empted by hiding a button.
 */

export type MutationMethod = 'POST' | 'PATCH' | 'DELETE'

export interface ApiError {
  message: string
  status: number
  /** Present on 409 conflict responses, e.g. timetable clashes. */
  conflicts?: unknown
}

interface Options {
  /** Called after a successful write, once the server data has been refetched. */
  onSuccess?: () => void
  /** Override the default success toast title. */
  successTitle?: string
}

export function useApiMutation() {
  const router = useRouter()
  const { success, error } = useToast()
  const [pending, setPending] = React.useState(false)

  const run = React.useCallback(
    async (
      url: string,
      method: MutationMethod,
      body?: unknown,
      options: Options = {}
    ): Promise<boolean> => {
      setPending(true)
      try {
        const res = await fetch(url, {
          method,
          headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        })

        const payload = await res.json().catch(() => ({}))

        if (!res.ok) {
          const message =
            (payload as { error?: string }).error ?? `Request failed (${res.status})`
          error(options.successTitle ?? 'Action failed', message)
          return false
        }

        // Re-render the server component so the new numbers arrive from the DB
        // rather than being patched into local state by hand.
        router.refresh()
        success(options.successTitle ?? 'Saved', (payload as { message?: string }).message)
        options.onSuccess?.()
        return true
      } catch {
        error(options.successTitle ?? 'Action failed', 'Network error — check your connection.')
        return false
      } finally {
        setPending(false)
      }
    },
    [router, success, error]
  )

  return { run, pending }
}
