import { Suspense } from 'react'
import { requirePermission } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import { ToastProvider } from '@/components/ui/toast'
import { AuditBannerPanel } from './_components/audit-banner'
import { KpiPanel } from './_components/kpi-grid'
import { FacultyPanel, SectionAccessPanel, StudentPanel } from './_components/panels'
import { BannerSkeleton, KpiSkeleton, PanelSkeleton } from './_components/skeletons'

export const metadata = { title: 'Access Governance · Apex University ERP' }

/**
 * ADMIN · RBAC Governance — /dashboard/admin
 *
 * The reference screen for the whole app: everything here is Tier-2/Tier-3
 * control surface, every mutation is a server action guarded by
 * requirePermission("user.manage"), and every panel streams behind its own
 * Suspense boundary so a slow count never blocks the rest of the page.
 */
export default async function AdminGovernancePage() {
  // Tier 1 (route = admin) + Tier 2 (user.manage). Redirects before render.
  const ctx = await requirePermission(PERMISSIONS.USER_MANAGE, { route: 'admin' })
  const collegeId = ctx.user.collegeId

  return (
    <ToastProvider>
      <div className="mx-auto max-w-7xl space-y-6">
        <header>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">
            Access Governance
          </h1>
          <p className="mt-1 text-sm text-muted">
            Who can do what, per person and per section. Every change is written to the tamper-evident
            audit chain below.
          </p>
        </header>

        <Suspense fallback={<BannerSkeleton />}>
          <AuditBannerPanel collegeId={collegeId} />
        </Suspense>

        <Suspense fallback={<KpiSkeleton />}>
          <KpiPanel collegeId={collegeId} />
        </Suspense>

        <Suspense fallback={<PanelSkeleton title="Faculty privilege matrix" rows={3} />}>
          <FacultyPanel collegeId={collegeId} />
        </Suspense>

        <Suspense fallback={<PanelSkeleton title="Section-level access" rows={3} />}>
          <SectionAccessPanel collegeId={collegeId} />
        </Suspense>

        <Suspense fallback={<PanelSkeleton title="Student roster" rows={5} />}>
          <StudentPanel collegeId={collegeId} />
        </Suspense>
      </div>
    </ToastProvider>
  )
}
