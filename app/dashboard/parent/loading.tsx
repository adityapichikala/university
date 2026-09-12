import { Skeleton } from '@/components/ui/states'
import { Card } from '@/components/ui/card'
import { KpiSkeletonGrid } from '@/components/dashboard/kpi-card'

export default function ParentLoading() {
  return (
    <div className="mx-auto max-w-6xl" aria-busy>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-[30rem]" />
      </div>

      <Card className="mb-6 p-5">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="mt-2 h-3 w-32" />
      </Card>

      <KpiSkeletonGrid />

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="mt-4 h-40 w-full" />
        </Card>
        <Card className="p-5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-4 h-40 w-full" />
        </Card>
      </div>

      <Card className="mt-4 p-5">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-4 h-32 w-full" />
      </Card>
    </div>
  )
}
