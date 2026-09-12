import { prisma } from '@/lib/db'
import { requirePermission, scopes } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import { EMPLOYEE_SELECT, LEAVE_REQUEST_SELECT } from '@/lib/phase4-query'
import { leaveDays } from '@/lib/leave'
import { ToastProvider } from '@/components/ui/toast'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { KpiCard } from '@/components/dashboard/kpi-card'
import { LeaveQueue } from '@/components/dashboard/leave-queue'

export const metadata = { title: 'HR · Apex University ERP' }

/**
 * HR portal (Phase 4, doc §7).
 *
 * HR is college-wide — unlike the HOD screen it is deliberately *not* narrowed
 * to one department, because the whole point of HR is a cross-department view.
 * Access is therefore gated on `employee.manage`, which only HR and ADMIN hold.
 */
export default async function HrPage() {
  const ctx = await requirePermission(PERMISSIONS.EMPLOYEE_MANAGE, { route: 'hr' })
  const college = scopes.college(ctx)

  const [employees, leaveRows, departments] = await Promise.all([
    prisma.employee.findMany({
      where: college,
      select: EMPLOYEE_SELECT,
      orderBy: { user: { regno: 'asc' } },
      take: 200,
    }),
    prisma.leaveRequest.findMany({
      where: college,
      select: LEAVE_REQUEST_SELECT,
      orderBy: [{ status: 'asc' }, { startDate: 'asc' }],
      take: 100,
    }),
    prisma.department.findMany({
      where: college,
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ])

  // "On leave today" — approved requests whose window covers now.
  const today = new Date()
  const onLeaveToday = leaveRows.filter(
    (r) => r.status === 'APPROVED' && r.startDate <= today && r.endDate >= today
  ).length

  const pendingLeave = leaveRows.filter((r) => r.status === 'PENDING').length

  // Headcount per department, so HR can spot a team running thin.
  const byDepartment = departments
    .map((d) => ({
      id: d.id,
      name: d.name,
      count: employees.filter((e) => e.departmentId === d.id).length,
    }))
    .sort((a, b) => b.count - a.count)

  const maxDeptCount = byDepartment.reduce((max, d) => Math.max(max, d.count), 0)

  const leave = leaveRows.map((r) => ({
    id: r.id,
    employeeName: r.employee.user.name,
    employeeRegno: r.employee.user.regno,
    designation: r.employee.designation,
    departmentName: r.employee.department?.name,
    startDate: r.startDate.toISOString().slice(0, 10),
    endDate: r.endDate.toISOString().slice(0, 10),
    days: leaveDays(r.startDate, r.endDate),
    reason: r.reason,
    status: r.status,
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString().slice(0, 10) : null,
  }))

  const canApproveLeave = ctx.can(PERMISSIONS.LEAVE_APPROVE)

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">HR</h1>
        <p className="mt-1 text-sm text-muted">
          The full employee record and every leave request in the college, across all departments.
          Approvals are written to the audit log.
        </p>
      </div>

      <ToastProvider>
        <div className="space-y-6">
          {/* ── KPI bento ─────────────────────────────────────────────────── */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              icon="badge"
              label="Employees"
              value={employees.length}
              hint="on the payroll"
            />
            <KpiCard
              icon="event_busy"
              label="Pending leave"
              value={pendingLeave}
              hint={pendingLeave === 1 ? 'awaiting a decision' : 'awaiting decisions'}
              tone={pendingLeave > 0 ? 'warning' : 'default'}
            />
            <KpiCard icon="beach_access" label="On leave today" value={onLeaveToday} hint="approved and active" />
            <KpiCard
              icon="account_tree"
              label="Departments"
              value={departments.length}
              hint="with staff assigned"
            />
          </div>

          {/* ── Leave queue ───────────────────────────────────────────────── */}
          <div id="leave" className="scroll-mt-24">
            <LeaveQueue
              leave={leave}
              canApprove={canApproveLeave}
              description="You hold college-wide approval — requests from every department appear here."
              emptyDescription="No staff have filed leave yet."
            />
          </div>

          {/* ── Employee roster ───────────────────────────────────────────── */}
          <div id="employees" className="scroll-mt-24">
            <Card>
              <CardHeader>
                <CardTitle>Employee roster</CardTitle>
                <CardDescription>
                  {employees.length} staff records · designation, band and department
                </CardDescription>
              </CardHeader>
              <CardContent className="px-0">
                {employees.length === 0 ? (
                  <div className="px-6">
                    <EmptyState
                      icon="badge"
                      title="No employees on record"
                      description="Create employee records to populate the HR portal."
                    />
                  </div>
                ) : (
                  <div className="overflow-x-auto border-t border-border">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-background text-[11px] uppercase tracking-wider text-subtle">
                        <tr>
                          <th className="px-6 py-2.5 font-medium">Employee</th>
                          <th className="px-3 py-2.5 font-medium">Designation</th>
                          <th className="px-3 py-2.5 font-medium">Department</th>
                          <th className="px-3 py-2.5 text-right font-medium">Band</th>
                          <th className="px-6 py-2.5 text-right font-medium">Leave</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {employees.map((e) => (
                          <tr key={e.id} className="transition-colors hover:bg-background">
                            <td className="px-6 py-3">
                              <p className="font-medium text-foreground">{e.user.name}</p>
                              <p className="num text-[11px] text-subtle">{e.user.regno}</p>
                            </td>
                            <td className="px-3 py-3 text-muted">{e.designation}</td>
                            <td className="px-3 py-3 text-muted">{e.department?.name ?? '—'}</td>
                            <td className="num px-3 py-3 text-right text-muted">{e.salaryBand}</td>
                            <td className="num px-6 py-3 text-right text-foreground">
                              {e._count.leaveRequests}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── Department spread ─────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle>Headcount by department</CardTitle>
              <CardDescription>Where the payroll is concentrated</CardDescription>
            </CardHeader>
            <CardContent>
              {byDepartment.length === 0 ? (
                <EmptyState
                  icon="account_tree"
                  title="No departments"
                  description="Departments appear once staff are assigned to them."
                />
              ) : (
                <ul className="space-y-2">
                  {byDepartment.map((d) => {
                    const percent =
                      maxDeptCount === 0 ? 0 : Math.round((d.count / maxDeptCount) * 100)
                    return (
                      <li key={d.id}>
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-foreground">{d.name}</span>
                          <span className="num text-muted">{d.count}</span>
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-border">
                          <div
                            className="h-full rounded-full bg-accent transition-all"
                            style={{ width: `${Math.max(2, percent)}%` }}
                          />
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </ToastProvider>
    </div>
  )
}
