import Link from 'next/link'
import { prisma } from '@/lib/db'
import { requirePermission, scopes } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import { toDayKey } from '@/lib/academics'
import { ToastProvider } from '@/components/ui/toast'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
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

  const selectedCourseId = sp.courseId ?? ''
  const dateKey = sp.date ?? toDayKey(new Date())
  const day = new Date(`${dateKey}T00:00:00.000Z`)

  // Roster = everyone enrolled in the selected course (and only that course).
  // Roll number and section come along so the teacher can identify a student
  // the way the section does, not just by regno — two sections both have a
  // roll 01, so the pair is only meaningful together.
  const roster = selectedCourseId
    ? await prisma.courseEnrollment.findMany({
        where: { courseId: selectedCourseId, ...scopes.college(ctx) },
        select: {
          student: {
            select: {
              id: true,
              regno: true,
              name: true,
              rollNo: true,
              class: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: [{ student: { class: { name: 'asc' } } }, { student: { rollNo: 'asc' } }],
      })
    : []

  // Any marks already saved for this day, so the form re-opens as it was left.
  const existing = selectedCourseId
    ? await prisma.attendance.findMany({
        where: { courseId: selectedCourseId, date: day, ...scopes.college(ctx) },
        select: { studentId: true, status: true },
      })
    : []

  // If viewing the grid, figure out which courses are already marked for this date.
  const markedCourseIds = !selectedCourseId
    ? (
        await prisma.attendance.findMany({
          where: { courseId: { in: courses.map((c) => c.id) }, date: day, ...scopes.college(ctx) },
          select: { courseId: true },
          distinct: ['courseId'],
        })
      ).map((a) => a.courseId)
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
      ) : !selectedCourseId ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => {
            const isMarked = markedCourseIds.includes(course.id)
            return (
              <Link key={course.id} href={`/dashboard/teacher/attendance?courseId=${course.id}&date=${dateKey}`}>
                <Card className="h-full hover:border-accent transition-colors">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <CardTitle className="text-lg">{course.name}</CardTitle>
                      {isMarked && (
                        <span className="shrink-0 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-success">
                          Marked
                        </span>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted">{course.code}</p>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      ) : (
        <ToastProvider>
          <AttendanceClient
            key={`${selectedCourseId}-${dateKey}`}
            courses={courses}
            initialCourseId={selectedCourseId}
            initialDate={dateKey}
            roster={roster.map((r) => ({
              id: r.student.id,
              regno: r.student.regno,
              name: r.student.name,
              rollNo: r.student.rollNo,
              section: r.student.class?.name ?? null,
            }))}
            initialMarks={existing.map((e) => ({
              studentId: e.studentId,
              status: e.status as 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED',
            }))}
          />
        </ToastProvider>
      )}
    </div>
  )
}
