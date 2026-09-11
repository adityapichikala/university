import type { AuthContext } from './rbac'
import { scopes } from './rbac'
import { PERMISSIONS } from './roles'

/**
 * Shared query shapes for the Hostel module.
 *
 * Kept out of the route files because a Next.js route may only export HTTP
 * verbs, and both `/api/hostel/allocations` and `/api/hostel/allocations/[id]`
 * need the same select.
 */

export const HOSTEL_ALLOCATION_SELECT = {
  id: true,
  allocatedAt: true,
  vacatedAt: true,
  student: { select: { id: true, name: true, regno: true } },
  room: { select: { id: true, block: true, roomNumber: true, capacity: true } },
} as const

/**
 * Tier 3 read scope for hostel allocations.
 *   hostel.manage → every bed in the college
 *   otherwise     → only the caller's own allocation
 */
export function hostelAllocationScope(ctx: AuthContext) {
  if (ctx.can(PERMISSIONS.HOSTEL_MANAGE)) return scopes.college(ctx)
  return { ...scopes.college(ctx), studentId: ctx.user.id }
}
