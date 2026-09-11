'use client'

import * as React from 'react'
import { useToast } from '@/components/ui/toast'
import type { MutationResult } from '@/lib/permissions'

/**
 * Optimistic toggle engine shared by all three governance matrices.
 *
 * How it works (React 19):
 *   • `values` is the confirmed server truth, held in state.
 *   • `useOptimistic` layers a pending patch on top while the server action
 *     is in flight — including a `pending` flag per key, so the switch can
 *     show its spinner with no extra state.
 *   • On success we fold the value into `values`, so when React discards the
 *     optimistic layer the new value is already there (no flicker).
 *   • On failure we do NOT fold it in, so React automatically rolls the
 *     switch back to the previous state.
 *
 * Every key is `"<entityId>:<something>"` — e.g. `usr_1:grade.entry`,
 * `crs_1:cls_2`. The caller's `commit` splits it back apart.
 */

interface ToggleState {
  values: Record<string, boolean>
  pending: Record<string, boolean>
}

interface Patch {
  key: string
  value: boolean
}

/** Toast copy: what to say when a switch is turned on vs off. */
export interface ToggleCopy {
  on: string
  off: string
}

export function useOptimisticToggles(
  initial: Record<string, boolean>,
  commit: (key: string, value: boolean) => Promise<MutationResult<unknown>>,
  copy: ToggleCopy
) {
  const { success, error } = useToast()
  const [values, setValues] = React.useState<Record<string, boolean>>(initial)

  const [state, addOptimistic] = React.useOptimistic<ToggleState, Patch>(
    { values, pending: {} },
    (current, patch) => ({
      values: { ...current.values, [patch.key]: patch.value },
      pending: { ...current.pending, [patch.key]: true },
    })
  )

  const [, startTransition] = React.useTransition()

  const toggle = React.useCallback(
    (key: string, next: boolean, subject: string) => {
      startTransition(async () => {
        addOptimistic({ key, value: next })
        const result = await commit(key, next)
        if (result.ok) {
          setValues((current) => ({ ...current, [key]: next }))
          success(next ? copy.on : copy.off, subject)
        } else {
          error('Change not saved', result.error)
        }
      })
    },
    [addOptimistic, commit, copy, error, success]
  )

  return {
    values: state.values,
    pending: state.pending,
    toggle,
    /** Escape hatch for panels that need to re-sync after a server refresh. */
    reset: setValues,
  }
}
