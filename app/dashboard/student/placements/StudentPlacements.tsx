'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Dialog } from '@base-ui/react/dialog'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState, Spinner } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { KpiCard } from '@/components/dashboard/kpi-card'
import { applyToDrive, withdrawApplication } from '@/lib/placement-actions'
import {
  APPLICATION_STATUS_STYLE,
  asApplicationStatus,
  MAX_WITHDRAW_REASON,
  MIN_WITHDRAW_REASON,
  type ApplicationStatus,
} from '@/lib/phase4-query'
import { cn } from '@/lib/utils'

/**
 * Student placement browser.
 *
 * Applying and withdrawing are sparse overrides on the server rows — the
 * status flips instantly and rolls back if the write is refused, so a second
 * attempt at a closed drive shows the real error rather than a stale button.
 *
 * Withdrawal asks for a reason before it commits. The server requires one too,
 * so this dialog is the honest way to collect it rather than a validation
 * afterthought — and a withdrawn drive stays actionable, because re-applying is
 * allowed while the drive is still open.
 */

interface Drive {
  id: string
  companyName: string
  role: string
  eligibilityCriteria: string
  packageOffered: string
  driveDate: string
  closed: boolean
  applicantCount: number
  applicationId: string | null
  status: string | null
}

interface Props {
  drives: Drive[]
  summary: { open: number; applied: number; interviewing: number; offers: number }
}

