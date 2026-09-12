import type { Prisma, PrismaClient } from '@prisma/client'
import { timesOverlap, weekdayLabel, timeRange } from './timetable'

/**
 * Enrollment domain rules (credits, seats, timetable clashes, waitlist).
 *
 * Everything that decides whether an enrollment may exist lives here rather
 * than in the route handler, so the API, any future server action and the
 * tests cannot drift apart on what "full" or "overloaded" means.
 */

/** Hard academic ceiling: a student may not be confirmed for more than this. */
export const MAX_CREDITS = 24

/** Fallback when a course has no explicit cap. */
export const DEFAULT_SECTION_CAPACITY = 60

export const ENROLLMENT_STATUSES = ['CONFIRMED', 'WAITLISTED'] as const

export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number]

export function isEnrollmentStatus(value: unknown): value is EnrollmentStatus {
  return typeof value === 'string' && (ENROLLMENT_STATUSES as readonly string[]).includes(value)
}

/** Unknown/absent reads as CONFIRMED so legacy rows keep counting as seats. */
export function asEnrollmentStatus(value: unknown): EnrollmentStatus {
  return isEnrollmentStatus(value) ? value : 'CONFIRMED'
}

export const ENROLLMENT_STATUS_LABEL: Record<EnrollmentStatus, string> = {
  CONFIRMED: 'Enrolled',
  WAITLISTED: 'Waitlisted',
}

/** Shared shape — the route, the UI and the tests all read the same fields. */
export const enrollmentSelect = {
  id: true,
  studentId: true,
  courseId: true,
  classId: true,
  status: true,
  createdAt: true,
  student: { select: { id: true, regno: true, name: true } },
  course: { select: { id: true, code: true, name: true, credits: true, capacity: true } },
  class: { select: { id: true, name: true } },
} as const

export type EnrollmentRow = Prisma.CourseEnrollmentGetPayload<{
  select: typeof enrollmentSelect
}>

/* ── Results ───────────────────────────────────────────────────────────────── */

export interface SeatState {
  capacity: number
  taken: number
  full: boolean
}

export interface SlotClash {
  /** The course the student is already confirmed for. */
  courseCode: string
  courseName: string
  day: string
  start: string
  end: string
  /** The new slot that would collide with it. */
  newStart: string
  newEnd: string
}

export type EnrollFailure =
  | { kind: 'STUDENT_NOT_FOUND'; message: string }
  | { kind: 'NOT_A_STUDENT'; message: string }
  | { kind: 'COURSE_NOT_FOUND'; message: string }
  | { kind: 'CLASS_NOT_FOUND'; message: string }
  | {
      kind: 'DUPLICATE'
      message: string
      status: EnrollmentStatus
    }
  | {
      kind: 'CREDIT_CAP'
      message: string
      currentCredits: number
      courseCredits: number
      limit: number
    }
  | { kind: 'SLOT_CLASH'; message: string; conflicts: SlotClash[] }
  | {
      kind: 'SECTION_FULL'
      message: string
      seats: SeatState
      /** Always true — the caller offers JOIN_WAITLIST instead of failing. */
      canWaitlist: true
    }

export interface EnrollSuccess {
  ok: true
  enrollment: EnrollmentRow
  /** True when the student was queued rather than seated. */
  waitlisted: boolean
  /** 1-based place in the queue, only set when waitlisted. */
  waitlistPosition?: number
  /** Seat state after the write, for an accurate "N of M seats" caption. */
  seats: SeatState
}

export type EnrollResult = EnrollSuccess | { ok: false; failure: EnrollFailure }

/* ── Write ─────────────────────────────────────────────────────────────────── */

export interface EnrollInput {
  studentId: string
  courseId: string
  classId: string
  /** Set when the student knowingly joins a full section's queue. */
  joinWaitlist?: boolean
}

/**
 * Create an enrollment, or queue the student.
 *
 * The whole decision runs inside one `prisma.$transaction`. That matters:
 * reading the seat count and then inserting would leave a window where two
 * students both see "one seat left" and both take it. On SQLite an interactive
 * transaction holds the write lock, so the re-check below is the one that
 * counts — the pre-check outside would be a hint at best.
 */
