import { BannerSkeleton, KpiSkeleton, PanelSkeleton } from './_components/skeletons'

/** Route-level loading state — mirrors the real layout so nothing jumps. */
export default function AdminGovernanceLoading() {
  return (
    <div className="mx-auto max-w-7xl space-y-6" aria-busy>
      <div className="space-y-2">
        <div className="h-7 w-64 animate-pulse rounded-lg bg-slate-200/70" />
        <div className="h-4 w-96 animate-pulse rounded-lg bg-slate-200/70" />
      </div>
      <BannerSkeleton />
      <KpiSkeleton />
      <PanelSkeleton title="Faculty privilege matrix" rows={3} />
      <PanelSkeleton title="Section-level access" rows={3} />
      <PanelSkeleton title="Student roster" rows={5} />
    </div>
  )
}
