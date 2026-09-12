import { Skeleton } from '@/components/ui/states'
import { Card } from '@/components/ui/card'

export default function FinanceLoading() {
  return (
    <div className="mx-auto max-w-6xl" aria-busy>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-96" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-7 w-24" />
            <Skeleton className="mt-2 h-2.5 w-20" />
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <Card key={i} className="p-4">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="mt-3 h-[150px] w-full" />
          </Card>
        ))}
      </div>

      <Card className="mt-6 p-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-5 h-[200px] w-full" />
      </Card>
    </div>
  )
}
