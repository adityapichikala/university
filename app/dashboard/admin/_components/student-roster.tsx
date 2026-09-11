'use client'

import * as React from 'react'
import { Switch } from '@/components/ui/switch'
import { EmptyState } from '@/components/ui/states'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { setUserPermissionAction } from '../actions'
import { useOptimisticToggles } from './use-optimistic-toggles'
import type { AccessMatrix, PermissionColumn, StudentRow } from './types'

/**
 * Student roster with per-student feature toggles (LMS, Exam Engine,
 * Virtual Lab). Search filters locally and has its own empty state.
 * Toggles are optimistic against `setUserPermissionAction`.
 */

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function StudentRoster({
  rows,
  columns,
  matrix,
}: {
  rows: StudentRow[]
  columns: PermissionColumn[]
  matrix: AccessMatrix
}) {
  const [query, setQuery] = React.useState('')

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.regno.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        (r.className ?? '').toLowerCase().includes(q)
    )
  }, [rows, query])

  const initial = React.useMemo(() => {
    const out: Record<string, boolean> = {}
    for (const row of rows) {
      for (const col of columns) {
        out[`${row.id}:${col.key}`] = matrix[row.id]?.[col.key]?.effective ?? false
      }
    }
    return out
  }, [rows, columns, matrix])

  const commit = React.useCallback(async (key: string, value: boolean) => {
    const split = key.lastIndexOf(':')
    return setUserPermissionAction({
      userId: key.slice(0, split),
      permissionKey: key.slice(split + 1),
      granted: value,
    })
  }, [])

  const { values, pending, toggle } = useOptimisticToggles(initial, commit, {
    on: 'Feature enabled',
    off: 'Feature disabled',
  })

  if (rows.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          icon="group_off"
          title="No students enrolled"
          description="Add a user with the Student role and they will show up here with their feature toggles."
        />
      </div>
    )
  }

  return (
    <div>
      {/* Toolbar — search is an interactive element, so it gets its own states. */}
      <div className="flex flex-col gap-3 border-b border-border px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] leading-none text-subtle">
            search
          </span>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, regno or section"
            aria-label="Search students"
            className="pl-9"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-subtle transition-colors hover:bg-background hover:text-foreground"
            >
              <span className="material-symbols-outlined text-[16px] leading-none">close</span>
            </button>
          ) : null}
        </div>

        <p className="num text-xs text-subtle">
          {filtered.length} / {rows.length} shown
        </p>
      </div>

      {filtered.length === 0 ? (
        <div className="p-6">
          <EmptyState
            icon="filter_alt_off"
            title={`No students match “${query}”`}
            description="Try a different name, registration number or section."
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border">
                <th
                  scope="col"
                  className="px-6 py-3 text-[11px] font-semibold uppercase tracking-wider text-subtle"
                >
                  Student
                </th>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    scope="col"
                    className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-subtle"
                  >
                    <span className="inline-flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px] leading-none">
                        {col.icon}
                      </span>
                      {col.label}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-border/60 transition-colors last:border-0 hover:bg-background"
                >
                  <td className="px-6 py-3.5">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-background text-xs font-semibold text-muted">
                        {initials(row.name)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{row.name}</p>
                        <p className="num truncate text-[11px] text-subtle">
                          {row.regno}
                          {row.className ? ` · ${row.className}` : ''}
                        </p>
                      </div>
                    </div>
                  </td>

                  {columns.map((col) => {
                    const key = `${row.id}:${col.key}`
                    const cell = matrix[row.id]?.[col.key]
                    const isPending = Boolean(pending[key])
                    return (
                      <td key={col.key} className="px-4 py-3.5">
                        <div className="flex flex-col items-center gap-1.5">
                          <Switch
                            checked={values[key] ?? false}
                            loading={isPending}
                            onCheckedChange={(next) =>
                              toggle(key, next, `${col.label} · ${row.name}`)
                            }
                            aria-label={`${col.label} for ${row.name}`}
                          />
                          <span
                            className={cn(
                              'text-[9px] font-medium uppercase tracking-wide',
                              cell?.inherited ? 'text-subtle' : 'text-accent'
                            )}
                          >
                            {isPending ? 'saving' : cell?.inherited ? 'inherited' : 'override'}
                          </span>
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
