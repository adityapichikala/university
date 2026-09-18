import { requirePermission } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import { getAllClearance } from '@/lib/clearance'
import { ToastProvider } from '@/components/ui/toast'
import { Card, CardContent } from '@/components/ui/card'
import { ClearanceTable } from './ClearanceTable'

export const metadata = { title: 'No-Dues Clearance · Apex University ERP' }

/**
 * No-Dues clearance console.
 *
 * Guarded by `clearance.manage` — not the `admin` route slug — so the four
 * department heads (Librarian, Warden, Finance, HOD) can reach it too, each
 * limited to signing off their own department. ADMIN sees and can act on all
 * four. There is no path-prefix middleware in this app, so the permission is
 * the only gate.
 */
export default async function AdminClearancePage() {
  const ctx = await requirePermission(PERMISSIONS.CLEARANCE_MANAGE)
  const { students } = await getAllClearance(ctx.user.collegeId)

  const total = students.length
  const cleared = students.filter((s) => s.overall === 'CLEARED').length

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">
          No-Dues Clearance
        </h1>
        <p className="mt-1 text-sm text-muted">
          Each department signs a graduating student off. Statuses are computed live from fees,
          library, hostel and results; use the controls to approve or hold a department manually.
          {ctx.user.role !== 'ADMIN'
            ? ` You can sign off ${
                ctx.user.role === 'LIBRARIAN'
                  ? 'Library'
                  : ctx.user.role === 'WARDEN'
                    ? 'Hostel'
                    : ctx.user.role === 'FINANCE'
                      ? 'Finance'
                      : 'Academics'
              } only.`
            : ''}
        </p>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs text-muted">Students</p>
          <p className="num mt-1 text-2xl font-bold leading-none text-foreground">{total}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted">Fully cleared</p>
          <p className="num mt-1 text-2xl font-bold leading-none text-success">{cleared}</p>
          <p className="mt-1 text-[11px] text-subtle">
            {total > 0 ? Math.round((cleared / total) * 100) : 0}% of students
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted">Still pending</p>
          <p className="num mt-1 text-2xl font-bold leading-none text-warning">{total - cleared}</p>
        </Card>
      </div>

      <ToastProvider>
        <ClearanceTable students={students} viewerRole={ctx.user.role} />
      </ToastProvider>
    </div>
  )
}
