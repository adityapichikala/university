import { Skeleton } from '@/components/ui/states'
import { Card } from '@/components/ui/card'

/** Route-level loading state — mirrors the workbench so nothing jumps. */
export default function TeacherAssignmentsLoading() {
  return (
    <div className="mx-auto max-w-5xl" aria-busy>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-96" />
      </div>

      <Skeleton className="mb-4 h-9 w-40" />

      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-64" />
                <Skeleton className="h-3 w-full max-w-lg" />
              </div>
              <Skeleton className="h-4 w-20" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
