import type { AuthContext } from './rbac'
import { scopes } from './rbac'
import { PERMISSIONS } from './roles'

/**
 * Shared query shapes for the Library module.
 *
 * Kept out of the route files because a Next.js route may only export HTTP
 * verbs, and both `/api/library/issues` and `/api/library/issues/[id]` need
 * the same select.
 */

export const LIBRARY_ISSUE_SELECT = {
  id: true,
  issuedAt: true,
  dueAt: true,
  returnedAt: true,
  fineAmount: true,
  item: { select: { id: true, title: true, author: true, isbn: true } },
  student: { select: { id: true, name: true, regno: true } },
} as const

/**
 * Tier 3 read scope for library issues.
 *   library.manage → the whole college's loans
 *   otherwise      → only the caller's own loans
 */
export function libraryIssueScope(ctx: AuthContext) {
  if (ctx.can(PERMISSIONS.LIBRARY_MANAGE)) return scopes.college(ctx)
  return { ...scopes.college(ctx), studentId: ctx.user.id }
}
