'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Minimal toast system — no dependency, ~90 lines.
 *
 * Provider holds the stack; `useToast()` gives any client component a
 * `toast()` call. Timers are scheduled inside the event handler (not an
 * effect) so there is no setState-after-render, and every timer is cleared
 * on unmount.
 */

export type ToastVariant = 'success' | 'error' | 'info'

export interface ToastOptions {
  title: string
  description?: string
  variant?: ToastVariant
  /** ms before auto-dismiss. 0 keeps it until dismissed. Default 4000. */
  duration?: number
}

interface ToastRecord extends ToastOptions {
  id: number
  variant: ToastVariant
}

interface ToastApi {
  toast: (options: ToastOptions) => void
  success: (title: string, description?: string) => void
  error: (title: string, description?: string) => void
}

const ToastContext = React.createContext<ToastApi | null>(null)

const ICON: Record<ToastVariant, string> = {
  success: 'check_circle',
  error: 'error',
  info: 'info',
}

const TONE: Record<ToastVariant, string> = {
  success: 'text-success bg-success-soft',
  error: 'text-danger bg-danger-soft',
  info: 'text-accent bg-accent-soft',
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastRecord[]>([])
  const timers = React.useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  const nextId = React.useRef(1)

  const dismiss = React.useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const toast = React.useCallback(
    (options: ToastOptions) => {
      const id = nextId.current++
      const record: ToastRecord = { variant: 'success', ...options, id }
      setToasts((current) => [...current, record])

      const duration = options.duration ?? 4000
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration)
        )
      }
    },
    [dismiss]
  )

  // Clear pending timers if the provider ever unmounts mid-flight.
  React.useEffect(() => {
    const pending = timers.current
    return () => {
      pending.forEach((timer) => clearTimeout(timer))
      pending.clear()
    }
  }, [])

  const api = React.useMemo<ToastApi>(
    () => ({
      toast,
      success: (title, description) => toast({ title, description, variant: 'success' }),
      error: (title, description) => toast({ title, description, variant: 'error' }),
    }),
    [toast]
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.variant === 'error' ? 'alert' : 'status'}
            className="animate-fade pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-border bg-surface p-4 shadow-card"
          >
            <span
              className={cn(
                'material-symbols-outlined mt-0.5 shrink-0 rounded-lg p-1 text-[18px] leading-none',
                TONE[t.variant]
              )}
            >
              {ICON[t.variant]}
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">{t.title}</p>
              {t.description ? (
                <p className="mt-0.5 text-xs leading-relaxed text-muted">{t.description}</p>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="-m-1 shrink-0 rounded-lg p-1 text-subtle transition-colors hover:bg-background hover:text-foreground"
            >
              <span className="material-symbols-outlined text-[18px] leading-none">close</span>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = React.useContext(ToastContext)
  if (!ctx) throw new Error('useToast() must be used inside <ToastProvider>')
  return ctx
}
