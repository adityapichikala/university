'use server'

import { requirePermission } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import {
  setSectionAccess,
  setUserPermission,
  type MutationResult,
  type SetPermissionInput,
  type SetPermissionResult,
  type SetSectionAccessInput,
  type SetSectionAccessResult,
} from '@/lib/permissions'

/**
 * Governance mutations (architecture doc §9: "Server Actions where possible").
 *
 * Every action runs the full Tier 1 + Tier 2 guard first — requirePermission()
 * redirects anyone without "user.manage" before a single byte is written.
 * Note the guard is called OUTSIDE the try/catch on purpose: redirect() works
 * by throwing, and catching it would silently disable the guard.
 *
 * Actions return a MutationResult rather than throwing, so the client can
 * roll back its optimistic update and show a toast.
 */

export async function setUserPermissionAction(
  input: SetPermissionInput
): Promise<MutationResult<SetPermissionResult>> {
  const ctx = await requirePermission(PERMISSIONS.USER_MANAGE, { route: 'admin' })
  return setUserPermission(ctx, input)
}

export async function setSectionAccessAction(
  input: SetSectionAccessInput
): Promise<MutationResult<SetSectionAccessResult>> {
  const ctx = await requirePermission(PERMISSIONS.USER_MANAGE, { route: 'admin' })
  return setSectionAccess(ctx, input)
}
