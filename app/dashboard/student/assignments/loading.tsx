import { Skeleton } from '@/components/ui/states'
import { Card } from '@/components/ui/card'

/** Route-level loading state — mirrors the feed so nothing jumps. */
export default function StudentAssignmentsLoading() {
  return (
    <div className="mx-auto max-w-4xl" aria-busy>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-96" />
      </div>

      <div className="mb-4 flex gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-8 w-24 rounded-lg" />
        ))}
      </div>

      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="p-5">
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-3 w-full max-w-lg" />
            </div>
            <Skeleton className="mt-4 h-9 w-full" />
          </Card>
        ))}
      </div>
    </div>
  )
}
