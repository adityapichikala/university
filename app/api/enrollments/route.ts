import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { authorize, authorizePermission, scopes, type AuthContext } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/roles'

/**
 * Tier 3 — who sees which enrollments:
 *   enrollment.manage → every enrollment in the college
 *   TEACHER           → only enrollments on courses they teach
 *   everyone else     → only their own rows
 */
function readScope(ctx: AuthContext) {
  if (ctx.can(PERMISSIONS.ENROLLMENT_MANAGE)) return scopes.college(ctx)
  if (ctx.user.role === 'TEACHER') {
    return { ...scopes.college(ctx), ...scopes.teacherCourses(ctx) }
  }
  return { ...scopes.college(ctx), ...scopes.own(ctx) }
}

const enrollmentSelect = {
  id: true,
  studentId: true,
  courseId: true,
  classId: true,
  student: { select: { id: true, regno: true, name: true } },
  course: { select: { id: true, code: true, name: true, credits: true } },
  class: { select: { id: true, name: true } },
} as const

export async function GET(req: NextRequest) {
  const result = await authorize(req)
  if (!result.ok) return result.response
  const { ctx } = result
  if (!ctx.user.collegeId) {
    return NextResponse.json({ error: 'No college scope' }, { status: 403 })
  }

  // Optional filters, e.g. /api/enrollments?courseId=… for a course roster.
  const courseId = req.nextUrl.searchParams.get('courseId')
  const classId = req.nextUrl.searchParams.get('classId')

  const enrollments = await prisma.courseEnrollment.findMany({
    where: {
      ...readScope(ctx),
      ...(courseId && { courseId }),
      ...(classId && { classId }),
    },
    select: enrollmentSelect,
    orderBy: [{ student: { regno: 'asc' } }, { course: { code: 'asc' } }],
  })

  return NextResponse.json({ enrollments })
}

const createEnrollmentSchema = z.object({
  studentId: z.string().min(1),
  courseId: z.string().min(1),
  classId: z.string().min(1),
})

export async function POST(req: NextRequest) {
  const result = await authorizePermission(req, PERMISSIONS.ENROLLMENT_MANAGE)
  if (!result.ok) return result.response
  const { ctx } = result
  const collegeId = ctx.user.collegeId
  if (!collegeId) return NextResponse.json({ error: 'No college scope' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const parsed = createEnrollmentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 })
  }

  const { studentId, courseId, classId } = parsed.data

  // Every FK must resolve inside the caller's college.
  const [student, course, klass] = await Promise.all([
    prisma.user.findFirst({
      where: { id: studentId, collegeId },
      select: { id: true, regno: true, role: true },
    }),
    prisma.course.findFirst({ where: { id: courseId, collegeId }, select: { id: true, code: true } }),
    prisma.class.findFirst({ where: { id: classId, collegeId }, select: { id: true, name: true } }),
  ])

  if (!student) return NextResponse.json({ error: 'Student not found in your college' }, { status: 400 })
  if (student.role !== 'STUDENT') {
    return NextResponse.json({ error: 'That user is not a student' }, { status: 400 })
  }
  if (!course) return NextResponse.json({ error: 'Course not found in your college' }, { status: 400 })
  if (!klass) return NextResponse.json({ error: 'Class not found in your college' }, { status: 400 })

  const existing = await prisma.courseEnrollment.findUnique({
    where: { studentId_courseId: { studentId, courseId } },
    select: { id: true },
  })
  if (existing) {
    await audit({
      ctx,
      agentName: 'academics',
      actionType: 'ENROLLMENT_CREATE',
      targetEntity: 'CourseEnrollment',
      status: 'REJECTED',
      after: { regno: student.regno, course: course.code, reason: 'already enrolled' },
    })
    return NextResponse.json(
      { error: `${student.regno} is already enrolled in ${course.code}` },
      { status: 409 }
    )
  }

  const enrollment = await prisma.courseEnrollment.create({
    data: { collegeId, studentId, courseId, classId },
    select: enrollmentSelect,
  })

  await audit({
    ctx,
    agentName: 'academics',
    actionType: 'ENROLLMENT_CREATE',
    targetEntity: 'CourseEnrollment',
    entityId: enrollment.id,
    after: { regno: student.regno, course: course.code, class: klass.name },
  })

  return NextResponse.json({ enrollment }, { status: 201 })
}
