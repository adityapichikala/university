'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState, Spinner } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { KpiCard } from '@/components/dashboard/kpi-card'
import { convertAdmission, decideAdmission } from './actions'
import {
  ADMISSION_STATUS_CHIP,
  ADMISSION_STATUS_LABEL,
  ADMISSION_STATUSES,
  ADMISSION_TRANSITIONS,
  type AdmissionStatus,
} from '@/lib/admissions'
import { cn } from '@/lib/utils'

/**
 * Admin › Admissions workspace.
 *
 * Filter chips + a per-applicant row. Status changes are sparse overrides so
 * the row flips immediately and rolls back on refusal — the server re-reads
 * the row anyway, so a stale tab can never skip a stage.
 */

interface Admission {
  id: string
  applicantName: string
  email: string
  phone: string
  programAppliedFor: string
  meritScore: number | null
  status: AdmissionStatus
  documentsUrl: string | null
  appliedOn: string
  converted: boolean
}

interface Props {
  admissions: Admission[]
  summary: {
    total: number
    pending: number
    approved: number
    enrolled: number
    averageMerit: number
  }
}

export function AdmissionsClient({ admissions, summary }: Props) {
  const toast = useToast()
  const router = useRouter()

  const [overrides, setOverrides] = React.useState<Record<string, { status: AdmissionStatus }>>({})
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [filter, setFilter] = React.useState<AdmissionStatus | 'ALL'>('ALL')

  const rows = React.useMemo(
    () => admissions.map((a) => ({ ...a, ...(overrides[a.id] ?? {}) })),
    [admissions, overrides]
  )

  const visible = React.useMemo(
    () => (filter === 'ALL' ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter]
  )

  async function decide(applicant: Admission, decision: 'APPROVED' | 'REJECTED') {
    setBusyId(applicant.id)
    let result: { ok: boolean; error?: string }
    try {
      result = await decideAdmission({ id: applicant.id, decision })
    } catch {
      result = { ok: false, error: 'Network error — nothing was changed' }
    }
    setBusyId(null)

    if (!result.ok) {
      toast.error('Could not update', result.error)
      return
    }
    setOverrides((current) => ({ ...current, [applicant.id]: { status: decision } }))
    toast.success(
      decision === 'APPROVED' ? 'Application approved' : 'Application rejected',
      `${applicant.applicantName} · ${applicant.programAppliedFor}`
    )
    router.refresh()
  }

  async function convert(applicant: Admission) {
    setBusyId(applicant.id)
    let result: {
      ok: boolean
      error?: string
      data?: { regno: string; temporaryPassword: string; name: string }
    }
    try {
      result = await convertAdmission({ id: applicant.id })
    } catch {
      result = { ok: false, error: 'Network error — nobody was enrolled' }
    }
    setBusyId(null)

    if (!result.ok || !result.data) {
      toast.error('Could not enrol', result.error)
      return
    }
    setOverrides((current) => ({ ...current, [applicant.id]: { status: 'CONVERTED' } }))
    toast.success(
      `Enrolled as ${result.data.regno}`,
      `Temporary password: ${result.data.temporaryPassword}`
    )
    router.refresh()
  }

  return (
    <div className="space-y-6">
      {/* ── KPI bento ─────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon="how_to_reg" label="Applications" value={summary.total} hint="this intake" />
        <KpiCard
          icon="schedule"
          label="Pending"
          value={summary.pending}
          hint="awaiting a decision"
          tone={summary.pending > 0 ? 'warning' : 'default'}
        />
        <KpiCard icon="task_alt" label="Approved" value={summary.approved} hint="ready to enrol" />
        <KpiCard
          icon="school"
          label="Enrolled"
          value={summary.enrolled}
          hint={`avg merit ${summary.averageMerit}`}
          tone={summary.enrolled > 0 ? 'success' : 'default'}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Applications</CardTitle>
          <CardDescription>
            {visible.length} shown · {summary.total} total
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {/* ── Filter chips ─────────────────────────────────────────────── */}
          <div className="flex flex-wrap gap-2 px-6 pb-4">
            <FilterChip active={filter === 'ALL'} onClick={() => setFilter('ALL')} label="All" />
            {ADMISSION_STATUSES.map((status) => (
              <FilterChip
                key={status}
                active={filter === status}
                onClick={() => setFilter(status)}
                label={ADMISSION_STATUS_LABEL[status]}
              />
            ))}
          </div>

          {visible.length === 0 ? (
            <div className="px-6">
              <EmptyState
                icon="how_to_reg"
                title="Nothing here"
                description={
                  filter === 'ALL'
                    ? 'No applications have been received for this intake yet.'
                    : `No applications with status “${ADMISSION_STATUS_LABEL[filter as AdmissionStatus]}”.`
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {visible.map((a) => {
                const transitions = ADMISSION_TRANSITIONS[a.status]
                return (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-start justify-between gap-3 px-6 py-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-foreground">{a.applicantName}</p>
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider',
                            ADMISSION_STATUS_CHIP[a.status]
                          )}
                        >
                          {ADMISSION_STATUS_LABEL[a.status]}
                        </span>
                        {typeof a.meritScore === 'number' ? (
                          <span className="num rounded-full bg-background px-2 py-0.5 text-[10px] text-muted">
                            merit {a.meritScore.toFixed(1)}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-sm text-muted">{a.programAppliedFor}</p>
                      <p className="num mt-1 text-[11px] text-subtle">
                        {a.email} · {a.phone} · applied {a.appliedOn}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {busyId === a.id ? <Spinner /> : null}
                      {transitions.map((next) => (
                        <Button
                          key={next}
                          size="sm"
                          variant={next === 'REJECTED' ? 'ghost' : 'accent'}
                          disabled={busyId === a.id}
                          onClick={() => decide(a, next as 'APPROVED' | 'REJECTED')}
                        >
                          {next === 'APPROVED' ? 'Approve' : 'Reject'}
                        </Button>
                      ))}
                      {a.status === 'APPROVED' ? (
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={busyId === a.id}
                          onClick={() => convert(a)}
                        >
                          Enrol
                        </Button>
                      ) : null}
                      {a.status === 'CONVERTED' ? (
                        <p className="num text-[11px] text-success">Enrolled</p>
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

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full border px-3 py-1 text-[11px] font-medium transition-colors',
        active
          ? 'border-accent bg-accent-soft text-accent'
          : 'border-border bg-surface text-muted hover:border-border-strong hover:text-foreground'
      )}
    >
      {label}
    </button>
  )
}
