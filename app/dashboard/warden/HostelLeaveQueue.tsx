'use client'

import * as React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState, Spinner } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import {
  HOSTEL_LEAVE_CHIP,
  HOSTEL_LEAVE_LABEL,
  asHostelLeaveStatus,
} from '@/lib/hostel-leave'
import { bulkDecideHostelLeave } from './hostel-actions'

/**
 * Warden queue for hostel leave.
 *
 * Pending requests sit at the top with an inline decision form; already-decided
 * ones collapse into a history table. Selection is capped by nothing — the
 * server transaction only moves rows that are still PENDING, so a stale tab
 * cannot double-decide.
 */

export interface HostelLeaveQueueRow {
  id: string
  studentRegno: string
  studentName: string
  roomLabel: string | null
  fromDate: string
  toDate: string
  nights: number
  reason: string
  status: string
  note: string | null
  decidedAt: string | null
}

interface Props {
  rows: HostelLeaveQueueRow[]
}

export function HostelLeaveQueue({ rows }: Props) {
  const { success, error } = useToast()
  const [pending, setPending] = React.useState(false)
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [note, setNote] = React.useState('')
  const [showHistory, setShowHistory] = React.useState(false)

  const queue = rows.filter((r) => r.status === 'PENDING')
  const history = rows.filter((r) => r.status !== 'PENDING')

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function decide(ids: string[], decision: 'APPROVED' | 'REJECTED') {
    if (ids.length === 0) {
      error('Nothing selected', 'Tick at least one request first.')
      return
    }
    setPending(true)
    const result = await bulkDecideHostelLeave({ ids, decision, note })
    setPending(false)

    if (!result.ok) {
      error('Decision not recorded', result.error)
      return
    }
    const { decided, skipped } = result.data
    success(
      decision === 'APPROVED' ? 'Approved' : 'Rejected',
      skipped > 0
        ? `${decided} updated, ${skipped} already decided elsewhere.`
        : `${decided} request${decided === 1 ? '' : 's'} updated.`
    )
    setSelected(new Set())
    setNote('')
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Leave requests</CardTitle>
          <CardDescription>
            {queue.length === 0
              ? 'Nothing waiting — the queue is clear.'
              : `${queue.length} request${queue.length === 1 ? '' : 's'} awaiting your decision.`}
          </CardDescription>
        </div>
        {history.length > 0 ? (
          <Button variant="outline" size="sm" onClick={() => setShowHistory((v) => !v)}>
            <span className="material-symbols-outlined text-[18px] leading-none">
              {showHistory ? 'visibility_off' : 'history'}
            </span>
            {showHistory ? 'Hide' : 'History'}
          </Button>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-4">
        {queue.length === 0 ? (
          <EmptyState
            icon="event_available"
            title="No pending requests"
            description="When a student applies for hostel leave, it appears here for approval."
          />
        ) : (
          <>
            <div className="space-y-3">
              {queue.map((r) => (
                <label
                  key={r.id}
                  className={cn(
                    'flex cursor-pointer gap-3 rounded-xl border p-4 transition-colors',
                    selected.has(r.id)
                      ? 'border-accent bg-accent-soft/40'
                      : 'border-border bg-background hover:border-border-strong'
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
                    checked={selected.has(r.id)}
                    onChange={() => toggle(r.id)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="text-sm font-semibold text-foreground">
                        {r.studentName}
                      </span>
                      <span className="num text-xs text-muted">{r.studentRegno}</span>
                      {r.roomLabel ? (
                        <span className="num rounded-md bg-background px-1.5 py-0.5 text-[11px] text-subtle">
                          {r.roomLabel}
                        </span>
                      ) : null}
                    </div>
                    <p className="num mt-1 text-xs text-muted">
                      {r.fromDate} → {r.toDate}
                      <span className="ml-2 text-subtle">
                        {r.nights} night{r.nights === 1 ? '' : 's'}
                      </span>
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-muted">{r.reason}</p>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-background p-4">
              <label className="min-w-[16rem] flex-1">
                <span className="mb-1.5 block text-xs font-medium text-muted">
                  Note <span className="text-subtle">(optional, shown to the student)</span>
                </span>
                <Input
                  value={note}
                  maxLength={300}
                  placeholder="e.g. Return by 20:00 on the last day."
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending || selected.size === 0}
                  onClick={() => decide(Array.from(selected), 'REJECTED')}
                >
                  {pending ? <Spinner /> : null}
                  Reject selected
                </Button>
                <Button
                  variant="accent"
                  size="sm"
                  disabled={pending || selected.size === 0}
                  onClick={() => decide(Array.from(selected), 'APPROVED')}
                >
                  {pending ? <Spinner /> : null}
                  Approve selected
                </Button>
              </div>
            </div>

            {selected.size > 0 ? (
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="text-xs text-muted underline-offset-2 hover:text-foreground hover:underline"
              >
                Clear selection ({selected.size})
              </button>
            ) : null}
          </>
        )}

        {showHistory && history.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-border text-xs uppercase tracking-wide text-muted">
                  <th className="px-3 py-2.5 text-left font-medium">Student</th>
                  <th className="px-3 py-2.5 text-left font-medium">Dates</th>
                  <th className="px-3 py-2.5 text-left font-medium">Status</th>
                  <th className="px-3 py-2.5 text-left font-medium">Decided</th>
                </tr>
              </thead>
              <tbody>
                {history.map((r) => {
                  const status = asHostelLeaveStatus(r.status)
                  return (
                    <tr key={r.id} className="border-b border-border last:border-0 align-top">
                      <td className="px-3 py-3">
                        <span className="text-foreground">{r.studentName}</span>
                        <span className="num ml-2 text-[11px] text-subtle">{r.studentRegno}</span>
                      </td>
                      <td className="num px-3 py-3 text-muted">
                        {r.fromDate} → {r.toDate}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={cn(
                            'inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium',
                            HOSTEL_LEAVE_CHIP[status]
                          )}
                        >
                          {HOSTEL_LEAVE_LABEL[status]}
                        </span>
                        {r.note ? (
                          <span className="mt-1 block max-w-[16rem] text-[11px] italic text-subtle">
                            {r.note}
                          </span>
                        ) : null}
                      </td>
                      <td className="num px-3 py-3 text-muted">{r.decidedAt ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
