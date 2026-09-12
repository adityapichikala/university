import Link from 'next/link'
import { prisma } from '@/lib/db'
import { requireUser, scopes } from '@/lib/rbac'
import { buildTranscript } from '@/lib/results'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { TranscriptPanel } from './TranscriptPanel'

export const metadata = { title: 'My Results · Apex University ERP' }

/**
 * Student › My Results.
 *
 * The publish gate lives in the query, not the UI: `publishedAt: { not: null }`.
 * An unpublished result simply is not in the result set, so there is no way to
 * render it by accident.
 */
export default async function StudentResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ sem?: string }>
}) {
  const ctx = await requireUser({ route: 'student' })
  const sp = await searchParams

  // The student's own section determines their semester, so the default filter
  // follows them as they progress rather than being pinned to a constant.
  const myClass = ctx.user.classId
    ? await prisma.class.findUnique({
        where: { id: ctx.user.classId },
        select: { semesterId: true, semester: true },
      })
    : null
  const mySemesterId = myClass?.semesterId ?? null

  // Only semesters this student actually has published results in are offered —
  // plus their own, so an empty semester still reads as "nothing yet" rather
  // than vanishing from the selector.
  const semesters = await prisma.semester.findMany({
    where: {
      collegeId: ctx.user.collegeId ?? undefined,
      OR: [
        { exams: { some: { results: { some: { studentId: ctx.user.id, publishedAt: { not: null } } } } } },
        ...(mySemesterId ? [{ id: mySemesterId }] : []),
      ],
    },
    select: { id: true, number: true, name: true, isCurrent: true },
    orderBy: { number: 'asc' },
  })

  const requested = sp.sem && semesters.some((s) => s.id === sp.sem) ? sp.sem : null
  const selectedSemesterId =
    requested ??
    (semesters.some((s) => s.id === mySemesterId) ? mySemesterId : null) ??
    semesters[semesters.length - 1]?.id ??
    null

  const results = await prisma.examResult.findMany({
    where: {
      ...scopes.college(ctx),
      studentId: ctx.user.id,
      publishedAt: { not: null },
      ...(selectedSemesterId ? { exam: { semesterId: selectedSemesterId } } : {}),
    },
    select: {
      id: true,
      marksObtained: true,
      grade: true,
      publishedAt: true,
      exam: {
        select: {
          id: true,
          examType: true,
          examDate: true,
          maxMarks: true,
          semesterId: true,
          course: { select: { code: true, name: true } },
        },
      },
    },
    orderBy: { exam: { examDate: 'desc' } },
  })

  // Same source of truth as GET /api/results/summary — the page and the API
  // cannot drift apart on what a CGPA means.
  const transcript = await buildTranscript(prisma, ctx.user.id, ctx.user.collegeId)

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">My Results</h1>
        <p className="mt-1 text-sm text-muted">
          Only results your teacher has published appear here, and only published results feed
          your CGPA.
        </p>
      </div>

      {transcript ? <TranscriptPanel transcript={transcript} /> : null}

      {/* Semester switcher. Links, not client state — the filter is shareable
          and survives a refresh. */}
      {semesters.length > 0 ? (
        <div className="mt-6">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-heading text-sm font-semibold text-foreground">Semester</h2>
            {myClass ? (
              <p className="text-xs text-subtle">
                You are in <span className="num">Semester {myClass.semester}</span>
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {semesters.map((s) => {
              const active = s.id === selectedSemesterId
              return (
                <Link
                  key={s.id}
                  href={`/dashboard/student/results?sem=${s.id}`}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                    active
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-border bg-surface text-muted hover:border-border-strong hover:text-foreground'
                  )}
                >
                  {s.name}
                  {s.isCurrent ? <span className="ml-1.5 text-subtle">· current</span> : null}
                </Link>
              )
            })}
            {selectedSemesterId ? (
              <Link
                href="/dashboard/student/results"
                className="rounded-lg px-2 py-1.5 text-xs text-muted underline-offset-2 hover:text-accent hover:underline"
              >
                All
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mt-6">
        <h2 className="mb-3 font-heading text-sm font-semibold text-foreground">
          Exam-by-exam
          {selectedSemesterId
            ? ` · ${semesters.find((s) => s.id === selectedSemesterId)?.name ?? ''}`
            : ''}
        </h2>
        {results.length === 0 ? (
          <Card>
            <CardContent className="py-14 text-center">
              <span className="material-symbols-outlined text-4xl text-subtle">military_tech</span>
              <p className="mt-3 text-sm text-muted">
                No published results yet. Results appear once your teacher publishes them.
              </p>
            </CardContent>
          </Card>
        ) : (
        <Card>
          <CardHeader>
            <CardTitle>Published results</CardTitle>
            <CardDescription>
              <span className="num">{results.length}</span> result(s)
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-border text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-2.5 text-left font-medium">Course</th>
                    <th className="px-4 py-2.5 text-left font-medium">Exam</th>
                    <th className="px-4 py-2.5 text-left font-medium">Date</th>
                    <th className="px-4 py-2.5 text-right font-medium">Marks</th>
                    <th className="px-4 py-2.5 text-right font-medium">Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3">
                        <span className="num font-medium text-foreground">
                          {r.exam.course.code}
                        </span>
                        <span className="ml-2 text-muted">{r.exam.course.name}</span>
                      </td>
                      <td className="px-4 py-3 text-muted">
                        {r.exam.examType.charAt(0) + r.exam.examType.slice(1).toLowerCase()}
                      </td>
                      <td className="num px-4 py-3 text-muted">
                        {r.exam.examDate.toISOString().slice(0, 10)}
                      </td>
                      <td className="num px-4 py-3 text-right text-foreground">
                        {r.marksObtained}
                        <span className="text-subtle"> / {r.exam.maxMarks}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="num rounded-lg bg-accent-soft px-2 py-1 text-xs font-semibold text-accent">
                          {r.grade}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
        )}
      </div>
    </div>
  )
}
