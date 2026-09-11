import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { authorizePermission, scopes } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/roles'

const updateCourseSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  code: z.string().trim().min(1).max(32).optional(),
  credits: z.number().int().min(1).max(10).optional(),
  departmentId: z.string().min(1).optional(),
  teacherId: z.string().nullish(),
})

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const result = await authorizePermission(req, PERMISSIONS.COURSE_MANAGE)
  if (!result.ok) return result.response
  const { ctx } = result
  const collegeId = ctx.user.collegeId
  if (!collegeId) return NextResponse.json({ error: 'No college scope' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = updateCourseSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request payload' },
      { status: 400 }
    )
  }

  const target = await prisma.course.findFirst({
    where: { id, ...scopes.college(ctx) },
    select: { id: true, code: true, name: true, credits: true, departmentId: true, teacherId: true },
  })
  if (!target) return NextResponse.json({ error: 'Course not found' }, { status: 404 })

  const { name, credits, departmentId, teacherId } = parsed.data
  const codeUpper = parsed.data.code?.toUpperCase()

  if (departmentId) {
    const department = await prisma.department.findFirst({
      where: { id: departmentId, collegeId },
      select: { id: true },
    })
    if (!department) {
      return NextResponse.json({ error: 'Department not found in your college' }, { status: 400 })
    }
  }

  if (teacherId) {
    const teacher = await prisma.user.findFirst({
      where: { id: teacherId, collegeId },
      select: { role: true },
    })
    if (!teacher || teacher.role !== 'TEACHER') {
      return NextResponse.json({ error: 'That user is not a teacher in your college' }, { status: 400 })
    }
  }

  if (codeUpper && codeUpper !== target.code) {
    const duplicate = await prisma.course.findUnique({
      where: { collegeId_code: { collegeId, code: codeUpper } },
      select: { id: true },
    })
    if (duplicate) {
      await audit({
        ctx,
        agentName: 'academics',
        actionType: 'COURSE_UPDATE',
        targetEntity: 'Course',
        entityId: id,
        status: 'REJECTED',
        after: { code: codeUpper, reason: 'code already used in this college' },
      })
      return NextResponse.json({ error: `Course code ${codeUpper} already exists` }, { status: 409 })
    }
  }

  const course = await prisma.course.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(codeUpper !== undefined && { code: codeUpper }),
      ...(credits !== undefined && { credits }),
      ...(departmentId !== undefined && { departmentId }),
      // `teacherId: null` explicitly unassigns; `undefined` leaves it alone.
      ...(teacherId !== undefined && { teacherId: teacherId || null }),
    },
    select: { id: true, code: true, name: true, credits: true, departmentId: true, teacherId: true },
  })

  await audit({
    ctx,
    agentName: 'academics',
    actionType: 'COURSE_UPDATE',
    targetEntity: 'Course',
    entityId: id,
    before: target,
    after: {
      code: course.code,
      name: course.name,
      credits: course.credits,
      departmentId: course.departmentId,
      teacherId: course.teacherId,
    },
  })

  return NextResponse.json({ course })
}

/**
 * DELETE is blocked while students are enrolled — cascading away enrollment,
 * attendance and exam history is not something to do from a list UI.
 */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const result = await authorizePermission(req, PERMISSIONS.COURSE_MANAGE)
  if (!result.ok) return result.response
  const { ctx } = result

  const { id } = await params
  const target = await prisma.course.findFirst({
    where: { id, ...scopes.college(ctx) },
    select: { id: true, code: true, name: true, _count: { select: { enrollments: true } } },
  })
  if (!target) return NextResponse.json({ error: 'Course not found' }, { status: 404 })

  if (target._count.enrollments > 0) {
    await audit({
      ctx,
      agentName: 'academics',
      actionType: 'COURSE_DELETE',
      targetEntity: 'Course',
      entityId: id,
      status: 'REJECTED',
      after: { code: target.code, reason: 'course still has enrollments' },
    })
    return NextResponse.json(
      { error: `Cannot delete ${target.code}: ${target._count.enrollments} student(s) enrolled` },
      { status: 409 }
    )
  }

  await prisma.course.delete({ where: { id } })

  await audit({
    ctx,
    agentName: 'academics',
    actionType: 'COURSE_DELETE',
    targetEntity: 'Course',
    entityId: id,
    before: { code: target.code, name: target.name },
  })

  return NextResponse.json({ ok: true })
}
