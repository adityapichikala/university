import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { authorizePermission, scopes } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/roles'

type Ctx = { params: Promise<{ id: string }> }

/** DELETE /api/enrollments/:id — withdraw a student from a course. */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const result = await authorizePermission(req, PERMISSIONS.ENROLLMENT_MANAGE)
  if (!result.ok) return result.response
  const { ctx } = result

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

  await prisma.courseEnrollment.delete({ where: { id } })

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
  })

  return NextResponse.json({ ok: true })
}
