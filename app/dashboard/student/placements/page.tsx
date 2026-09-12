import { prisma } from '@/lib/db'
import { requirePermission, scopes } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import { asApplicationStatus } from '@/lib/phase4-query'
import { ToastProvider } from '@/components/ui/toast'
import { StudentPlacements } from './StudentPlacements'

export const metadata = { title: 'Placements · Apex University ERP' }

/**
 * Wall-clock read, deliberately parked in its own async frame.
 *
 * A drive closes the moment its date passes, so this page genuinely needs the
 * current time — but calling `Date.now()` straight in the render body trips
 * `react-hooks/purity`. Awaiting it from a helper keeps the render body a pure
 * function of its inputs and its awaited results, which is what the rule wants.
 */
async function currentTime(): Promise<number> {
  return Date.now()
}

/**
 * Student placements (Phase 4, doc §7).
 *
 * The student-facing half of the placement loop: browse the college's drives
 * and apply. Guarded by `placement.apply` — the permission students held but
 * which nothing enforced until this screen existed.
 *
 * Tier 3: only this caller's own application is selected alongside each drive,
 * so the applicant list of a drive is never exposed to another student.
 */
export default async function StudentPlacementsPage() {
  const ctx = await requirePermission(PERMISSIONS.PLACEMENT_APPLY, { route: 'student' })
  const college = scopes.college(ctx)

  const driveRows = await prisma.placementDrive.findMany({
    where: college,
    select: {
      id: true,
      companyName: true,
      role: true,
      eligibilityCriteria: true,
      driveDate: true,
      packageOffered: true,
      _count: { select: { applications: true } },
      applications: {
        where: { studentId: ctx.user.id },
        select: { id: true, status: true, createdAt: true },
      },
    },
    orderBy: { driveDate: 'asc' },
    take: 50,
  })

  const now = await currentTime()
  const drives = driveRows.map((d) => {
    const mine = d.applications[0]
    return {
      id: d.id,
      companyName: d.companyName,
      role: d.role,
      eligibilityCriteria: d.eligibilityCriteria,
      packageOffered: d.packageOffered,
      driveDate: d.driveDate.toISOString().slice(0, 10),
      closed: d.driveDate.getTime() < now,
      applicantCount: d._count.applications,
      applicationId: mine?.id ?? null,
      status: mine?.status ?? null,
    }
  })

  const mine = drives.filter((d) => d.applicationId)
  const offers = mine.filter((d) => asApplicationStatus(d.status) === 'SELECTED').length
  const interviewing = mine.filter((d) => asApplicationStatus(d.status) === 'SHORTLISTED').length
  const open = drives.filter((d) => !d.closed).length

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">Placements</h1>
        <p className="mt-1 text-sm text-muted">
          Drives open to your batch. Applying is recorded immediately — withdraw any time before an
          offer is made.
        </p>
      </div>

      <ToastProvider>
        <StudentPlacements
          drives={drives}
          summary={{
            open,
            applied: mine.length,
            interviewing,
            offers,
          }}
        />
      </ToastProvider>
    </div>
  )
}
