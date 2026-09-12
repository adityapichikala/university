'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState, Spinner } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { decideLeaveRequest } from '@/lib/leave-actions'
import { LEAVE_STATUS_STYLE, asLeaveStatus, leaveDaysLabel } from '@/lib/leave'
import { cn } from '@/lib/utils'

/**
 * Leave approval queue — shared by the HOD and HR portals.
 *
 * Both screens decide the same entity under the same permission, so the
 * optimistic-update-with-rollback logic exists exactly once. The only
 * difference is which rows the server chose to send.
 */

export interface LeaveRow {
  id: string
  employeeName: string
  employeeRegno: string
  designation: string
  departmentName?: string
  startDate: string
  endDate: string
  days: number
  reason: string
  status: string
  reviewedAt: string | null
}

interface Props {
  leave: LeaveRow[]
  canApprove: boolean
  /** Shown under the title — differs per portal. */
  description?: string
  emptyTitle?: string
  emptyDescription?: string
}

export function LeaveQueue({
  leave,
  canApprove,
  description = 'Approve or reject requests. Every decision is written to the audit log.',
  emptyTitle = 'No leave requests',
  emptyDescription = 'Requests will appear here as staff file them.',
}: Props) {
  const toast = useToast()
  const router = useRouter()
  const [busyId, setBusyId] = React.useState<string | null>(null)

  // Decisions are a sparse override on top of the server rows, so a refresh
  // shows fresh data through without any props-to-state syncing.
  const [overrides, setOverrides] = React.useState<
    Record<string, { status: string; reviewedAt: string }>
  >({})

  const rows = React.useMemo(
    () => leave.map((r) => (r.id in overrides ? { ...r, ...overrides[r.id] } : r)),
    [leave, overrides]
  )

  async function decide(id: string, decision: 'APPROVED' | 'REJECTED') {
    const previous = overrides
    setOverrides((current) => ({
      ...current,
      [id]: { status: decision, reviewedAt: new Date().toISOString().slice(0, 10) },
    }))
    setBusyId(id)

    let result: { ok: boolean; error?: string }
    try {
      result = await decideLeaveRequest({ id, decision })
    } catch {
      result = { ok: false, error: 'Network error — nothing was recorded' }
    }

    setBusyId(null)

    if (!result.ok) {
      setOverrides(previous)
      toast.error('Could not record decision', result.error)
      return
    }

    toast.success(
      decision === 'APPROVED' ? 'Leave approved' : 'Leave rejected',
      'The decision has been written to the audit log.'
    )
    router.refresh()
  }

  // Pending first — the whole point of a queue is what still needs a human.
  const ordered = React.useMemo(() => {
    const pending = rows.filter((r) => asLeaveStatus(r.status) === 'PENDING')
    const decided = rows.filter((r) => asLeaveStatus(r.status) !== 'PENDING')
    return [...pending, ...decided]
  }, [rows])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Leave requests</CardTitle>
        <CardDescription>
          {canApprove
            ? description
            : 'You can see the queue but do not hold the approval permission.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {rows.length === 0 ? (
          <div className="px-6">
            <EmptyState icon="event_available" title={emptyTitle} description={emptyDescription} />
          </div>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {ordered.map((r) => {
              const style = LEAVE_STATUS_STYLE[asLeaveStatus(r.status)]
              const isPending = asLeaveStatus(r.status) === 'PENDING'
              return (
                <li key={r.id} className="px-6 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-foreground">{r.employeeName}</p>
                        <span className="num text-[11px] text-accent">{r.employeeRegno}</span>
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider',
                            style.chip
                          )}
                        >
                          {style.label}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted">
                        {r.designation}
                        {r.departmentName ? (
                          <span className="text-subtle"> · {r.departmentName}</span>
                        ) : null}
                      </p>
                      <p className="num mt-1 text-[11px] text-subtle">
                        {r.startDate} → {r.endDate} · {leaveDaysLabel(r.days)}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-muted">{r.reason}</p>
                    </div>

                    {isPending && canApprove ? (
                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          size="sm"
                          variant="accent"
                          disabled={busyId === r.id}
                          onClick={() => decide(r.id, 'APPROVED')}
                        >
                          {busyId === r.id ? <Spinner /> : null}
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === r.id}
                          onClick={() => decide(r.id, 'REJECTED')}
                        >
                          Reject
                        </Button>
                      </div>
                    ) : (
                      <p className="num shrink-0 text-[11px] text-subtle">
                        {r.reviewedAt ? `decided ${r.reviewedAt}` : 'awaiting review'}
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
