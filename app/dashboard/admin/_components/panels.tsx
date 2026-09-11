import * as React from 'react'
import { prisma } from '@/lib/db'
import { Card } from '@/components/ui/card'
import { PERMISSIONS } from '@/lib/roles'
import { buildAccessMatrix, type AccessCell } from '@/lib/permissions'
import { FacultyMatrix } from './faculty-matrix'
import { StudentRoster } from './student-roster'
import { SectionAccess } from './section-access'
import type {
  AccessMatrix,
  ClassRow,
  CourseRow,
  FacultyRow,
  StudentRow,
} from './types'

/**
 * Server panels. Each one owns its queries so the page can stream them
 * independently behind their own Suspense boundary — a slow KPI count never
 * blocks the privilege matrix from painting.
 */

function PanelCard({
  title,
  description,
  icon,
  children,
}: {
  title: string
  description: string
  icon: string
  children: React.ReactNode
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-3 border-b border-border p-6 pb-4">
        <span className="material-symbols-outlined rounded-xl bg-accent-soft p-2 text-[18px] leading-none text-accent">
          {icon}
        </span>
        <div>
          <h2 className="font-heading text-base font-semibold text-foreground">{title}</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p>
        </div>
      </div>
      {children}
    </Card>
  )
}

/** Flatten Prisma's nested permission shape into the matrix's flat inputs. */
function flattenGrants(
  rows: Array<{ role: string; permission: { key: string } }>
): Array<{ role: string; key: string }> {
  return rows.map((r) => ({ role: r.role, key: r.permission.key }))
}

function flattenOverrides(
  rows: Array<{ userId: string; granted: boolean; permission: { key: string } }>
): Array<{ userId: string; key: string; granted: boolean }> {
  return rows.map((r) => ({ userId: r.userId, key: r.permission.key, granted: r.granted }))
}

function toMatrix(matrix: Record<string, Record<string, AccessCell>>): AccessMatrix {
  return matrix as AccessMatrix
}

/* ── Faculty privilege matrix ───────────────────────────────────────────────── */

const FACULTY_COLUMNS = [
  {
    key: PERMISSIONS.GRADE_ENTRY,
    label: 'Grade entry',
    description: 'Enter and edit marks for their courses',
  },
  {
    key: PERMISSIONS.ATTENDANCE_MARK,
    label: 'Attendance',
    description: 'Mark daily attendance for their courses',
  },
  {
    key: PERMISSIONS.EXAM_CREATE,
    label: 'Exam creation',
    description: 'Create exams and publish results',
  },
]

