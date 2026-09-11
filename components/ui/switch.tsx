'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Accessible toggle built on role="switch".
 *
 * Three visual states, because every interactive element on the governance
 * dashboard needs one:
 *   • idle     — on (indigo) / off (grey)
 *   • loading  — knob is replaced by a spinner, input locked, aria-busy set
 *   • disabled — dimmed, not focusable, no pointer events
 *
 * `onCheckedChange` receives the *requested* next value. The parent decides
 * whether to keep it (optimistic) or roll back.
 */
export interface SwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'children'> {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  loading?: boolean
  size?: 'sm' | 'md'
  /** Required — the matrix cell has no visible text label of its own. */
  'aria-label': string
}

export function Switch({
  checked,
  onCheckedChange,
  loading = false,
  disabled = false,
  size = 'md',
  className,
  'aria-label': ariaLabel,
  ...props
}: SwitchProps) {
  const locked = disabled || loading

  const track = size === 'sm' ? 'h-5 w-9' : 'h-6 w-11'
  const knob = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4.5 w-4.5'
  const travel = size === 'sm' ? 'translate-x-4' : 'translate-x-5'

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-busy={loading || undefined}
      aria-label={ariaLabel}
      disabled={locked}
      onClick={() => !locked && onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-full border transition-colors duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2',
        track,
        checked
          ? 'border-accent bg-accent'
          : 'border-border-strong bg-slate-200 hover:bg-slate-300',
        locked && 'cursor-not-allowed opacity-60',
        !locked && 'cursor-pointer',
        className
      )}
      {...props}
    >
      <span
        className={cn(
          'pointer-events-none ml-0.5 flex items-center justify-center rounded-full bg-white shadow-sm transition-transform duration-200',
          knob,
          checked ? travel : 'translate-x-0'
        )}
      >
        {loading ? (
          <span className="material-symbols-outlined animate-spin text-[13px] leading-none text-accent">
            progress_activity
          </span>
        ) : null}
      </span>
    </button>
  )
}
