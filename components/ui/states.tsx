import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * The three states every panel on the governance dashboard can be in.
 * Kept in one file so loading/empty/error look identical across screens.
 */

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse rounded-lg bg-slate-200/70', className)}
      {...props}
    />
  )
}

/** Inline spinner for buttons — Material Symbols only, per the design system. */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('material-symbols-outlined animate-spin text-[18px] leading-none', className)}
    >
      progress_activity
    </span>
  )
}

export interface EmptyStateProps {
  icon?: string
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function EmptyState({
  icon = 'inbox',
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border-strong bg-background px-6 py-10 text-center',
        className
      )}
    >
      <span className="material-symbols-outlined text-[28px] leading-none text-subtle">
        {icon}
      </span>
      <div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {description ? (
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  )
}

export interface ErrorStateProps {
  title?: string
  description?: string
  onRetry?: () => void
  className?: string
}

export function ErrorState({
  title = 'Something went wrong',
  description = 'This panel could not be loaded. Try again — nothing has been changed.',
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-danger/30 bg-danger-soft/40 px-6 py-10 text-center',
        className
      )}
    >
      <span className="material-symbols-outlined text-[28px] leading-none text-danger">error</span>
      <div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted">{description}</p>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-background"
        >
          <span className="material-symbols-outlined text-[16px] leading-none">refresh</span>
          Retry
        </button>
      ) : null}
    </div>
  )
}
