import { prisma } from '@/lib/db'
import { requirePermission, scopes } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import { ExamsClient } from './ExamsClient'

export const metadata = { title: 'Exams & Marks · Apex University ERP' }

/**
 * Teacher › Exams & Marks.
 *
 * Creating an exam needs exam.create; entering marks needs grade.entry. The
 * page requires exam.create and then hides the mark-entry UI when the caller
 * lacks grade.entry, so a partially-privileged role still gets a usable screen.
 */
export default async function TeacherExamsPage() {
  const ctx = await requirePermission(PERMISSIONS.EXAM_CREATE, { route: 'teacher' })

  const [exams, courses] = await Promise.all([
    prisma.exam.findMany({
      where: { ...scopes.college(ctx), course: { teacherId: ctx.user.id } },
      select: {
        id: true,
        courseId: true,
        examDate: true,
        examType: true,
        maxMarks: true,
        course: { select: { id: true, code: true, name: true } },
        _count: { select: { results: true } },
      },
      orderBy: { examDate: 'desc' },
    }),
    prisma.course.findMany({
      where: { ...scopes.college(ctx), ...scopes.taughtCourses(ctx) },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    }),
  ])

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">
          Exams &amp; Marks
        </h1>
        <p className="mt-1 text-sm text-muted">
          Schedule an exam, enter marks, then publish. Students see nothing until you publish.
        </p>
      </div>

      <ExamsClient
        canGrade={ctx.can(PERMISSIONS.GRADE_ENTRY)}
        courses={courses}
        initialExams={exams.map((e) => ({
          id: e.id,
          courseId: e.courseId,
          examType: e.examType,
          examDate: e.examDate.toISOString().slice(0, 10),
          maxMarks: e.maxMarks,
          courseCode: e.course.code,
          courseName: e.course.name,
          resultCount: e._count.results,
        }))}
      />
    </div>
  )
}
