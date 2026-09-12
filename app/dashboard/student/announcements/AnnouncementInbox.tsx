'use client'

import * as React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState, Spinner } from '@/components/ui/states'
import { useApiMutation } from '@/components/dashboard/use-api-mutation'
import { PriorityChip, expiresInLabel } from '@/components/dashboard/announcement-priority'
import { cn } from '@/lib/utils'

/**
 * The student inbox. Read state is optimistic — the row flips immediately and
 * the server response reconciles it — so marking ten announcements read does
 * not feel like ten round trips.
 */

export interface InboxAnnouncement {
  id: string
  title: string
  body: string
  priority: string
  expiresAt: string | null
  createdAt: string
  author: string
  audience: string
  readAt: string | null
  named: boolean
}

type Filter = 'ALL' | 'UNREAD' | 'READ'

export function AnnouncementInbox({
  announcements: initial,
}: {
  announcements: InboxAnnouncement[]
}) {
  const { run, pending } = useApiMutation()
  const [filter, setFilter] = React.useState<Filter>('ALL')

  // Optimistic read state is held as a sparse override on top of the server
  // rows, not as a copy of them. That removes the "sync props into state"
  // effect entirely: whenever `router.refresh()` delivers fresher data the new
  // rows show through immediately, and overrides still apply where they exist.
  const [overrides, setOverrides] = React.useState<Record<string, string | null>>({})

  const items = React.useMemo(
    () =>
      initial.map((a) =>
        a.id in overrides ? { ...a, readAt: overrides[a.id] } : a
      ),
    [initial, overrides]
  )

  const unread = items.filter((a) => a.readAt === null).length
  const urgent = items.filter((a) => a.priority === 'URGENT').length

  // Urgent first, then newest — the same order the banner uses, so the two
  // surfaces never disagree about what matters most.
  const ordered = React.useMemo(() => {
    const rank: Record<string, number> = { URGENT: 0, NORMAL: 1, LOW: 2 }
    return [...items].sort((a, b) => {
      const byPriority = (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1)
      if (byPriority !== 0) return byPriority
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })
  }, [items])

  const visible = ordered.filter((a) => {
    if (filter === 'UNREAD') return a.readAt === null
    if (filter === 'READ') return a.readAt !== null
    return true
  })

  async function toggleRead(id: string, read: boolean) {
    const previous = overrides
    const stamp = read ? new Date().toISOString() : null
    // Optimistic: flip now, roll back if the server refuses.
    setOverrides((current) => ({ ...current, [id]: stamp }))
    const ok = await run(`/api/announcements/${id}/read`, 'PATCH', { read }, {
      successTitle: read ? 'Marked as read' : 'Marked as unread',
    })
    if (!ok) setOverrides(previous)
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-muted">Total</p>
          <p className="num mt-1 text-3xl font-bold leading-none text-foreground">
            {items.length}
          </p>
          <p className="mt-1 text-[11px] text-subtle">addressed to you</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted">Unread</p>
          <p
            className={cn(
              'num mt-1 text-3xl font-bold leading-none',
              unread > 0 ? 'text-accent' : 'text-foreground'
            )}
          >
            {unread}
          </p>
          <p className="mt-1 text-[11px] text-subtle">
            {unread > 0 ? 'still to read' : 'you are all caught up'}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted">Urgent</p>
          <p
            className={cn(
              'num mt-1 text-3xl font-bold leading-none',
              urgent > 0 ? 'text-danger' : 'text-foreground'
            )}
          >
            {urgent}
          </p>
          <p className="mt-1 text-[11px] text-subtle">
            {urgent > 0 ? 'pinned to your dashboard' : 'nothing urgent'}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted">Named to you</p>
          <p className="num mt-1 text-3xl font-bold leading-none text-foreground">
            {items.filter((a) => a.named).length}
          </p>
          <p className="mt-1 text-[11px] text-subtle">individually addressed</p>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Inbox</CardTitle>
          <CardDescription>
            Marking a notice read is recorded against your account.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <div className="px-6 pb-4">
            <div className="inline-flex rounded-lg border border-border-strong bg-background p-0.5">
              {(['ALL', 'UNREAD', 'READ'] as Filter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                    filter === f
                      ? 'bg-surface text-foreground shadow-soft'
                      : 'text-muted hover:text-foreground'
                  )}
                >
                  {f.charAt(0) + f.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="px-6">
              <EmptyState
                icon="campaign"
                title={items.length === 0 ? 'No announcements yet' : 'Nothing here'}
                description={
                  items.length === 0
                    ? 'Notices from your teachers and the college will appear here.'
                    : 'No announcements match that filter.'
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {visible.map((a) => (
                <li
                  key={a.id}
                  className={cn(
                    'px-6 py-4 transition-colors',
                    a.readAt === null ? 'bg-accent-soft/30' : 'bg-surface'
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {a.readAt === null ? (
                          <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />
                        ) : null}
                        <p
                          className={cn(
                            'text-sm',
                            a.readAt === null
                              ? 'font-semibold text-foreground'
                              : 'font-medium text-muted'
                          )}
                        >
                          {a.title}
                        </p>
                        <PriorityChip priority={a.priority} />
                        {a.named ? (
                          <span className="num rounded-lg bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                            TO YOU
                          </span>
                        ) : null}
                        {a.expiresAt ? (
                          <span className="num text-[10px] text-subtle">
                            {expiresInLabel(a.expiresAt)}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted">
                        {a.body}
                      </p>
                      <p className="num mt-2 text-[11px] text-subtle">
                        {a.author} · {a.createdAt.slice(0, 10)} · {a.audience}
                      </p>
                    </div>

                    <Button
                      size="sm"
                      variant={a.readAt === null ? 'accent' : 'ghost'}
                      disabled={pending}
                      onClick={() => toggleRead(a.id, a.readAt === null)}
                    >
                      {pending ? <Spinner /> : null}
                      {a.readAt === null ? 'Mark read' : 'Mark unread'}
                    </Button>
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
