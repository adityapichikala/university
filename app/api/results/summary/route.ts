import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { authorize, type AuthContext } from '@/lib/rbac'
import { buildTranscript, canViewTranscript } from '@/lib/results'

/**
 * GET /api/results/summary[?studentId=STU001]
 *
 * The credit-weighted transcript: per-course letter + grade points, and the
 * CGPA. A student always gets their own; anyone else must pass the Tier-3 check
 * in `canViewTranscript`.
 */
export async function GET(req: NextRequest) {
  const result = await authorize(req)
  if (!result.ok) return result.response
  const { ctx } = result as { ctx: AuthContext }

  const requested = req.nextUrl.searchParams.get('studentId')
  const targetId = requested ?? ctx.user.id

  if (requested && !(await canViewTranscript(prisma, ctx, targetId))) {
    return NextResponse.json(
      { error: 'You may not view this student’s transcript' },
      { status: 403 }
    )
  }

  const transcript = await buildTranscript(prisma, targetId, ctx.user.collegeId)
  if (!transcript) {
    return NextResponse.json({ error: 'Student not found' }, { status: 404 })
  }

  return NextResponse.json({ transcript })
}
