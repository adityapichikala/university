'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { asAnnouncementPriority, isLive, priorityRank } from '@/lib/announcements'
import { PRIORITY_STYLES, expiresInLabel } from './announcement-priority'
import { cn } from '@/lib/utils'

/**
 * Announcement banner — urgent notices, above the fold.
 *
 * Three ways an item leaves this banner, and each is a different kind of
 * intent:
 *   • dismiss   → "I have seen it, stop showing me" (localStorage, per id)
 *   • mark read → "I have acted on it"              (server, NotificationRead)
 *   • expiresAt → "it is no longer true"            (time, nobody's choice)
 *
 * Dismissal is deliberately per-announcement-id and deliberately local: it is
 * a UI preference about *this* browser, not a college-wide fact, so it must
 * never be written back to the server or shared with the read receipts that
 * the teacher's "read by 12 of 40" counter depends on.
 *
 * The rows themselves arrive as props from the server layout rather than being
 * fetched here. That matters twice over: the banner paints with the rest of
 * the page instead of flashing a skeleton, and there is no second round trip
 * for something every single dashboard view needs.
 */

/** One key per announcement id, so dismissing one does not hide the others. */
const DISMISS_PREFIX = 'announcement:dismissed:'

/** Keep the banner a banner — three notices, then a link to the full board. */
const MAX_VISIBLE = 3

/** Re-check expiry this often, so a notice lapses without a reload. */
const EXPIRY_TICK_MS = 30_000

export interface BannerAnnouncement {
  id: string
  title: string
  body: string
  priority: string
  expiresAt: string | null
  createdAt: string
  createdBy: { name: string; regno: string }
  audience: string
  readAt: string | null
}

/**
 * "Have we mounted yet?" via useSyncExternalStore — the React-documented way
 * to read a browser-only value without a hydration mismatch and without an
 * effect that setstates. Server says false, client says true, always.
 */
const subscribeNever = () => () => {}
const snapshotClient = () => true
const snapshotServer = () => false

const EMPTY: ReadonlySet<string> = new Set()

/** localStorage throws in private mode / when disabled — never let that break UI. */
function readDismissed(): Set<string> {
  try {
    const ids: string[] = []
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i)
      if (key?.startsWith(DISMISS_PREFIX)) ids.push(key.slice(DISMISS_PREFIX.length))
    }
    return new Set(ids)
  } catch {
    return new Set()
  }
}

function writeDismissed(id: string) {
  try {
    window.localStorage.setItem(`${DISMISS_PREFIX}${id}`, new Date().toISOString())
  } catch {
    /* storage unavailable — the dismiss just won't survive a reload */
  }
}

export function AnnouncementBanner({
  announcements,
  moreHref,
  className,
}: {
  announcements: BannerAnnouncement[]
  /** Where "+N more" points. Omitted for roles without a dedicated board. */
  moreHref?: string
  className?: string
}) {
  const router = useRouter()
  const mounted = React.useSyncExternalStore(subscribeNever, snapshotClient, snapshotServer)

  const [now, setNow] = React.useState(() => Date.now())
  const [dismissVersion, setDismissVersion] = React.useState(0)
  const [readIds, setReadIds] = React.useState<ReadonlySet<string>>(EMPTY)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  // A notice can expire while the tab sits idle, so the clock has to tick.
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), EXPIRY_TICK_MS)
    return () => window.clearInterval(timer)
  }, [])

  // Read during render, not in an effect: `mounted` guarantees this only ever
  // runs in the browser, and `dismissVersion` re-runs it after a dismissal.
  const dismissed = React.useMemo(
    () => (mounted ? readDismissed() : EMPTY),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dismissVersion is the invalidation key
    [mounted, dismissVersion]
  )

  function dismiss(id: string) {
    writeDismissed(id)
    setDismissVersion((v) => v + 1)
  }

  async function markRead(id: string) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/announcements/${id}/read`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ read: true }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // Hide it immediately; the server re-render will confirm.
      setReadIds((current) => new Set(current).add(id))
      router.refresh()
    } catch {
      /* nothing optimistic to roll back — the notice simply stays until
         it is dismissed or expires */
    } finally {
      setBusyId(null)
    }
  }

  // Before mount the server HTML and the client HTML must agree, so render a
  // placeholder of the same shape and swap in the real rows on hydration.
  if (!mounted) {
    return announcements.length > 0 ? (
      <div className={cn('mb-6', className)} aria-hidden>
        <div className="h-[76px] w-full rounded-xl border border-border bg-surface" />
      </div>
    ) : null
  }

  const nowDate = new Date(now)
  const visible = announcements
    .filter((a) => isLive(a, nowDate))
    .filter((a) => !dismissed.has(a.id))
    .filter((a) => !a.readAt && !readIds.has(a.id))
    .sort((a, b) => {
      const byPriority = priorityRank(a.priority) - priorityRank(b.priority)
      if (byPriority !== 0) return byPriority
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })

  const shown = visible.slice(0, MAX_VISIBLE)
  const hidden = visible.length - shown.length

  if (shown.length === 0) return null

  return (
    <div className={cn('mb-6 space-y-2', className)} aria-live="polite">
      {shown.map((a) => {
        const style = PRIORITY_STYLES[asAnnouncementPriority(a.priority)]
        const remaining = expiresInLabel(a.expiresAt, now)
        return (
          <div
            key={a.id}
            role={a.priority === 'URGENT' ? 'alert' : 'status'}
            className={cn(
              'animate-fade flex items-start gap-3 rounded-xl border px-4 py-3 shadow-card',
              style.banner
            )}
          >
            <span className={cn('material-symbols-outlined mt-0.5 shrink-0 !text-[20px]', style.glyph)}>
              {style.icon}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-primary">{a.title}</p>
                {a.priority === 'URGENT' ? (
                  <span className="rounded-full bg-danger px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-white">
                    Urgent
                  </span>
                ) : null}
                {remaining ? <span className="num text-[10px] text-subtle">{remaining}</span> : null}
              </div>
              <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted">{a.body}</p>
              <p className="num mt-1 text-[10px] uppercase tracking-wider text-subtle">
                {a.audience} · {a.createdBy.regno}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => markRead(a.id)}
                disabled={busyId === a.id}
                className="rounded-lg px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted hover:bg-background hover:text-foreground disabled:opacity-50"
              >
                {busyId === a.id ? '…' : 'Got it'}
              </button>
              <button
                type="button"
                onClick={() => dismiss(a.id)}
                aria-label={`Dismiss announcement: ${a.title}`}
                className="grid h-7 w-7 place-items-center rounded-lg text-subtle hover:bg-background hover:text-foreground"
              >
                <span className="material-symbols-outlined !text-[18px]">close</span>
              </button>
            </div>
          </div>
        )
      })}

      {hidden > 0 ? (
        moreHref ? (
          <Link
            href={moreHref}
            className="num block text-right text-[10px] uppercase tracking-wider text-accent hover:underline"
          >
            +{hidden} more announcement{hidden === 1 ? '' : 's'}
          </Link>
        ) : (
          <p className="num text-right text-[10px] uppercase tracking-wider text-subtle">
            +{hidden} more announcement{hidden === 1 ? '' : 's'}
          </p>
        )
      ) : null}
    </div>
  )
}
