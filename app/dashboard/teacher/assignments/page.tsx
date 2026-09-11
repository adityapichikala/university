import { prisma } from '@/lib/db'
import { requirePermission, scopes } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import { ToastProvider } from '@/components/ui/toast'
import { AssignmentsWorkbench, type AssignmentRow } from './AssignmentsWorkbench'

export const metadata = { title: 'Assignments · Apex University ERP' }

/**
 * Teacher › Assignments.
 *
 * Tier 2: assignment.manage (create/edit) — grading needs grade.entry and is
 * enforced inside PATCH /api/submissions/:id, not here.
 * Tier 3: only the courses this teacher actually teaches.
 */
export default async function TeacherAssignmentsPage() {
  const ctx = await requirePermission(PERMISSIONS.ASSIGNMENT_MANAGE, { route: 'teacher' })

  const [courses, assignments] = await Promise.all([
    prisma.course.findMany({
      where: { ...scopes.college(ctx), ...scopes.taughtCourses(ctx) },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    }),
    prisma.assignment.findMany({
      where: { ...scopes.college(ctx), ...scopes.teacherCourses(ctx) },
      select: {
        id: true,
        title: true,
        description: true,
        dueDate: true,
        maxMarks: true,
        courseId: true,
        course: { select: { code: true, name: true } },
        _count: { select: { submissions: true } },
      },
      orderBy: { dueDate: 'asc' },
    }),
  ])

  const rows: AssignmentRow[] = assignments.map((a) => ({
    id: a.id,
    title: a.title,
    description: a.description,
    dueDate: a.dueDate.toISOString(),
    maxMarks: a.maxMarks,
    courseId: a.courseId,
    courseCode: a.course.code,
    courseName: a.course.name,
    submissionCount: a._count.submissions,
  }))

  return (
    <ToastProvider>
      <div className="mx-auto max-w-5xl">
        <div className="mb-6">
          <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">
            Assignments
          </h1>
          <p className="mt-1 text-sm text-muted">
            Post work for your sections and grade what comes back. Students only ever see
            assignments for courses they are enrolled in.
          </p>
        </div>

        <AssignmentsWorkbench
          courses={courses}
          initialAssignments={rows}
        />
      </div>
    </ToastProvider>
  )
}
