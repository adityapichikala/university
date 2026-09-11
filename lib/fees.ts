/**
 * Fees & Finance — pure domain rules (Phase 3, doc §7).
 *
 * Deliberately dependency-free (no Prisma, no `@/` imports) so the money
 * rules can be unit-tested without a database and reused by the seed.
 */

/** FeeRecord.status is a String on SQLite — these are the only valid values. */
export const FEE_STATUSES = ['PENDING', 'PARTIAL', 'PAID', 'WAIVED', 'OVERDUE'] as const
export type FeeStatus = (typeof FEE_STATUSES)[number]

export function isFeeStatus(value: unknown): value is FeeStatus {
  return typeof value === 'string' && (FEE_STATUSES as readonly string[]).includes(value)
}

/**
 * Derive the status from the numbers rather than trusting the stored column.
 * The column is a cached convenience; this is the truth.
 *
 * A record is OVERDUE only when it is not settled AND the due date has passed.
 * WAIVED is never derived — it is an explicit human decision.
 */
export function feeStatusFor(input: {
  amountDue: number
  amountPaid: number
  dueDate: Date | string
  waived?: boolean
  now?: Date
}): FeeStatus {
  const { amountDue, amountPaid, waived = false } = input
  const now = input.now ?? new Date()
  const due = input.dueDate instanceof Date ? input.dueDate : new Date(input.dueDate)

  if (waived) return 'WAIVED'
  if (amountPaid <= 0) return due.getTime() < now.getTime() ? 'OVERDUE' : 'PENDING'
  if (amountPaid >= amountDue - 0.005) return 'PAID'
  return due.getTime() < now.getTime() ? 'OVERDUE' : 'PARTIAL'
}

export interface FeeLine {
  amountDue: number
  amountPaid: number
  status: string
  dueDate: Date | string
  waived?: boolean
}

export interface FeeSummary {
  /** Number of fee records considered. */
  count: number
  billed: number
  paid: number
  outstanding: number
  /** Records not settled (paid < due, not waived). */
  openCount: number
  /** Open records whose due date has passed. */
  overdueCount: number
  waivedCount: number
}

/** Roll a list of fee records up into the KPI numbers the UI shows. */
export function summarizeFees(records: FeeLine[], now?: Date): FeeSummary {
  const summary: FeeSummary = {
    count: records.length,
    billed: 0,
    paid: 0,
    outstanding: 0,
    openCount: 0,
    overdueCount: 0,
    waivedCount: 0,
  }

  for (const record of records) {
    const status = feeStatusFor({ ...record, now })
    const outstanding = Math.max(0, round2(record.amountDue - record.amountPaid))

    summary.billed = round2(summary.billed + record.amountDue)
    summary.paid = round2(summary.paid + record.amountPaid)
    summary.outstanding = round2(summary.outstanding + outstanding)

    if (status === 'WAIVED') summary.waivedCount += 1
    else if (status !== 'PAID') {
      summary.openCount += 1
      if (status === 'OVERDUE') summary.overdueCount += 1
    }
  }

  return summary
}

/** Money never needs more than 2 decimals, and Float drift shows up fast. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** ₹1,24,500 — Indian grouping, no decimals on whole amounts. */
export function formatCurrency(value: number, withPaise = false): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: withPaise ? 2 : 0,
    minimumFractionDigits: withPaise ? 2 : 0,
  }).format(value)
}

/** Compact form for KPI tiles: 1.2L / 45.6K / 820. */
export function formatCompactCurrency(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1e7) return `₹${(value / 1e7).toFixed(2)}Cr`
  if (abs >= 1e5) return `₹${(value / 1e5).toFixed(2)}L`
  if (abs >= 1e3) return `₹${(value / 1e3).toFixed(1)}K`
  return `₹${round2(value)}`
}
