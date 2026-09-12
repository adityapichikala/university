import { Skeleton } from '@/components/ui/states'
import { Card } from '@/components/ui/card'

export default function HodLoading() {
  return (
    <div className="mx-auto max-w-6xl" aria-busy>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-96" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="p-5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-8 w-12" />
            <Skeleton className="mt-2 h-2.5 w-24" />
          </Card>
        ))}
      </div>

      <Card className="mt-6 p-5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-2 h-3 w-72" />
        <div className="mt-4 space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="mt-2 h-3 w-48" />
              <Skeleton className="mt-2 h-3 w-2/3" />
            </div>
          ))}
        </div>
      </Card>

      <Card className="mt-6 p-5">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-4 h-32 w-full" />
      </Card>
    </div>
  )
}
