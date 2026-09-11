'use client'

import * as React from 'react'
import { Switch } from '@/components/ui/switch'
import { EmptyState } from '@/components/ui/states'
import { cn } from '@/lib/utils'
import { setUserPermissionAction } from '../actions'
import { useOptimisticToggles } from './use-optimistic-toggles'
import type { AccessMatrix, FacultyRow, PermissionColumn } from './types'

/**
 * Faculty privilege matrix — teachers × permissions.
 *
 * Each cell is an optimistic Switch wired to the `setUserPermissionAction`
 * server action. The caption under each switch tells you where the value
 * comes from: inherited from the role, or a custom override.
 */

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function FacultyMatrix({
  rows,
  columns,
  matrix,
}: {
  rows: FacultyRow[]
  columns: PermissionColumn[]
  matrix: AccessMatrix
}) {
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
    on: 'Privilege granted',
    off: 'Privilege revoked',
  })

  if (columns.length === 0) {
    return (
      <EmptyState
        icon="tune"
        title="No permissions defined"
        description="Run the seed to create the permission catalogue, then assign them here."
      />
    )
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon="person_search"
        title="No faculty accounts yet"
        description="Create a user with the Teacher role and they will appear in this matrix."
      />
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left">
        <thead>
          <tr className="border-b border-border">
            <th
              scope="col"
              className="px-6 py-3 text-[11px] font-semibold uppercase tracking-wider text-subtle"
            >
              Faculty
            </th>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                title={col.description}
                className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-subtle"
              >
                {col.label}
              </th>
            ))}
            <th
              scope="col"
              className="px-6 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-subtle"
            >
              Courses
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-border/60 transition-colors last:border-0 hover:bg-background"
            >
              <td className="px-6 py-3.5">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
                    {initials(row.name)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{row.name}</p>
                    <p className="num truncate text-[11px] text-subtle">
                      {row.regno} · {row.email}
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
                        onCheckedChange={(next) => toggle(key, next, `${col.label} · ${row.name}`)}
                        aria-label={`${col.label} for ${row.name}`}
                      />
                      <span
                        className={cn(
                          'text-[9px] font-medium uppercase tracking-wide',
                          cell?.inherited ? 'text-subtle' : 'text-accent'
                        )}
                      >
                        {isPending
                          ? 'saving'
                          : cell?.inherited
                            ? 'inherited'
                            : cell?.override
                              ? 'forced'
                              : 'revoked'}
                      </span>
                    </div>
                  </td>
                )
              })}

              <td className="num px-6 py-3.5 text-right text-sm text-muted">{row.courseCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
