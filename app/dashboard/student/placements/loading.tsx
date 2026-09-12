import { Skeleton } from '@/components/ui/states'
import { Card } from '@/components/ui/card'
import { KpiSkeletonGrid } from '@/components/dashboard/kpi-card'

export default function StudentPlacementsLoading() {
  return (
    <div className="mx-auto max-w-6xl" aria-busy>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-4 w-[26rem]" />
      </div>

      <KpiSkeletonGrid />

      <Card className="mt-6 p-5">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="mt-2 h-3 w-56" />
        <div className="mt-4 space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="mt-2 h-3 w-28" />
                <Skeleton className="mt-2 h-3 w-64" />
              </div>
              <Skeleton className="h-8 w-20" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
