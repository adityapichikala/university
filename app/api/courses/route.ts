import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { authorize, authorizePermission, scopes, type AuthContext } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/roles'

/**
 * Tier 3 — who sees which courses:
 *   course.manage → every course in the college
 *   TEACHER       → only the courses they teach
 *   everyone else → only courses they are enrolled in
 */
function readScope(ctx: AuthContext) {
  if (ctx.can(PERMISSIONS.COURSE_MANAGE)) return scopes.college(ctx)
  if (ctx.user.role === 'TEACHER') {
    return { ...scopes.college(ctx), ...scopes.taughtCourses(ctx) }
  }
  return { ...scopes.college(ctx), enrollments: { some: { studentId: ctx.user.id } } }
}

const courseSelect = {
  id: true,
  code: true,
  name: true,
  credits: true,
  departmentId: true,
  teacherId: true,
  department: { select: { id: true, name: true } },
  teacher: { select: { id: true, regno: true, name: true } },
  _count: { select: { enrollments: true } },
} as const

export async function GET(req: NextRequest) {
  const result = await authorize(req)
  if (!result.ok) return result.response
  const { ctx } = result
  if (!ctx.user.collegeId) {
    return NextResponse.json({ error: 'No college scope' }, { status: 403 })
  }

  const courses = await prisma.course.findMany({
    where: readScope(ctx),
    select: courseSelect,
    orderBy: { code: 'asc' },
  })

  return NextResponse.json({ courses })
}

const createCourseSchema = z.object({
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(160),
  credits: z.number().int().min(1).max(10).default(3),
  departmentId: z.string().min(1),
  teacherId: z.string().nullish(),
})

export async function POST(req: NextRequest) {
  const result = await authorizePermission(req, PERMISSIONS.COURSE_MANAGE)
  if (!result.ok) return result.response
  const { ctx } = result
  const collegeId = ctx.user.collegeId
  if (!collegeId) return NextResponse.json({ error: 'No college scope' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const parsed = createCourseSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request payload' },
      { status: 400 }
    )
  }

  const { name, credits, departmentId, teacherId } = parsed.data
  const codeUpper = parsed.data.code.toUpperCase()

  // Both FKs must resolve inside the caller's college — never trust an id from the client.
  const department = await prisma.department.findFirst({
    where: { id: departmentId, collegeId },
    select: { id: true },
  })
  if (!department) {
    return NextResponse.json({ error: 'Department not found in your college' }, { status: 400 })
  }

  if (teacherId) {
    const teacher = await prisma.user.findFirst({
      where: { id: teacherId, collegeId },
      select: { id: true, role: true },
    })
    if (!teacher) {
      return NextResponse.json({ error: 'Teacher not found in your college' }, { status: 400 })
    }
    if (teacher.role !== 'TEACHER') {
      return NextResponse.json({ error: 'That user is not a teacher' }, { status: 400 })
    }
  }

  const duplicate = await prisma.course.findUnique({
    where: { collegeId_code: { collegeId, code: codeUpper } },
    select: { id: true },
  })
  if (duplicate) {
    await audit({
      ctx,
      agentName: 'academics',
      actionType: 'COURSE_CREATE',
      targetEntity: 'Course',
      status: 'REJECTED',
      after: { code: codeUpper, reason: 'code already used in this college' },
    })
    return NextResponse.json({ error: `Course code ${codeUpper} already exists` }, { status: 409 })
  }

  const course = await prisma.course.create({
    data: {
      code: codeUpper,
      name,
      credits,
      collegeId,
      departmentId,
      teacherId: teacherId || null,
    },
    select: courseSelect,
  })

  await audit({
    ctx,
    agentName: 'academics',
    actionType: 'COURSE_CREATE',
    targetEntity: 'Course',
    entityId: course.id,
    after: { code: course.code, name: course.name, credits: course.credits, teacherId },
  })

  return NextResponse.json({ course }, { status: 201 })
}
