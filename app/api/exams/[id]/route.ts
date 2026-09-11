import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { authorizePermission, scopes } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/roles'
import { EXAM_TYPES, parseDay } from '@/lib/academics'

type Ctx = { params: Promise<{ id: string }> }

/** Resolve an exam, enforcing the teacher's own-course scope. */
async function resolveExam(id: string, ctx: Parameters<typeof scopes.college>[0]) {
  return prisma.exam.findFirst({
    where: {
      id,
      ...scopes.college(ctx),
      ...(ctx.user.role === 'TEACHER' ? { course: { teacherId: ctx.user.id } } : {}),
    },
    select: { id: true, courseId: true, examType: true, maxMarks: true, course: { select: { code: true } } },
  })
}

const updateExamSchema = z.object({
  examType: z.enum(EXAM_TYPES).optional(),
  maxMarks: z.number().positive().max(1000).optional(),
  examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const result = await authorizePermission(req, PERMISSIONS.EXAM_CREATE)
  if (!result.ok) return result.response
  const { ctx } = result

  const { id } = await params
  const exam = await resolveExam(id, ctx)
  if (!exam) return NextResponse.json({ error: 'Exam not found' }, { status: 404 })

  const body = await req.json().catch(() => null)
  const parsed = updateExamSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request payload' },
      { status: 400 }
    )
  }

  const examDate = parsed.data.examDate ? parseDay(parsed.data.examDate) : undefined
  if (parsed.data.examDate && !examDate) {
    return NextResponse.json({ error: 'Invalid exam date' }, { status: 400 })
  }

  const updated = await prisma.exam.update({
    where: { id },
    data: {
      ...(parsed.data.examType && { examType: parsed.data.examType }),
      ...(parsed.data.maxMarks !== undefined && { maxMarks: parsed.data.maxMarks }),
      ...(examDate && { examDate }),
    },
    select: { id: true, examType: true, maxMarks: true, examDate: true },
  })

  await audit({
    ctx,
    agentName: 'academics',
    actionType: 'EXAM_UPDATE',
    targetEntity: 'Exam',
    entityId: id,
    before: { examType: exam.examType, maxMarks: exam.maxMarks },
    after: { examType: updated.examType, maxMarks: updated.maxMarks },
  })

  return NextResponse.json({ exam: updated })
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const result = await authorizePermission(req, PERMISSIONS.EXAM_CREATE)
  if (!result.ok) return result.response
  const { ctx } = result

  const { id } = await params
  const exam = await prisma.exam.findFirst({
    where: {
      id,
      ...scopes.college(ctx),
      ...(ctx.user.role === 'TEACHER' ? { course: { teacherId: ctx.user.id } } : {}),
    },
    select: { id: true, examType: true, course: { select: { code: true } }, _count: { select: { results: true } } },
  })
  if (!exam) return NextResponse.json({ error: 'Exam not found' }, { status: 404 })

  if (exam._count.results > 0) {
    await audit({
      ctx,
      agentName: 'academics',
      actionType: 'EXAM_DELETE',
      targetEntity: 'Exam',
      entityId: id,
      status: 'REJECTED',
      after: { reason: 'exam has results', count: exam._count.results },
    })
    return NextResponse.json(
      { error: `Cannot delete: ${exam._count.results} result(s) recorded` },
      { status: 409 }
    )
  }

  await prisma.exam.delete({ where: { id } })

  await audit({
    ctx,
    agentName: 'academics',
    actionType: 'EXAM_DELETE',
    targetEntity: 'Exam',
    entityId: id,
    before: { course: exam.course.code, examType: exam.examType },
  })

  return NextResponse.json({ ok: true })
}
