import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { requireUser, scopes } from '@/lib/rbac'
import { PERMISSIONS, ROLE_LABEL, SLUG_ROLE } from '@/lib/roles'
import { weekdayLabel, timeRange } from '@/lib/timetable'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Role landing route: /dashboard/<slug>
 *
 * One route serves every role, but it is not one *dashboard*. A student's
 * landing page is about their academic record; a staff landing page is about
 * the work they govern.
 *
 * Students deliberately see no RBAC surface — no role name, no permission
 * count, no effective-permission list. A student's identity in this system is
 * their registration number, and which role row the database resolved for them
 * is an implementation detail they should never have to reason about. Staff
 * keep the governance view, because for an admin or HOD those grants are the
 * thing they actually manage.
 */
export default async function RoleDashboardPage({
  params,
}: {
  params: Promise<{ role: string }>
}) {
  const { role: slug } = await params

  const role = SLUG_ROLE[slug]
  if (!role) notFound()

  // Tier 1: /dashboard/<slug> must belong to the caller's own role.
  const ctx = await requireUser({ route: slug })

  const firstName = ctx.user.name.split(' ')[0]
  const isStudent = role === 'STUDENT'
  // Only staff pay for this — a student never renders the permission surface.
  const permissions = isStudent ? [] : Array.from(ctx.permissions).sort()

  // Students get a glanceable "what's on today" strip. It is deliberately a
  // preview (max three entries) — the full week lives on the timetable page.
  const today = new Date()
  const todaySlots =
    isStudent && ctx.user.classId
      ? await prisma.timetableSlot.findMany({
          where: { classId: ctx.user.classId, dayOfWeek: today.getDay() },
          select: {
            id: true,
            startTime: true,
            endTime: true,
            room: true,
            course: {
              select: { code: true, name: true, teacher: { select: { name: true } } },
            },
          },
          orderBy: { startTime: 'asc' },
        })
      : []
  const previewSlots = todaySlots.slice(0, 3)

  // Student stats: their academic standing, not their access grants. Section
  // and semester come from the section record the student is attached to.
  const [section, enrolledCount] =
    isStudent && ctx.user.classId
      ? await Promise.all([
          prisma.class.findUnique({
            where: { id: ctx.user.classId },
            select: { name: true, semester: true },
          }),
          prisma.courseEnrollment.count({ where: { studentId: ctx.user.id } }),
        ])
      : [null, 0]

  // "Who is coming to campus" — the next few drives, soonest first. Gated on
  // the same permission that opens the placements page, so a student without it
  // sees nothing rather than a link they would be refused.
  const canSeePlacements = isStudent && ctx.can(PERMISSIONS.PLACEMENT_APPLY)
  const upcomingDrives = canSeePlacements
    ? await prisma.placementDrive.findMany({
        where: { ...scopes.college(ctx), driveDate: { gte: today } },
        select: {
          id: true,
          companyName: true,
          role: true,
          driveDate: true,
          packageOffered: true,
        },
        orderBy: { driveDate: 'asc' },
        take: 4,
      })
    : []

  const studentStats = [
    { label: 'Section', value: section?.name ?? 'Unassigned' },
    { label: 'Semester', value: section ? String(section.semester) : '—' },
    { label: 'Enrolled courses', value: String(enrolledCount) },
  ]

  const staffStats = [
    { label: 'Role', value: ROLE_LABEL[role] },
    { label: 'Status', value: ctx.user.status },
    { label: 'Permissions', value: String(permissions.length) },
  ]

  const stats = isStudent ? studentStats : staffStats

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">
          Welcome back, {firstName}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {/* Students are identified by their registration number alone — the
              role is not theirs to see. Staff see both. */}
          Signed in as <span className="num text-foreground">{ctx.user.regno}</span>
          {isStudent ? null : <> · {ROLE_LABEL[role]}</>}
        </p>
      </div>

      {isStudent ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>Today&rsquo;s classes</CardTitle>
                  <p className="text-sm text-muted">
                    {weekdayLabel(today.getDay())}
                    {todaySlots.length > previewSlots.length
                      ? ` · showing ${previewSlots.length} of ${todaySlots.length}`
                      : ` · ${todaySlots.length} scheduled`}
                  </p>
                </div>
                <Link
                  href="/dashboard/student/timetable"
                  className="shrink-0 text-xs font-medium text-accent hover:underline"
                >
                  Full timetable
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {todaySlots.length === 0 ? (
                <p className="text-sm text-subtle">
                  Nothing scheduled today — enjoy the breathing room.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {previewSlots.map((slot) => (
                    <li key={slot.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">
                          <span className="num text-accent">{slot.course.code}</span>{' '}
                          <span className="text-muted">{slot.course.name}</span>
                        </p>
                        <p className="mt-0.5 text-xs text-subtle">
                          {slot.course.teacher?.name ?? 'Unassigned'} · {slot.room}
                        </p>
                      </div>
                      <span className="num shrink-0 rounded-lg bg-background px-2 py-1 text-xs text-muted">
                        {timeRange(slot.startTime, slot.endTime)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Companies coming to campus. Deliberately beside the classes card
              rather than below it: both answer "what is coming up", and a
              student scans them together. */}
          {canSeePlacements ? (
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>Companies visiting</CardTitle>
                    <p className="text-sm text-muted">
                      {upcomingDrives.length === 0
                        ? 'Nothing scheduled yet'
                        : `Next ${upcomingDrives.length} drive${upcomingDrives.length === 1 ? '' : 's'}`}
                    </p>
                  </div>
                  <Link
                    href="/dashboard/student/placements"
                    className="shrink-0 text-xs font-medium text-accent hover:underline"
                  >
                    Placements
                  </Link>
                </div>
              </CardHeader>
              <CardContent>
                {upcomingDrives.length === 0 ? (
                  <p className="text-sm text-subtle">
                    No drives on the calendar. The placement office publishes them here as soon as
                    they are confirmed.
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {upcomingDrives.map((drive) => (
                      <li
                        key={drive.id}
                        className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {drive.companyName}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-subtle">
                            {drive.role} · {drive.packageOffered}
                          </p>
                        </div>
                        <span className="num shrink-0 rounded-lg bg-accent-soft px-2 py-1 text-xs font-medium text-accent">
                          {drive.driveDate.toISOString().slice(5, 10)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.label} className="p-5">
            <p className="font-mono text-[10px] uppercase tracking-wider text-subtle">
              {stat.label}
            </p>
            <p className="num mt-2 text-xl font-semibold text-foreground">{stat.value}</p>
          </Card>
        ))}
      </div>

      {/* Governance surface — staff only. A student has no permissions to
          review, so rendering an empty card would be noise at best. */}
      {isStudent ? null : (
        <Card>
          <CardHeader>
            <CardTitle>Effective permissions</CardTitle>
            <p className="text-sm text-muted">
              Tier 2 RBAC — role grants with per-user overrides applied.
            </p>
          </CardHeader>
          <CardContent>
            {permissions.length === 0 ? (
              <p className="text-sm text-subtle">No permissions granted to this role.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {permissions.map((key) => (
                  <li
                    key={key}
                    className="num rounded-lg bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent"
                  >
                    {key}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {isStudent ? null : (
        <p className="text-xs text-subtle">
          Phase 0 foundation is in place — auth, role routing and permissions. Module screens land
          in Phase 1.
        </p>
      )}
    </div>
  )
}
