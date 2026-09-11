import { prisma } from '@/lib/db'
import { requireUser, scopes } from '@/lib/rbac'
import { sectionUnlocked } from '@/lib/permissions'
import {
  WEEKDAYS,
  durationMinutes,
  timeRange,
  weekdayLabel,
  type GridSlot,
} from '@/lib/timetable'
import { Card } from '@/components/ui/card'
import { WeekGrid } from '@/components/timetable/week-grid'
import { EmptyState } from '@/components/ui/states'

export const metadata = { title: 'Timetable · Apex University ERP' }

/**
 * Student › Timetable.
 *
 * Tier 3: only the student's own section, and only courses their section has
 * not been locked out of — the identical rule the attendance and assignment
 * screens use, so a governance switch takes effect everywhere at once.
 */
export default async function StudentTimetablePage() {
  const ctx = await requireUser({ route: 'student' })

  const enrollment = await prisma.courseEnrollment.findFirst({
    where: { studentId: ctx.user.id },
    select: { classId: true, class: { select: { id: true, name: true } } },
  })

  const rows = enrollment?.classId
    ? await prisma.timetableSlot.findMany({
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
            select: {
              id: true,
              code: true,
              name: true,
              teacher: { select: { name: true } },
            },
          },
          class: { select: { id: true, name: true } },
        },
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
        take: 200,
      })
    : []

  const slots: GridSlot[] = rows.map((s) => ({
    id: s.id,
    courseId: s.course.id,
    courseCode: s.course.code,
    courseName: s.course.name,
    teacherName: s.course.teacher?.name ?? null,
    className: s.class.name,
    room: s.room,
    startTime: s.startTime,
    endTime: s.endTime,
    dayOfWeek: s.dayOfWeek,
  }))

  // JS day: 0=Sun…6=Sat, which matches the schema. Sunday maps to nothing.
  const today = new Date().getDay()

  const totalMinutes = slots.reduce(
    (sum, s) => sum + durationMinutes(s.startTime, s.endTime),
    0
  )

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">Timetable</h1>
        <p className="mt-1 text-sm text-muted">
          {enrollment?.class
            ? `Your weekly schedule for section ${enrollment.class.name}.`
            : 'Your weekly schedule will appear once you are assigned to a section.'}
        </p>
      </div>

      {slots.length > 0 ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Card className="p-4">
            <p className="text-xs text-muted">Section</p>
            <p className="num mt-1 text-lg font-semibold text-foreground">
              {enrollment?.class.name ?? '—'}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted">Classes per week</p>
            <p className="num mt-1 text-lg font-semibold text-foreground">{slots.length}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted">Contact hours</p>
            <p className="num mt-1 text-lg font-semibold text-foreground">
              {(totalMinutes / 60).toFixed(1)}
              <span className="ml-1 text-xs font-normal text-muted">h</span>
            </p>
          </Card>
        </div>
      ) : null}

      <WeekGrid
        slots={slots}
        today={today}
        emptyTitle="No classes scheduled"
        emptyHint="Your section's timetable has not been published yet."
      />

      {slots.length > 0 ? (
        <div className="mt-6">
          <h2 className="font-heading text-sm font-semibold text-foreground">Week at a glance</h2>
          <div className="mt-3 space-y-4">
            {WEEKDAYS.map((day) => {
              const daySlots = slots.filter((s) => s.dayOfWeek === day.value)
              if (daySlots.length === 0) return null
              return (
                <div key={day.value}>
                  <div className="flex items-center gap-2">
                    <h3
                      className={`text-xs font-semibold ${
                        day.value === today ? 'text-accent' : 'text-muted'
                      }`}
                    >
                      {day.long}
                    </h3>
                    {day.value === today ? (
                      <span className="num rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                        Today
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2 space-y-2">
                    {daySlots.map((slot) => (
                      <div
                        key={slot.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-surface px-4 py-2.5"
                      >
                        <span className="num w-24 shrink-0 text-xs text-muted">
                          {timeRange(slot.startTime, slot.endTime)}
                        </span>
                        <span className="num rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-semibold text-accent">
                          {slot.courseCode}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                          {slot.courseName}
                        </span>
                        <span className="num text-[11px] text-subtle">{slot.room}</span>
                        {slot.teacherName ? (
                          <span className="num hidden text-[11px] text-subtle sm:inline">
                            {slot.teacherName}
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="mt-6">
          <EmptyState
            icon="event_busy"
            title="Nothing to list yet"
            description={`Once ${enrollment?.class.name ?? 'your section'} has scheduled slots they will be listed by ${weekdayLabel(1)} through ${weekdayLabel(6)}.`}
          />
        </div>
      )}
    </div>
  )
}
