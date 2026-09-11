import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { authorize, authorizePermission, scopes } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/roles'
import { scoreSummary } from '@/lib/academics'

type Ctx = { params: Promise<{ id: string }> }

const gradeSchema = z.object({
  score: z.number().min(0).max(100000),
  feedback: z.string().trim().max(4000).nullish(),
})

/**
 * PATCH /api/submissions/:id — grade a submission (requires `grade.entry`).
 *
 * Creates or updates the 1:1 Grade row and appends the previous score to
 * `Grade.history`, so a re-grade never silently erases the original mark.
 * The submission flips to GRADED.
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  const result = await authorize(req)
  if (!result.ok) return result.response
  const { ctx } = result

  const { id } = await params
  const submission = await prisma.submission.findFirst({
    where: { id, ...scopes.college(ctx) },
    select: {
      id: true,
      fileUrl: true,
      submittedAt: true,
      version: true,
      status: true,
      student: { select: { id: true, regno: true, name: true } },
      assignment: {
        select: { id: true, title: true, maxMarks: true, dueDate: true, course: { select: { teacherId: true, code: true } } },
      },
      grade: { select: { id: true, score: true, feedback: true, gradedAt: true, history: true } },
    },
  })
  if (!submission) return NextResponse.json({ error: 'Submission not found' }, { status: 404 })

  const isOwner =
    ctx.user.role === 'TEACHER' && submission.assignment.course.teacherId === ctx.user.id
  const canManageAll = ctx.can(PERMISSIONS.GRADE_ENTRY) && ctx.user.role !== 'TEACHER'
  if (submission.student.id !== ctx.user.id && !isOwner && !canManageAll) {
    return NextResponse.json({ error: 'Submission not found' }, { status: 404 })
  }

  return NextResponse.json({ submission })
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const result = await authorizePermission(req, PERMISSIONS.GRADE_ENTRY)
  if (!result.ok) return result.response
  const { ctx } = result

  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = gradeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request payload' },
      { status: 400 }
    )
  }

  const submission = await prisma.submission.findFirst({
    where: { id, ...scopes.college(ctx) },
    select: {
      id: true,
      status: true,
      student: { select: { id: true, regno: true, name: true } },
      assignment: {
        select: { id: true, title: true, maxMarks: true, course: { select: { teacherId: true, code: true } } },
      },
      grade: { select: { id: true, score: true, feedback: true, history: true } },
    },
  })
  if (!submission) return NextResponse.json({ error: 'Submission not found' }, { status: 404 })

  // Tier 3: teachers grade only their own course's submissions.
  if (ctx.user.role === 'TEACHER' && submission.assignment.course.teacherId !== ctx.user.id) {
    await audit({
      ctx,
      agentName: 'academics',
      actionType: 'SUBMISSION_GRADE',
      targetEntity: 'Grade',
      entityId: id,
      status: 'REJECTED',
      after: { reason: 'not your course' },
    })
    return NextResponse.json({ error: 'This submission is not on one of your courses' }, { status: 404 })
  }

  const summary = scoreSummary(parsed.data.score, submission.assignment.maxMarks)
  if (!summary) {
    return NextResponse.json({ error: 'Assignment maxMarks must be positive' }, { status: 400 })
  }

  // Re-grade trail: append the previous score instead of overwriting it.
  let history: unknown[] = []
  if (submission.grade?.history) {
    try {
      const parsedHistory = JSON.parse(submission.grade.history)
      if (Array.isArray(parsedHistory)) history = parsedHistory
    } catch {
      history = []
    }
  }
  if (submission.grade) {
    history.push({
      score: submission.grade.score,
      feedback: submission.grade.feedback ?? null,
      replacedAt: new Date().toISOString(),
    })
  }

  const [grade] = await prisma.$transaction([
    prisma.grade.upsert({
      where: { submissionId: submission.id },
      update: {
        score: summary.score,
        feedback: parsed.data.feedback || null,
        gradedByUserId: ctx.user.id,
        gradedAt: new Date(),
        history: JSON.stringify(history),
      },
      create: {
        collegeId: ctx.user.collegeId ?? '',
        submissionId: submission.id,
        score: summary.score,
        feedback: parsed.data.feedback || null,
        gradedByUserId: ctx.user.id,
        history: JSON.stringify(history),
      },
      select: { id: true, score: true, feedback: true, gradedAt: true, history: true },
    }),
    prisma.submission.update({
      where: { id: submission.id },
      data: { status: 'GRADED' },
      select: { id: true, status: true },
    }),
  ])

  await audit({
    ctx,
    agentName: 'academics',
    actionType: submission.grade ? 'SUBMISSION_REGRADE' : 'SUBMISSION_GRADE',
    targetEntity: 'Grade',
    entityId: grade.id,
    before: submission.grade ? { score: submission.grade.score } : null,
    after: {
      student: submission.student.regno,
      assignment: submission.assignment.title,
      score: summary.score,
      maxMarks: submission.assignment.maxMarks,
      percentage: summary.percentage,
      letter: summary.letter,
      regraded: Boolean(submission.grade),
    },
  })

  return NextResponse.json({ grade, submission, summary })
}
