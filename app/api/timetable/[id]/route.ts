import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { authorize, authorizePermission, scopes } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/roles'
import { findConflicts, conflictSummary, isValidTime } from '@/lib/timetable'

type Ctx = { params: Promise<{ id: string }> }

/** PATCH is a full replacement of the mutable fields — simplest to reason about. */
const updateSchema = z.object({
  courseId: z.string().trim().min(1).optional(),
  classId: z.string().trim().min(1).optional(),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  startTime: z.string().trim().optional(),
  endTime: z.string().trim().optional(),
  room: z.string().trim().min(1).max(60).optional(),
})

const slotSelect = {
  id: true,
  dayOfWeek: true,
  startTime: true,
  endTime: true,
  room: true,
  course: {
    select: { id: true, code: true, name: true, teacherId: true, teacher: { select: { name: true } } },
  },
  class: { select: { id: true, name: true } },
} as const

export async function GET(req: NextRequest, { params }: Ctx) {
  const result = await authorize(req)
  if (!result.ok) return result.response
  const { ctx } = result

  const { id } = await params
  const slot = await prisma.timetableSlot.findFirst({
    where: { id, ...scopes.college(ctx) },
    select: slotSelect,
  })
  if (!slot) return NextResponse.json({ error: 'Slot not found' }, { status: 404 })

  return NextResponse.json({ slot })
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const result = await authorizePermission(req, PERMISSIONS.TIMETABLE_MANAGE)
  if (!result.ok) return result.response
  const { ctx } = result
  if (!ctx.user.collegeId) {
    return NextResponse.json({ error: 'No college scope' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request payload' },
      { status: 400 }
    )
  }
  if (parsed.data.startTime && !isValidTime(parsed.data.startTime)) {
    return NextResponse.json({ error: 'startTime must be HH:MM in 24-hour form' }, { status: 400 })
  }
  if (parsed.data.endTime && !isValidTime(parsed.data.endTime)) {
    return NextResponse.json({ error: 'endTime must be HH:MM in 24-hour form' }, { status: 400 })
  }

  const canManageAll = ctx.can(PERMISSIONS.TIMETABLE_MANAGE) && ctx.user.role !== 'TEACHER'
  const existing = await prisma.timetableSlot.findFirst({
    where: {
      id,
      ...scopes.college(ctx),
      ...(canManageAll ? {} : { course: { teacherId: ctx.user.id } }),
    },
    select: slotSelect,
  })
  if (!existing) {
    await audit({
      ctx,
      agentName: 'academics',
      actionType: 'TIMETABLE_UPDATE',
      targetEntity: 'TimetableSlot',
      entityId: id,
      status: 'REJECTED',
      after: { reason: 'not found or not yours' },
    })
    return NextResponse.json({ error: 'Slot not found or not assigned to you' }, { status: 404 })
  }

  const next = {
    courseId: parsed.data.courseId ?? existing.course.id,
    classId: parsed.data.classId ?? existing.class.id,
    dayOfWeek: parsed.data.dayOfWeek ?? existing.dayOfWeek,
    startTime: parsed.data.startTime ?? existing.startTime,
    endTime: parsed.data.endTime ?? existing.endTime,
    room: parsed.data.room ?? existing.room,
  }

  // A teacher cannot move a slot onto a course that is not theirs.
  const course = await prisma.course.findFirst({
    where: {
      id: next.courseId,
      ...scopes.college(ctx),
      ...(ctx.user.role === 'TEACHER' ? scopes.taughtCourses(ctx) : {}),
    },
    select: { id: true, code: true, name: true, teacherId: true },
  })
  if (!course) {
    return NextResponse.json({ error: 'Course not found or not assigned to you' }, { status: 404 })
  }

  const conflicts = await findConflicts(
    prisma,
    {
      collegeId: ctx.user.collegeId,
      courseId: next.courseId,
      classId: next.classId,
      dayOfWeek: next.dayOfWeek,
      startTime: next.startTime,
      endTime: next.endTime,
      room: next.room,
    },
    id
  )

  if (conflicts.length > 0) {
    await audit({
      ctx,
      agentName: 'academics',
      actionType: 'TIMETABLE_UPDATE',
      targetEntity: 'TimetableSlot',
      entityId: id,
      status: 'REJECTED',
      after: { reason: 'conflict', conflicts: conflicts.map((c) => ({ kind: c.kind, message: c.message })) },
    })
    return NextResponse.json({ error: conflictSummary(conflicts), conflicts }, { status: 409 })
  }

  const slot = await prisma.timetableSlot.update({
    where: { id },
    data: next,
    select: slotSelect,
  })

  await audit({
    ctx,
    agentName: 'academics',
    actionType: 'TIMETABLE_UPDATE',
    targetEntity: 'TimetableSlot',
    entityId: id,
    before: {
      course: existing.course.code,
      class: existing.class.name,
      dayOfWeek: existing.dayOfWeek,
      startTime: existing.startTime,
      endTime: existing.endTime,
      room: existing.room,
    },
    after: {
      course: slot.course.code,
      class: slot.class.name,
      dayOfWeek: slot.dayOfWeek,
      startTime: slot.startTime,
      endTime: slot.endTime,
      room: slot.room,
    },
  })

  return NextResponse.json({ slot })
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const result = await authorizePermission(req, PERMISSIONS.TIMETABLE_MANAGE)
  if (!result.ok) return result.response
  const { ctx } = result

  const { id } = await params
  const canManageAll = ctx.can(PERMISSIONS.TIMETABLE_MANAGE) && ctx.user.role !== 'TEACHER'
  const existing = await prisma.timetableSlot.findFirst({
    where: {
      id,
      ...scopes.college(ctx),
      ...(canManageAll ? {} : { course: { teacherId: ctx.user.id } }),
    },
    select: { id: true, course: { select: { code: true } }, class: { select: { name: true } } },
  })
  if (!existing) {
    await audit({
      ctx,
      agentName: 'academics',
      actionType: 'TIMETABLE_DELETE',
      targetEntity: 'TimetableSlot',
      entityId: id,
      status: 'REJECTED',
      after: { reason: 'not found or not yours' },
    })
    return NextResponse.json({ error: 'Slot not found or not assigned to you' }, { status: 404 })
  }

  await prisma.timetableSlot.delete({ where: { id } })

  await audit({
    ctx,
    agentName: 'academics',
    actionType: 'TIMETABLE_DELETE',
    targetEntity: 'TimetableSlot',
    entityId: id,
    before: { course: existing.course.code, class: existing.class.name },
  })

  return NextResponse.json({ ok: true })
}
