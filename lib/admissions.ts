/**
 * Admission funnel — shared vocabulary.
 *
 * These constants live here rather than in the `'use server'` module because
 * a server-action file may only export async functions; a `const` export
 * there is a build error.
 *
 * SQLite has no native enums, so `Admission.status` is a plain String and
 * this list is the source of truth (same arrangement as `lib/roles.ts`).
 */

export const ADMISSION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CONVERTED'] as const

export type AdmissionStatus = (typeof ADMISSION_STATUSES)[number]

export function isAdmissionStatus(value: unknown): value is AdmissionStatus {
  return typeof value === 'string' && (ADMISSION_STATUSES as readonly string[]).includes(value)
}

export function asAdmissionStatus(value: unknown): AdmissionStatus {
  return isAdmissionStatus(value) ? value : 'PENDING'
}

export const ADMISSION_STATUS_LABEL: Record<AdmissionStatus, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CONVERTED: 'Enrolled',
}

/** Chip classes per status — keeps the palette in the design system. */
export const ADMISSION_STATUS_CHIP: Record<AdmissionStatus, string> = {
  PENDING: 'bg-warning-soft text-warning',
  APPROVED: 'bg-accent-soft text-accent',
  REJECTED: 'bg-danger-soft text-danger',
  CONVERTED: 'bg-success-soft text-success',
}

/** Which decisions are offered for a given current status. */
export const ADMISSION_TRANSITIONS: Record<AdmissionStatus, AdmissionStatus[]> = {
  PENDING: ['APPROVED', 'REJECTED'],
  APPROVED: ['REJECTED'],
  REJECTED: [],
  CONVERTED: [],
}
