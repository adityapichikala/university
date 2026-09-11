import { prisma } from '@/lib/db'
import { requirePermission, scopes } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import { sectionUnlocked } from '@/lib/permissions'
import { ToastProvider } from '@/components/ui/toast'
import { AssignmentsFeed, type AssignmentItem } from './AssignmentsFeed'

export const metadata = { title: 'Assignments · Apex University ERP' }

/**
 * Student › Assignments.
 *
 * Tier 2: submission.submit — every real student role has it; the admin can
 * revoke it per user, in which case this page redirects them away.
 * Tier 3: only courses this student is enrolled in, minus any course their
 * section has been locked out of. Same scope as GET /api/assignments so the
 * page and the API can never disagree.
 */
export default async function StudentAssignmentsPage() {
  const ctx = await requirePermission(PERMISSIONS.SUBMISSION_SUBMIT, { route: 'student' })

  // A student belongs to exactly one section; the lock filter keys off it.
  const enrollment = await prisma.courseEnrollment.findFirst({
    where: { studentId: ctx.user.id },
    select: { classId: true },
  })

  const assignments = await prisma.assignment.findMany({
    where: {
      ...scopes.college(ctx),
      course: {
        enrollments: { some: { studentId: ctx.user.id } },
        ...sectionUnlocked(enrollment?.classId ?? null),
      },
    },
    select: {
      id: true,
      title: true,
      description: true,
      dueDate: true,
      maxMarks: true,
      course: { select: { code: true, name: true } },
      teacher: { select: { name: true } },
      submissions: {
        where: { studentId: ctx.user.id },
        select: {
          id: true,
          fileUrl: true,
          version: true,
          status: true,
          submittedAt: true,
          grade: {
            select: { score: true, feedback: true, gradedAt: true },
          },
        },
        take: 1,
      },
    },
    orderBy: { dueDate: 'asc' },
    take: 200,
  })

  const items: AssignmentItem[] = assignments.map((a) => {
    const submission = a.submissions[0] ?? null
    return {
      id: a.id,
      title: a.title,
      description: a.description,
      dueDate: a.dueDate.toISOString(),
      maxMarks: a.maxMarks,
      courseCode: a.course.code,
      courseName: a.course.name,
      teacherName: a.teacher?.name ?? null,
      submission: submission
        ? {
            id: submission.id,
            fileUrl: submission.fileUrl,
            version: submission.version,
            status: submission.status,
            submittedAt: submission.submittedAt.toISOString(),
            grade: submission.grade
              ? {
                  score: submission.grade.score,
                  feedback: submission.grade.feedback,
                  gradedAt: submission.grade.gradedAt.toISOString(),
                }
              : null,
          }
        : null,
    }
  })

  return (
    <ToastProvider>
      <div className="mx-auto max-w-4xl">
        <div className="mb-6">
          <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">
            Assignments
          </h1>
          <p className="mt-1 text-sm text-muted">
            Post your work before the due date and read your grade here. You can resubmit
            any time before it is graded — a resubmit bumps the version, it does not
            create a second attempt.
          </p>
        </div>

        <AssignmentsFeed items={items} />
      </div>
    </ToastProvider>
  )
}
