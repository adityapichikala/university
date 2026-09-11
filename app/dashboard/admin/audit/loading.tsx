import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/states'
import { AuditResultsSkeleton } from './_components/audit-results'

/** Route-level loading state — mirrors the real layout so nothing jumps. */
export default function AuditLogLoading() {
  return (
    <div className="mx-auto max-w-7xl space-y-6" aria-busy>
      <div className="space-y-2">
        <div className="h-7 w-40 animate-pulse rounded-lg bg-slate-200/70" />
        <div className="h-4 w-96 animate-pulse rounded-lg bg-slate-200/70" />
      </div>

      <Card>
        <div className="flex flex-wrap gap-3 border-b border-border px-6 py-4">
          {[190, 170, 130, 150, 150].map((w) => (
            <div key={w} className="space-y-1">
              <Skeleton className="h-2 w-12" />
              <Skeleton className="h-9" style={{ width: w }} />
            </div>
          ))}
        </div>
      </Card>

      <AuditResultsSkeleton />
    </div>
  )
}
