'use client'

import * as React from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState, Spinner } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import {
  canDecideDepartment,
  type ClearanceDepartment,
  type StudentClearanceRow,
} from '@/lib/clearance-shared'
import { decideClearance } from './actions'

/**
 * No-Dues console table.
 *
 * Every student is a row; the four departments are columns. The auto status is
 * recomputed on the server, so a cell that reads CLEARED is genuinely clear —
 * unless a department head has overridden it, in which case the cell shows the
 * manual decision and the controls let them push it back to auto.
 *
 * A department head sees action buttons only for their own department (and an
 * admin, for all four) — `canDecideDepartment` is the same rule the server
 * enforces, so a button the server would refuse never reaches it.
 */

const STATUS_CHIP: Record<string, string> = {
  CLEARED: 'bg-success-soft text-success',
  PENDING: 'bg-warning-soft text-warning',
}

interface Props {
  students: StudentClearanceRow[]
  viewerRole: string
}

export function ClearanceTable({ students, viewerRole }: Props) {
  const { success, error } = useToast()
  const [busy, setBusy] = React.useState<Set<string>>(new Set())

  function keyOf(studentId: string, department: ClearanceDepartment) {
    return `${studentId}:${department}`
  }

  async function act(
    studentId: string,
    department: ClearanceDepartment,
    manualStatus: 'CLEARED' | 'PENDING' | null,
    label: string
  ) {
    const k = keyOf(studentId, department)
    setBusy((b) => new Set(b).add(k))
    const result = await decideClearance({ studentId, department, manualStatus })
    setBusy((b) => {
      const next = new Set(b)
      next.delete(k)
      return next
    })
    if (!result.ok) {
      error('Decision not saved', result.error)
      return
    }
    success('Updated', `${department} clearance ${label}.`)
  }

  if (students.length === 0) {
    return (
      <EmptyState
        icon="groups"
        title="No students in this college"
        description="When student accounts exist they will appear here with their clearance status."
      />
    )
  }

  return (
    <Card>
      <CardContent className="px-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-border text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 text-left font-medium">Student</th>
                {(['LIBRARY', 'HOSTEL', 'FINANCE', 'ACADEMICS'] as ClearanceDepartment[]).map((d) => (
                  <th key={d} className="px-4 py-2.5 text-center font-medium">
                    {d[0] + d.slice(1).toLowerCase()}
                  </th>
                ))}
                <th className="px-4 py-2.5 text-center font-medium">Overall</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.studentId} className="border-b border-border last:border-0 align-middle">
                  <td className="px-4 py-3">
                    <span className="font-medium text-foreground">{s.name}</span>
                    <span className="num ml-2 text-xs text-subtle">{s.regno}</span>
                  </td>
                  {s.departments.map((d) => {
                    const decidable = canDecideDepartment(viewerRole, d.department)
                    const k = keyOf(s.studentId, d.department)
                    const isBusy = busy.has(k)
                    return (
                      <td key={d.department} className="px-4 py-3 text-center">
                        <div className="flex flex-col items-center gap-1.5">
                          <span
                            className={cn(
                              'inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold',
                              STATUS_CHIP[d.status]
                            )}
                          >
                            {d.status}
                          </span>
                          {decidable ? (
                            <div className="flex items-center gap-1">
                              {d.status === 'PENDING' ? (
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => act(s.studentId, d.department, 'CLEARED', 'cleared')}
                                  title="Mark cleared (override auto check)"
                                  className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-success hover:bg-success-soft disabled:opacity-50"
                                >
                                  {isBusy ? <Spinner /> : 'Clear'}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => act(s.studentId, d.department, 'PENDING', 'held')}
                                  title="Hold this department"
                                  className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-warning hover:bg-warning-soft disabled:opacity-50"
                                >
                                  {isBusy ? <Spinner /> : 'Hold'}
                                </button>
                              )}
                              {d.overridden ? (
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => act(s.studentId, d.department, null, 'returned to auto')}
                                  title="Revert to the live auto check"
                                  className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-subtle hover:bg-background disabled:opacity-50"
                                >
                                  {isBusy ? <Spinner /> : '↺ Auto'}
                                </button>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-[10px] text-subtle">read-only</span>
                          )}
                        </div>
                      </td>
                    )
                  })}
                  <td className="px-4 py-3 text-center">
                    <span
                      className={cn(
                        'inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold',
                        STATUS_CHIP[s.overall]
                      )}
                    >
                      {s.overall}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
