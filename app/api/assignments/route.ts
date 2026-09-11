import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { authorize, authorizePermission, scopes, type AuthContext } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/roles'
import { sectionUnlocked } from '@/lib/permissions'

/**
 * Assignments (Wave 3). Tier 3 decides who sees what:
 *   teacher  → assignments on the courses they teach
 *   student  → assignments on courses they are enrolled in (minus any course
 *              their section has been locked out of)
 *   anyone with assignment.manage → whole college
 */

function readScope(ctx: AuthContext, studentClassId: string | null) {
  if (ctx.can(PERMISSIONS.ASSIGNMENT_MANAGE) && ctx.user.role !== 'TEACHER') {
    return scopes.college(ctx)
  }
  if (ctx.user.role === 'TEACHER') {
    return { ...scopes.college(ctx), ...scopes.teacherCourses(ctx) }
  }
  return {
    ...scopes.college(ctx),
    course: {
      enrollments: { some: { studentId: ctx.user.id } },
      ...sectionUnlocked(studentClassId),
    },
  }
}

const createSchema = z.object({
  courseId: z.string().trim().min(1, 'courseId is required'),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(4000),
  dueDate: z.string().trim().min(1, 'dueDate is required'),
  maxMarks: z.number().positive().max(1000),
  rubric: z.string().trim().max(4000).nullish(),
  allowedFileTypes: z.string().trim().max(200).nullish(),
})

/** Accepts "YYYY-MM-DD" or any ISO datetime. */
function parseDueDate(value: string): Date | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T23:59:59.000Z`)
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export async function GET(req: NextRequest) {
  const result = await authorize(req)
  if (!result.ok) return result.response
  const { ctx } = result
  if (!ctx.user.collegeId) {
    return NextResponse.json({ error: 'No college scope' }, { status: 403 })
  }

  const courseId = req.nextUrl.searchParams.get('courseId')

  // Only students need their section for the lock filter.
  const enrollment = ctx.user.role === 'STUDENT'
    ? await prisma.courseEnrollment.findFirst({
        where: { studentId: ctx.user.id },
        select: { classId: true },
      })
    : null

  const rows = await prisma.assignment.findMany({
    where: {
      ...readScope(ctx, enrollment?.classId ?? null),
      ...(courseId && { courseId }),
    },
    select: {
      id: true,
      title: true,
      description: true,
      dueDate: true,
      maxMarks: true,
      rubric: true,
      allowedFileTypes: true,
      course: { select: { id: true, code: true, name: true } },
      teacher: { select: { id: true, name: true } },
      _count: { select: { submissions: true } },
    },
    orderBy: { dueDate: 'asc' },
    take: 200,
  })

  return NextResponse.json({ assignments: rows })
}

export async function POST(req: NextRequest) {
  const result = await authorizePermission(req, PERMISSIONS.ASSIGNMENT_MANAGE)
  if (!result.ok) return result.response
  const { ctx } = result
  if (!ctx.user.collegeId) {
    return NextResponse.json({ error: 'No college scope' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request payload' },
      { status: 400 }
    )
  }

  const dueDate = parseDueDate(parsed.data.dueDate)
  if (!dueDate) {
    return NextResponse.json({ error: 'dueDate must be YYYY-MM-DD or an ISO datetime' }, { status: 400 })
  }

  // Tier 3: teachers may only create assignments on their own courses.
  const course = await prisma.course.findFirst({
    where: {
      id: parsed.data.courseId,
      ...scopes.college(ctx),
      ...(ctx.user.role === 'TEACHER' ? scopes.taughtCourses(ctx) : {}),
    },
    select: { id: true, code: true },
  })
  if (!course) {
    await audit({
      ctx,
      agentName: 'academics',
      actionType: 'ASSIGNMENT_CREATE',
      targetEntity: 'Assignment',
      status: 'REJECTED',
      after: { courseId: parsed.data.courseId, reason: 'course not yours / not in college' },
    })
    return NextResponse.json({ error: 'Course not found or not assigned to you' }, { status: 404 })
  }

  const assignment = await prisma.assignment.create({
    data: {
      collegeId: ctx.user.collegeId,
      courseId: course.id,
      teacherId: ctx.user.id,
      title: parsed.data.title,
      description: parsed.data.description,
      dueDate,
      maxMarks: parsed.data.maxMarks,
      rubric: parsed.data.rubric || null,
      allowedFileTypes: parsed.data.allowedFileTypes || 'pdf,docx,zip',
    },
    select: {
      id: true,
      title: true,
      dueDate: true,
      maxMarks: true,
      course: { select: { code: true, name: true } },
    },
  })

  await audit({
    ctx,
    agentName: 'academics',
    actionType: 'ASSIGNMENT_CREATE',
    targetEntity: 'Assignment',
    entityId: assignment.id,
    after: {
      title: assignment.title,
      course: course.code,
      dueDate: dueDate.toISOString(),
      maxMarks: assignment.maxMarks,
    },
  })

  return NextResponse.json({ assignment }, { status: 201 })
}
