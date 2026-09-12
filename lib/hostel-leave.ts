/**
 * Hostel leave vocabulary.
 *
 * Separate from `lib/leave.ts` (staff leave): different approver, different
 * lifecycle, and a student has no Employee record. Constants live here rather
 * than in the `'use server'` module, which may only export async functions.
 */

export const HOSTEL_LEAVE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const

export type HostelLeaveStatus = (typeof HOSTEL_LEAVE_STATUSES)[number]

export function isHostelLeaveStatus(value: unknown): value is HostelLeaveStatus {
  return typeof value === 'string' && (HOSTEL_LEAVE_STATUSES as readonly string[]).includes(value)
}

export function asHostelLeaveStatus(value: unknown): HostelLeaveStatus {
  return isHostelLeaveStatus(value) ? value : 'PENDING'
}

export const HOSTEL_LEAVE_CHIP: Record<HostelLeaveStatus, string> = {
  PENDING: 'bg-warning-soft text-warning',
  APPROVED: 'bg-success-soft text-success',
  REJECTED: 'bg-danger-soft text-danger',
  CANCELLED: 'bg-background text-subtle',
}

export const HOSTEL_LEAVE_LABEL: Record<HostelLeaveStatus, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
}

/** Overnight stays are the point — a day pass is not a hostel leave. */
export const MAX_LEAVE_NIGHTS = 30

/** UTC-midnight parse of a `YYYY-MM-DD` input, or null if it is not a date. */
export function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

export function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Whole nights between two UTC-midnight dates. */
export function nightsBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000)
}
