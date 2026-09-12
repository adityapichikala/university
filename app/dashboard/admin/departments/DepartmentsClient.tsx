'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState, Spinner } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { KpiCard } from '@/components/dashboard/kpi-card'
import { assignHod, createDepartment, renameDepartment } from './actions'

/**
 * Admin › Departments workspace.
 *
 * Every write is a sparse override layered over the server rows: the UI moves
 * immediately and rolls back if the action is refused, so a duplicate name or
 * a HOD who already heads another department surfaces as a toast rather than
 * as a control that lies about the current state.
 */

interface Person {
  id: string
  name: string
  regno: string
  role: string
}

interface Department {
  id: string
  name: string
  hodUserId: string | null
  hod: Person | null
  counts: { users: number; courses: number; classes: number; employees: number }
}

interface Props {
  departments: Department[]
  candidates: Person[]
  summary: { departments: number; faculty: number; courses: number; unheaded: number }
}

type Patch = Partial<Pick<Department, 'name' | 'hodUserId' | 'hod'>>

export function DepartmentsClient({ departments, candidates, summary }: Props) {
  const toast = useToast()
  const router = useRouter()

  const [overrides, setOverrides] = React.useState<Record<string, Patch>>({})
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState('')
  const [newName, setNewName] = React.useState('')
  const [creating, setCreating] = React.useState(false)

  const rows = React.useMemo(
    () => departments.map((d) => ({ ...d, ...(overrides[d.id] ?? {}) })),
    [departments, overrides]
  )

  function patch(id: string, next: Patch) {
    setOverrides((current) => ({ ...current, [id]: { ...current[id], ...next } }))
  }

  async function onCreate(event: React.FormEvent) {
    event.preventDefault()
    const name = newName.trim()
    if (!name) return

    setCreating(true)
    let result: { ok: boolean; error?: string }
    try {
      result = await createDepartment({ name })
    } catch {
      result = { ok: false, error: 'Network error — nothing was created' }
    }
    setCreating(false)

    if (!result.ok) {
      toast.error('Could not create department', result.error)
      return
    }
    setNewName('')
    toast.success('Department created', name)
    router.refresh()
  }

  function startEdit(dept: Department) {
    setEditingId(dept.id)
    setDraft(dept.name)
  }

  async function commitEdit(dept: Department) {
    const name = draft.trim()
    if (!name || name === dept.name) {
      setEditingId(null)
      return
    }

    setBusyId(dept.id)
    let result: { ok: boolean; error?: string }
    try {
      result = await renameDepartment({ id: dept.id, name })
    } catch {
      result = { ok: false, error: 'Network error — nothing was changed' }
    }
    setBusyId(null)

    if (!result.ok) {
      toast.error('Could not rename', result.error)
      return
    }
    patch(dept.id, { name })
    setEditingId(null)
    toast.success('Renamed', name)
    router.refresh()
  }

  async function onHodChange(dept: Department, hodUserId: string) {
    const nextHod = hodUserId ? candidates.find((c) => c.id === hodUserId) ?? null : null

    setBusyId(dept.id)
    let result: { ok: boolean; error?: string }
    try {
      result = await assignHod({ id: dept.id, hodUserId: hodUserId || null })
    } catch {
      result = { ok: false, error: 'Network error — nothing was changed' }
    }
    setBusyId(null)

    if (!result.ok) {
      toast.error('Could not update HOD', result.error)
      // Reset the select to the value the server still holds.
      patch(dept.id, { hodUserId: dept.hodUserId, hod: dept.hod })
      return
    }
    patch(dept.id, { hodUserId: nextHod?.id ?? null, hod: nextHod })
    toast.success(
      nextHod ? 'HOD appointed' : 'HOD cleared',
      nextHod ? `${nextHod.name} now heads ${dept.name}.` : `${dept.name} has no head.`
    )
    router.refresh()
  }

  return (
    <div className="space-y-6">
      {/* ── KPI bento ─────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon="account_tree"
          label="Departments"
          value={summary.departments}
          hint="across the college"
        />
        <KpiCard icon="groups" label="Assigned people" value={summary.faculty} hint="users with a home department" />
        <KpiCard icon="menu_book" label="Courses" value={summary.courses} hint="owned by departments" />
        <KpiCard
          icon="person_off"
          label="Without a HOD"
          value={summary.unheaded}
          hint={summary.unheaded === 0 ? 'all departments headed' : 'need a head'}
          tone={summary.unheaded > 0 ? 'warning' : 'success'}
        />
      </div>

      {/* ── Create ────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>New department</CardTitle>
          <CardDescription>Names must be unique within the college.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onCreate} className="flex flex-wrap items-center gap-3">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Mechanical Engineering"
              maxLength={80}
              className="max-w-sm"
              aria-label="New department name"
            />
            <Button type="submit" variant="accent" disabled={creating || !newName.trim()}>
              {creating ? <Spinner /> : null}
              Create
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* ── List ──────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>All departments</CardTitle>
          <CardDescription>
            {rows.length} department{rows.length === 1 ? '' : 's'} · {candidates.length} staff
            eligible to head one
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {rows.length === 0 ? (
            <div className="px-6">
              <EmptyState
                icon="account_tree"
                title="No departments yet"
                description="Create the first department to start organising courses and staff."
              />
            </div>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {rows.map((d) => {
                const isEditing = editingId === d.id
                return (
                  <li key={d.id} className="px-6 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        {isEditing ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <Input
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              maxLength={80}
                              className="max-w-xs"
                              aria-label={`Rename ${d.name}`}
                            />
                            <Button
                              size="sm"
                              variant="accent"
                              disabled={busyId === d.id || !draft.trim()}
                              onClick={() => commitEdit(d)}
                            >
                              {busyId === d.id ? <Spinner /> : null}
                              Save
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-foreground">{d.name}</p>
                            <button
                              type="button"
                              onClick={() => startEdit(d)}
                              aria-label={`Rename ${d.name}`}
                              className="rounded-md p-1 text-subtle transition-colors hover:bg-background hover:text-accent"
                            >
                              <span className="material-symbols-outlined text-[16px] leading-none">
                                edit
                              </span>
                            </button>
                          </div>
                        )}

                        <p className="num mt-1 text-[11px] text-subtle">
                          {d.counts.users} people · {d.counts.courses} courses ·{' '}
                          {d.counts.classes} classes · {d.counts.employees} staff records
                        </p>
                      </div>

                      <div className="w-full max-w-[16rem]">
                        <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-subtle">
                          Head of department
                        </label>
                        <div className="flex items-center gap-2">
                          <select
                            value={d.hodUserId ?? ''}
                            disabled={busyId === d.id}
                            onChange={(e) => onHodChange(d, e.target.value)}
                            className="w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-xs text-foreground outline-none transition-colors focus:border-accent disabled:opacity-60"
                            aria-label={`Head of ${d.name}`}
                          >
                            <option value="">Unassigned</option>
                            {candidates.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name} · {c.regno}
                              </option>
                            ))}
                          </select>
                          {busyId === d.id ? <Spinner /> : null}
                        </div>
                        {d.hod ? (
                          <p className="num mt-1 text-[10px] text-muted">{d.hod.role}</p>
                        ) : null}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
