import { prisma } from '@/lib/db'
import { requirePermission, scopes } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import { leaveDays } from '@/lib/leave'
import { ToastProvider } from '@/components/ui/toast'
import { LeaveSelfService } from './LeaveSelfService'

export const metadata = { title: 'My Leave · Apex University ERP' }

/**
 * Staff self-service (Phase 4, doc §7) — one route for every staff role.
 *
 * Deliberately *not* /dashboard/<role>/leave: eight near-identical copies of
 * the same screen would drift. Instead the route is permission-gated
 * (`leave.request`) rather than role-gated, so any staff member who holds the
 * permission lands here and nobody else does.
 *
 * Tier 3 is enforced in two places: the history query below is filtered to
 * `employee.userId === caller`, and cancelLeaveRequest() re-checks ownership
 * before writing.
 */
export default async function MyLeavePage() {
  const ctx = await requirePermission(PERMISSIONS.LEAVE_REQUEST)
  const college = scopes.college(ctx)

  const employee = await prisma.employee.findUnique({
    where: { userId: ctx.user.id },
    select: { id: true, designation: true, department: { select: { name: true } } },
  })

  const rows = employee
    ? await prisma.leaveRequest.findMany({
        where: { ...college, employeeId: employee.id },
        select: { id: true, startDate: true, endDate: true, reason: true, status: true, reviewedAt: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }],
        take: 50,
      })
    : []

  const requests = rows.map((r) => ({
    id: r.id,
    startDate: r.startDate.toISOString().slice(0, 10),
    endDate: r.endDate.toISOString().slice(0, 10),
    days: leaveDays(r.startDate, r.endDate),
    reason: r.reason,
    status: r.status,
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString().slice(0, 10) : null,
  }))

  // Days already committed this calendar year — the number staff actually ask for.
  const year = new Date().getFullYear()
  const approvedDays = rows
    .filter((r) => r.status === 'APPROVED' && r.startDate.getFullYear() === year)
    .reduce((sum, r) => sum + leaveDays(r.startDate, r.endDate), 0)

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">My Leave</h1>
        <p className="mt-1 text-sm text-muted">
          {employee
            ? `File a request and track it through approval. You are recorded as ${employee.designation}${
                employee.department ? ` in ${employee.department.name}` : ''
              }.`
            : 'Your account has no employee record yet, so leave cannot be filed.'}
        </p>
      </div>

      <ToastProvider>
        <LeaveSelfService
          requests={requests}
          canRequest={Boolean(employee)}
          missingEmployeeReason={
            employee ? undefined : 'Ask HR to create your employee record before filing leave.'
          }
          approvedDays={approvedDays}
          year={year}
        />
      </ToastProvider>
    </div>
  )
}
