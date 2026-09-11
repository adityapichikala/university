'use client'

import * as React from 'react'
import { EmptyState } from '@/components/ui/states'
import { cn } from '@/lib/utils'

/**
 * Audit table. Rows expand to show the before/after snapshot and the row's
 * place in the hash chain — that is what makes the log useful during an
 * incident rather than just decorative.
 *
 * Timestamps arrive pre-formatted from the server (plain strings) so there is
 * no locale/timezone hydration mismatch.
 */

export interface AuditEntryView {
  id: string
  time: string
  actionType: string
  targetEntity: string
  status: string
  agentName: string
  actorName: string | null
  actorRegno: string | null
  hash: string | null
  prevHash: string | null
  entityId: string | null
  ip: string | null
  before: string | null
  after: string | null
}

const STATUS_TONE: Record<string, string> = {
  EXECUTED: 'bg-success-soft text-success',
  APPROVED: 'bg-success-soft text-success',
  REJECTED: 'bg-warning-soft text-warning',
  FAILED: 'bg-danger-soft text-danger',
  PENDING: 'bg-background text-muted',
}

function shortHash(hash: string | null): string {
  if (!hash) return '—'
  return hash.length <= 16 ? hash : `${hash.slice(0, 12)}…`
}

export function AuditTable({ rows }: { rows: AuditEntryView[] }) {
  const [expanded, setExpanded] = React.useState<string | null>(null)

  if (rows.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          icon="search_off"
          title="No audit entries match these filters"
          description="Widen the date range or clear the filters. New entries appear here the moment a state-changing action runs."
        />
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] border-collapse text-left">
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="w-8 px-3 py-3" />
            <th
              scope="col"
              className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-subtle"
            >
              Timestamp
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-subtle"
            >
              Action
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-subtle"
            >
              Actor
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-subtle"
            >
              Status
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-subtle"
            >
              Hash
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const open = expanded === row.id
            return (
              <React.Fragment key={row.id}>
                <tr
                  className={cn(
                    'border-b border-border/60 transition-colors',
                    open ? 'bg-background' : 'hover:bg-background'
                  )}
                >
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : row.id)}
                      aria-expanded={open}
                      aria-label={open ? 'Collapse entry' : 'Expand entry'}
                      className="rounded-md p-1 text-subtle transition-colors hover:bg-surface hover:text-foreground"
                    >
                      <span className="material-symbols-outlined text-[18px] leading-none">
                        {open ? 'expand_less' : 'expand_more'}
                      </span>
                    </button>
                  </td>

                  <td className="num whitespace-nowrap px-4 py-3 text-xs text-muted">
                    {row.time}
                  </td>

                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-foreground">{row.actionType}</p>
                    <p className="num truncate text-[11px] text-subtle">
                      {row.targetEntity}
                      {row.entityId ? ` · ${row.entityId}` : ''}
                    </p>
                  </td>

                  <td className="px-4 py-3">
                    <p className="text-sm text-foreground">{row.actorName ?? row.agentName}</p>
                    <p className="num text-[11px] text-subtle">{row.actorRegno ?? 'system'}</p>
                  </td>

                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                        STATUS_TONE[row.status] ?? 'bg-background text-muted'
                      )}
                    >
                      {row.status}
                    </span>
                  </td>

                  <td className="num px-4 py-3 text-xs text-subtle" title={row.hash ?? undefined}>
                    {shortHash(row.hash)}
                  </td>
                </tr>

                {open ? (
                  <tr className="border-b border-border/60 bg-background">
                    <td />
                    <td colSpan={5} className="px-4 pb-4 pt-1">
                      <div className="grid gap-3 lg:grid-cols-2">
                        <div className="rounded-lg border border-border bg-surface p-3">
                          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-subtle">
                            State before
                          </p>
                          <pre className="num overflow-x-auto whitespace-pre-wrap break-all text-[11px] leading-relaxed text-muted">
                            {row.before ?? '—'}
                          </pre>
                        </div>
                        <div className="rounded-lg border border-border bg-surface p-3">
                          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-subtle">
                            State after
                          </p>
                          <pre className="num overflow-x-auto whitespace-pre-wrap break-all text-[11px] leading-relaxed text-muted">
                            {row.after ?? '—'}
                          </pre>
                        </div>
                      </div>

                      <dl className="mt-3 grid gap-3 sm:grid-cols-3">
                        <div>
                          <dt className="text-[10px] font-semibold uppercase tracking-wider text-subtle">
                            Entry id
                          </dt>
                          <dd className="num mt-0.5 break-all text-[11px] text-muted">{row.id}</dd>
                        </div>
                        <div>
                          <dt className="text-[10px] font-semibold uppercase tracking-wider text-subtle">
                            Source IP
                          </dt>
                          <dd className="num mt-0.5 text-[11px] text-muted">{row.ip ?? '—'}</dd>
                        </div>
                        <div>
                          <dt className="text-[10px] font-semibold uppercase tracking-wider text-subtle">
                            Previous hash
                          </dt>
                          <dd
                            className="num mt-0.5 break-all text-[11px] text-muted"
                            title={row.prevHash ?? undefined}
                          >
                            {row.prevHash ?? '—'}
                          </dd>
                        </div>
                      </dl>
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
