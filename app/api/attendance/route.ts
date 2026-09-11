import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { authorize, authorizePermission, scopes, type AuthContext } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/roles'
import { ATTENDANCE_STATUSES, parseDay } from '@/lib/academics'
import { lockedStudentIds } from '@/lib/permissions'

/**
 * Tier 3 — who sees which attendance rows:
 *   teacher → only rows on courses they teach
 *   student → only their own rows
 *   anyone with grade.entry/attendance.mark (admin, HOD) → whole college
 */
function readScope(ctx: AuthContext) {
  if (ctx.can(PERMISSIONS.ATTENDANCE_MARK) && ctx.user.role !== 'TEACHER') {
    return scopes.college(ctx)
  }
  if (ctx.user.role === 'TEACHER') {
    return { ...scopes.college(ctx), ...scopes.teacherCourses(ctx) }
  }
  return { ...scopes.college(ctx), ...scopes.own(ctx) }
}

export async function GET(req: NextRequest) {
  const result = await authorize(req)
  if (!result.ok) return result.response
  const { ctx } = result
  if (!ctx.user.collegeId) {
    return NextResponse.json({ error: 'No college scope' }, { status: 403 })
  }

  const courseId = req.nextUrl.searchParams.get('courseId')
  const day = req.nextUrl.searchParams.get('date')
  const date = day ? parseDay(day) : null
  if (day && !date) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
  }

  const rows = await prisma.attendance.findMany({
    where: {
      ...readScope(ctx),
      ...(courseId && { courseId }),
      ...(date && { date }),
    },
    select: {
      id: true,
      studentId: true,
      courseId: true,
      date: true,
      status: true,
      student: { select: { regno: true, name: true } },
      course: { select: { code: true, name: true } },
    },
    orderBy: [{ date: 'desc' }, { student: { regno: 'asc' } }],
    take: 500,
  })

  return NextResponse.json({ attendance: rows })
}

const markSchema = z.object({
  courseId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  /** Partial is fine — only the students present in this array are changed. */
  marks: z
    .array(
      z.object({
        studentId: z.string().min(1),
        status: z.enum(ATTENDANCE_STATUSES),
      })
    )
    .min(1)
    .max(500),
})

/**
 * POST /api/attendance — bulk mark one session.
 *
 * Gated by attendance.mark AND scoped to the caller's own courses: a teacher
 * cannot post attendance for a course they don't teach, even with a valid
 * courseId. Every student must actually be enrolled in that course.
 */
export async function POST(req: NextRequest) {
  const result = await authorizePermission(req, PERMISSIONS.ATTENDANCE_MARK)
  if (!result.ok) return result.response
  const { ctx } = result
  const collegeId = ctx.user.collegeId
  if (!collegeId) return NextResponse.json({ error: 'No college scope' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const parsed = markSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request payload' },
      { status: 400 }
    )
  }

  const { courseId, marks } = parsed.data
  const date = parseDay(parsed.data.date)
  if (!date) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })

  // Tier 3: the course must be the caller's own (teachers) or in their college.
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
      actionType: 'ATTENDANCE_MARK',
      targetEntity: 'Attendance',
      status: 'REJECTED',
      after: { courseId, date: parsed.data.date, reason: 'course not yours / not in college' },
    })
    return NextResponse.json({ error: 'Course not found or not assigned to you' }, { status: 404 })
  }

  // Every marked student must be enrolled in this course.
  const studentIds = [...new Set(marks.map((m) => m.studentId))]
  const enrolled = await prisma.courseEnrollment.findMany({
    where: { courseId, studentId: { in: studentIds } },
    select: { studentId: true },
  })
  const enrolledSet = new Set(enrolled.map((e) => e.studentId))
  const notEnrolled = studentIds.filter((id) => !enrolledSet.has(id))
  if (notEnrolled.length) {
    await audit({
      ctx,
      agentName: 'academics',
      actionType: 'ATTENDANCE_MARK',
      targetEntity: 'Attendance',
      status: 'REJECTED',
      after: {
        course: course.code,
        date: parsed.data.date,
        reason: 'students not enrolled',
        count: notEnrolled.length,
      },
    })
    return NextResponse.json(
      { error: `${notEnrolled.length} student(s) are not enrolled in ${course.code}` },
      { status: 400 }
    )
  }

  // Section-level lock: a class locked out of this course cannot be marked.
  const locked = await lockedStudentIds(courseId, studentIds)
  if (locked.size > 0) {
    await audit({
      ctx,
      agentName: 'academics',
      actionType: 'ATTENDANCE_MARK',
      targetEntity: 'Attendance',
      status: 'REJECTED',
      after: {
        course: course.code,
        date: parsed.data.date,
        reason: 'section locked out of course',
        count: locked.size,
      },
    })
    return NextResponse.json(
      {
        error: `${locked.size} student(s) belong to a section locked out of ${course.code}`,
      },
      { status: 403 }
    )
  }

  // Upsert per student: re-marking a day corrects it rather than erroring.
  await prisma.$transaction(
    marks.map((m) =>
      prisma.attendance.upsert({
        where: { studentId_courseId_date: { studentId: m.studentId, courseId, date } },
        update: { status: m.status },
        create: {
          collegeId,
          studentId: m.studentId,
          courseId,
          date,
          status: m.status,
        },
      })
    )
  )

  await audit({
    ctx,
    agentName: 'academics',
    actionType: 'ATTENDANCE_MARK',
    targetEntity: 'Attendance',
    entityId: `${courseId}:${parsed.data.date}`,
    after: {
      course: course.code,
      date: parsed.data.date,
      marked: marks.length,
      statuses: marks.reduce<Record<string, number>>((acc, m) => {
        acc[m.status] = (acc[m.status] ?? 0) + 1
        return acc
      }, {}),
    },
  })

  return NextResponse.json({ ok: true, marked: marks.length })
}
