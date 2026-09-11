/** Deterministic UTC formatting — safe to call on both server and client. */

const DATE_ONLY = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
})

export function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : DATE_ONLY.format(date)
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : DATE_TIME.format(date)
}

/** "in 3 days" / "2 days late" — plain, no library. */
export function dueLabel(dueIso: string, now = Date.now()): { text: string; overdue: boolean } {
  const due = new Date(dueIso).getTime()
  if (Number.isNaN(due)) return { text: '—', overdue: false }

  const diffMs = due - now
  const days = Math.round(Math.abs(diffMs) / 86_400_000)
  if (diffMs < 0) return { text: days === 0 ? 'due today' : `${days}d overdue`, overdue: true }
  if (days === 0) return { text: 'due today', overdue: false }
  if (days === 1) return { text: 'due tomorrow', overdue: false }
  return { text: `in ${days} days`, overdue: false }
}
