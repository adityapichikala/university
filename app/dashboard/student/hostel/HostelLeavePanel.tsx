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
  MAX_LEAVE_NIGHTS,
  asHostelLeaveStatus,
  nightsBetween,
  parseDateOnly,
  toDateInput,
} from '@/lib/hostel-leave'
import { cancelHostelLeave, requestHostelLeave, type HostelLeaveRow } from './actions'

/**
 * Student half of hostel leave: file a request, cancel a pending one, and
 * print the slip a warden has approved.
 *
 * The slip is rendered on screen rather than generated as a file — a printed
 * page is what a gate guard actually checks, and `window.print()` plus a small
 * `@media print` block gives that without a PDF dependency. `printSlip` state
 * selects one request so only that slip (not the whole portal) reaches paper.
 */

export interface HostelStudent {
  name: string
  regno: string
  roomLabel: string | null
  block: string | null
}

interface Props {
  student: HostelStudent
  leaves: HostelLeaveRow[]
}

export function HostelLeavePanel({ student, leaves }: Props) {
  const { success, error } = useToast()
  const [pending, setPending] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const [printId, setPrintId] = React.useState<string | null>(null)

  // Controlled dates so the night count can update as the student types.
  const today = toDateInput(new Date())
  const [fromDate, setFromDate] = React.useState(today)
  const [toDate, setToDate] = React.useState(today)

  const from = parseDateOnly(fromDate)
  const to = parseDateOnly(toDate)
  const nights = from && to ? nightsBetween(from, to) : 0

  const live = leaves.filter((l) => l.status === 'PENDING' || l.status === 'APPROVED')
  const hasLiveCovering = live.length > 0

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const reason = String(data.get('reason') ?? '').trim()

    // Client-side guard mirrors the server action, which is the real authority.
    if (!from || !to) {
      error('Check the dates', 'Choose both a departure and a return date.')
      return
    }
    if (nights < 1) {
      error('Too short', 'A hostel leave must cover at least one night.')
      return
    }
    if (nights > MAX_LEAVE_NIGHTS) {
      error('Too long', `${MAX_LEAVE_NIGHTS} nights is the maximum in one request.`)
      return
    }
    if (reason.length < 10) {
      error('Reason needed', 'Tell the warden why — at least 10 characters.')
      return
    }

    setPending(true)
    const result = await requestHostelLeave({ fromDate, toDate, reason })
    setPending(false)

    if (!result.ok) {
      error('Request not filed', result.error)
      return
    }
    success('Leave requested', 'The warden has been notified.')
    form.reset()
    setOpen(false)
    setFromDate(today)
    setToDate(today)
  }

  async function cancel(row: HostelLeaveRow) {
    setPending(true)
    const result = await cancelHostelLeave({ id: row.id })
    setPending(false)
    if (!result.ok) {
      error('Could not cancel', result.error)
      return
    }
    success('Request cancelled')
    if (printId === row.id) setPrintId(null)
  }

  const printing = printId ? leaves.find((l) => l.id === printId) ?? null : null

  // The slip is the only thing on the page when printing.
  if (printing) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between print:hidden">
          <Button variant="outline" size="sm" onClick={() => setPrintId(null)}>
            <span className="material-symbols-outlined text-[18px] leading-none">arrow_back</span>
            Back
          </Button>
          <Button variant="accent" size="sm" onClick={() => window.print()}>
            <span className="material-symbols-outlined text-[18px] leading-none">print</span>
            Print slip
          </Button>
        </div>

        <div className="rounded-xl border border-border-strong bg-white p-8 text-slate-900 shadow-soft print:border-0 print:shadow-none">
          <div className="flex items-start justify-between border-b border-slate-300 pb-4">
            <div>
              <p className="text-lg font-bold">Apex University</p>
              <p className="text-xs">Office of the Hostel Warden</p>
            </div>
            <div className="text-right text-xs">
              <p className="font-semibold uppercase tracking-wide">Hostel leave slip</p>
              <p className="num mt-1">{printing.id.slice(-8).toUpperCase()}</p>
            </div>
          </div>

          <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
            <Field label="Student" value={student.name} />
            <Field label="Registration no." value={student.regno} />
            <Field label="Room" value={student.roomLabel ?? 'Not allocated'} />
            <Field label="Block" value={student.block ?? '—'} />
            <Field label="Departure" value={printing.fromDate} />
            <Field label="Return" value={printing.toDate} />
            <Field label="Nights" value={String(printing.nights)} />
            <Field
              label="Status"
              value={HOSTEL_LEAVE_LABEL[asHostelLeaveStatus(printing.status)]}
            />
          </dl>

          <div className="mt-6 border-t border-slate-300 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide">Reason</p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{printing.reason}</p>
          </div>

          {printing.note ? (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide">Warden&apos;s note</p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{printing.note}</p>
            </div>
          ) : null}

          <div className="mt-10 grid grid-cols-2 gap-10 text-xs">
            <div className="border-t border-slate-400 pt-2">Student signature</div>
            <div className="border-t border-slate-400 pt-2">Warden signature</div>
          </div>

          <p className="mt-6 text-[11px] leading-relaxed text-slate-600">
            Present this slip at the gate on departure and on return. It is valid only for the
            dates shown.
          </p>
        </div>
      </div>
    )
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Leave</CardTitle>
          <CardDescription>
            Apply for an overnight leave and collect your slip once the warden approves.
          </CardDescription>
        </div>
        <Button
          variant={open ? 'outline' : 'accent'}
          size="sm"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span className="material-symbols-outlined text-[18px] leading-none">
            {open ? 'close' : 'flight_takeoff'}
          </span>
          {open ? 'Cancel' : 'Apply for leave'}
        </Button>
      </CardHeader>

      <CardContent className="space-y-5">
        {open ? (
          <form
            onSubmit={submit}
            className="animate-fade space-y-4 rounded-xl border border-border bg-background p-4"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-muted">Departure</span>
                <Input
                  type="date"
                  name="fromDate"
                  value={fromDate}
                  min={today}
                  onChange={(e) => setFromDate(e.target.value)}
                  required
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-muted">Return</span>
                <Input
                  type="date"
                  name="toDate"
                  value={toDate}
                  min={fromDate || today}
                  onChange={(e) => setToDate(e.target.value)}
                  required
                />
              </label>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted">
                Reason <span className="text-subtle">(min 10 characters)</span>
              </span>
              <textarea
                name="reason"
                rows={3}
                maxLength={500}
                required
                placeholder="e.g. Attending a family function in Kochi."
                className={cn(
                  'w-full rounded-xl border border-border-strong bg-surface px-3.5 py-2.5 text-sm text-foreground',
                  'placeholder:text-subtle',
                  'transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20'
                )}
              />
            </label>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted">
                {nights >= 1 && nights <= MAX_LEAVE_NIGHTS ? (
                  <>
                    <span className="num font-semibold text-foreground">{nights}</span> night
                    {nights === 1 ? '' : 's'} away · max {MAX_LEAVE_NIGHTS}
                  </>
                ) : (
                  <>Leave must cover 1–{MAX_LEAVE_NIGHTS} nights.</>
                )}
              </p>
              <Button type="submit" variant="accent" size="sm" disabled={pending}>
                {pending ? <Spinner /> : null}
                Submit request
              </Button>
            </div>

            {hasLiveCovering ? (
              <p className="text-[11px] leading-relaxed text-subtle">
                Requests that overlap a pending or approved leave are refused — cancel the old one
                first.
              </p>
            ) : null}
          </form>
        ) : null}

        {leaves.length === 0 ? (
          <EmptyState
            icon="flight_takeoff"
            title="No leave requests"
            description="You have not applied for hostel leave yet. Apply above and the warden will decide."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-border text-xs uppercase tracking-wide text-muted">
                  <th className="px-3 py-2.5 text-left font-medium">From</th>
                  <th className="px-3 py-2.5 text-left font-medium">To</th>
                  <th className="px-3 py-2.5 text-left font-medium">Nights</th>
                  <th className="px-3 py-2.5 text-left font-medium">Reason</th>
                  <th className="px-3 py-2.5 text-left font-medium">Status</th>
                  <th className="px-3 py-2.5 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {leaves.map((l) => {
                  const status = asHostelLeaveStatus(l.status)
                  return (
                    <tr key={l.id} className="border-b border-border last:border-0 align-top">
                      <td className="num px-3 py-3 font-medium text-foreground">{l.fromDate}</td>
                      <td className="num px-3 py-3 text-muted">{l.toDate}</td>
                      <td className="num px-3 py-3 text-muted">{l.nights}</td>
                      <td className="max-w-[18rem] px-3 py-3 text-muted">
                        <span className="line-clamp-2">{l.reason}</span>
                        {l.note ? (
                          <span className="mt-1 block text-[11px] italic text-subtle">
                            Warden: {l.note}
                          </span>
                        ) : null}
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
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {status === 'APPROVED' ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setPrintId(l.id)}
                              title="Generate the gate slip"
                            >
                              <span className="material-symbols-outlined text-[18px] leading-none">
                                print
                              </span>
                              Leave slip
                            </Button>
                          ) : null}
                          {status === 'PENDING' ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={pending}
                              onClick={() => cancel(l)}
                            >
                              Cancel
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  )
}
