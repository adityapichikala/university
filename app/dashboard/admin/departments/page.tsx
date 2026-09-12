import { prisma } from '@/lib/db'
import { requirePermission, scopes } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import { ToastProvider } from '@/components/ui/toast'
import { DepartmentsClient } from './DepartmentsClient'

export const metadata = { title: 'Departments · Apex University ERP' }

/**
 * Admin › Departments (doc §7).
 *
 * Tier 1 (`route: 'admin'`) + Tier 2 (`department.manage`) + Tier 3 (every
 * query is scoped to the caller's college). Deliberately *not* gated on
 * `department.view`: seeing a department and restructuring it are different
 * powers, and HODs only hold the former.
 */
export default async function AdminDepartmentsPage() {
  const ctx = await requirePermission(PERMISSIONS.DEPARTMENT_MANAGE, { route: 'admin' })
  const college = scopes.college(ctx)

  const [departments, hodCandidates] = await Promise.all([
    prisma.department.findMany({
      where: college,
      select: {
        id: true,
        name: true,
        hodUserId: true,
        hod: { select: { id: true, name: true, regno: true, role: true } },
        _count: { select: { users: true, courses: true, classes: true, employees: true } },
      },
      orderBy: { name: 'asc' },
    }),
    // Only teaching staff can head a department — the action re-checks this.
    prisma.user.findMany({
      where: { ...college, role: { in: ['TEACHER', 'HOD'] } },
      select: { id: true, name: true, regno: true, role: true },
      orderBy: { name: 'asc' },
    }),
  ])

  const faculty = departments.reduce((n, d) => n + d._count.users, 0)
  const courses = departments.reduce((n, d) => n + d._count.courses, 0)
  const unheaded = departments.filter((d) => !d.hodUserId).length

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">Departments</h1>
        <p className="mt-1 text-sm text-muted">
          The college&rsquo;s academic structure. Appointing a HOD is recorded in the audit trail.
        </p>
      </div>

      <ToastProvider>
        <DepartmentsClient
          departments={departments.map((d) => ({
            id: d.id,
            name: d.name,
            hodUserId: d.hodUserId,
            hod: d.hod,
            counts: {
              users: d._count.users,
              courses: d._count.courses,
              classes: d._count.classes,
              employees: d._count.employees,
            },
          }))}
          candidates={hodCandidates}
          summary={{ departments: departments.length, faculty, courses, unheaded }}
        />
      </ToastProvider>
    </div>
  )
}
