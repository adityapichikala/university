import * as React from 'react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/**
 * The KPI tile used by every Phase 4 portal.
 *
 * Extracted from the HOD screen so all four portals share one visual: mono
 * label, mono number (design system — JetBrains Mono for all figures), subtle
 * Material icon, soft hover lift.
 */

export type KpiTone = 'default' | 'warning' | 'success' | 'danger'

const TONE_ICON: Record<KpiTone, string> = {
  default: 'text-subtle',
  warning: 'text-warning',
  success: 'text-success',
  danger: 'text-danger',
}

const TONE_VALUE: Record<KpiTone, string> = {
  default: 'text-foreground',
  warning: 'text-warning',
  success: 'text-success',
  danger: 'text-danger',
}

interface Props {
  icon: string
  label: string
  /** Already formatted — numbers keep the mono treatment either way. */
  value: string | number
  hint?: string
  tone?: KpiTone
  className?: string
}

export function KpiCard({ icon, label, value, hint, tone = 'default', className }: Props) {
  return (
    <Card className={cn('p-5 transition-shadow hover:shadow-lift', className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="font-mono text-[10px] uppercase tracking-wider text-subtle">{label}</p>
        <span
          className={cn(
            'material-symbols-outlined !text-[18px] shrink-0 leading-none',
            TONE_ICON[tone]
          )}
        >
          {icon}
        </span>
      </div>
      <p className={cn('num mt-2 text-3xl font-bold leading-none', TONE_VALUE[tone])}>{value}</p>
      {hint ? <p className="mt-1.5 text-[11px] leading-snug text-subtle">{hint}</p> : null}
    </Card>
  )
}

/** Skeleton row matching the KPI grid, used by portal loading.tsx files. */
export function KpiSkeletonGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="h-[104px] animate-pulse rounded-xl bg-slate-200/70" />
      ))}
    </div>
  )
}
