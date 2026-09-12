import { prisma } from '@/lib/db'
import { requirePermission, scopes } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import { AcademicsClient } from './AcademicsClient'

export const metadata = { title: 'Academics · Apex University ERP' }

/**
 * Admin › Academics — Wave 1: courses, classes and enrollments.
 * Guarded server-side by requirePermission("course.manage"); the class and
 * enrollment sections are checked separately so a role holding only one of
 * the three permissions still gets a usable screen.
 */
export default async function AdminAcademicsPage() {
  const ctx = await requirePermission(PERMISSIONS.COURSE_MANAGE, { route: 'admin' })
  const collegeScope = scopes.college(ctx)

  const [courses, classes, enrollments, departments, teachers, students] = await Promise.all([
    prisma.course.findMany({
      where: collegeScope,
      select: {
        id: true,
        code: true,
        name: true,
        credits: true,
        departmentId: true,
        teacherId: true,
        department: { select: { id: true, name: true } },
        teacher: { select: { id: true, regno: true, name: true } },
        _count: { select: { enrollments: true } },
      },
      orderBy: { code: 'asc' },
    }),
    prisma.class.findMany({
      where: collegeScope,
      select: {
        id: true,
        name: true,
        semester: true,
        batchYear: true,
        departmentId: true,
        department: { select: { id: true, name: true } },
        _count: { select: { enrollments: true } },
      },
      orderBy: [{ batchYear: 'desc' }, { semester: 'asc' }, { name: 'asc' }],
    }),
    prisma.courseEnrollment.findMany({
      where: collegeScope,
      select: {
        id: true,
        studentId: true,
        courseId: true,
        classId: true,
        status: true,
        student: { select: { id: true, regno: true, name: true } },
        course: { select: { id: true, code: true, name: true } },
        class: { select: { id: true, name: true } },
      },
      orderBy: [{ student: { regno: 'asc' } }, { course: { code: 'asc' } }],
    }),
    prisma.department.findMany({
      where: collegeScope,
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.user.findMany({
      where: { ...collegeScope, role: 'TEACHER', status: 'ACTIVE' },
      select: { id: true, regno: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.user.findMany({
      where: { ...collegeScope, role: 'STUDENT', status: 'ACTIVE' },
      select: { id: true, regno: true, name: true },
      orderBy: { regno: 'asc' },
    }),
  ])

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">Academics</h1>
        <p className="mt-1 text-sm text-muted">
          Define the course catalogue, group students into classes, and enroll them. Every write is
          scoped to your college and written to the audit log.
        </p>
      </div>

      <AcademicsClient
        canManageClasses={ctx.can(PERMISSIONS.CLASS_MANAGE)}
        canManageEnrollments={ctx.can(PERMISSIONS.ENROLLMENT_MANAGE)}
        initialCourses={courses}
        initialClasses={classes}
        initialEnrollments={enrollments}
        departments={departments}
        teachers={teachers}
        students={students}
      />
    </div>
  )
}
