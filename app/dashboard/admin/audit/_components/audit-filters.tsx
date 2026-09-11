'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AUDIT_STATUSES } from '@/lib/audit-log'
import { Spinner } from '@/components/ui/states'
import { cn } from '@/lib/utils'

/**
 * Filter bar. Deliberately uncontrolled + form-driven: selects auto-submit on
 * change, the search box submits on Enter. No state, no effects, no hydration
 * risk — and the URL stays the single source of truth (shareable, back-button
 * friendly, and the server re-renders behind a Suspense boundary).
 */

const FIELD =
  'h-9 rounded-lg border border-border-strong bg-surface px-2.5 text-xs text-foreground transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20'

export function AuditFilters({
  actionTypes,
  actors,
  current,
}: {
  actionTypes: string[]
  actors: Array<{ id: string; name: string; regno: string }>
  current: {
    actionType?: string
    actorId?: string
    status?: string
    q?: string
    from?: string
    to?: string
  }
}) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()

  const submit = (form: HTMLFormElement) => {
    const data = new FormData(form)
    const params = new URLSearchParams()
    for (const key of ['actionType', 'actorId', 'status', 'q', 'from', 'to'] as const) {
      const value = String(data.get(key) ?? '').trim()
      if (value) params.set(key, value)
    }
    const qs = params.toString()
    startTransition(() => router.push(qs ? `/dashboard/admin/audit?${qs}` : '/dashboard/admin/audit'))
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit(e.currentTarget)
      }}
      className="flex flex-col gap-3 border-b border-border px-6 py-4 lg:flex-row lg:items-end lg:flex-wrap"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="f-action" className="text-[10px] font-semibold uppercase tracking-wider text-subtle">
          Action
        </label>
        <select
          id="f-action"
          name="actionType"
          defaultValue={current.actionType ?? ''}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className={cn(FIELD, 'min-w-[190px]')}
        >
          <option value="">All actions</option>
          {actionTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="f-actor" className="text-[10px] font-semibold uppercase tracking-wider text-subtle">
          Actor
        </label>
        <select
          id="f-actor"
          name="actorId"
          defaultValue={current.actorId ?? ''}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className={cn(FIELD, 'min-w-[170px]')}
        >
          <option value="">Anyone</option>
          {actors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.regno})
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="f-status" className="text-[10px] font-semibold uppercase tracking-wider text-subtle">
          Status
        </label>
        <select
          id="f-status"
          name="status"
          defaultValue={current.status ?? ''}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className={cn(FIELD, 'min-w-[130px]')}
        >
          <option value="">Any status</option>
          {AUDIT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="f-from" className="text-[10px] font-semibold uppercase tracking-wider text-subtle">
          From
        </label>
        <input
          id="f-from"
          name="from"
          type="date"
          defaultValue={current.from ?? ''}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className={cn(FIELD, 'w-[150px]')}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="f-to" className="text-[10px] font-semibold uppercase tracking-wider text-subtle">
          To
        </label>
        <input
          id="f-to"
          name="to"
          type="date"
          defaultValue={current.to ?? ''}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className={cn(FIELD, 'w-[150px]')}
        />
      </div>

      <div className="flex flex-1 flex-col gap-1 lg:min-w-[220px]">
        <label htmlFor="f-q" className="text-[10px] font-semibold uppercase tracking-wider text-subtle">
          Search
        </label>
        <div className="relative">
          <span className="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] leading-none text-subtle">
            search
          </span>
          <input
            id="f-q"
            name="q"
            type="search"
            defaultValue={current.q ?? ''}
            placeholder="Entity, regno or id — press Enter"
            className={cn(FIELD, 'w-full pl-8')}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? <Spinner className="text-[14px]" /> : (
            <span className="material-symbols-outlined text-[15px] leading-none">filter_alt</span>
          )}
          Apply
        </button>
        <Link
          href="/dashboard/admin/audit"
          className="inline-flex h-9 items-center rounded-lg border border-border-strong bg-surface px-3 text-xs font-medium text-muted transition-colors hover:bg-background hover:text-foreground"
        >
          Reset
        </Link>
      </div>
    </form>
  )
}
