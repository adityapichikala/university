import Link from 'next/link'
import { prisma } from '@/lib/db'
import { requirePermission } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import { CREDITED_STATUSES } from '@/lib/academics'
import { gradeFromPercentage } from '@/lib/academics'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { KpiCard } from '@/components/dashboard/kpi-card'
import { cn } from '@/lib/utils'

export const metadata = { title: 'My Child · Apex University ERP' }

/**
 * Parent portal (Phase 4, doc §7) — strictly read-only.
 *
 * The critical rule here is Tier 3: a parent may only read children linked to
 * them by a `ParentChild` row. The `?child=` parameter is matched *against
 * that link list*, never used directly in a query, so guessing another
 * student's id returns nothing. Parents also only see results whose
 * `publishedAt` is set — an unpublished score is invisible to them even if
 * they are linked to the student.
 */
export default async function ParentPage({
  searchParams,
}: {
  searchParams: Promise<{ child?: string }>
}) {
  const ctx = await requirePermission(PERMISSIONS.PARENT_VIEW_CHILD, { route: 'parent' })
  const params = await searchParams

  // Only ever these ids — this list *is* the access control.
  const links = await prisma.parentChild.findMany({
    where: { parentId: ctx.user.id },
    select: {
      relation: true,
      student: {
        select: {
          id: true,
          name: true,
          regno: true,
          department: { select: { name: true } },
        },
      },
    },
    orderBy: { student: { regno: 'asc' } },
  })

  if (links.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">My Child</h1>
        <Card className="mt-6">
          <CardContent className="py-6">
            <EmptyState
              icon="family_restroom"
              title="No child linked yet"
              description="Ask the registrar to link your account to your child's student record. Until then there is nothing to show here."
            />
          </CardContent>
        </Card>
      </div>
    )
  }

  const requested = params.child
  const active =
    links.find((l) => l.student.id === requested)?.student ?? links[0].student
  const activeLink = links.find((l) => l.student.id === active.id)
  const studentId = active.id

  const [attendance, results, feeRecords] = await Promise.all([
    prisma.attendance.findMany({
      where: { studentId },
      select: { status: true, courseId: true, course: { select: { code: true, name: true } } },
      take: 5000,
    }),
    prisma.examResult.findMany({
      where: { studentId, publishedAt: { not: null } },
      select: {
        id: true,
        marksObtained: true,
        grade: true,
        publishedAt: true,
        exam: {
          select: {
            maxMarks: true,
            examType: true,
            examDate: true,
            course: { select: { code: true, name: true } },
          },
        },
      },
      orderBy: { publishedAt: 'desc' },
      take: 100,
    }),
    prisma.feeRecord.findMany({
      where: { studentId },
      select: {
        id: true,
        amountPaid: true,
        status: true,
        feeStructure: { select: { amount: true, programName: true, dueDate: true } },
      },
      orderBy: { feeStructure: { dueDate: 'desc' } },
      take: 20,
    }),
  ])

  /* ── Attendance ─────────────────────────────────────────────────────────── */
  const credited = attendance.filter((a) =>
    (CREDITED_STATUSES as readonly string[]).includes(a.status)
  ).length
  const attendancePercent =
    attendance.length === 0 ? 0 : Math.round((credited / attendance.length) * 100)

  const byCourse = new Map<string, { code: string; name: string; total: number; present: number }>()
  for (const a of attendance) {
    const entry = byCourse.get(a.courseId) ?? {
      code: a.course.code,
      name: a.course.name,
      total: 0,
      present: 0,
    }
    entry.total += 1
    if ((CREDITED_STATUSES as readonly string[]).includes(a.status)) entry.present += 1
    byCourse.set(a.courseId, entry)
  }
  const courseAttendance = Array.from(byCourse.values())
    .map((c) => ({
      ...c,
      percent: c.total === 0 ? 0 : Math.round((c.present / c.total) * 100),
    }))
    .sort((a, b) => a.percent - b.percent)

  /* ── Results ────────────────────────────────────────────────────────────── */
  const graded = results.filter((r) => r.exam.maxMarks > 0)
  const averagePercent =
    graded.length === 0
      ? 0
      : Math.round(
          (graded.reduce((sum, r) => sum + (r.marksObtained / r.exam.maxMarks) * 100, 0) /
            graded.length) *
            10
        ) / 10

  /* ── Fees ───────────────────────────────────────────────────────────────── */
  const totalDue = feeRecords.reduce((sum, f) => sum + f.feeStructure.amount, 0)
  const totalPaid = feeRecords.reduce((sum, f) => sum + f.amountPaid, 0)
  const outstanding = Math.max(0, Math.round((totalDue - totalPaid) * 100) / 100)

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">My Child</h1>
        <p className="mt-1 text-sm text-muted">
          Attendance, published results and fee status. This view is read-only — for corrections,
          contact the department office.
        </p>
      </div>

      {/* ── Child switcher ────────────────────────────────────────────────── */}
      {links.length > 1 ? (
        <div className="mb-6 flex flex-wrap gap-2">
          {links.map((l) => (
            <Link
              key={l.student.id}
              href={`/dashboard/parent?child=${l.student.id}`}
              className={cn(
                'rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors',
                l.student.id === active.id
                  ? 'border-accent bg-accent text-white'
                  : 'border-border-strong bg-surface text-muted hover:border-accent hover:text-accent'
              )}
            >
              {l.student.name}
              <span className="num ml-1.5 opacity-70">{l.student.regno}</span>
            </Link>
          ))}
        </div>
      ) : null}

      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-5">
          <div>
            <p className="font-heading text-lg font-bold text-primary">{active.name}</p>
            <p className="num text-xs text-subtle">
              {active.regno} · {active.department?.name ?? 'No department'}
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-[10px] uppercase tracking-wider text-subtle">
              Relationship
            </p>
            <p className="text-sm font-medium text-foreground">
              {activeLink?.relation ?? 'GUARDIAN'}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── KPI bento ─────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon="fact_check"
          label="Attendance"
          value={`${attendancePercent}%`}
          hint={`${credited} of ${attendance.length} sessions`}
          tone={
            attendancePercent >= 75 ? 'success' : attendancePercent > 0 ? 'warning' : 'default'
          }
        />
        <KpiCard
          icon="military_tech"
          label="Average"
          value={`${averagePercent}%`}
          hint={`${graded.length} published results`}
        />
        <KpiCard
          icon="payments"
          label="Outstanding"
          value={outstanding === 0 ? 'Nil' : outstanding.toLocaleString()}
          hint={outstanding === 0 ? 'all fees cleared' : 'due to the college'}
          tone={outstanding > 0 ? 'warning' : 'success'}
        />
        <KpiCard
          icon="event_available"
          label="Sessions"
          value={attendance.length}
          hint="recorded to date"
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {/* ── Attendance by course ────────────────────────────────────────── */}
        <Card id="attendance" className="scroll-mt-24">
          <CardHeader>
            <CardTitle>Attendance by course</CardTitle>
            <CardDescription>Lowest first — below 75% needs attention</CardDescription>
          </CardHeader>
          <CardContent>
            {courseAttendance.length === 0 ? (
              <EmptyState
                icon="fact_check"
                title="No attendance recorded"
                description="Attendance appears here once teachers start taking it."
              />
            ) : (
              <ul className="space-y-3">
                {courseAttendance.map((c) => (
                  <li key={c.code}>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="min-w-0 truncate font-medium text-foreground">
                        <span className="num text-accent">{c.code}</span> {c.name}
                      </span>
                      <span
                        className={cn(
                          'num shrink-0 font-semibold',
                          c.percent >= 75 ? 'text-success' : 'text-warning'
                        )}
                      >
                        {c.percent}%
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-border">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          c.percent >= 75 ? 'bg-success' : 'bg-warning'
                        )}
                        style={{ width: `${Math.max(2, c.percent)}%` }}
                      />
                    </div>
                    <p className="num mt-1 text-[10px] text-subtle">
                      {c.present}/{c.total} sessions
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ── Published results ───────────────────────────────────────────── */}
        <Card id="results" className="scroll-mt-24">
          <CardHeader>
            <CardTitle>Published results</CardTitle>
            <CardDescription>
              Only results the college has published are shown here
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {graded.length === 0 ? (
              <div className="px-6">
                <EmptyState
                  icon="military_tech"
                  title="No published results"
                  description="Results appear here once the college publishes them."
                />
              </div>
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {graded.slice(0, 12).map((r) => {
                  const percent = Math.round((r.marksObtained / r.exam.maxMarks) * 100)
                  const grade = r.grade || gradeFromPercentage(percent)
                  return (
                    <li key={r.id} className="flex items-center justify-between gap-3 px-6 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">
                          <span className="num text-accent">{r.exam.course.code}</span>{' '}
                          {r.exam.course.name}
                        </p>
                        <p className="num text-[11px] text-subtle">
                          {r.exam.examType} · {r.exam.examDate.toISOString().slice(0, 10)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="num text-sm font-semibold text-foreground">{percent}%</p>
                        <p className="num text-[10px] text-subtle">{grade}</p>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Fees ──────────────────────────────────────────────────────────── */}
      <Card className="mt-4" id="fees">
        <CardHeader>
          <CardTitle>Fee status</CardTitle>
          <CardDescription>
            Paid <span className="num">{totalPaid.toLocaleString()}</span> of{' '}
            <span className="num">{totalDue.toLocaleString()}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {feeRecords.length === 0 ? (
            <div className="px-6">
              <EmptyState
                icon="payments"
                title="No fee records"
                description="Fee records appear once the finance office raises them."
              />
            </div>
          ) : (
            <div className="overflow-x-auto border-t border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-background text-[11px] uppercase tracking-wider text-subtle">
                  <tr>
                    <th className="px-6 py-2.5 font-medium">Programme</th>
                    <th className="px-3 py-2.5 font-medium">Due</th>
                    <th className="px-3 py-2.5 text-right font-medium">Amount</th>
                    <th className="px-3 py-2.5 text-right font-medium">Paid</th>
                    <th className="px-6 py-2.5 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {feeRecords.map((f) => (
                    <tr key={f.id} className="transition-colors hover:bg-background">
                      <td className="px-6 py-3 text-foreground">{f.feeStructure.programName}</td>
                      <td className="num px-3 py-3 text-muted">
                        {f.feeStructure.dueDate.toISOString().slice(0, 10)}
                      </td>
                      <td className="num px-3 py-3 text-right text-foreground">
                        {f.feeStructure.amount.toLocaleString()}
                      </td>
                      <td className="num px-3 py-3 text-right text-foreground">
                        {f.amountPaid.toLocaleString()}
                      </td>
                      <td className="px-6 py-3 text-right">
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider',
                            f.status === 'PAID'
                              ? 'bg-success-soft text-success'
                              : f.status === 'PENDING'
                                ? 'bg-warning-soft text-warning'
                                : 'bg-background text-muted'
                          )}
                        >
                          {f.status}
                        </span>
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