export async function FacultyPanel({ collegeId }: { collegeId: string | null }) {
  const where = collegeId ? { collegeId } : {}
  const keys = FACULTY_COLUMNS.map((c) => c.key)

  const [teachers, roleGrants, permissions] = await Promise.all([
    prisma.user.findMany({
      where: { ...where, role: { in: ['TEACHER', 'HOD'] }, status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        regno: true,
        email: true,
        role: true,
        _count: { select: { coursesTaught: true } },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.rolePermission.findMany({ select: { role: true, permission: { select: { key: true } } } }),
    prisma.permission.findMany({ where: { key: { in: keys } }, select: { key: true } }),
  ])

  const ids = teachers.map((t) => t.id)
  const overrides = ids.length
    ? await prisma.userPermission.findMany({
        where: { userId: { in: ids } },
        select: { userId: true, granted: true, permission: { select: { key: true } } },
      })
    : []

  // Only offer columns whose permission rows actually exist.
  const known = new Set(permissions.map((p) => p.key))
  const columns = FACULTY_COLUMNS.filter((c) => known.has(c.key))

  const matrix = toMatrix(
    buildAccessMatrix(
      teachers.map((t) => ({ id: t.id, role: t.role })),
      columns.map((c) => c.key),
      flattenGrants(roleGrants),
      flattenOverrides(overrides)
    )
  )

  const rows: FacultyRow[] = teachers.map((t) => ({
    id: t.id,
    name: t.name,
    regno: t.regno,
    role: t.role,
    email: t.email,
    courseCount: t._count.coursesTaught,
  }))

  return (
    <PanelCard
      title="Faculty privilege matrix"
      description="Grant or revoke teaching privileges per person. Overrides beat the role default and are audited."
      icon="badge"
    >
      <FacultyMatrix rows={rows} columns={columns} matrix={matrix} />
    </PanelCard>
  )
}

/* ── Student roster ─────────────────────────────────────────────────────────── */

const STUDENT_COLUMNS = [
  { key: PERMISSIONS.LMS_ACCESS, label: 'LMS', icon: 'menu_book' },
  { key: PERMISSIONS.EXAM_ENGINE_ACCESS, label: 'Exam engine', icon: 'quiz' },
  { key: PERMISSIONS.VIRTUAL_LAB_ACCESS, label: 'Virtual lab', icon: 'science' },
]

export async function StudentPanel({ collegeId }: { collegeId: string | null }) {
  const where = collegeId ? { collegeId } : {}
  const keys = STUDENT_COLUMNS.map((c) => c.key)

  const [students, roleGrants, permissions] = await Promise.all([
    prisma.user.findMany({
      where: { ...where, role: 'STUDENT', status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        regno: true,
        email: true,
        role: true,
        enrollments: { take: 1, select: { class: { select: { name: true } } } },
      },
      orderBy: { regno: 'asc' },
      take: 200,
    }),
    prisma.rolePermission.findMany({ select: { role: true, permission: { select: { key: true } } } }),
    prisma.permission.findMany({ where: { key: { in: keys } }, select: { key: true } }),
  ])

  const ids = students.map((s) => s.id)
  const overrides = ids.length
    ? await prisma.userPermission.findMany({
        where: { userId: { in: ids } },
        select: { userId: true, granted: true, permission: { select: { key: true } } },
      })
    : []

  const known = new Set(permissions.map((p) => p.key))
  const columns = STUDENT_COLUMNS.filter((c) => known.has(c.key))

  const matrix = toMatrix(
    buildAccessMatrix(
      students.map((s) => ({ id: s.id, role: s.role })),
      columns.map((c) => c.key),
      flattenGrants(roleGrants),
      flattenOverrides(overrides)
    )
  )

  const rows: StudentRow[] = students.map((s) => ({
    id: s.id,
    name: s.name,
    regno: s.regno,
    email: s.email,
    className: s.enrollments[0]?.class.name ?? null,
  }))

  return (
    <PanelCard
      title="Student roster"
      description="Feature access per student. Turn a module off for one person without touching the whole cohort."
      icon="groups"
    >
      <StudentRoster rows={rows} columns={columns} matrix={matrix} />
    </PanelCard>
  )
}

/* ── Section-level access ───────────────────────────────────────────────────── */

export async function SectionAccessPanel({ collegeId }: { collegeId: string | null }) {
  const where = collegeId ? { collegeId } : {}

  const [courses, classes, accessRows] = await Promise.all([
    prisma.course.findMany({
      where,
      select: {
        id: true,
        code: true,
        name: true,
        teacher: { select: { name: true } },
      },
      orderBy: { code: 'asc' },
    }),
    prisma.class.findMany({
      where,
      select: { id: true, name: true, semester: true },
      orderBy: { name: 'asc' },
    }),
    prisma.courseSectionAccess.findMany({
      where,
      select: { courseId: true, classId: true, enabled: true },
    }),
  ])

  const access: Record<string, boolean> = {}
  for (const row of accessRows) access[`${row.courseId}:${row.classId}`] = row.enabled

  const courseRows: CourseRow[] = courses.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    teacherName: c.teacher?.name ?? null,
  }))

  const classRows: ClassRow[] = classes.map((k) => ({
    id: k.id,
    name: k.name,
    semester: k.semester,
  }))

  return (
    <PanelCard
      title="Section-level access"
      description="Which class sections may reach each course. Locked sections disappear from student and teacher views."
      icon="account_tree"
    >
      <SectionAccess courses={courseRows} classes={classRows} access={access} />
    </PanelCard>
  )
}
