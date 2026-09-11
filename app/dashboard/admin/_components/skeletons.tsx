import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/states'
import { cn } from '@/lib/utils'

/** Fallbacks shown while each Suspense panel streams in. */

export function BannerSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-44" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
        <div className="grid flex-1 gap-4 sm:grid-cols-3 lg:max-w-2xl">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-2.5 w-20" />
              <Skeleton className="h-4 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function KpiSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
      <Skeleton className="h-36 rounded-xl sm:col-span-2 lg:col-span-4" />
      <Skeleton className="h-36 rounded-xl lg:col-span-2" />
      <Skeleton className="h-32 rounded-xl lg:col-span-3" />
      <Skeleton className="h-32 rounded-xl lg:col-span-3" />
    </div>
  )
}

export function PanelSkeleton({
  title,
  rows = 4,
  className,
}: {
  title?: string
  rows?: number
  className?: string
}) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <div className="border-b border-border p-6 pb-4">
        {title ? (
          <p className="text-xs font-semibold uppercase tracking-wider text-subtle">{title}</p>
        ) : (
          <Skeleton className="h-3.5 w-40" />
        )}
        <Skeleton className="mt-2 h-3 w-64" />
      </div>
      <div className="space-y-3 p-6">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-9 w-9 rounded-full" />
            <Skeleton className="h-3.5 flex-1" />
            <Skeleton className="h-6 w-11 rounded-full" />
            <Skeleton className="h-6 w-11 rounded-full" />
          </div>
        ))}
      </div>
    </Card>
  )
}
