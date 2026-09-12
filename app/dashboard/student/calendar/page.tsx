import { prisma } from '@/lib/db'
import { requireUser, scopes } from '@/lib/rbac'
import { sectionUnlocked } from '@/lib/permissions'
import { timeRange } from '@/lib/timetable'
import {
  addDays,
  addMonths,
  dateKey,
  monthMatrix,
  startOfMonthUtc,
  todayUtc,
  type CalendarEventKind,
} from '@/lib/calendar'
import { FullCalendar, type CalendarEvent } from '@/components/timetable/full-calendar'
import { Card } from '@/components/ui/card'

export const metadata = { title: 'Calendar · Apex University ERP' }

/**
 * Row shapes for the two `Promise.resolve([])` branches of the parallel query.
 * Annotating them keeps the union from widening to `never[]`, which would make
 * `slots`/`exams` unusable below.
 */
interface SlotRow {
  id: string
  dayOfWeek: number
  startTime: string
  endTime: string
  room: string
  course: { code: string; name: string; teacher: { name: string } | null }
}

interface ExamRow {
  id: string
  examDate: Date
  examType: string
  maxMarks: number
  course: { code: string; name: string }
}

/**
 * Student › Calendar.
 *
 * One merged timeline: recurring timetable slots expanded onto real dates,
 * one-off exams placed on their exam date, and non-teaching days from the
 * academic calendar.
 *
 * The query window is the month currently in view plus its lead/trail days —
 * but the client owns the anchor date, so the server cannot know it. Instead
 * the window is generously "this month ± three": wide enough that paging a few
 * months either way and switching to week/day view is already covered, and
 * narrow enough that a four-year placement calendar never arrives in one
 * payload. Paging past the window shows an empty grid rather than a wrong one
 * — the events are simply not in the payload.
 */
export default async function StudentCalendarPage() {
  const ctx = await requireUser({ route: 'student' })
  const today = todayUtc()

  const enrollment = await prisma.courseEnrollment.findFirst({
    where: { studentId: ctx.user.id },
    select: { classId: true, class: { select: { id: true, name: true } } },
  })

  const windowStart = startOfMonthUtc(addMonths(today, -3))
  const windowEnd = addDays(startOfMonthUtc(addMonths(today, 3)), -1)

  // A course is college-wide, not per-section — a student sits exams for the
  // courses they are enrolled in. Resolve those ids once and reuse them, so an
  // exam for a course the student never took cannot leak onto their calendar.
  const myEnrollments = await prisma.courseEnrollment.findMany({
    where: { ...scopes.college(ctx), studentId: ctx.user.id },
    select: { courseId: true },
    take: 100,
  })
  const myCourseIds = myEnrollments.map((e) => e.courseId)

  const [slots, exams, calendarDays] = await Promise.all([
    enrollment?.classId
      ? prisma.timetableSlot.findMany({
          where: {
            ...scopes.college(ctx),
            classId: enrollment.classId,
            course: sectionUnlocked(enrollment.classId),
          },
          select: {
            id: true,
            dayOfWeek: true,
            startTime: true,
            endTime: true,
            room: true,
            course: {
              select: { code: true, name: true, teacher: { select: { name: true } } },
            },
          },
          orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
          take: 200,
        })
      : Promise.resolve([] as SlotRow[]),
    myCourseIds.length > 0
      ? prisma.exam.findMany({
          where: {
            ...scopes.college(ctx),
            courseId: { in: myCourseIds },
            examDate: { gte: windowStart, lte: windowEnd },
          },
          select: {
            id: true,
            examDate: true,
            examType: true,
            maxMarks: true,
            course: { select: { code: true, name: true } },
          },
          orderBy: { examDate: 'asc' },
          take: 200,
        })
      : Promise.resolve([] as ExamRow[]),
    prisma.academicCalendarDay.findMany({
      where: {
        ...scopes.college(ctx),
        date: { gte: windowStart, lte: windowEnd },
        OR: [
          { classId: null },
          ...(enrollment?.classId ? [{ classId: enrollment.classId }] : []),
        ],
      },
      select: { id: true, date: true, title: true, kind: true, classId: true },
      orderBy: { date: 'asc' },
      take: 200,
    }),
  ])

  const events: CalendarEvent[] = []

  // ── Recurring slots, one event per matching date in the window ────────────
  // 42 cells × a handful of slots is trivial work, but iterating days and
  // filtering slots is O(days + slots) rather than O(days × slots).
  const slotsByDay = new Map<number, typeof slots>()
  for (const slot of slots) {
    const list = slotsByDay.get(slot.dayOfWeek)
    if (list) list.push(slot)
    else slotsByDay.set(slot.dayOfWeek, [slot])
  }

  const closedDates = new Set(
    calendarDays
      .filter((d) => d.kind === 'HOLIDAY' || d.kind === 'CLOSURE')
      .map((d) => dateKey(d.date))
  )

  const firstCell = monthMatrix(addMonths(today, -3))[0]
  const lastCell = monthMatrix(addMonths(today, 3))[41]

  for (let date = firstCell; date <= lastCell; date = addDays(date, 1)) {
    const key = dateKey(date)
    // A closed day has no lectures. Showing both would be a lie.
    if (closedDates.has(key)) continue
    const daySlots = slotsByDay.get(date.getUTCDay())
    if (!daySlots) continue
    for (const slot of daySlots) {
      events.push({
        id: `slot:${slot.id}:${key}`,
        date: key,
        kind: 'LECTURE',
        title: slot.course.code,
        time: timeRange(slot.startTime, slot.endTime),
        subtitle: [slot.course.name, slot.room, slot.course.teacher?.name]
          .filter(Boolean)
          .join(' · '),
      })
    }
  }

  // ── Exams ─────────────────────────────────────────────────────────────────
  for (const exam of exams) {
    events.push({
      id: `exam:${exam.id}`,
      date: dateKey(exam.examDate),
      kind: 'EXAM',
      title: `${exam.course.code} ${exam.examType}`,
      time: null,
      subtitle: `${exam.course.name} · out of ${exam.maxMarks}`,
    })
  }

  // ── Non-teaching days ─────────────────────────────────────────────────────
  for (const day of calendarDays) {
    events.push({
      id: `day:${day.id}`,
      date: dateKey(day.date),
      kind: (day.kind === 'HOLIDAY' || day.kind === 'CLOSURE' || day.kind === 'BREAK' || day.kind === 'EVENT'
        ? day.kind
        : 'EVENT') as CalendarEventKind,
      title: day.title,
      time: null,
      subtitle: day.classId ? 'Your section only' : 'Whole college',
    })
  }

  const upcoming = events
    .filter((e) => e.date >= dateKey(today) && e.kind !== 'LECTURE')
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 4)

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">Calendar</h1>
        <p className="mt-1 text-sm text-muted">
          Classes, exams and non-teaching days for{' '}
          {enrollment?.class ? `section ${enrollment.class.name}` : 'your section'}.
        </p>
      </div>

      {upcoming.length > 0 ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {upcoming.map((event) => (
            <Card key={event.id} className="p-4">
              <p className="num text-xs text-muted">{event.date}</p>
              <p className="mt-1 truncate text-sm font-semibold text-foreground">{event.title}</p>
              <p className="mt-0.5 truncate text-[11px] text-subtle">
                {event.subtitle ?? (event.kind === 'EXAM' ? 'Exam' : 'Holiday')}
              </p>
            </Card>
          ))}
        </div>
      ) : null}

      <FullCalendar events={events} />
    </div>
  )
}