export async function createEnrollment(
  prisma: PrismaClient,
  collegeId: string,
  input: EnrollInput
): Promise<EnrollResult> {
  return prisma.$transaction(async (tx) => {
    const [student, course, klass] = await Promise.all([
      tx.user.findFirst({
        where: { id: input.studentId, collegeId },
        select: { id: true, regno: true, role: true },
      }),
      tx.course.findFirst({
        where: { id: input.courseId, collegeId },
        select: { id: true, code: true, name: true, credits: true, capacity: true },
      }),
      tx.class.findFirst({
        where: { id: input.classId, collegeId },
        select: { id: true, name: true },
      }),
    ])

    if (!student) {
      return fail({ kind: 'STUDENT_NOT_FOUND', message: 'Student not found in your college' })
    }
    if (student.role !== 'STUDENT') {
      return fail({ kind: 'NOT_A_STUDENT', message: `${student.regno} is not a student` })
    }
    if (!course) {
      return fail({ kind: 'COURSE_NOT_FOUND', message: 'Course not found in your college' })
    }
    if (!klass) {
      return fail({ kind: 'CLASS_NOT_FOUND', message: 'Class not found in your college' })
    }

    // ── Already has a row? ─────────────────────────────────────────────────
    // The @@unique([studentId, courseId]) constraint is the real guarantee;
    // this read only exists to return a useful message instead of a crash.
    const existing = await tx.courseEnrollment.findUnique({
      where: { studentId_courseId: { studentId: student.id, courseId: course.id } },
      select: { id: true, status: true },
    })
    if (existing) {
      const status = asEnrollmentStatus(existing.status)
      return fail({
        kind: 'DUPLICATE',
        status,
        message:
          status === 'WAITLISTED'
            ? `${student.regno} is already on the waitlist for ${course.code}`
            : `${student.regno} is already enrolled in ${course.code}`,
      })
    }

    const confirmed = await tx.courseEnrollment.findMany({
      where: { studentId: student.id, status: 'CONFIRMED' },
      select: { course: { select: { credits: true } } },
    })
    const currentCredits = confirmed.reduce((sum, e) => sum + e.course.credits, 0)

    if (currentCredits + course.credits > MAX_CREDITS) {
      return fail({
        kind: 'CREDIT_CAP',
        currentCredits,
        courseCredits: course.credits,
        limit: MAX_CREDITS,
        message:
          `${student.regno} is at ${currentCredits} of ${MAX_CREDITS} credits — ` +
          `${course.code} (${course.credits}) would take them to ${currentCredits + course.credits}`,
      })
    }

    // ── Timetable clash ────────────────────────────────────────────────────
    // Only CONFIRMED enrollments clash: a waitlisted place holds no seat and
    // no timetable slot, so it must not block anything.
    const clashes = await findSlotClashes(tx, {
      collegeId,
      studentId: student.id,
      courseId: course.id,
      classId: klass.id,
    })
    if (clashes.length > 0) {
      return fail({
        kind: 'SLOT_CLASH',
        conflicts: clashes,
        message: `${course.code} clashes with ${clashes.length} confirmed class${clashes.length === 1 ? '' : 'es'} in ${student.regno}'s timetable`,
      })
    }

    // ── Seats ──────────────────────────────────────────────────────────────
    const capacity = course.capacity > 0 ? course.capacity : DEFAULT_SECTION_CAPACITY
    const taken = await tx.courseEnrollment.count({
      where: { courseId: course.id, classId: klass.id, status: 'CONFIRMED' },
    })

    if (taken >= capacity) {
      if (!input.joinWaitlist) {
        return fail({
          kind: 'SECTION_FULL',
          canWaitlist: true,
          seats: { capacity, taken, full: true },
          message: `${course.code} (${klass.name}) is full — ${taken}/${capacity} seats taken. Join the waitlist?`,
        })
      }

      const entry = await tx.courseEnrollment.create({
        data: {
          collegeId,
          studentId: student.id,
          courseId: course.id,
          classId: klass.id,
          status: 'WAITLISTED',
        },
        select: enrollmentSelect,
      })

      const waitlistPosition = await tx.courseEnrollment.count({
        where: {
          courseId: course.id,
          classId: klass.id,
          status: 'WAITLISTED',
          createdAt: { lte: entry.createdAt },
        },
      })

      return {
        ok: true as const,
        enrollment: entry,
        waitlisted: true,
        waitlistPosition,
        seats: { capacity, taken, full: true },
      }
    }

    const enrollment = await tx.courseEnrollment.create({
      data: {
        collegeId,
        studentId: student.id,
        courseId: course.id,
        classId: klass.id,
        status: 'CONFIRMED',
      },
      select: enrollmentSelect,
    })

    return {
      ok: true as const,
      enrollment,
      waitlisted: false,
      seats: { capacity, taken: taken + 1, full: taken + 1 >= capacity },
    }
  })
}

export interface WithdrawResult {
  ok: boolean
  /** The waitlisted student who took the freed seat, if any. */
  promoted?: { regno: string; name: string; courseCode: string }
  seats?: SeatState
}

/**
 * Withdraw a student and hand the freed seat to the queue.
 *
 * A waitlist that never promotes is just a second, sadder failure message, so
 * the seat is passed on in the same transaction that frees it — no window
 * where the seat exists but belongs to nobody.
 */
