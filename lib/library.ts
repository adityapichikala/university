/**
 * Library — pure domain rules (Phase 3, doc §7).
 *
 * No Prisma, no `@/` imports: the fine maths is the part most likely to be
 * argued about, so it lives somewhere it can be tested in isolation.
 */

/** ₹ per day, charged per issued copy. */
export const FINE_PER_DAY = 5

/** Standard loan period in days when the caller does not supply a due date. */
export const DEFAULT_LOAN_DAYS = 14

export type IssueState = 'ACTIVE' | 'RETURNED' | 'OVERDUE'

export const ISSUE_STATES: IssueState[] = ['ACTIVE', 'RETURNED', 'OVERDUE']

/** Whole days late. Never negative — an early return is simply 0. */
export function daysLate(dueAt: Date | string, at: Date | string): number {
  const due = toDate(dueAt).getTime()
  const now = toDate(at).getTime()
  if (now <= due) return 0
  // Floor, not ceil: being 3 hours late is not a day's fine.
  return Math.floor((now - due) / 86_400_000)
}

/**
 * Fine owed at a point in time. A returned book is charged up to its return
 * date; one still out is charged up to `now`, which is how the UI shows a
 * running fine on an overdue loan.
 */
export function computeFine(
  dueAt: Date | string,
  at: Date | string | null,
  perDay: number = FINE_PER_DAY
): number {
  if (at === null) return 0
  return daysLate(dueAt, at) * perDay
}

/** One of ACTIVE / OVERDUE / RETURNED. RETURNED always wins. */
export function issueState(issue: {
  returnedAt: Date | string | null
  dueAt: Date | string
  now?: Date | string
}): IssueState {
  if (issue.returnedAt) return 'RETURNED'
  const now = issue.now ?? new Date()
  return daysLate(issue.dueAt, now) > 0 ? 'OVERDUE' : 'ACTIVE'
}

export interface LibraryItemStock {
  totalCopies: number
  availableCopies: number
}

/** Guard rails for the two copy-count columns. */
export function stockIsSane(item: LibraryItemStock): boolean {
  return (
    Number.isInteger(item.totalCopies) &&
    Number.isInteger(item.availableCopies) &&
    item.totalCopies >= 0 &&
    item.availableCopies >= 0 &&
    item.availableCopies <= item.totalCopies
  )
}

/**
 * A copy can only leave the shelf if one is physically there.
 * Returns the reason when it cannot, so callers can 409 with a real message.
 */
export function canIssue(item: LibraryItemStock): { ok: true } | { ok: false; reason: string } {
  if (!stockIsSane(item)) return { ok: false, reason: 'Catalog copy counts are inconsistent' }
  if (item.availableCopies <= 0) {
    return { ok: false, reason: 'No copies available for issue' }
  }
  return { ok: true }
}

/** Default due date for a fresh loan. */
export function defaultDueDate(from: Date = new Date(), days = DEFAULT_LOAN_DAYS): Date {
  const due = new Date(from.getTime())
  due.setDate(due.getDate() + days)
  return due
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}
