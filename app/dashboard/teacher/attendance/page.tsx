import { prisma } from '@/lib/db'
import { requirePermission, scopes } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import { toDayKey } from '@/lib/academics'
import { AttendanceClient } from './AttendanceClient'

export const metadata = { title: 'Attendance · Apex University ERP' }

/**
 * Teacher › Attendance.
 *
 * Loads the roster for a chosen course+day and lets the teacher mark everyone
 * at once. Guarded by requirePermission("attendance.mark"); the course list is
 * already narrowed to courses this teacher actually teaches.
 */
export default async function TeacherAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ courseId?: string; date?: string }>
}) {
  const ctx = await requirePermission(PERMISSIONS.ATTENDANCE_MARK, { route: 'teacher' })
  const sp = await searchParams

  const courses = await prisma.course.findMany({
    where: { ...scopes.college(ctx), ...scopes.taughtCourses(ctx) },
    select: { id: true, code: true, name: true },
    orderBy: { code: 'asc' },
  })

  const selectedCourseId = sp.courseId ?? courses[0]?.id ?? ''
  const dateKey = sp.date ?? toDayKey(new Date())
  const day = new Date(`${dateKey}T00:00:00.000Z`)

  // Roster = everyone enrolled in the selected course (and only that course).
  const roster = selectedCourseId
    ? await prisma.courseEnrollment.findMany({
        where: { courseId: selectedCourseId, ...scopes.college(ctx) },
        select: {
          student: { select: { id: true, regno: true, name: true } },
        },
        orderBy: { student: { regno: 'asc' } },
      })
    : []

  // Any marks already saved for this day, so the form re-opens as it was left.
  const existing = selectedCourseId
    ? await prisma.attendance.findMany({
        where: { courseId: selectedCourseId, date: day, ...scopes.college(ctx) },
        select: { studentId: true, status: true },
      })
    : []

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">Attendance</h1>
        <p className="mt-1 text-sm text-muted">
          Mark the whole section for one session. Re-submitting a day corrects it rather than
          duplicating.
        </p>
      </div>

      {courses.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-10 text-center shadow-soft">
          <span className="material-symbols-outlined text-4xl text-subtle">fact_check</span>
          <p className="mt-3 text-sm text-muted">
            You have no courses assigned yet, so there is no one to mark.
          </p>
        </div>
      ) : (
        <AttendanceClient
          courses={courses}
          initialCourseId={selectedCourseId}
          initialDate={dateKey}
          roster={roster.map((r) => r.student)}
          initialMarks={existing.map((e) => ({
            studentId: e.studentId,
            status: e.status as 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED',
          }))}
        />
      )}
    </div>
  )
}
