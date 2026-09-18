import * as React from 'react'
import { requireUser } from '@/lib/rbac'
import { getClearance } from '@/lib/clearance'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export const metadata = { title: 'No-Dues Clearance · Apex University ERP' }

/**
 * Student › No-Dues Clearance.
 *
 * Read-only progress across the four departments that must sign a graduating
 * student off. Every department's status is derived live from the operational
 * tables (fees, library, hostel, results) unless a department head has recorded
 * a manual override — in which case `overridden` is true and the banner explains
 * that a human decision is in force.
 */

const STATUS_STYLES: Record<string, string> = {
  CLEARED: 'bg-success-soft text-success',
  PENDING: 'bg-warning-soft text-warning',
}

export default async function StudentClearancePage() {
  const ctx = await requireUser({ route: 'student' })
  const summary = await getClearance(ctx.user.id, ctx.user.collegeId ?? '')

  const allClear = summary.overall === 'CLEARED'

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">
          No-Dues Clearance
        </h1>
        <p className="mt-1 text-sm text-muted">
          Each department signs off before you graduate. Statuses update as the offices record
          payments, returns and results — a department head can also approve or hold a department
          manually.
        </p>
      </div>

      <Card
        className={cn(
          'mb-6 border-l-4',
          allClear ? 'border-l-success bg-success-soft/40' : 'border-l-warning bg-warning-soft/40'
        )}
      >
        <CardContent className="flex items-center gap-4 p-5">
          <span className="material-symbols-outlined text-[32px] leading-none text-foreground">
            {allClear ? 'verified' : 'hourglass_top'}
          </span>
          <div>
            <p className="text-base font-semibold text-foreground">
              {allClear
                ? 'All departments cleared — you are eligible for your No-Dues certificate'
                : `${summary.pending.length} department${summary.pending.length === 1 ? '' : 's'} still pending`}
            </p>
            <p className="mt-0.5 text-sm text-muted">
              {allClear
                ? 'The registrar can now issue your clearance certificate.'
                : 'Clear the departments below and your certificate will be unlocked.'}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        {summary.departments.map((d) => (
          <Card key={d.department}>
            <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-[22px] leading-none text-muted">
                  {d.icon}
                </span>
                <CardTitle className="text-base">{d.label}</CardTitle>
              </div>
              <span
                className={cn(
                  'inline-flex rounded-full px-2.5 py-1 text-xs font-semibold',
                  STATUS_STYLES[d.status]
                )}
              >
                {d.status}
              </span>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted">
                {d.autoReason ?? 'No outstanding items in this department.'}
              </p>
              {d.overridden ? (
                <p className="rounded-lg bg-background px-3 py-2 text-xs text-subtle">
                  Manually {d.manualStatus === 'CLEARED' ? 'cleared' : 'held'} by{' '}
                  {d.decidedByName ?? 'a department head'}
                  {d.decidedAt ? ` on ${d.decidedAt.slice(0, 10)}` : ''}
                  {d.note ? ` — “${d.note}”` : ''}.
                </p>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
