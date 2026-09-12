import { prisma } from '@/lib/db'
import { requireUser, scopes } from '@/lib/rbac'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { KpiCard } from '@/components/dashboard/kpi-card'

export const metadata = { title: 'My Courses · Apex University ERP' }

/**
 * Student course list (Phase 4, doc §7) — read-only.
 *
 * Tier 1 (`route: 'student'`) plus Tier 3 (the enrollment query is filtered to
 * `studentId === caller`). There is no dedicated permission for "see your own
 * timetable of courses" — inventing one would be noise, so this screen leans
 * on role + ownership scoping instead.
 */
export default async function StudentCoursesPage() {
  const ctx = await requireUser({ route: 'student' })
  const college = scopes.college(ctx)

  const enrollments = await prisma.courseEnrollment.findMany({
    where: { ...college, studentId: ctx.user.id },
    select: {
      id: true,
      course: {
        select: {
          id: true,
          code: true,
          name: true,
          credits: true,
          teacher: { select: { name: true, regno: true } },
          _count: { select: { exams: true, enrollments: true } },
        },
      },
      class: { select: { name: true, semester: true } },
    },
    orderBy: { course: { code: 'asc' } },
    take: 50,
  })

  const totalCredits = enrollments.reduce((sum, e) => sum + e.course.credits, 0)
  const sections = new Set(enrollments.map((e) => e.class?.name).filter(Boolean))
  const withExams = enrollments.filter((e) => e.course._count.exams > 0).length

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">My Courses</h1>
        <p className="mt-1 text-sm text-muted">
          Everything you are enrolled in this term, with the teaching assignment for each.
        </p>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon="menu_book"
          label="Enrolled"
          value={enrollments.length}
          hint="courses this term"
        />
        <KpiCard icon="stars" label="Credits" value={totalCredits} hint="registered" />
        <KpiCard
          icon="groups"
          label="Sections"
          value={sections.size}
          hint={sections.size === 1 ? 'single section' : 'across sections'}
        />
        <KpiCard
          icon="quiz"
          label="With exams"
          value={withExams}
          hint="courses holding exams"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Course list</CardTitle>
          <CardDescription>
            {enrollments.length} enrolled · {totalCredits} credits
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {enrollments.length === 0 ? (
            <div className="px-6">
              <EmptyState
                icon="menu_book"
                title="No courses yet"
                description="Your enrolments will appear here once the department registers you."
              />
            </div>
          ) : (
            <div className="overflow-x-auto border-t border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-background text-[11px] uppercase tracking-wider text-subtle">
                  <tr>
                    <th className="px-6 py-2.5 font-medium">Course</th>
                    <th className="px-3 py-2.5 font-medium">Teacher</th>
                    <th className="px-3 py-2.5 font-medium">Section</th>
                    <th className="px-3 py-2.5 text-right font-medium">Credits</th>
                    <th className="px-6 py-2.5 text-right font-medium">Exams</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {enrollments.map((e) => (
                    <tr key={e.id} className="transition-colors hover:bg-background">
                      <td className="px-6 py-3">
                        <p className="font-medium text-foreground">
                          <span className="num text-accent">{e.course.code}</span> · {e.course.name}
                        </p>
                      </td>
                      <td className="px-3 py-3 text-muted">
                        {e.course.teacher?.name ?? 'Unassigned'}
                        {e.course.teacher ? (
                          <span className="num ml-2 text-[10px] text-subtle">
                            {e.course.teacher.regno}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-muted">
                        {e.class?.name ?? '—'}
                        {e.class ? (
                          <span className="num ml-2 text-[10px] text-subtle">
                            sem {e.class.semester}
                          </span>
                        ) : null}
                      </td>
                      <td className="num px-3 py-3 text-right text-foreground">{e.course.credits}</td>
                      <td className="num px-6 py-3 text-right text-foreground">
                        {e.course._count.exams}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
