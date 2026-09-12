import { cn } from '@/lib/utils'
import { asAnnouncementPriority, type AnnouncementPriority } from '@/lib/announcements'

/**
 * Priority presentation, shared by the banner, the teacher composer and the
 * student inbox so "URGENT" is the same red everywhere.
 *
 * Deliberately free of hooks and of 'use client' — it renders in either tree.
 */

interface PriorityStyle {
  label: string
  icon: string
  /** Chip colours. Indigo is reserved for the accent, so only URGENT is loud. */
  chip: string
  /** Full-width banner treatment used above the fold. */
  banner: string
  /** Icon glyph colour inside a banner. */
  glyph: string
}

export const PRIORITY_STYLES: Record<AnnouncementPriority, PriorityStyle> = {
  URGENT: {
    label: 'Urgent',
    icon: 'priority_high',
    chip: 'bg-danger-soft text-danger',
    banner: 'border-danger/30 bg-danger-soft',
    glyph: 'text-danger',
  },
  NORMAL: {
    label: 'Notice',
    icon: 'campaign',
    chip: 'bg-accent-soft text-accent',
    banner: 'border-border bg-surface',
    glyph: 'text-accent',
  },
  LOW: {
    label: 'Low',
    icon: 'info',
    chip: 'bg-background text-muted',
    banner: 'border-border bg-background',
    glyph: 'text-muted',
  },
}

export function PriorityChip({
  priority,
  className,
}: {
  priority: unknown
  className?: string
}) {
  const style = PRIORITY_STYLES[asAnnouncementPriority(priority)]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider',
        style.chip,
        className
      )}
    >
      <span className="material-symbols-outlined !text-[12px]">{style.icon}</span>
      {style.label}
    </span>
  )
}

/** "in 3 days" / "2h left" / "expired" — coarse on purpose, no date library. */
export function expiresInLabel(expiresAt: string | null, now: number = Date.now()): string | null {
  if (!expiresAt) return null
  const ms = new Date(expiresAt).getTime() - now
  if (Number.isNaN(ms)) return null
  if (ms <= 0) return 'Expired'

  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `${Math.max(1, minutes)}m left`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h left`

  const days = Math.round(hours / 24)
  return days === 1 ? '1 day left' : `${days} days left`
}
