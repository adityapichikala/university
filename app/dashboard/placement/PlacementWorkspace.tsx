'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState, Spinner } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { KpiCard } from '@/components/dashboard/kpi-card'
import { updateApplicationStatus } from '@/lib/placement-actions'
import {
  APPLICATION_STATUS_STYLE,
  APPLICATION_STATUSES,
  asApplicationStatus,
  type PipelineTally,
} from '@/lib/phase4-query'
import { cn } from '@/lib/utils'

/**
 * The placement pipeline.
 *
 * Status changes are a sparse override layered over the server rows, so a
 * refresh flows through cleanly and a failed write rolls back to the value the
 * server still holds. Same pattern as <LeaveQueue>.
 */

interface Application {
  id: string
  studentName: string
  studentRegno: string
  status: string
}

interface Drive {
  id: string
  companyName: string
  role: string
  eligibilityCriteria: string
  packageOffered: string
  driveDate: string
  tally: PipelineTally
  applications: Application[]
}

interface Props {
  drives: Drive[]
  overall: PipelineTally
  studentCount: number
}

export function PlacementWorkspace({ drives, overall, studentCount }: Props) {
  const toast = useToast()
  const router = useRouter()
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [overrides, setOverrides] = React.useState<Record<string, string>>({})
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({})

  const resolved = React.useMemo(
    () =>
      drives.map((d) => ({
        ...d,
        applications: d.applications.map((a) =>
          a.id in overrides ? { ...a, status: overrides[a.id] } : a
        ),
      })),
    [drives, overrides]
  )

  async function changeStatus(id: string, status: string) {
    const previous = overrides
    setOverrides((current) => ({ ...current, [id]: status }))
    setBusyId(id)

    let result: { ok: boolean; error?: string }
    try {
      result = await updateApplicationStatus({ applicationId: id, status })
    } catch {
      result = { ok: false, error: 'Network error — nothing was recorded' }
    }

    setBusyId(null)

    if (!result.ok) {
      setOverrides(previous)
      toast.error('Could not update status', result.error)
      return
    }

    // Keep the optimistic value; refresh re-reads the authoritative row.
    toast.success('Status updated', 'The change has been written to the audit log.')
    router.refresh()
  }

  return (
    <div className="space-y-6">
      {/* ── KPI bento ─────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon="business_center" label="Drives" value={drives.length} hint="on the calendar" />
        <KpiCard
          icon="work"
          label="Applications"
          value={overall.total}
          hint="across all drives"
        />
        <KpiCard
          icon="emoji_events"
          label="Offers"
          value={overall.selected}
          hint={`${overall.offerRate}% of decided outcomes`}
          tone={overall.selected > 0 ? 'success' : 'default'}
        />
        <KpiCard
          icon="pending_actions"
          label="In flight"
          value={overall.applied + overall.shortlisted}
          hint="applied or shortlisted"
          tone={overall.applied > 0 ? 'warning' : 'default'}
        />
      </div>

      {/* ── Funnel ────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Pipeline</CardTitle>
          <CardDescription>
            {studentCount} students eligible · {overall.total} applications logged
          </CardDescription>
        </CardHeader>
        <CardContent>
          {overall.total === 0 ? (
            <EmptyState
              icon="work"
              title="No applications yet"
              description="Students will appear here once they apply to a drive."
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-5">
              {(['APPLIED', 'SHORTLISTED', 'SELECTED', 'REJECTED', 'WITHDRAWN'] as const).map(
                (status) => {
                  const count =
                    status === 'APPLIED'
                      ? overall.applied
                      : status === 'SHORTLISTED'
                        ? overall.shortlisted
                        : status === 'SELECTED'
                          ? overall.selected
                          : status === 'REJECTED'
                            ? overall.rejected
                            : overall.withdrawn
                  return (
                    <div
                      key={status}
                      className="rounded-xl border border-border bg-background px-4 py-3"
                    >
                      <p className="font-mono text-[9px] uppercase tracking-wider text-subtle">
                        {APPLICATION_STATUS_STYLE[status].label}
                      </p>
                      <p className="num mt-1 text-2xl font-bold leading-none text-foreground">
                        {count}
                      </p>
                    </div>
                  )
                }
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Drives ────────────────────────────────────────────────────────── */}
      {resolved.length === 0 ? (
        <Card>
          <CardContent className="py-6">
            <EmptyState
              icon="business_center"
              title="No placement drives"
              description="Create a drive to start collecting applications."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {resolved.map((d) => {
            const isOpen = expanded[d.id] ?? false
            return (
              <Card key={d.id} id={`drive-${d.id}`} className="scroll-mt-24">
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle>{d.companyName}</CardTitle>
                      <CardDescription>
                        {d.role} · <span className="num">{d.packageOffered}</span> ·{' '}
                        <span className="num">{d.driveDate}</span>
                      </CardDescription>
                      <p className="mt-1.5 text-xs text-muted">{d.eligibilityCriteria}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-4">
                      <MiniStat label="Applied" value={d.tally.applied} />
                      <MiniStat label="Shortlisted" value={d.tally.shortlisted} />
                      <MiniStat label="Offers" value={d.tally.selected} tone="success" />
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="px-0">
                  {d.applications.length === 0 ? (
                    <div className="px-6">
                      <EmptyState
                        icon="person_off"
                        title="No applicants"
                        description="Nobody has applied to this drive yet."
                      />
                    </div>
                  ) : (
                    <>
                      <ul className="divide-y divide-border border-t border-border">
                        {(isOpen ? d.applications : d.applications.slice(0, 4)).map((a) => {
                          const style = APPLICATION_STATUS_STYLE[asApplicationStatus(a.status)]
                          return (
                            <li
                              key={a.id}
                              className="flex flex-wrap items-center justify-between gap-3 px-6 py-3"
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-foreground">
                                  {a.studentName}
                                </p>
                                <p className="num text-[11px] text-subtle">{a.studentRegno}</p>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <select
                                  aria-label={`Status for ${a.studentName}`}
                                  value={a.status}
                                  disabled={busyId === a.id}
                                  onChange={(e) => changeStatus(a.id, e.target.value)}
                                  className={cn(
                                    'num rounded-lg border border-border bg-surface px-2 py-1.5 text-[11px] font-medium text-foreground',
                                    'transition-colors hover:border-border-strong focus:outline-none focus:ring-2 focus:ring-accent/30',
                                    'disabled:opacity-50'
                                  )}
                                >
                                  {APPLICATION_STATUSES.map((s) => (
                                    <option key={s} value={s}>
                                      {APPLICATION_STATUS_STYLE[s].label}
                                    </option>
                                  ))}
                                </select>
                                <span
                                  className={cn(
                                    'rounded-full px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider',
                                    style.chip
                                  )}
                                >
                                  {style.label}
                                </span>
                                {busyId === a.id ? <Spinner /> : null}
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                      {d.applications.length > 4 ? (
                        <div className="px-6 pt-3">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setExpanded((current) => ({ ...current, [d.id]: !isOpen }))
                            }
                          >
                            {isOpen
                              ? 'Show less'
                              : `Show all ${d.applications.length} applicants`}
                          </Button>
                        </div>
                      ) : null}
                    </>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: 'success'
}) {
  return (
    <div className="text-right">
      <p className="font-mono text-[9px] uppercase tracking-wider text-subtle">{label}</p>
      <p
        className={cn(
          'num text-lg font-bold leading-none',
          tone === 'success' ? 'text-success' : 'text-foreground'
        )}
      >
        {value}
      </p>
    </div>
  )
}
