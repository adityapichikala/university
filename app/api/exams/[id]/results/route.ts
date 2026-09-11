import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { authorize, authorizePermission, scopes } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/roles'
import { gradeFromPercentage } from '@/lib/academics'

type Ctx = { params: Promise<{ id: string }> }

/**
 * GET /api/exams/:id/results
 *
 * Students may only read results that have been published (publishedAt set).
 * A teacher reads the full sheet for their own exam.
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  const result = await authorize(req)
  if (!result.ok) return result.response
  const { ctx } = result

  const { id } = await params

  const exam = await prisma.exam.findFirst({
    where: {
      id,
      ...scopes.college(ctx),
      ...(ctx.user.role === 'TEACHER' ? { course: { teacherId: ctx.user.id } } : {}),
    },
    select: { id: true, maxMarks: true, examType: true, course: { select: { code: true, name: true } } },
  })
  if (!exam) return NextResponse.json({ error: 'Exam not found' }, { status: 404 })

  const isStaff = ctx.can(PERMISSIONS.GRADE_ENTRY) || ctx.can(PERMISSIONS.EXAM_CREATE)
  const publishedOnly = !isStaff || ctx.user.role === 'STUDENT'

  const results = await prisma.examResult.findMany({
    where: {
      examId: id,
      ...(publishedOnly
        ? { studentId: ctx.user.id, publishedAt: { not: null } }
        : { ...scopes.college(ctx) }),
    },
    select: {
      id: true,
      studentId: true,
      marksObtained: true,
      grade: true,
      publishedAt: true,
      student: { select: { regno: true, name: true } },
    },
    orderBy: { student: { regno: 'asc' } },
  })

  return NextResponse.json({ exam, results })
}

const resultSchema = z.object({
  studentId: z.string().min(1),
  marksObtained: z.number().min(0),
})

const upsertSchema = z.object({
  results: z.array(resultSchema).min(1).max(500),
  /** When true, every result for this exam becomes visible to students. */
  publish: z.boolean().optional(),
})

/**
 * PUT /api/exams/:id/results — enter or correct marks, optionally publish.
 * Gated by grade.entry and scoped to the teacher's own course.
 */
export async function PUT(req: NextRequest, { params }: Ctx) {
  const result = await authorizePermission(req, PERMISSIONS.GRADE_ENTRY)
  if (!result.ok) return result.response
  const { ctx } = result
  const collegeId = ctx.user.collegeId
  if (!collegeId) return NextResponse.json({ error: 'No college scope' }, { status: 403 })

  const { id } = await params
  const exam = await prisma.exam.findFirst({
    where: {
      id,
      ...scopes.college(ctx),
      ...(ctx.user.role === 'TEACHER' ? { course: { teacherId: ctx.user.id } } : {}),
    },
    select: { id: true, maxMarks: true, courseId: true, course: { select: { code: true } } },
  })
  if (!exam) return NextResponse.json({ error: 'Exam not found' }, { status: 404 })

  const body = await req.json().catch(() => null)
  const parsed = upsertSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request payload' },
      { status: 400 }
    )
  }

  const { results, publish } = parsed.data

  // Only enrolled students can be graded.
  const studentIds = [...new Set(results.map((r) => r.studentId))]
  const enrolled = await prisma.courseEnrollment.findMany({
    where: { courseId: exam.courseId, studentId: { in: studentIds } },
    select: { studentId: true },
  })
  const enrolledSet = new Set(enrolled.map((e) => e.studentId))
  const notEnrolled = studentIds.filter((sid) => !enrolledSet.has(sid))
  if (notEnrolled.length) {
    return NextResponse.json(
      { error: `${notEnrolled.length} student(s) are not enrolled in this course` },
      { status: 400 }
    )
  }

  const overMax = results.filter((r) => r.marksObtained > exam.maxMarks)
  if (overMax.length) {
    return NextResponse.json(
      { error: `Marks cannot exceed the exam maximum of ${exam.maxMarks}` },
      { status: 400 }
    )
  }

  const publishedAt = publish ? new Date() : null

  await prisma.$transaction(
    results.map((r) =>
      prisma.examResult.upsert({
        where: { examId_studentId: { examId: id, studentId: r.studentId } },
        update: {
          marksObtained: r.marksObtained,
          grade: gradeFromPercentage((r.marksObtained / exam.maxMarks) * 100),
          ...(publish && { publishedAt }),
        },
        create: {
          collegeId,
          examId: id,
          studentId: r.studentId,
          marksObtained: r.marksObtained,
          grade: gradeFromPercentage((r.marksObtained / exam.maxMarks) * 100),
          publishedAt,
        },
      })
    )
  )

  await audit({
    ctx,
    agentName: 'academics',
    actionType: publish ? 'EXAM_PUBLISH' : 'EXAM_RESULT_UPSERT',
    targetEntity: 'ExamResult',
    entityId: id,
    after: {
      course: exam.course.code,
      graded: results.length,
      published: Boolean(publish),
    },
  })

  return NextResponse.json({ ok: true, graded: results.length, published: Boolean(publish) })
}
