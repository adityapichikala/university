import { Skeleton } from '@/components/ui/states'
import { Card } from '@/components/ui/card'

export default function TeacherAnnouncementsLoading() {
  return (
    <div className="mx-auto max-w-5xl" aria-busy>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-96" />
      </div>

      {/* Composer */}
      <Card className="p-5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-2 h-3 w-72" />
        <Skeleton className="mt-4 h-9 w-full" />
        <Skeleton className="mt-3 h-24 w-full" />
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
        <Skeleton className="mt-4 h-9 w-40" />
      </Card>

      {/* Sent list */}
      <Card className="mt-6 p-5">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="mt-2 h-3 w-56" />
        <div className="mt-4 space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="mt-2 h-3 w-full" />
              <Skeleton className="mt-3 h-1.5 w-full" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
