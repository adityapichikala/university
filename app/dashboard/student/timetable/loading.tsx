import { Skeleton } from '@/components/ui/states'
import { Card } from '@/components/ui/card'

/** Route-level loading state — mirrors the grid + KPI row so nothing jumps. */
export default function StudentTimetableLoading() {
  return (
    <div className="mx-auto max-w-6xl" aria-busy>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-80" />
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-6 w-24" />
          </Card>
        ))}
      </div>

      <Card className="p-4">
        <Skeleton className="h-[420px] w-full" />
      </Card>
    </div>
  )
}
