import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { authorize, authorizePermission, scopes, type AuthContext } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/roles'
import {
  createEnrollment,
  enrollmentSelect,
  type EnrollFailure,
  type EnrollResult,
} from '@/lib/enrollment'

/**
 * Tier 3 — who sees which enrollments:
 *   enrollment.manage → every enrollment in the college
 *   TEACHER           → only enrollments on courses they teach
 *   everyone else     → only their own rows
 */
function readScope(ctx: AuthContext) {
  if (ctx.can(PERMISSIONS.ENROLLMENT_MANAGE)) return scopes.college(ctx)
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

  // Optional filters, e.g. /api/enrollments?courseId=… for a course roster.
  const courseId = req.nextUrl.searchParams.get('courseId')
  const classId = req.nextUrl.searchParams.get('classId')

  const enrollments = await prisma.courseEnrollment.findMany({
    where: {
      ...readScope(ctx),
      ...(courseId && { courseId }),
      ...(classId && { classId }),
    },
    select: enrollmentSelect,
    orderBy: [{ student: { regno: 'asc' } }, { course: { code: 'asc' } }],
  })

  return NextResponse.json({ enrollments })
}

const createEnrollmentSchema = z.object({
  studentId: z.string().min(1),
  courseId: z.string().min(1),
  classId: z.string().min(1),
  /** Set when the student accepts a place on the queue of a full section. */
  joinWaitlist: z.boolean().optional(),
})

/**
 * HTTP status per refusal. Everything the caller can act on is a 409 so the
 * client can tell "try something different" from "you are not allowed":
 *   DUPLICATE / CREDIT_CAP / SLOT_CLASH / SECTION_FULL → 409 + `reason`
 *   STUDENT_NOT_FOUND / NOT_A_STUDENT / …              → 400 (bad input)
 */
const FAILURE_STATUS: Record<EnrollFailure['kind'], number> = {
  STUDENT_NOT_FOUND: 400,
  NOT_A_STUDENT: 400,
  COURSE_NOT_FOUND: 400,
  CLASS_NOT_FOUND: 400,
  DUPLICATE: 409,
  CREDIT_CAP: 409,
  SLOT_CLASH: 409,
  SECTION_FULL: 409,
}

export async function POST(req: NextRequest) {
  const result = await authorizePermission(req, PERMISSIONS.ENROLLMENT_MANAGE)
  if (!result.ok) return result.response
  const { ctx } = result
  const collegeId = ctx.user.collegeId
  if (!collegeId) return NextResponse.json({ error: 'No college scope' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const parsed = createEnrollmentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 })
  }

  // All of the rule-checking (credits, seats, clashes) happens inside this
  // call, in one transaction — see lib/enrollment.ts.
  const outcome: EnrollResult = await createEnrollment(prisma, collegeId, {
    studentId: parsed.data.studentId,
    courseId: parsed.data.courseId,
    classId: parsed.data.classId,
    joinWaitlist: parsed.data.joinWaitlist,
  })

  if (!outcome.ok) {
    const { failure } = outcome
    await audit({
      ctx,
      agentName: 'academics',
      actionType: 'ENROLLMENT_CREATE',
      targetEntity: 'CourseEnrollment',
      status: 'REJECTED',
      after: { reason: failure.kind, message: failure.message },
    })

    return NextResponse.json(
      {
        error: failure.message,
        reason: failure.kind,
        // Extra fields the UI needs to offer a next step rather than a dead end.
        ...(failure.kind === 'SECTION_FULL' ? { seats: failure.seats, canWaitlist: true } : {}),
        ...(failure.kind === 'SLOT_CLASH' ? { conflicts: failure.conflicts } : {}),
        ...(failure.kind === 'CREDIT_CAP'
          ? {
              currentCredits: failure.currentCredits,
              courseCredits: failure.courseCredits,
              limit: failure.limit,
            }
          : {}),
        ...(failure.kind === 'DUPLICATE' ? { status: failure.status } : {}),
      },
      { status: FAILURE_STATUS[failure.kind] }
    )
  }

  const { enrollment, waitlisted, waitlistPosition, seats } = outcome

  await audit({
    ctx,
    agentName: 'academics',
    actionType: waitlisted ? 'ENROLLMENT_WAITLIST' : 'ENROLLMENT_CREATE',
    targetEntity: 'CourseEnrollment',
    entityId: enrollment.id,
    after: {
      regno: enrollment.student.regno,
      course: enrollment.course.code,
      class: enrollment.class.name,
      ...(waitlisted ? { waitlistPosition } : {}),
    },
  })

  return NextResponse.json(
    {
      enrollment,
      waitlisted,
      waitlistPosition,
      seats,
      message: waitlisted
        ? `${enrollment.student.regno} is #${waitlistPosition} on the waitlist for ${enrollment.course.code}`
        : `${enrollment.student.regno} enrolled in ${enrollment.course.code}`,
    },
    { status: 201 }
  )
}