export function StudentPlacements({ drives, summary }: Props) {
  const toast = useToast()
  const router = useRouter()
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [overrides, setOverrides] = React.useState<
    Record<string, { applicationId: string; status: ApplicationStatus } | null>
  >({})

  // The drive being withdrawn from, plus the reason typed so far. Null when
  // no dialog is open — so the dialog's state cannot outlive its trigger.
  const [withdrawTarget, setWithdrawTarget] = React.useState<{
    driveId: string
    applicationId: string
    companyName: string
  } | null>(null)
  const [reason, setReason] = React.useState('')

  const reasonTooShort = reason.trim().length < MIN_WITHDRAW_REASON

  const rows = React.useMemo(
    () =>
      drives.map((d) => {
        const override = d.id in overrides ? overrides[d.id] : undefined
        if (override === undefined) return d
        return override === null
          ? { ...d, applicationId: null, status: null }
          : { ...d, applicationId: override.applicationId, status: override.status }
      }),
    [drives, overrides]
  )

  // Open and unapplied first — that is what a student can still act on.
  const ordered = React.useMemo(() => {
    const actionable = rows.filter((d) => !d.closed && !d.applicationId)
    const rest = rows.filter((d) => d.closed || d.applicationId)
    return [...actionable, ...rest]
  }, [rows])

  async function apply(driveId: string) {
    setBusyId(driveId)
    let result: { ok: boolean; error?: string }
    try {
      result = await applyToDrive({ driveId })
    } catch {
      result = { ok: false, error: 'Network error — nothing was submitted' }
    }
    setBusyId(null)

    if (!result.ok) {
      toast.error('Could not apply', result.error)
      return
    }

    // The real id arrives on refresh; a placeholder keeps the button honest.
    setOverrides((current) => ({
      ...current,
      [driveId]: { applicationId: `pending-${driveId}`, status: 'APPLIED' },
    }))
    toast.success('Application submitted', 'The placement office can see it now.')
    router.refresh()
  }

  async function withdraw(driveId: string, applicationId: string, why: string) {
    setBusyId(driveId)
    let result: { ok: boolean; error?: string }
    try {
      result = await withdrawApplication({ applicationId, reason: why })
    } catch {
      result = { ok: false, error: 'Network error — nothing was changed' }
    }
    setBusyId(null)

    if (!result.ok) {
      toast.error('Could not withdraw', result.error)
      return
    }

    setOverrides((current) => ({ ...current, [driveId]: null }))
    setWithdrawTarget(null)
    setReason('')
    toast.success('Application withdrawn', 'You can apply again while the drive is open.')
    router.refresh()
  }

  return (
    <div className="space-y-6">
      {/* ── KPI bento ─────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon="business_center" label="Open drives" value={summary.open} hint="accepting applications" />
        <KpiCard icon="work" label="Applied" value={summary.applied} hint="drives you applied to" />
        <KpiCard
          icon="how_to_reg"
          label="Shortlisted"
          value={summary.interviewing}
          hint="moved to interview"
          tone={summary.interviewing > 0 ? 'warning' : 'default'}
        />
        <KpiCard
          icon="emoji_events"
          label="Offers"
          value={summary.offers}
          hint="congratulations"
          tone={summary.offers > 0 ? 'success' : 'default'}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Drives</CardTitle>
          <CardDescription>
            {drives.length} on the calendar · {summary.open} still open
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {drives.length === 0 ? (
            <div className="px-6">
              <EmptyState
                icon="business_center"
                title="No placement drives"
                description="Drives will appear here once the placement office schedules them."
              />
            </div>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {ordered.map((d) => {
                const status = d.status ? asApplicationStatus(d.status) : null
                const style = status ? APPLICATION_STATUS_STYLE[status] : null
                // A withdrawn application is not a live one, so the drive is
                // actionable again — that is the whole point of allowing a
                // re-apply rather than treating WITHDRAWN as final.
                const canApply = !d.closed && (!d.applicationId || status === 'WITHDRAWN')
                const canWithdraw =
                  Boolean(d.applicationId) &&
                  status !== 'SELECTED' &&
                  status !== 'REJECTED' &&
                  status !== 'WITHDRAWN'

                return (
                  <li
                    key={d.id}
                    className="flex flex-wrap items-start justify-between gap-3 px-6 py-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-foreground">{d.companyName}</p>
                        {/* JD download — a real navigation so the browser saves
                            the PDF rather than the router trying to render it. */}
                        <a
                          href={`/api/placements/drives/${d.id}/jd`}
                          download
                          title={`Download the job description for ${d.companyName}`}
                          aria-label={`Download the job description for ${d.companyName}`}
                          className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-surface px-1.5 text-[10px] font-medium text-muted transition-colors hover:border-border-strong hover:text-accent"
                        >
                          <span className="material-symbols-outlined text-[14px] leading-none">
                            download
                          </span>
                          JD
                        </a>
                        {style ? (
                          <span
                            className={cn(
                              'rounded-full px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider',
                              style.chip
                            )}
                          >
                            {style.label}
                          </span>
                        ) : null}
                        {d.closed ? (
                          <span className="rounded-full bg-background px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-subtle">
                            Closed
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-sm text-muted">{d.role}</p>
                      <p className="num mt-1 text-[11px] text-subtle">
                        {d.packageOffered} · drive <span className="num">{d.driveDate}</span> ·{' '}
                        {d.applicantCount} applicants
                      </p>
                      <p className="mt-1 text-xs text-muted">{d.eligibilityCriteria}</p>
                    </div>

                    <div className="shrink-0">
                      {canApply ? (
                        <Button
                          size="sm"
                          variant="accent"
                          disabled={busyId === d.id}
                          onClick={() => apply(d.id)}
                        >
                          {busyId === d.id ? <Spinner /> : null}
                          {status === 'WITHDRAWN' ? 'Apply again' : 'Apply'}
                        </Button>
                      ) : canWithdraw ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId === d.id}
                          onClick={() => {
                            setReason('')
                            setWithdrawTarget({
                              driveId: d.id,
                              applicationId: d.applicationId as string,
                              companyName: d.companyName,
                            })
                          }}
                        >
                          {busyId === d.id ? <Spinner /> : null}
                          Withdraw
                        </Button>
                      ) : status === 'SELECTED' ? (
                        <p className="num text-[11px] text-success">Offer received</p>
                      ) : status === 'WITHDRAWN' ? (
                        <p className="num text-[11px] text-subtle">Withdrawn</p>
                      ) : d.closed ? (
                        <p className="num text-[11px] text-subtle">Closed</p>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── Withdraw: ask why, then commit ─────────────────────────────────── */}
      <Dialog.Root
        open={withdrawTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setWithdrawTarget(null)
            setReason('')
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="animate-fade fixed inset-0 z-40 bg-primary/40" />
          <Dialog.Popup className="animate-fade fixed left-1/2 top-1/2 z-50 w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface p-6 shadow-lift focus:outline-none">
            <Dialog.Title className="font-heading text-base font-semibold text-foreground">
              Withdraw application
            </Dialog.Title>
            <p className="mt-1 text-sm text-muted">
              Withdrawing from{' '}
              <span className="font-medium text-foreground">{withdrawTarget?.companyName}</span>.
              The placement office sees your reason, and you can apply again while the drive is
              still open.
            </p>

            <form
              className="mt-4"
              onSubmit={(event) => {
                event.preventDefault()
                if (!withdrawTarget || reasonTooShort) return
                void withdraw(withdrawTarget.driveId, withdrawTarget.applicationId, reason)
              }}
            >
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-muted">
                  Why are you withdrawing?{' '}
                  <span className="text-subtle">(min {MIN_WITHDRAW_REASON} characters)</span>
                </span>
                <textarea
                  autoFocus
                  rows={3}
                  value={reason}
                  maxLength={MAX_WITHDRAW_REASON}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Accepted an offer elsewhere; the role no longer matches my specialisation."
                  className={cn(
                    'w-full rounded-xl border border-border-strong bg-surface px-3.5 py-2.5 text-sm text-foreground',
                    'placeholder:text-subtle',
                    'transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20'
                  )}
                />
              </label>

              <div className="mt-1.5 flex items-center justify-between text-[11px] text-subtle">
                <span>
                  {reasonTooShort
                    ? `${Math.max(0, MIN_WITHDRAW_REASON - reason.trim().length)} more character(s) needed`
                    : 'Ready to submit'}
                </span>
                <span className="num">
                  {reason.trim().length}/{MAX_WITHDRAW_REASON}
                </span>
              </div>

              <div className="mt-5 flex justify-end gap-2">
                <Dialog.Close className="inline-flex h-10 items-center rounded-xl border border-border-strong bg-surface px-4 text-sm font-medium text-foreground transition-colors hover:bg-background">
                  Keep application
                </Dialog.Close>
                <Button
                  type="submit"
                  variant="danger"
                  disabled={reasonTooShort || busyId !== null}
                >
                  {busyId !== null ? <Spinner /> : null}
                  Withdraw
                </Button>
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
