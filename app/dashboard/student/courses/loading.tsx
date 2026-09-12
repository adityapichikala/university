import { Skeleton } from '@/components/ui/states'
import { Card } from '@/components/ui/card'
import { KpiSkeletonGrid } from '@/components/dashboard/kpi-card'

export default function StudentCoursesLoading() {
  return (
    <div className="mx-auto max-w-6xl" aria-busy>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-[30rem]" />
      </div>

      <KpiSkeletonGrid />

      <Card className="mt-6 p-5">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-2 h-3 w-44" />
        <div className="mt-4 space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center justify-between gap-4">
              <Skeleton className="h-4 w-52" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-4 w-10" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
