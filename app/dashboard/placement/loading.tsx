import { Skeleton } from '@/components/ui/states'
import { Card } from '@/components/ui/card'
import { KpiSkeletonGrid } from '@/components/dashboard/kpi-card'

export default function PlacementLoading() {
  return (
    <div className="mx-auto max-w-6xl" aria-busy>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-[28rem]" />
      </div>

      <KpiSkeletonGrid />

      <Card className="mt-6 p-5">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-2 h-3 w-64" />
        <div className="mt-4 grid gap-3 sm:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      </Card>

      <Card className="mt-4 p-5">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="mt-2 h-3 w-72" />
        <div className="mt-4 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center justify-between">
              <Skeleton className="h-8 w-1/3" />
              <Skeleton className="h-8 w-24" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
