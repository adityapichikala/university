import { prisma } from '@/lib/db'
import { requireUser, scopes } from '@/lib/rbac'
import { buildTranscript } from '@/lib/results'
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
export default async function StudentResultsPage() {
  const ctx = await requireUser({ route: 'student' })

  const results = await prisma.examResult.findMany({
    where: {
      ...scopes.college(ctx),
      studentId: ctx.user.id,
      publishedAt: { not: null },
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

      <div className="mt-6">
        <h2 className="mb-3 font-heading text-sm font-semibold text-foreground">
          Exam-by-exam
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
