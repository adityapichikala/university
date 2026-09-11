import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { authorize, authorizePermission, scopes, type AuthContext } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/roles'
import { sectionUnlocked } from '@/lib/permissions'
import {
  findConflicts,
  conflictSummary,
  isValidTime,
  isWeekday,
  type SlotConflict,
} from '@/lib/timetable'

/**
 * Timetable (Wave 4).
 *
 * Tier 3 decides the rows you can read:
 *   teacher → slots on the courses they teach
 *   student → slots for their own section, minus courses their section is
 *             locked out of (the same rule attendance and assignments use)
 *   anyone with timetable.manage (HOD / REGISTRAR / ADMIN) → whole college
 */

function readScope(ctx: AuthContext, studentClassId: string | null) {
  if (ctx.can(PERMISSIONS.TIMETABLE_MANAGE) && ctx.user.role !== 'TEACHER') {
    return scopes.college(ctx)
  }
  if (ctx.user.role === 'TEACHER') {
    return { ...scopes.college(ctx), ...scopes.teacherCourses(ctx) }
  }
  return {
    ...scopes.college(ctx),
    // Without a section there is no timetable to show — never widen to the
    // whole college just because the enrollment row is missing.
    classId: studentClassId ?? '__no_section__',
    course: sectionUnlocked(studentClassId),
  }
}

const slotSchema = z.object({
  courseId: z.string().trim().min(1, 'courseId is required'),
  classId: z.string().trim().min(1, 'classId is required'),
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().trim(),
  endTime: z.string().trim(),
  room: z.string().trim().min(1, 'room is required').max(60),
})

function validateShape(data: z.infer<typeof slotSchema>): string | null {
  if (!isWeekday(data.dayOfWeek)) return 'dayOfWeek must be 1 (Mon) … 6 (Sat)'
  if (!isValidTime(data.startTime)) return 'startTime must be HH:MM in 24-hour form'
  if (!isValidTime(data.endTime)) return 'endTime must be HH:MM in 24-hour form'
  return null
}

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

export async function GET(req: NextRequest) {
  const result = await authorize(req)
  if (!result.ok) return result.response
  const { ctx } = result
  if (!ctx.user.collegeId) {
    return NextResponse.json({ error: 'No college scope' }, { status: 403 })
  }

  const classId = req.nextUrl.searchParams.get('classId')
  const courseId = req.nextUrl.searchParams.get('courseId')

  // Students are filtered to their own section; the lock filter keys off it.
  const enrollment =
    ctx.user.role === 'STUDENT'
      ? await prisma.courseEnrollment.findFirst({
          where: { studentId: ctx.user.id },
          select: { classId: true },
        })
      : null

  const rows = await prisma.timetableSlot.findMany({
    where: {
      ...readScope(ctx, enrollment?.classId ?? null),
      ...(classId && ctx.user.role !== 'STUDENT' ? { classId } : {}),
      ...(courseId ? { courseId } : {}),
    },
    select: slotSelect,
    orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    take: 500,
  })

  return NextResponse.json({ slots: rows })
}

export async function POST(req: NextRequest) {
  const result = await authorizePermission(req, PERMISSIONS.TIMETABLE_MANAGE)
  if (!result.ok) return result.response
  const { ctx } = result
  if (!ctx.user.collegeId) {
    return NextResponse.json({ error: 'No college scope' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const parsed = slotSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request payload' },
      { status: 400 }
    )
  }
  const shapeError = validateShape(parsed.data)
  if (shapeError) {
    return NextResponse.json({ error: shapeError }, { status: 400 })
  }

  // Tier 3: a teacher may only schedule the courses they actually teach.
  const course = await prisma.course.findFirst({
    where: {
      id: parsed.data.courseId,
      ...scopes.college(ctx),
      ...(ctx.user.role === 'TEACHER' ? scopes.taughtCourses(ctx) : {}),
    },
    select: { id: true, code: true, name: true, teacherId: true },
  })
  if (!course) {
    await audit({
      ctx,
      agentName: 'academics',
      actionType: 'TIMETABLE_CREATE',
      targetEntity: 'TimetableSlot',
      status: 'REJECTED',
      after: { courseId: parsed.data.courseId, reason: 'course not yours / not in college' },
    })
    return NextResponse.json({ error: 'Course not found or not assigned to you' }, { status: 404 })
  }

  const klass = await prisma.class.findFirst({
    where: { id: parsed.data.classId, ...scopes.college(ctx) },
    select: { id: true, name: true },
  })
  if (!klass) {
    return NextResponse.json({ error: 'Section not found' }, { status: 404 })
  }

  const conflicts: SlotConflict[] = await findConflicts(prisma, {
    collegeId: ctx.user.collegeId,
    courseId: course.id,
    classId: klass.id,
    dayOfWeek: parsed.data.dayOfWeek,
    startTime: parsed.data.startTime,
    endTime: parsed.data.endTime,
    room: parsed.data.room,
  })

  if (conflicts.length > 0) {
    await audit({
      ctx,
      agentName: 'academics',
      actionType: 'TIMETABLE_CREATE',
      targetEntity: 'TimetableSlot',
      status: 'REJECTED',
      after: {
        course: course.code,
        class: klass.name,
        dayOfWeek: parsed.data.dayOfWeek,
        startTime: parsed.data.startTime,
        endTime: parsed.data.endTime,
        room: parsed.data.room,
        reason: 'conflict',
        conflicts: conflicts.map((c) => ({ kind: c.kind, message: c.message })),
      },
    })
    return NextResponse.json({ error: conflictSummary(conflicts), conflicts }, { status: 409 })
  }

  const slot = await prisma.timetableSlot.create({
    data: {
      collegeId: ctx.user.collegeId,
      courseId: course.id,
      classId: klass.id,
      dayOfWeek: parsed.data.dayOfWeek,
      startTime: parsed.data.startTime,
      endTime: parsed.data.endTime,
      room: parsed.data.room,
    },
    select: slotSelect,
  })

  await audit({
    ctx,
    agentName: 'academics',
    actionType: 'TIMETABLE_CREATE',
    targetEntity: 'TimetableSlot',
    entityId: slot.id,
    after: {
      course: course.code,
      class: klass.name,
      dayOfWeek: slot.dayOfWeek,
      startTime: slot.startTime,
      endTime: slot.endTime,
      room: slot.room,
    },
  })

  return NextResponse.json({ slot }, { status: 201 })
}
