import { Skeleton } from '@/components/ui/states'
import { Card } from '@/components/ui/card'

export default function StudentResultsLoading() {
  return (
    <div className="mx-auto max-w-5xl" aria-busy>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-96" />
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-8 w-16" />
            <Skeleton className="mt-2 h-2.5 w-24" />
          </Card>
        ))}
      </div>

      <Card className="p-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-4 h-[160px] w-full" />
      </Card>
    </div>
  )
}
