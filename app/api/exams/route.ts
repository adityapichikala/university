import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { authorize, authorizePermission, scopes, type AuthContext } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/roles'
import { EXAM_TYPES, parseDay } from '@/lib/academics'

/** Students only ever see exams whose results have been published. */
function readScope(ctx: AuthContext) {
  if (ctx.can(PERMISSIONS.EXAM_CREATE) || ctx.can(PERMISSIONS.GRADE_ENTRY)) {
    return scopes.college(ctx)
  }
  if (ctx.user.role === 'TEACHER') {
    return { ...scopes.college(ctx), course: { teacherId: ctx.user.id } }
  }
  return { ...scopes.college(ctx), results: { some: { studentId: ctx.user.id, publishedAt: { not: null } } } }
}

export async function GET(req: NextRequest) {
  const result = await authorize(req)
  if (!result.ok) return result.response
  const { ctx } = result
  if (!ctx.user.collegeId) {
    return NextResponse.json({ error: 'No college scope' }, { status: 403 })
  }

  const courseId = req.nextUrl.searchParams.get('courseId')

  const exams = await prisma.exam.findMany({
    where: { ...readScope(ctx), ...(courseId && { courseId }) },
    select: {
      id: true,
      courseId: true,
      examDate: true,
      examType: true,
      maxMarks: true,
      course: { select: { id: true, code: true, name: true, teacherId: true } },
      _count: { select: { results: true } },
    },
    orderBy: { examDate: 'desc' },
  })

  return NextResponse.json({ exams })
}

const createExamSchema = z.object({
  courseId: z.string().min(1),
  examType: z.enum(EXAM_TYPES),
  examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'examDate must be YYYY-MM-DD'),
  maxMarks: z.number().positive().max(1000),
})

export async function POST(req: NextRequest) {
  const result = await authorizePermission(req, PERMISSIONS.EXAM_CREATE)
  if (!result.ok) return result.response
  const { ctx } = result
  const collegeId = ctx.user.collegeId
  if (!collegeId) return NextResponse.json({ error: 'No college scope' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const parsed = createExamSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request payload' },
      { status: 400 }
    )
  }

  const { courseId, examType, maxMarks } = parsed.data
  const examDate = parseDay(parsed.data.examDate)
  if (!examDate) return NextResponse.json({ error: 'Invalid exam date' }, { status: 400 })

  // Teachers may only create exams on their own courses.
  const course = await prisma.course.findFirst({
    where: {
      id: courseId,
      ...scopes.college(ctx),
      ...(ctx.user.role === 'TEACHER' ? scopes.taughtCourses(ctx) : {}),
    },
    select: { id: true, code: true },
  })
  if (!course) {
    await audit({
      ctx,
      agentName: 'academics',
      actionType: 'EXAM_CREATE',
      targetEntity: 'Exam',
      status: 'REJECTED',
      after: { courseId, examType, reason: 'course not yours / not in college' },
    })
    return NextResponse.json({ error: 'Course not found or not assigned to you' }, { status: 404 })
  }

  const exam = await prisma.exam.create({
    data: { collegeId, courseId, examType, examDate, maxMarks },
    select: {
      id: true,
      courseId: true,
      examDate: true,
      examType: true,
      maxMarks: true,
      course: { select: { id: true, code: true, name: true, teacherId: true } },
      _count: { select: { results: true } },
    },
  })

  await audit({
    ctx,
    agentName: 'academics',
    actionType: 'EXAM_CREATE',
    targetEntity: 'Exam',
    entityId: exam.id,
    after: { course: course.code, examType, maxMarks, examDate: parsed.data.examDate },
  })

  return NextResponse.json({ exam }, { status: 201 })
}
