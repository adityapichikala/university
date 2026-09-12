import { Skeleton } from '@/components/ui/states'
import { Card } from '@/components/ui/card'
import { KpiSkeletonGrid } from '@/components/dashboard/kpi-card'

export default function AdmissionsLoading() {
  return (
    <div className="mx-auto max-w-6xl" aria-busy>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-[32rem]" />
      </div>

      <KpiSkeletonGrid />

      <Card className="mt-6 p-5">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-2 h-3 w-48" />
        <div className="mt-4 flex gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-7 w-20 rounded-full" />
          ))}
        </div>
        <div className="mt-5 space-y-5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="mt-2 h-3 w-52" />
                <Skeleton className="mt-2 h-3 w-72" />
              </div>
              <Skeleton className="h-8 w-24" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