export async function withdrawEnrollment(
  prisma: PrismaClient,
  collegeId: string,
  enrollmentId: string
): Promise<WithdrawResult> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.courseEnrollment.findFirst({
      where: { id: enrollmentId, collegeId },
      select: {
        id: true,
        courseId: true,
        classId: true,
        status: true,
        student: { select: { regno: true } },
        course: { select: { code: true, capacity: true } },
      },
    })
    if (!row) return { ok: false }

    await tx.courseEnrollment.delete({ where: { id: row.id } })

    const capacity = row.course.capacity > 0 ? row.course.capacity : DEFAULT_SECTION_CAPACITY
    const taken = await tx.courseEnrollment.count({
      where: { courseId: row.courseId, classId: row.classId, status: 'CONFIRMED' },
    })

    // Only a confirmed departure frees a seat.
    if (asEnrollmentStatus(row.status) !== 'CONFIRMED' || taken >= capacity) {
      return { ok: true, seats: { capacity, taken, full: taken >= capacity } }
    }

    const queue = await tx.courseEnrollment.findMany({
      where: { courseId: row.courseId, classId: row.classId, status: 'WAITLISTED' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        studentId: true,
        student: { select: { regno: true, name: true } },
        course: { select: { credits: true } },
      },
      take: 10,
    })

    for (const candidate of queue) {
      // Promoting must respect the credit cap too — being first in the queue
      // does not buy an overload.
      const carried = await tx.courseEnrollment.findMany({
        where: { studentId: candidate.studentId, status: 'CONFIRMED' },
        select: { course: { select: { credits: true } } },
      })
      const credits = carried.reduce((sum, e) => sum + e.course.credits, 0)
      if (credits + candidate.course.credits > MAX_CREDITS) continue

      await tx.courseEnrollment.update({
        where: { id: candidate.id },
        data: { status: 'CONFIRMED' },
      })

      return {
        ok: true,
        promoted: {
          regno: candidate.student.regno,
          name: candidate.student.name,
          courseCode: row.course.code,
        },
        seats: { capacity, taken: taken + 1, full: taken + 1 >= capacity },
      }
    }

    return { ok: true, seats: { capacity, taken, full: taken >= capacity } }
  })
}

/* ── Reads ─────────────────────────────────────────────────────────────────── */

/**
 * Timetable slots of the new course that collide with slots the student is
 * already confirmed for.
 */
export async function findSlotClashes(
  tx: Prisma.TransactionClient | PrismaClient,
  input: { collegeId: string; studentId: string; courseId: string; classId: string }
): Promise<SlotClash[]> {
  const held = await tx.courseEnrollment.findMany({
    where: { studentId: input.studentId, status: 'CONFIRMED' },
    select: {
      courseId: true,
      classId: true,
      course: { select: { code: true, name: true } },
    },
  })

  if (held.length === 0) return []

  const [newSlots, existingSlots] = await Promise.all([
    tx.timetableSlot.findMany({
      where: { collegeId: input.collegeId, courseId: input.courseId, classId: input.classId },
      select: { dayOfWeek: true, startTime: true, endTime: true },
    }),
    tx.timetableSlot.findMany({
      where: {
        collegeId: input.collegeId,
        OR: held.map((h) => ({ courseId: h.courseId, classId: h.classId })),
      },
      select: { courseId: true, dayOfWeek: true, startTime: true, endTime: true },
    }),
  ])

  if (newSlots.length === 0 || existingSlots.length === 0) return []

  const clashes: SlotClash[] = []
  for (const already of held) {
    // Slots of a course the student already holds. They can only be enrolled in
    // a course once (@@unique([studentId, courseId])), so matching on courseId
    // alone is unambiguous.
    const heldSlots = existingSlots.filter((s) => s.courseId === already.courseId)
    for (const existing of heldSlots) {
      for (const next of newSlots) {
        if (existing.dayOfWeek !== next.dayOfWeek) continue
        if (!timesOverlap(existing.startTime, existing.endTime, next.startTime, next.endTime)) {
          continue
        }
        clashes.push({
          courseCode: already.course.code,
          courseName: already.course.name,
          day: weekdayLabel(existing.dayOfWeek),
          start: existing.startTime,
          end: existing.endTime,
          newStart: next.startTime,
          newEnd: next.endTime,
        })
      }
    }
  }

  return clashes
}

/** "Mon 09:00–10:00" — one line per clash for an error toast. */
export function clashLine(clash: SlotClash): string {
  return `${clash.courseCode} ${clash.day} ${timeRange(clash.start, clash.end)}`
}

function fail(failure: EnrollFailure): { ok: false; failure: EnrollFailure } {
  return { ok: false, failure }
}
