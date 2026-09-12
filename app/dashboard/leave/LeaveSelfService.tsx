'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState, Spinner } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { KpiCard } from '@/components/dashboard/kpi-card'
import { cancelLeaveRequest, fileLeaveRequest } from '@/lib/leave-actions'
import { LEAVE_STATUS_STYLE, asLeaveStatus, leaveDaysLabel } from '@/lib/leave'
import { cn } from '@/lib/utils'

/**
 * Staff self-service workspace.
 *
 * Newly filed requests are prepended locally for instant feedback; the server
 * refresh then replaces them with authoritative rows. Withdrawals flip the
 * status optimistically and roll back on failure — same sparse-override
 * pattern used by the HOD/HR queue.
 */

interface LeaveRequestRow {
  id: string
  startDate: string
  endDate: string
  days: number
  reason: string
  status: string
  reviewedAt: string | null
}

interface Props {
  requests: LeaveRequestRow[]
  canRequest: boolean
  missingEmployeeReason?: string
  approvedDays: number
  year: number
}

const todayIso = () => new Date().toISOString().slice(0, 10)

export function LeaveSelfService({
  requests,
  canRequest,
  missingEmployeeReason,
  approvedDays,
  year,
}: Props) {
  const toast = useToast()
  const router = useRouter()

  const [startDate, setStartDate] = React.useState('')
  const [endDate, setEndDate] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [filing, setFiling] = React.useState(false)
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [local, setLocal] = React.useState<LeaveRequestRow[]>([])

  const rows = React.useMemo(() => {
    const seen = new Set(local.map((r) => r.id))
    return [...local, ...requests.filter((r) => !seen.has(r.id))]
  }, [local, requests])

  const pending = rows.filter((r) => asLeaveStatus(r.status) === 'PENDING')
  const decided = rows.filter((r) => asLeaveStatus(r.status) !== 'PENDING')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!startDate || !endDate) {
      toast.error('Pick both dates', 'A leave request needs a start and an end.')
      return
    }
    if (endDate < startDate) {
      toast.error('Check the dates', 'The end date is before the start date.')
      return
    }
    if (reason.trim().length < 5) {
      toast.error('Add a reason', 'Approvers need at least a short explanation.')
      return
    }

    setFiling(true)
    let result: { ok: boolean; error?: string; id?: string }
    try {
      result = await fileLeaveRequest({ startDate, endDate, reason })
    } catch {
      result = { ok: false, error: 'Network error — nothing was filed' }
    }
    setFiling(false)

    if (!result.ok) {
      toast.error('Could not file request', result.error)
      return
    }

    const days =
      Math.floor(
        (new Date(`${endDate}T00:00:00Z`).getTime() -
          new Date(`${startDate}T00:00:00Z`).getTime()) /
          86_400_000
      ) + 1

    setLocal((current) => [
      {
        id: result.id ?? `local-${Date.now()}`,
        startDate,
        endDate,
        days,
        reason: reason.trim(),
        status: 'PENDING',
        reviewedAt: null,
      },
      ...current,
    ])
    setStartDate('')
    setEndDate('')
    setReason('')
    toast.success('Request filed', 'It is now visible to your approver.')
    router.refresh()
  }

  async function withdraw(id: string) {
    setBusyId(id)

    let result: { ok: boolean; error?: string }
    try {
      result = await cancelLeaveRequest({ id })
    } catch {
      result = { ok: false, error: 'Network error — nothing was changed' }
    }
    setBusyId(null)

    if (!result.ok) {
      toast.error('Could not withdraw', result.error)
      return
    }

    setLocal((current) =>
      current.map((r) =>
        r.id === id ? { ...r, status: 'CANCELLED', reviewedAt: todayIso() } : r
      )
    )
    toast.success('Request withdrawn', 'It will no longer be sent for approval.')
    router.refresh()
  }

  return (
    <div className="space-y-6">
      {/* ── KPI bento ─────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon="pending_actions"
          label="Pending"
          value={pending.length}
          hint="awaiting a decision"
          tone={pending.length > 0 ? 'warning' : 'default'}
        />
        <KpiCard
          icon="event_available"
          label={`Approved ${year}`}
          value={approvedDays}
          hint={approvedDays === 1 ? 'day taken' : 'days taken'}
          tone="success"
        />
        <KpiCard icon="history" label="Total filed" value={rows.length} hint="all time" />
        <KpiCard
          icon="event_busy"
          label="Decided"
          value={decided.length}
          hint="approved, rejected or withdrawn"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── File a request ──────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>File a request</CardTitle>
            <CardDescription>
              Requests go to your department approver. You cannot backdate leave or overlap an
              existing request.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!canRequest ? (
              <EmptyState
                icon="badge"
                title="No employee record"
                description={missingEmployeeReason}
              />
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="leave-start"
                      className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-subtle"
                    >
                      Start
                    </label>
                    <input
                      id="leave-start"
                      type="date"
                      value={startDate}
                      min={todayIso()}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="leave-end"
                      className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-subtle"
                    >
                      End
                    </label>
                    <input
                      id="leave-end"
                      type="date"
                      value={endDate}
                      min={startDate || todayIso()}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="leave-reason"
                    className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-subtle"
                  >
                    Reason
                  </label>
                  <textarea
                    id="leave-reason"
                    rows={3}
                    value={reason}
                    maxLength={500}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why you need the leave"
                    className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                  />
                  <p className="num mt-1 text-right text-[10px] text-subtle">
                    {reason.length}/500
                  </p>
                </div>

                <Button type="submit" variant="accent" disabled={filing}>
                  {filing ? <Spinner /> : null}
                  Submit request
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        {/* ── My requests ─────────────────────────────────────────────────── */}
        <Card id="history" className="scroll-mt-24">
          <CardHeader>
            <CardTitle>My requests</CardTitle>
            <CardDescription>{rows.length} filed · newest first</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {rows.length === 0 ? (
              <div className="px-6">
                <EmptyState
                  icon="event_note"
                  title="No leave requests"
                  description="Anything you file will appear here with its approval status."
                />
              </div>
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {rows.map((r) => {
                  const style = LEAVE_STATUS_STYLE[asLeaveStatus(r.status)]
                  const isPending = asLeaveStatus(r.status) === 'PENDING'
                  return (
                    <li key={r.id} className="px-6 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="num text-xs font-medium text-foreground">
                              {r.startDate} → {r.endDate}
                            </span>
                            <span
                              className={cn(
                                'rounded-full px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider',
                                style.chip
                              )}
                            >
                              {style.label}
                            </span>
                          </div>
                          <p className="num mt-0.5 text-[11px] text-subtle">
                            {leaveDaysLabel(r.days)}
                            {r.reviewedAt ? ` · decided ${r.reviewedAt}` : ''}
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-muted">{r.reason}</p>
                        </div>

                        {isPending ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busyId === r.id}
                            onClick={() => withdraw(r.id)}
                          >
                            {busyId === r.id ? <Spinner /> : null}
                            Withdraw
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
