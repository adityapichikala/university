/**
 * Leave requests — domain rules shared by the HOD and HR portals.
 *
 * Status vocabulary lives here rather than in an enum because SQLite has no
 * enums; anything read from the DB is treated as untrusted and funnelled
 * through `asLeaveStatus`.
 */

export const LEAVE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const
export type LeaveStatus = (typeof LEAVE_STATUSES)[number]

/** The only two outcomes a reviewer can record. */
export const LEAVE_DECISIONS = ['APPROVED', 'REJECTED'] as const
export type LeaveDecision = (typeof LEAVE_DECISIONS)[number]

export function isLeaveStatus(value: unknown): value is LeaveStatus {
  return typeof value === 'string' && (LEAVE_STATUSES as readonly string[]).includes(value)
}

export function asLeaveStatus(value: unknown): LeaveStatus {
  return isLeaveStatus(value) ? value : 'PENDING'
}

export function isLeaveDecision(value: unknown): value is LeaveDecision {
  return typeof value === 'string' && (LEAVE_DECISIONS as readonly string[]).includes(value)
}

/**
 * Inclusive day count — a Monday-to-Monday request is one day, not zero.
 * Floored so a partial day never rounds up into a full one.
 */
export function leaveDays(startDate: Date | string, endDate: Date | string): number {
  const start = startDate instanceof Date ? startDate : new Date(startDate)
  const end = endDate instanceof Date ? endDate : new Date(endDate)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0
  const ms = end.getTime() - start.getTime()
  if (ms < 0) return 0
  return Math.floor(ms / 86_400_000) + 1
}

export function leaveDaysLabel(days: number): string {
  return days === 1 ? '1 day' : `${days} days`
}

/** Has this request already been decided? Deciding twice would rewrite history. */
export function isDecided(status: unknown): boolean {
  return asLeaveStatus(status) !== 'PENDING'
}

export const LEAVE_STATUS_STYLE: Record<LeaveStatus, { label: string; chip: string }> = {
  PENDING: { label: 'Pending', chip: 'bg-warning-soft text-warning' },
  APPROVED: { label: 'Approved', chip: 'bg-success-soft text-success' },
  REJECTED: { label: 'Rejected', chip: 'bg-danger-soft text-danger' },
  CANCELLED: { label: 'Cancelled', chip: 'bg-background text-muted' },
}
