'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Spinner } from '@/components/ui/states'

/**
 * Re-runs the server components for this route so the KPI numbers and the
 * audit chain head catch up with mutations made since the page loaded.
 * Deliberately manual rather than automatic on every toggle — a re-render
 * mid-transition is what makes optimistic UI flicker.
 */
export function RefreshButton({ className }: { className?: string }) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()

  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      disabled={isPending}
      aria-busy={isPending || undefined}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 transition-colors',
        'hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
    >
      {isPending ? <Spinner className="text-[15px]" /> : (
        <span className="material-symbols-outlined text-[16px] leading-none">refresh</span>
      )}
      {isPending ? 'Syncing' : 'Refresh'}
    </button>
  )
}
