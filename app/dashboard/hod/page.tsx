import { prisma } from '@/lib/db'
import { requirePermission, scopes } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import { LEAVE_REQUEST_SELECT } from '@/lib/phase4-query'
import { leaveDays } from '@/lib/leave'
import { gradeFromPercentage } from '@/lib/academics'
import { ToastProvider } from '@/components/ui/toast'
import { HodWorkspace } from './HodWorkspace'

export const metadata = { title: 'Department · Apex University ERP' }

/**
 * HOD portal (Phase 4, doc §7).
 *
 * Everything on this screen is narrowed to the caller's own department —
 * Tier 3 scoping — so an HOD of CSE can never read another department's
 * faculty, courses or leave queue even though the screen is the same for all
 * heads. Guarded by `department.view`.
 */
export default async function HodPage() {
  const ctx = await requirePermission(PERMISSIONS.DEPARTMENT_VIEW, { route: 'hod' })

  const departmentId = ctx.user.departmentId
  const college = scopes.college(ctx)

  const [faculty, courses, students, leaveRows, examResults] = await Promise.all([
    prisma.user.findMany({
      where: { ...college, ...(departmentId ? { departmentId } : {}), role: { in: ['TEACHER', 'HOD'] } },
      select: {
        id: true,
        name: true,
        regno: true,
        role: true,
        employee: { select: { designation: true, salaryBand: true, joinedAt: true } },
        coursesTaught: { select: { id: true, credits: true } },
        _count: { select: { coursesTaught: true } },
      },
      orderBy: { regno: 'asc' },
    }),
    prisma.course.findMany({
      where: { ...college, ...(departmentId ? { departmentId } : {}) },
      select: {
        id: true,
        code: true,
        name: true,
        credits: true,
        teacher: { select: { id: true, name: true, regno: true } },
        _count: { select: { enrollments: true, exams: true } },
      },
      orderBy: { code: 'asc' },
    }),
    prisma.user.findMany({
      where: { ...college, ...(departmentId ? { departmentId } : {}), role: 'STUDENT' },
      select: { id: true, name: true, regno: true },
      orderBy: { regno: 'asc' },
    }),
    prisma.leaveRequest.findMany({
      where: {
        ...college,
        ...(departmentId ? { employee: { departmentId } } : {}),
      },
      select: LEAVE_REQUEST_SELECT,
      orderBy: [{ status: 'asc' }, { startDate: 'asc' }],
      take: 50,
    }),
    prisma.examResult.findMany({
      where: {
        ...college,
        ...(departmentId ? { exam: { course: { departmentId } } } : {}),
      },
      select: {
        marksObtained: true,
        grade: true,
        publishedAt: true,
        exam: { select: { maxMarks: true, courseId: true } },
      },
      take: 2000,
    }),
  ])

  // Average score across the department's graded results, computed here so the
  // UI never has to do arithmetic on raw marks.
  const graded = examResults.filter((r) => r.exam.maxMarks > 0)
  const averagePercent =
    graded.length === 0
      ? 0
      : Math.round(
          (graded.reduce((sum, r) => sum + (r.marksObtained / r.exam.maxMarks) * 100, 0) /
            graded.length) *
            10
        ) / 10

  // Grade distribution for the performance strip.
  const distribution = new Map<string, number>()
  for (const r of graded) {
    const grade = r.grade || gradeFromPercentage((r.marksObtained / r.exam.maxMarks) * 100)
    distribution.set(grade, (distribution.get(grade) ?? 0) + 1)
  }
  const gradeBuckets = Array.from(distribution.entries())
    .map(([grade, count]) => ({
      grade,
      count,
      percent: graded.length === 0 ? 0 : Math.round((count / graded.length) * 100),
    }))
    .sort((a, b) => b.count - a.count)

  const leave = leaveRows.map((r) => ({
    id: r.id,
    employeeName: r.employee.user.name,
    employeeRegno: r.employee.user.regno,
    designation: r.employee.designation,
    startDate: r.startDate.toISOString().slice(0, 10),
    endDate: r.endDate.toISOString().slice(0, 10),
    days: leaveDays(r.startDate, r.endDate),
    reason: r.reason,
    status: r.status,
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString().slice(0, 10) : null,
  }))

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">
          Department
        </h1>
        <p className="mt-1 text-sm text-muted">
          Faculty workload, course coverage and the leave queue for your department. Every decision
          you record is written to the audit log.
        </p>
      </div>

      <ToastProvider>
        <HodWorkspace
          summary={{
            faculty: faculty.length,
            students: students.length,
            courses: courses.length,
            pendingLeave: leave.filter((l) => l.status === 'PENDING').length,
            averagePercent,
            gradedCount: graded.length,
          }}
          faculty={faculty.map((f) => ({
            id: f.id,
            name: f.name,
            regno: f.regno,
            role: f.role,
            designation: f.employee?.designation ?? '—',
            salaryBand: f.employee?.salaryBand ?? '—',
            courseCount: f._count.coursesTaught,
            teachingLoad: f.coursesTaught.reduce((sum, c) => sum + c.credits, 0),
          }))}
          courses={courses.map((c) => ({
            id: c.id,
            code: c.code,
            name: c.name,
            credits: c.credits,
            teacherName: c.teacher?.name ?? 'Unassigned',
            teacherRegno: c.teacher?.regno ?? '—',
            enrolled: c._count.enrollments,
            examCount: c._count.exams,
          }))}
          gradeBuckets={gradeBuckets}
          leave={leave}
          canApproveLeave={ctx.can(PERMISSIONS.LEAVE_APPROVE)}
        />
      </ToastProvider>
    </div>
  )
}
