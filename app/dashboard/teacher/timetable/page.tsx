import { prisma } from '@/lib/db'
import { requirePermission, scopes } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import { ToastProvider } from '@/components/ui/toast'
import { TimetableEditor } from './TimetableEditor'
import type { GridSlot } from '@/lib/timetable'

export const metadata = { title: 'Timetable · Apex University ERP' }

/**
 * Teacher › Timetable.
 *
 * Tier 2: timetable.manage.
 * Tier 3: they only ever see and schedule slots on courses they teach. Sections
 * are listed in full — a teacher legitimately needs to book a room for another
 * section, and the API confirms the course is theirs before writing.
 */
export default async function TeacherTimetablePage() {
  const ctx = await requirePermission(PERMISSIONS.TIMETABLE_MANAGE, { route: 'teacher' })

  const [courses, sections, rows] = await Promise.all([
    prisma.course.findMany({
      where: { ...scopes.college(ctx), ...scopes.taughtCourses(ctx) },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    }),
    prisma.class.findMany({
      where: scopes.college(ctx),
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.timetableSlot.findMany({
      where: { ...scopes.college(ctx), ...scopes.teacherCourses(ctx) },
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
    }),
  ])

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

  return (
    <ToastProvider>
      <div className="mx-auto max-w-6xl">
        <div className="mb-6">
          <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">Timetable</h1>
          <p className="mt-1 text-sm text-muted">
            Your teaching week. Adding a slot checks the section, the teacher and the room —
            clashes are refused before they reach the calendar.
          </p>
        </div>

        <TimetableEditor courses={courses} sections={sections} initialSlots={slots} />
      </div>
    </ToastProvider>
  )
}
