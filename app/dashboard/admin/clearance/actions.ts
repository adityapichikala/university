'use server'

import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import {
  recordClearanceDecision,
  type ClearanceDecisionInput,
} from '@/lib/clearance'

/**
 * Admin / department-head console: record a No-Dues decision.
 *
 * The caller is already authenticated and permission-checked here; the actual
 * department-head scoping (a librarian may only sign Library, etc.) and the
 * audit write live in `recordClearanceDecision` so the rule is enforced in one
 * place regardless of who calls it.
 */
export async function decideClearance(input: ClearanceDecisionInput) {
  const ctx = await requirePermission(PERMISSIONS.CLEARANCE_MANAGE)
  const result = await recordClearanceDecision(ctx, input)
  if (result.ok) {
    revalidatePath('/dashboard/admin/clearance')
    revalidatePath('/dashboard/student/clearance')
  }
  return result
}
