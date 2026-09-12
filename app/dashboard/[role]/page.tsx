import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/rbac'
import { ROLE_LABEL, SLUG_ROLE } from '@/lib/roles'
import { weekdayLabel, timeRange } from '@/lib/timetable'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Role landing route: /dashboard/<slug>
 *
 * Phase 0 placeholder — it exists so login auto-redirect and the role-route
 * guard have somewhere to land and can actually be tested. Real feature
 * dashboards are Phase 1+.
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
  const permissions = Array.from(ctx.permissions).sort()

  // Students get a glanceable "what's on today" strip. It is deliberately a
  // preview (max three entries) — the full week lives on the timetable page.
  const today = new Date()
  const todaySlots =
    role === 'STUDENT' && ctx.user.classId
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

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">
          Welcome back, {firstName}
        </h1>
        <p className="mt-1 text-sm text-muted">
          Signed in as <span className="num text-foreground">{ctx.user.regno}</span> ·{' '}
          {ROLE_LABEL[role]}
        </p>
      </div>

      {role === 'STUDENT' ? (
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
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Role', value: ROLE_LABEL[role] },
          { label: 'Status', value: ctx.user.status },
          { label: 'Permissions', value: String(permissions.length) },
        ].map((stat) => (
          <Card key={stat.label} className="p-5">
            <p className="font-mono text-[10px] uppercase tracking-wider text-subtle">
              {stat.label}
            </p>
            <p className="num mt-2 text-xl font-semibold text-foreground">{stat.value}</p>
          </Card>
        ))}
      </div>

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

      <p className="text-xs text-subtle">
        Phase 0 foundation is in place — auth, role routing and permissions. Module screens land in
        Phase 1.
      </p>
    </div>
  )
}
