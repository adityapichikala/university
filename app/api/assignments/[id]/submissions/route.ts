import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { authorize, authorizePermission, scopes } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/roles'
import { submissionStatusFor } from '@/lib/academics'
import { lockedStudentIds } from '@/lib/permissions'

type Ctx = { params: Promise<{ id: string }> }

const submitSchema = z.object({
  fileUrl: z.string().trim().min(1, 'fileUrl is required').max(2000),
})

/**
 * GET  /api/assignments/:id/submissions — teacher sees the whole roster,
 * students see only their own row.
 * POST /api/assignments/:id/submissions — student submits. Re-submitting bumps
 * `version` on the same row (@@unique([assignmentId, studentId])), so a
 * submission always keeps exactly one Grade.
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  const result = await authorize(req)
  if (!result.ok) return result.response
  const { ctx } = result

  const { id } = await params
  const assignment = await prisma.assignment.findFirst({
    where: { id, ...scopes.college(ctx) },
    select: { id: true, title: true, courseId: true, course: { select: { teacherId: true } } },
  })
  if (!assignment) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 })

  const isOwner =
    ctx.user.role === 'TEACHER' && assignment.course.teacherId === ctx.user.id
  const canManageAll = ctx.can(PERMISSIONS.ASSIGNMENT_MANAGE) && ctx.user.role !== 'TEACHER'

  // Students: must be enrolled, may only read their own row.
  if (!isOwner && !canManageAll) {
    const enrolled = await prisma.courseEnrollment.findFirst({
      where: { courseId: assignment.courseId, studentId: ctx.user.id },
      select: { id: true },
    })
    if (!enrolled) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 })
  }

  const where =
    isOwner || canManageAll
      ? { assignmentId: id }
      : { assignmentId: id, studentId: ctx.user.id }

  const rows = await prisma.submission.findMany({
    where,
    select: {
      id: true,
      fileUrl: true,
      submittedAt: true,
      version: true,
      status: true,
      student: { select: { id: true, regno: true, name: true, email: true } },
      grade: {
        select: {
          id: true,
          score: true,
          feedback: true,
          gradedAt: true,
          gradedBy: { select: { name: true } },
        },
      },
    },
    orderBy: { student: { regno: 'asc' } },
    take: 500,
  })

  // Students must not see each other's work.
  const visible =
    isOwner || canManageAll
      ? rows
      : rows.filter((r) => r.student.id === ctx.user.id)

  return NextResponse.json({
    assignment: { id: assignment.id, title: assignment.title },
    submissions: visible,
  })
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const result = await authorizePermission(req, PERMISSIONS.SUBMISSION_SUBMIT)
  if (!result.ok) return result.response
  const { ctx } = result

  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = submitSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request payload' },
      { status: 400 }
    )
  }

  const assignment = await prisma.assignment.findFirst({
    where: { id, ...scopes.college(ctx) },
    select: { id: true, title: true, courseId: true, dueDate: true, course: { select: { code: true } } },
  })
  if (!assignment) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 })

  // Must be enrolled in the course the assignment belongs to.
  const enrollment = await prisma.courseEnrollment.findFirst({
    where: { courseId: assignment.courseId, studentId: ctx.user.id },
    select: { id: true, classId: true },
  })
  if (!enrollment) {
    await audit({
      ctx,
      agentName: 'academics',
      actionType: 'SUBMISSION_CREATE',
      targetEntity: 'Submission',
      entityId: id,
      status: 'REJECTED',
      after: { assignment: assignment.title, reason: 'not enrolled' },
    })
    return NextResponse.json({ error: 'You are not enrolled in this course' }, { status: 403 })
  }

  // Section lock: a locked section cannot submit either.
  const locked = await lockedStudentIds(assignment.courseId, [ctx.user.id])
  if (locked.size > 0) {
    await audit({
      ctx,
      agentName: 'academics',
      actionType: 'SUBMISSION_CREATE',
      targetEntity: 'Submission',
      entityId: id,
      status: 'REJECTED',
      after: { assignment: assignment.title, reason: 'section locked out of course' },
    })
    return NextResponse.json(
      { error: `Your section is locked out of ${assignment.course.code}` },
      { status: 403 }
    )
  }

  const now = new Date()
  const status = submissionStatusFor(assignment.dueDate, now)

  const existing = await prisma.submission.findUnique({
    where: { assignmentId_studentId: { assignmentId: id, studentId: ctx.user.id } },
    select: { id: true, version: true, status: true, submittedAt: true },
  })

  const submission = existing
    ? await prisma.submission.update({
        where: { id: existing.id },
        data: { fileUrl: parsed.data.fileUrl, submittedAt: now, version: existing.version + 1, status },
        select: { id: true, fileUrl: true, submittedAt: true, version: true, status: true },
      })
    : await prisma.submission.create({
        data: {
          collegeId: ctx.user.collegeId ?? '',
          assignmentId: id,
          studentId: ctx.user.id,
          fileUrl: parsed.data.fileUrl,
          submittedAt: now,
          version: 1,
          status,
        },
        select: { id: true, fileUrl: true, submittedAt: true, version: true, status: true },
      })

  await audit({
    ctx,
    agentName: 'academics',
    actionType: existing ? 'SUBMISSION_RESUBMIT' : 'SUBMISSION_CREATE',
    targetEntity: 'Submission',
    entityId: submission.id,
    before: existing ? { version: existing.version, status: existing.status } : null,
    after: {
      assignment: assignment.title,
      version: submission.version,
      status: submission.status,
      late: status === 'LATE',
    },
  })

  return NextResponse.json({ submission }, { status: existing ? 200 : 201 })
}
