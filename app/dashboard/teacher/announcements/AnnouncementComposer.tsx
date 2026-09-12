'use client'

import * as React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState, Spinner } from '@/components/ui/states'
import { useApiMutation } from '@/components/dashboard/use-api-mutation'
import { PriorityChip } from '@/components/dashboard/announcement-priority'
import { cn } from '@/lib/utils'

/**
 * Compose + receipts for the Announcements screen.
 *
 * The composer posts to the guarded REST route; the receipt bar is server
 * data, refreshed by `router.refresh()` after each write.
 */

export interface SentAnnouncement {
  id: string
  title: string
  body: string
  priority: string
  expiresAt: string | null
  createdAt: string
  author: string
  audienceLabel: string
  receipts: { audience: number; read: number; unread: number; percent: number }
}

const ROLE_OPTIONS = [
  { value: '', label: 'Everyone' },
  { value: 'STUDENT', label: 'Students' },
  { value: 'TEACHER', label: 'Teachers' },
  { value: 'HOD', label: 'Heads of Department' },
  { value: 'FINANCE', label: 'Finance' },
  { value: 'LIBRARIAN', label: 'Librarians' },
  { value: 'WARDEN', label: 'Wardens' },
]

const PRIORITY_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: 'LOW', label: 'Low', hint: 'Informational, sits at the bottom of the board' },
  { value: 'NORMAL', label: 'Normal', hint: 'Regular notice — the default' },
  { value: 'URGENT', label: 'Urgent', hint: 'Pinned above the fold on every dashboard' },
]

interface Props {
  classes: { id: string; name: string; semester: number }[]
  students: { id: string; name: string; regno: string }[]
  sent: SentAnnouncement[]
  canPickDepartment: boolean
}

export function AnnouncementComposer({ classes, students, sent, canPickDepartment }: Props) {
  const { run, pending } = useApiMutation()
  const [picked, setPicked] = React.useState<string[]>([])
  const [result, setResult] = React.useState<{ audience: number; read: number } | null>(null)

  const totalAudience = sent.reduce((sum, s) => sum + s.receipts.audience, 0)
  const totalRead = sent.reduce((sum, s) => sum + s.receipts.read, 0)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const targetRole = String(data.get('targetRole') ?? '')
    const targetClassId = String(data.get('targetClassId') ?? '')
    const expiresAt = String(data.get('expiresAt') ?? '')

    const ok = await run(
      '/api/announcements',
      'POST',
      {
        title: String(data.get('title') ?? '').trim(),
        body: String(data.get('body') ?? '').trim(),
        targetRole: targetRole || null,
        targetClassId: targetClassId || null,
        priority: String(data.get('priority') ?? 'NORMAL'),
        // Empty input → null → never expires. The datetime-local value has no
        // timezone, so `new Date(...)` reads it as the browser's local zone —
        // which is what the author meant when they typed it.
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        ...(picked.length > 0 ? { targetUserIds: picked } : {}),
      },
      { successTitle: 'Announcement posted' }
    )
    if (ok) {
      form.reset()
      setPicked([])
      setResult(null)
    }
  }

  function toggleStudent(id: string) {
    setPicked((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>New announcement</CardTitle>
          <CardDescription>
            Leave the filters empty to reach everyone in the college. Naming students adds them on
            top of any role or class filter — or, if you set no filter at all, sends it to those
            students only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <label className="block text-xs font-medium text-muted">
              Title
              <input
                name="title"
                required
                maxLength={160}
                placeholder="Mid-semester exam timetable published"
                className="mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-foreground placeholder:text-subtle"
              />
            </label>

            <label className="block text-xs font-medium text-muted">
              Message
              <textarea
                name="body"
                required
                maxLength={4000}
                rows={4}
                placeholder="Write the notice your audience will read…"
                className="mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-foreground placeholder:text-subtle"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-muted">
                Audience role
                <select
                  name="targetRole"
                  defaultValue=""
                  className="mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-foreground"
                >
                  {ROLE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-xs font-medium text-muted">
                Class / section
                <select
                  name="targetClassId"
                  defaultValue=""
                  className="mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-foreground"
                >
                  <option value="">Any class</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} (sem {c.semester})
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-muted">
                Priority
                <select
                  name="priority"
                  defaultValue="NORMAL"
                  className="mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-foreground"
                >
                  {PRIORITY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label} — {o.hint}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-xs font-medium text-muted">
                Expires at <span className="font-normal text-subtle">(optional)</span>
                <input
                  type="datetime-local"
                  name="expiresAt"
                  className="mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-foreground"
                />
              </label>
            </div>
            <p className="-mt-1 text-[11px] text-subtle">
              After this time the notice disappears from every dashboard automatically. Leave blank
              to keep it on the board indefinitely.
            </p>

            {!canPickDepartment ? (
              <p className="text-[11px] text-subtle">
                Department is set automatically to your own.
              </p>
            ) : null}

            <details className="rounded-lg border border-border bg-background px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-muted">
                Name specific students {picked.length > 0 ? `(${picked.length} selected)` : ''}
              </summary>
              <p className="mt-2 text-[11px] text-subtle">
                With a role or class selected these students are added to that audience. With no
                role and no class selected, only these students receive it.
              </p>
              <div className="mt-3 max-h-48 space-y-1 overflow-y-auto">
                {students.map((s) => (
                  <label
                    key={s.id}
                    className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs text-foreground hover:bg-surface"
                  >
                    <input
                      type="checkbox"
                      checked={picked.includes(s.id)}
                      onChange={() => toggleStudent(s.id)}
                      className="h-3.5 w-3.5 accent-[#4b41e1]"
                    />
                    <span className="num text-accent">{s.regno}</span>
                    <span className="text-muted">{s.name}</span>
                  </label>
                ))}
              </div>
            </details>

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner /> : null}
                Post announcement
              </Button>
              {result ? (
                <span className="num text-xs text-muted">
                  Reaching {result.audience} · {result.read} read
                </span>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sent</CardTitle>
          <CardDescription>
            {sent.length} announcement{sent.length === 1 ? '' : 's'} ·{' '}
            <span className="num">{totalRead}</span> of <span className="num">{totalAudience}</span>{' '}
            reads across all
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {sent.length === 0 ? (
            <div className="px-6">
              <EmptyState
                icon="campaign"
                title="Nothing posted yet"
                description="Your announcements will appear here with their read receipts."
              />
            </div>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {sent.map((a) => (
                <li key={a.id} className="px-6 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-foreground">{a.title}</p>
                        <PriorityChip priority={a.priority} />
                        {a.expiresAt ? (
                          <span className="num text-[10px] text-subtle">
                            expires {new Date(a.expiresAt).toLocaleString()}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted">{a.body}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="num text-xs text-muted">
                        {a.createdAt.slice(0, 10)} · {a.author}
                      </p>
                      <p className="mt-1 text-[11px] text-subtle">{a.audienceLabel}</p>
                    </div>
                  </div>

                  <div className="mt-3">
                    <div className="flex items-center justify-between text-[11px] text-muted">
                      <span className="num">
                        Read by {a.receipts.read} of {a.receipts.audience}
                      </span>
                      <span className="num">{a.receipts.percent}%</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-border">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          a.receipts.percent === 100 ? 'bg-success' : 'bg-accent'
                        )}
                        style={{ width: `${Math.max(2, a.receipts.percent)}%` }}
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
