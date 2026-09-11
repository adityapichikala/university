import { prisma } from '@/lib/db'
import { requireUser, scopes } from '@/lib/rbac'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata = { title: 'My Courses · Apex University ERP' }

/**
 * Teacher › My Courses.
 *
 * This page is the visible proof of Tier-3 scoping: it is guarded only by
 * requireUser() (no permission needed to read your own teaching load) and then
 * narrows the query with scopes.taughtCourses(). CS503 — seeded with no teacher
 * — must never appear here, even though it lives in the same college.
 */
export default async function TeacherCoursesPage() {
  const ctx = await requireUser({ route: 'teacher' })

  const courses = await prisma.course.findMany({
    where: { ...scopes.college(ctx), ...scopes.taughtCourses(ctx) },
    select: {
      id: true,
      code: true,
      name: true,
      credits: true,
      department: { select: { name: true } },
      _count: { select: { enrollments: true } },
    },
    orderBy: { code: 'asc' },
  })

  const totalStudents = courses.reduce((sum, c) => sum + c._count.enrollments, 0)

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">My Courses</h1>
        <p className="mt-1 text-sm text-muted">
          The courses assigned to you this term. Read-only for now — attendance and marks arrive in
          the next wave.
        </p>
      </div>

      {courses.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center">
            <span className="material-symbols-outlined text-4xl text-subtle">menu_book</span>
            <p className="mt-3 text-sm text-muted">
              No courses are assigned to you yet. An administrator can assign one from Academics.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap gap-3">
            <Card className="min-w-[150px] flex-1">
              <CardContent className="p-5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">Courses</p>
                <p className="num mt-1 text-2xl font-bold text-foreground">{courses.length}</p>
              </CardContent>
            </Card>
            <Card className="min-w-[150px] flex-1">
              <CardContent className="p-5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">Students</p>
                <p className="num mt-1 text-2xl font-bold text-foreground">{totalStudents}</p>
              </CardContent>
            </Card>
            <Card className="min-w-[150px] flex-1">
              <CardContent className="p-5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">Credits</p>
                <p className="num mt-1 text-2xl font-bold text-foreground">
                  {courses.reduce((sum, c) => sum + c.credits, 0)}
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {courses.map((course) => (
              <Card key={course.id} className="transition-shadow hover:shadow-card">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <span className="num rounded-lg bg-accent-soft px-2 py-1 text-xs font-semibold text-accent">
                      {course.code}
                    </span>
                    <span className="num text-xs text-subtle">{course.credits} cr</span>
                  </div>
                  <CardTitle className="mt-2">{course.name}</CardTitle>
                  <CardDescription>{course.department.name}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 text-sm text-muted">
                    <span className="material-symbols-outlined text-[18px]">groups</span>
                    <span className="num font-medium text-foreground">
                      {course._count.enrollments}
                    </span>
                    enrolled
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
