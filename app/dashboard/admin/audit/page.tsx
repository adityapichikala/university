import { Suspense } from 'react'
import { requirePermission } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import { listAuditActionTypes, listAuditActors } from '@/lib/audit-log'
import { Card } from '@/components/ui/card'
import { AuditFilters } from './_components/audit-filters'
import {
  AuditResults,
  AuditResultsSkeleton,
  firstParam,
  type RawParams,
} from './_components/audit-results'

export const metadata = { title: 'Audit Log · Apex University ERP' }

/**
 * ADMIN › Audit Log — /dashboard/admin/audit
 *
 * The read side of the tamper-evident chain built for the governance banner.
 * Filters live in the URL (shareable, back-button friendly) and the results
 * stream behind their own Suspense boundary, keyed by the search params so
 * re-filtering shows a skeleton instead of a frozen table.
 */
export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>
}) {
  // Tier 1 (route = admin) + Tier 2 (user.manage). Redirects before render.
  const ctx = await requirePermission(PERMISSIONS.USER_MANAGE, { route: 'admin' })
  const params = await searchParams
  const collegeId = ctx.user.collegeId

  const [actionTypes, actors] = await Promise.all([
    listAuditActionTypes(collegeId),
    listAuditActors(collegeId),
  ])

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header>
        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">Audit Log</h1>
        <p className="mt-1 text-sm text-muted">
          Every state-changing action, chained with SHA-256. Expand a row to see what changed and
          which entry it links to.
        </p>
      </header>

      <Card className="overflow-hidden">
        <AuditFilters
          actionTypes={actionTypes}
          actors={actors}
          current={{
            actionType: firstParam(params.actionType),
            actorId: firstParam(params.actorId),
            status: firstParam(params.status),
            q: firstParam(params.q),
            from: firstParam(params.from),
            to: firstParam(params.to),
          }}
        />
      </Card>

      <Suspense key={JSON.stringify(params)} fallback={<AuditResultsSkeleton />}>
        <AuditResults collegeId={collegeId} params={params} />
      </Suspense>
    </div>
  )
}
