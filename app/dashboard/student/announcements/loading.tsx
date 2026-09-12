import { Skeleton } from '@/components/ui/states'
import { Card } from '@/components/ui/card'

export default function StudentAnnouncementsLoading() {
  return (
    <div className="mx-auto max-w-5xl" aria-busy>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-80" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-7 w-16" />
          </Card>
        ))}
      </div>

      <Card className="mt-6 p-5">
        <Skeleton className="h-8 w-64" />
        <div className="mt-4 space-y-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i}>
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="mt-2 h-3 w-full" />
              <Skeleton className="mt-2 h-3 w-3/4" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
