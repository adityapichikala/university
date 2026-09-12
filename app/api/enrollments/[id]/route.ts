import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { authorizePermission, scopes } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/roles'
import { withdrawEnrollment } from '@/lib/enrollment'

type Ctx = { params: Promise<{ id: string }> }

/**
 * DELETE /api/enrollments/:id — withdraw a student from a course.
 *
 * College scoping is checked before the write, and `withdrawEnrollment` re-reads
 * the row inside its own transaction, so the two can never disagree.
 * If a seat frees up, the queue is promoted in that same transaction.
 */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const result = await authorizePermission(req, PERMISSIONS.ENROLLMENT_MANAGE)
  if (!result.ok) return result.response
  const { ctx } = result
  const collegeId = ctx.user.collegeId
  if (!collegeId) return NextResponse.json({ error: 'No college scope' }, { status: 403 })

  const { id } = await params
  const target = await prisma.courseEnrollment.findFirst({
    where: { id, ...scopes.college(ctx) },
    select: {
      id: true,
      student: { select: { regno: true } },
      course: { select: { code: true } },
      class: { select: { name: true } },
    },
  })
  if (!target) return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 })

  const outcome = await withdrawEnrollment(prisma, collegeId, id)
  if (!outcome.ok) {
    return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 })
  }

  await audit({
    ctx,
    agentName: 'academics',
    actionType: 'ENROLLMENT_DELETE',
    targetEntity: 'CourseEnrollment',
    entityId: id,
    before: {
      regno: target.student.regno,
      course: target.course.code,
      class: target.class.name,
    },
    after: outcome.promoted
      ? { seatPassedTo: outcome.promoted.regno }
      : null,
  })

  return NextResponse.json({
    ok: true,
    promoted: outcome.promoted,
    seats: outcome.seats,
    message: outcome.promoted
      ? `${target.student.regno} withdrawn — ${outcome.promoted.regno} promoted off the waitlist`
      : `${target.student.regno} withdrawn from ${target.course.code}`,
  })
}
