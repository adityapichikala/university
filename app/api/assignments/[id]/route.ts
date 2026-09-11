import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { authorize, authorizePermission, scopes, type AuthContext } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/roles'

type Ctx = { params: Promise<{ id: string }> }

/** Tier 3: teachers own their courses, everyone else needs assignment.manage. */
function writableScope(ctx: AuthContext) {
  return {
    ...scopes.college(ctx),
    ...(ctx.user.role === 'TEACHER' ? { course: { teacherId: ctx.user.id } } : {}),
  }
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const result = await authorize(req)
  if (!result.ok) return result.response
  const { ctx } = result

  const { id } = await params
  const assignment = await prisma.assignment.findFirst({
    where: { id, ...scopes.college(ctx) },
    select: {
      id: true,
      title: true,
      description: true,
      dueDate: true,
      maxMarks: true,
      rubric: true,
      allowedFileTypes: true,
      course: { select: { id: true, code: true, name: true, teacherId: true } },
      teacher: { select: { id: true, name: true } },
      _count: { select: { submissions: true } },
    },
  })
  if (!assignment) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 })

  // A student may only open an assignment for a course they are enrolled in.
  if (ctx.user.role === 'STUDENT') {
    const enrolled = await prisma.courseEnrollment.findFirst({
      where: { courseId: assignment.course.id, studentId: ctx.user.id },
      select: { id: true },
    })
    if (!enrolled) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 })
  }

  return NextResponse.json({ assignment })
}

const updateSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().min(1).max(4000).optional(),
  dueDate: z.string().trim().min(1).optional(),
  maxMarks: z.number().positive().max(1000).optional(),
  rubric: z.string().trim().max(4000).nullish(),
  allowedFileTypes: z.string().trim().max(200).nullish(),
})

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const result = await authorizePermission(req, PERMISSIONS.ASSIGNMENT_MANAGE)
  if (!result.ok) return result.response
  const { ctx } = result

  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request payload' },
      { status: 400 }
    )
  }

  const existing = await prisma.assignment.findFirst({
    where: { id, ...writableScope(ctx) },
    select: { id: true, title: true, dueDate: true, maxMarks: true, description: true },
  })
  if (!existing) {
    return NextResponse.json({ error: 'Assignment not found or not yours' }, { status: 404 })
  }

  let dueDate: Date | undefined
  if (parsed.data.dueDate !== undefined) {
    const raw = parsed.data.dueDate
    dueDate = /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? new Date(`${raw}T23:59:59.000Z`)
      : new Date(raw)
    if (Number.isNaN(dueDate.getTime())) {
      return NextResponse.json(
        { error: 'dueDate must be YYYY-MM-DD or an ISO datetime' },
        { status: 400 }
      )
    }
  }

  const assignment = await prisma.assignment.update({
    where: { id },
    data: {
      ...(parsed.data.title !== undefined && { title: parsed.data.title }),
      ...(parsed.data.description !== undefined && { description: parsed.data.description }),
      ...(dueDate && { dueDate }),
      ...(parsed.data.maxMarks !== undefined && { maxMarks: parsed.data.maxMarks }),
      ...(parsed.data.rubric !== undefined && { rubric: parsed.data.rubric || null }),
      ...(parsed.data.allowedFileTypes !== undefined && {
        allowedFileTypes: parsed.data.allowedFileTypes || 'pdf,docx,zip',
      }),
    },
    select: { id: true, title: true, dueDate: true, maxMarks: true },
  })

  await audit({
    ctx,
    agentName: 'academics',
    actionType: 'ASSIGNMENT_UPDATE',
    targetEntity: 'Assignment',
    entityId: id,
    before: {
      title: existing.title,
      dueDate: existing.dueDate.toISOString(),
      maxMarks: existing.maxMarks,
    },
    after: {
      title: assignment.title,
      dueDate: assignment.dueDate.toISOString(),
      maxMarks: assignment.maxMarks,
    },
  })

  return NextResponse.json({ assignment })
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const result = await authorizePermission(req, PERMISSIONS.ASSIGNMENT_MANAGE)
  if (!result.ok) return result.response
  const { ctx } = result

  const { id } = await params
  const existing = await prisma.assignment.findFirst({
    where: { id, ...writableScope(ctx) },
    select: { id: true, title: true, _count: { select: { submissions: true } } },
  })
  if (!existing) {
    return NextResponse.json({ error: 'Assignment not found or not yours' }, { status: 404 })
  }

  // Guard rail: deleting an assignment would cascade away student work and
  // every Grade attached to it.
  if (existing._count.submissions > 0) {
    await audit({
      ctx,
      agentName: 'academics',
      actionType: 'ASSIGNMENT_DELETE',
      targetEntity: 'Assignment',
      entityId: id,
      status: 'REJECTED',
      after: { reason: 'submissions exist', count: existing._count.submissions },
    })
    return NextResponse.json(
      {
        error: `Cannot delete: ${existing._count.submissions} submission(s) exist for this assignment.`,
      },
      { status: 409 }
    )
  }

  await prisma.assignment.delete({ where: { id } })

  await audit({
    ctx,
    agentName: 'academics',
    actionType: 'ASSIGNMENT_DELETE',
    targetEntity: 'Assignment',
    entityId: id,
    before: { title: existing.title },
  })

  return NextResponse.json({ ok: true })
}
