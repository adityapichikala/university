import { prisma } from '@/lib/db'
import { requirePermission, scopes } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import { PLACEMENT_DRIVE_SELECT, tallyApplications } from '@/lib/phase4-query'
import { ToastProvider } from '@/components/ui/toast'
import { PlacementWorkspace } from './PlacementWorkspace'

export const metadata = { title: 'Placements · Apex University ERP' }

/**
 * Placement portal (Phase 4, doc §7).
 *
 * Drives with their application funnel, and one row per applicant with a
 * status control. Guarded by `placement.manage`; the status transitions in
 * <PlacementWorkspace> re-check the same permission server-side.
 */
export default async function PlacementPage() {
  const ctx = await requirePermission(PERMISSIONS.PLACEMENT_MANAGE, { route: 'placement' })
  const college = scopes.college(ctx)

  const [driveRows, studentCount] = await Promise.all([
    prisma.placementDrive.findMany({
      where: college,
      select: PLACEMENT_DRIVE_SELECT,
      orderBy: { driveDate: 'desc' },
      take: 50,
    }),
    prisma.user.count({ where: { ...college, role: 'STUDENT' } }),
  ])

  const drives = driveRows.map((d) => {
    const tally = tallyApplications(d.applications)
    return {
      id: d.id,
      companyName: d.companyName,
      role: d.role,
      eligibilityCriteria: d.eligibilityCriteria,
      packageOffered: d.packageOffered,
      driveDate: d.driveDate.toISOString().slice(0, 10),
      tally,
      applications: d.applications
        .map((a) => ({
          id: a.id,
          studentName: a.student.name,
          studentRegno: a.student.regno,
          status: a.status,
        }))
        .sort((a, b) => {
          const rank: Record<string, number> = {
            SELECTED: 0,
            SHORTLISTED: 1,
            APPLIED: 2,
            REJECTED: 3,
            WITHDRAWN: 4,
          }
          return (rank[a.status] ?? 9) - (rank[b.status] ?? 9)
        }),
    }
  })

  // College-wide funnel across every drive.
  const overall = tallyApplications(driveRows.flatMap((d) => d.applications))

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">Placements</h1>
        <p className="mt-1 text-sm text-muted">
          Drive pipeline and applicant status for the college. Every status change is written to the
          audit log.
        </p>
      </div>

      <ToastProvider>
        <PlacementWorkspace drives={drives} overall={overall} studentCount={studentCount} />
      </ToastProvider>
    </div>
  )
}
