import { Skeleton } from '@/components/ui/states'
import { Card } from '@/components/ui/card'
import { KpiSkeletonGrid } from '@/components/dashboard/kpi-card'

export default function MyLeaveLoading() {
  return (
    <div className="mx-auto max-w-6xl" aria-busy>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-[26rem]" />
      </div>

      <KpiSkeletonGrid />

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-2 h-3 w-full" />
          <Skeleton className="mt-5 h-9 w-full" />
          <Skeleton className="mt-3 h-20 w-full" />
          <Skeleton className="mt-4 h-9 w-32" />
        </Card>
        <Card className="p-5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-2 h-3 w-40" />
          <div className="mt-4 space-y-4">
            {[0, 1, 2].map((i) => (
              <div key={i}>
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="mt-2 h-3 w-32" />
                <Skeleton className="mt-2 h-3 w-3/4" />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
