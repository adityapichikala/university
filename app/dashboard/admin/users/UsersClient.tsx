'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ROLES, ROLE_LABEL, type Role } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface UserRow {
  id: string
  regno: string
  name: string
  email: string
  role: string
  status: string
  departmentId: string | null
}

interface Props {
  currentUserId: string
  initialUsers: UserRow[]
  permissions: { id: string; key: string; description: string }[]
  departments: { id: string; name: string }[]
  initialOverrides: { userId: string; key: string; granted: boolean }[]
}

const EMPTY_FORM = {
  regno: '',
  name: '',
  email: '',
  role: 'STUDENT' as Role,
  password: '',
  departmentId: '',
}

export function UsersClient({
  currentUserId,
  initialUsers,
  permissions,
  departments,
  initialOverrides,
}: Props) {
  const router = useRouter()
  const [users, setUsers] = useState(initialUsers)
  const [overrides, setOverrides] = useState(initialOverrides)
  const [selectedId, setSelectedId] = useState(initialUsers[0]?.id ?? '')
  const [form, setForm] = useState(EMPTY_FORM)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const overrideMap = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const o of overrides) if (o.userId === selectedId) map.set(o.key, o.granted)
    return map
  }, [overrides, selectedId])

  const selectedUser = users.find((u) => u.id === selectedId)

  async function request(url: string, method: string, body?: unknown) {
    setError(null)
    setMessage(null)
    setBusy(true)
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error ?? 'Request failed')
        return null
      }
      return data
    } catch {
      setError('Network error. Please try again.')
      return null
    } finally {
      setBusy(false)
    }
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault()
    const data = await request('/api/admin/users', 'POST', {
      ...form,
      departmentId: form.departmentId || null,
    })
    if (!data) return
    setUsers((prev) => [...prev, data.user].sort((a, b) => a.regno.localeCompare(b.regno)))
    setForm(EMPTY_FORM)
    setMessage(`Created ${data.user.regno}`)
    router.refresh()
  }

  async function updateUser(id: string, patch: Record<string, unknown>) {
    const data = await request(`/api/admin/users/${id}`, 'PATCH', patch)
    if (!data) return
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, ...data.user } : u)))
    setMessage('User updated')
    router.refresh()
  }

  async function deactivate(id: string) {
    const data = await request(`/api/admin/users/${id}`, 'DELETE')
    if (!data) return
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, status: 'INACTIVE' } : u)))
    setMessage('User deactivated')
    router.refresh()
  }

  async function setOverride(userId: string, key: string, granted: boolean | null) {
    const data = await request('/api/admin/permissions', 'PUT', { userId, key, granted })
    if (!data) return
    setOverrides((prev) => {
      const rest = prev.filter((o) => !(o.userId === userId && o.key === key))
      return granted === null ? rest : [...rest, { userId, key, granted }]
    })
    setMessage(
      granted === null
        ? `Reset ${key} to role default`
        : `${granted ? 'Granted' : 'Revoked'} ${key}`
    )
    router.refresh()
  }

  return (
    <div className="space-y-6">
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          <span className="material-symbols-outlined !text-[18px]">error</span>
          {error}
        </div>
      )}
      {message && (
        <div className="flex items-center gap-2 rounded-xl bg-success-soft px-4 py-3 text-sm text-success">
          <span className="material-symbols-outlined !text-[18px]">check_circle</span>
          {message}
        </div>
      )}

      {/* ── Users ─────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <p className="text-sm text-muted">
            <span className="num">{users.length}</span> account
            {users.length === 1 ? '' : 's'} in your college.
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {['Reg No', 'Name', 'Email', 'Role', 'Status', ''].map((h) => (
                    <th
                      key={h}
                      className="pb-2 font-mono text-[10px] uppercase tracking-wider text-subtle"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr
                    key={u.id}
                    className={cn(
                      'border-b border-border/60 last:border-0',
                      selectedId === u.id && 'bg-accent-soft/40'
                    )}
                  >
                    <td className="num py-3 pr-4 font-medium">{u.regno}</td>
                    <td className="pr-4">{u.name}</td>
                    <td className="pr-4 text-muted">{u.email}</td>
                    <td className="pr-4">
                      <select
                        value={u.role}
                        onChange={(e) => updateUser(u.id, { role: e.target.value })}
                        disabled={busy || u.id === currentUserId}
                        className="rounded-lg border border-border-strong bg-surface px-2 py-1.5 font-mono text-[11px] text-foreground focus:border-accent focus:outline-none disabled:opacity-50"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="pr-4">
                      <span
                        className={cn(
                          'rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-wider',
                          u.status === 'ACTIVE'
                            ? 'bg-success-soft text-success'
                            : 'bg-danger-soft text-danger'
                        )}
                      >
                        {u.status}
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setSelectedId(u.id)}
                          className={cn(
                            'rounded-lg px-2.5 py-1.5 text-xs transition-colors',
                            selectedId === u.id
                              ? 'bg-accent text-white'
                              : 'text-muted hover:bg-background hover:text-accent'
                          )}
                        >
                          Permissions
                        </button>
                        {u.id !== currentUserId && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              u.status === 'ACTIVE'
                                ? deactivate(u.id)
                                : updateUser(u.id, { status: 'ACTIVE' })
                            }
                            className="rounded-lg px-2.5 py-1.5 text-xs text-muted hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                          >
                            {u.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Create user ────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Add user</CardTitle>
            <p className="text-sm text-muted">They can sign in immediately with these details.</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={createUser} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="new-regno">Reg No</Label>
                  <Input
                    id="new-regno"
                    className="num uppercase"
                    placeholder="STU002"
                    value={form.regno}
                    onChange={(e) => setForm({ ...form, regno: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="new-name">Full name</Label>
                  <Input
                    id="new-name"
                    placeholder="Jane Doe"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="new-email">Email</Label>
                  <Input
                    id="new-email"
                    type="email"
                    placeholder="jane@apex.edu"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="new-password">Password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    placeholder="min. 6 characters"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="new-role">Role</Label>
                  <select
                    id="new-role"
                    value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
                    className="h-11 w-full rounded-xl border border-border-strong bg-surface px-3.5 font-mono text-xs text-foreground focus:border-accent focus:outline-none"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="new-dept">Department</Label>
                  <select
                    id="new-dept"
                    value={form.departmentId}
                    onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
                    className="h-11 w-full rounded-xl border border-border-strong bg-surface px-3.5 text-sm text-foreground focus:border-accent focus:outline-none"
                  >
                    <option value="">— None —</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <Button type="submit" variant="accent" disabled={busy}>
                Create user
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* ── Per-user permission overrides (Tier 2) ─────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Per-user permissions</CardTitle>
            <p className="text-sm text-muted">
              {selectedUser ? (
                <>
                  Overrides for <span className="num text-foreground">{selectedUser.regno}</span> —
                  these beat their role defaults.
                </>
              ) : (
                'Select a user from the table.'
              )}
            </p>
          </CardHeader>
          <CardContent>
            {selectedUser ? (
              <div>
                {permissions.map((p) => {
                  const current = overrideMap.has(p.key) ? overrideMap.get(p.key)! : null
                  return (
                    <div
                      key={p.key}
                      className="flex items-center gap-3 border-t border-border py-3 first:border-t-0"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="num text-xs font-medium text-foreground">{p.key}</p>
                        <p className="text-xs text-muted">{p.description}</p>
                      </div>
                      <div className="flex shrink-0 rounded-lg border border-border p-0.5">
                        {(
                          [
                            ['Default', null],
                            ['Allow', true],
                            ['Deny', false],
                          ] as [string, boolean | null][]
                        ).map(([label, value]) => (
                          <button
                            key={label}
                            type="button"
                            disabled={busy}
                            onClick={() => setOverride(selectedUser.id, p.key, value)}
                            className={cn(
                              'rounded-md px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors disabled:opacity-50',
                              current === value
                                ? 'bg-accent text-white'
                                : 'text-muted hover:bg-background'
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-sm text-subtle">No user selected.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
