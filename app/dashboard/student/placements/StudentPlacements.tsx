'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState, Spinner } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { KpiCard } from '@/components/dashboard/kpi-card'
import { applyToDrive, withdrawApplication } from '@/lib/placement-actions'
import {
  APPLICATION_STATUS_STYLE,
  asApplicationStatus,
  type ApplicationStatus,
} from '@/lib/phase4-query'
import { cn } from '@/lib/utils'

/**
 * Student placement browser.
 *
 * Applying and withdrawing are sparse overrides on the server rows — the
 * status flips instantly and rolls back if the write is refused, so a second
 * attempt at a closed drive shows the real error rather than a stale button.
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

  async function withdraw(driveId: string, applicationId: string) {
    setBusyId(driveId)
    let result: { ok: boolean; error?: string }
    try {
      result = await withdrawApplication({ applicationId })
    } catch {
      result = { ok: false, error: 'Network error — nothing was changed' }
    }
    setBusyId(null)

    if (!result.ok) {
      toast.error('Could not withdraw', result.error)
      return
    }

    setOverrides((current) => ({ ...current, [driveId]: null }))
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
                const canApply = !d.closed && !d.applicationId
                const canWithdraw =
                  d.applicationId && status !== 'SELECTED' && status !== 'REJECTED' && status !== 'WITHDRAWN'

                return (
                  <li
                    key={d.id}
                    className="flex flex-wrap items-start justify-between gap-3 px-6 py-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-foreground">{d.companyName}</p>
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
                          Apply
                        </Button>
                      ) : canWithdraw ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId === d.id}
                          onClick={() => withdraw(d.id, d.applicationId as string)}
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
    </div>
  )
}
