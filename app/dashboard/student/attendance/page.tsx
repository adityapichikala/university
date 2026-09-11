import { prisma } from '@/lib/db'
import { requireUser, scopes } from '@/lib/rbac'
import { CREDITED_STATUSES, type AttendanceStatus } from '@/lib/academics'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { sectionUnlocked } from '@/lib/permissions'

export const metadata = { title: 'My Attendance · Apex University ERP' }

/**
 * Student › My Attendance.
 * No permission needed — Tier 3 scopes.own() restricts the query to this
 * student's own rows, so there is nothing else to see even if they try.
 * Section locks apply too: a course revoked for their class disappears here.
 */
export default async function StudentAttendancePage() {
  const ctx = await requireUser({ route: 'student' })

  const enrollment = await prisma.courseEnrollment.findFirst({
    where: { studentId: ctx.user.id },
    select: { classId: true },
  })

  const rows = await prisma.attendance.findMany({
    where: {
      ...scopes.college(ctx),
      ...scopes.own(ctx),
      course: { ...sectionUnlocked(enrollment?.classId) },
    },
    select: { id: true, courseId: true, status: true, course: { select: { code: true, name: true } } },
  })

  type Summary = { code: string; name: string; total: number; credited: number }
  const byCourse = new Map<string, Summary>()
  for (const row of rows) {
    const entry =
      byCourse.get(row.courseId) ??
      (() => {
        const fresh: Summary = {
          code: row.course.code,
          name: row.course.name,
          total: 0,
          credited: 0,
        }
        byCourse.set(row.courseId, fresh)
        return fresh
      })()
    entry.total += 1
    if (CREDITED_STATUSES.includes(row.status as AttendanceStatus)) entry.credited += 1
  }

  const summaries = [...byCourse.values()].sort((a, b) => a.code.localeCompare(b.code))
  const overallTotal = summaries.reduce((s, c) => s + c.total, 0)
  const overallCredited = summaries.reduce((s, c) => s + c.credited, 0)
  const overallPct = overallTotal ? Math.round((overallCredited / overallTotal) * 100) : 0

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">
          My Attendance
        </h1>
        <p className="mt-1 text-sm text-muted">
          Present and late sessions count toward your percentage.
        </p>
      </div>

      {summaries.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center">
            <span className="material-symbols-outlined text-4xl text-subtle">fact_check</span>
            <p className="mt-3 text-sm text-muted">No attendance has been recorded for you yet.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="mb-5">
            <CardContent className="flex flex-wrap items-center gap-6 p-6">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted">
                  Overall attendance
                </p>
                <p className="num mt-1 text-3xl font-bold text-foreground">{overallPct}%</p>
              </div>
              <div className="h-12 w-px bg-border" />
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted">
                  Sessions attended
                </p>
                <p className="num mt-1 text-xl font-semibold text-foreground">
                  {overallCredited}
                  <span className="text-muted"> / {overallTotal}</span>
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            {summaries.map((c) => {
              const pct = Math.round((c.credited / c.total) * 100)
              return (
                <Card key={c.code}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <span className="num rounded-lg bg-accent-soft px-2 py-1 text-xs font-semibold text-accent">
                        {c.code}
                      </span>
                      <span
                        className={
                          pct >= 75 ? 'num text-sm font-semibold text-success' : 'num text-sm font-semibold text-danger'
                        }
                      >
                        {pct}%
                      </span>
                    </div>
                    <CardTitle className="mt-2">{c.name}</CardTitle>
                    <CardDescription>
                      <span className="num">{c.credited}</span> of <span className="num">{c.total}</span>{' '}
                      sessions
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-background">
                      <div
                        className={pct >= 75 ? 'h-full rounded-full bg-success' : 'h-full rounded-full bg-danger'}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
