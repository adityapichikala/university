import { NextResponse, type NextRequest } from 'next/server'
import { authorize } from '@/lib/rbac'
import { getClearance } from '@/lib/clearance'

/**
 * GET /api/student/clearance
 *
 * The signed-in student's own No-Dues status across the four departments.
 * Auto status is recomputed live from the operational tables; a department
 * head's manual decision, if any, is folded in as `manualStatus` and drives
 * the effective `status`. Students only ever see their own row.
 */
export async function GET(req: NextRequest) {
  const result = await authorize(req, { route: 'student' })
  if (!result.ok) return result.response

  const ctx = result.ctx
  const summary = await getClearance(ctx.user.id, ctx.user.collegeId ?? '')

  return NextResponse.json({
    regno: ctx.user.regno,
    name: ctx.user.name,
    clearance: summary,
  })
}
