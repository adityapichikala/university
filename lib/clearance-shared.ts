import type { Role } from './roles'

/**
 * Client-safe clearance vocabulary.
 *
 * This module is imported by the student/admin *client* components, so it must
 * not touch Prisma, next/headers or anything server-only. The DB-backed logic
 * lives in lib/clearance.ts; this file is just the constants, types and the
 * tiny scoping rule a department head's browser needs to decide which buttons
 * to render.
 */

export type ClearanceDepartment = 'LIBRARY' | 'HOSTEL' | 'FINANCE' | 'ACADEMICS'

export type ClearanceStatus = 'CLEARED' | 'PENDING'

export const CLEARANCE_DEPARTMENTS: ClearanceDepartment[] = [
  'LIBRARY',
  'HOSTEL',
  'FINANCE',
  'ACADEMICS',
]

/** Display + the role that owns each department's sign-off. */
export const CLEARANCE_META: Record<
  ClearanceDepartment,
  { label: string; icon: string; ownerRole: Role }
> = {
  LIBRARY: { label: 'Library', icon: 'local_library', ownerRole: 'LIBRARIAN' },
  HOSTEL: { label: 'Hostel', icon: 'hotel', ownerRole: 'WARDEN' },
  FINANCE: { label: 'Finance', icon: 'payments', ownerRole: 'FINANCE' },
  ACADEMICS: { label: 'Academics', icon: 'school', ownerRole: 'HOD' },
}

/** May `role` record a manual decision for `department`? (Mirrors lib/clearance.ts.) */
export function canDecideDepartment(role: string, department: ClearanceDepartment): boolean {
  if (role === 'ADMIN') return true
  return CLEARANCE_META[department].ownerRole === role
}

export interface DepartmentClearance {
  department: ClearanceDepartment
  label: string
  icon: string
  autoStatus: ClearanceStatus
  autoReason: string | null
  manualStatus: ClearanceStatus | null
  status: ClearanceStatus
  overridden: boolean
  decidedByName: string | null
  decidedAt: string | null
  note: string | null
}

export interface StudentClearanceRow {
  studentId: string
  regno: string
  name: string
  departments: DepartmentClearance[]
  overall: ClearanceStatus
  pending: ClearanceDepartment[]
}
