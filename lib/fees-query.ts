import type { AuthContext } from './rbac'
import { scopes } from './rbac'
import { PERMISSIONS } from './roles'

/**
 * Shared query shapes for the Fees module.
 *
 * Lives outside the route handlers for two reasons: both
 * `/api/fees/records` and `/api/fees/records/[id]` need it, and a Next.js
 * route file may only export HTTP verbs — an extra named export breaks the
 * build's route type-check.
 */

export const FEE_RECORD_SELECT = {
  id: true,
  amountPaid: true,
  paymentDate: true,
  status: true,
  transactionRef: true,
  waiverReason: true,
  createdAt: true,
  student: { select: { id: true, name: true, regno: true } },
  feeStructure: {
    select: { id: true, programName: true, batchYear: true, amount: true, dueDate: true },
  },
  payments: {
    select: {
      id: true,
      amount: true,
      paidAt: true,
      transactionRef: true,
      method: true,
      receivedBy: { select: { id: true, name: true } },
    },
    orderBy: { paidAt: 'asc' },
  },
} as const

/**
 * Tier 3 read scope for fee records.
 *   fee.manage → whole college
 *   fee.view_own → only the caller's own rows
 *   otherwise → null (caller should 403)
 */
export function feeRecordScope(ctx: AuthContext) {
  if (ctx.can(PERMISSIONS.FEE_MANAGE)) return scopes.college(ctx)
  if (ctx.can(PERMISSIONS.FEE_VIEW_OWN)) return { ...scopes.college(ctx), studentId: ctx.user.id }
  return null
}
