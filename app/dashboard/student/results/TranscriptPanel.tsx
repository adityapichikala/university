import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { Transcript } from '@/lib/results'
import { cn } from '@/lib/utils'

/**
 * The credit-weighted half of "My Results".
 *
 * Two credit-weighted views, both from the same numbers:
 *   • a semester-wise GPA table (the "SGPA" per semester), and
 *   • the overall CGPA, which is the credit-weighted mean of those semesters.
 *
 * Deliberately states that a course's exams are averaged: the schema has no
 * exam weightings, and quietly inventing a policy would be worse than showing
 * the real one.
 */

export function TranscriptPanel({
  transcript,
  highlightSemesterId,
}: {
  transcript: Transcript
  /** The semester currently selected in the page's filter, if any. */
  highlightSemesterId?: string | null
}) {
  if (transcript.courses.length === 0) {
    return null
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-muted">CGPA</p>
          <p className="num mt-1 text-3xl font-bold leading-none text-accent">
            {transcript.cgpaDisplay}
          </p>
          <p className="mt-1 text-[11px] text-subtle">out of 10 · credit-weighted</p>
        </Card>

        <Card className="p-4">
          <p className="text-xs text-muted">Credits earned</p>
          <p className="num mt-1 text-3xl font-bold leading-none text-foreground">
            {transcript.earnedCredits}
            <span className="text-base font-normal text-muted">/{transcript.attemptedCredits}</span>
          </p>
          <p className="mt-1 text-[11px] text-subtle">earned / attempted</p>
        </Card>

        <Card className="p-4">
          <p className="text-xs text-muted">Weighted points</p>
          <p className="num mt-1 text-3xl font-bold leading-none text-foreground">
            {transcript.weightedPoints}
          </p>
          <p className="mt-1 text-[11px] text-subtle">Σ credits × grade points</p>
        </Card>

        <Card className="p-4">
          <p className="text-xs text-muted">Courses graded</p>
          <p className="num mt-1 text-3xl font-bold leading-none text-foreground">
            {transcript.courses.length}
          </p>
          <p className="mt-1 text-[11px] text-subtle">
            across {transcript.semesters.length} semester
            {transcript.semesters.length === 1 ? '' : 's'}
          </p>
        </Card>
      </div>

      {/* ── Semester-wise GPA ───────────────────────────────────────────────
          Shown only when results actually span more than one semester — a
          single-row table would just repeat the CGPA card above it. */}
      {transcript.semesters.length > 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>Semester-wise GPA</CardTitle>
            <CardDescription>
              Each semester&rsquo;s GPA is credit-weighted on its own. The CGPA above is the
              credit-weighted mean of these rows, so heavier semesters move it further.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-border text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-2.5 text-left font-medium">Semester</th>
                    <th className="px-4 py-2.5 text-right font-medium">Courses</th>
                    <th className="px-4 py-2.5 text-right font-medium">Credits</th>
                    <th className="px-4 py-2.5 text-right font-medium">Earned</th>
                    <th className="px-4 py-2.5 text-right font-medium">Points</th>
                    <th className="px-4 py-2.5 text-right font-medium">GPA</th>
                  </tr>
                </thead>
                <tbody>
                  {transcript.semesters.map((s) => {
                    const active = Boolean(highlightSemesterId) && s.semesterId === highlightSemesterId
                    return (
                      <tr
                        key={s.semesterId ?? 'unassigned'}
                        className={cn(
                          'border-b border-border last:border-0',
                          active && 'bg-accent-soft/40'
                        )}
                      >
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              'font-medium',
                              active ? 'text-accent' : 'text-foreground'
                            )}
                          >
                            {s.semesterName}
                          </span>
                          {active ? (
                            <span className="ml-2 text-[11px] text-accent">· selected</span>
                          ) : null}
                        </td>
                        <td className="num px-4 py-3 text-right text-muted">{s.courseCount}</td>
                        <td className="num px-4 py-3 text-right text-muted">
                          {s.attemptedCredits}
                        </td>
                        <td className="num px-4 py-3 text-right text-muted">{s.earnedCredits}</td>
                        <td className="num px-4 py-3 text-right text-muted">
                          {s.weightedPoints.toFixed(1)}
                        </td>
                        <td className="num px-4 py-3 text-right font-semibold text-foreground">
                          {s.gpaDisplay}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border-strong bg-background">
                    <td className="px-4 py-3 text-xs font-medium text-muted">Overall</td>
                    <td className="num px-4 py-3 text-right font-medium text-foreground">
                      {transcript.courses.length}
                    </td>
                    <td className="num px-4 py-3 text-right font-medium text-foreground">
                      {transcript.attemptedCredits}
                    </td>
                    <td className="num px-4 py-3 text-right font-medium text-foreground">
                      {transcript.earnedCredits}
                    </td>
                    <td className="num px-4 py-3 text-right font-medium text-foreground">
                      {transcript.weightedPoints.toFixed(1)}
                    </td>
                    <td className="num px-4 py-3 text-right font-semibold text-accent">
                      {transcript.cgpaDisplay}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Course breakdown</CardTitle>
          <CardDescription>
            Where a course has more than one published exam, the percentages are averaged before
            the letter is assigned — the schema carries no exam weightings.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-border text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5 text-left font-medium">Course</th>
                  <th className="px-4 py-2.5 text-right font-medium">Credits</th>
                  <th className="px-4 py-2.5 text-right font-medium">Avg %</th>
                  <th className="px-4 py-2.5 text-center font-medium">Grade</th>
                  <th className="px-4 py-2.5 text-right font-medium">Points</th>
                  <th className="px-4 py-2.5 text-right font-medium">Weighted</th>
                </tr>
              </thead>
              <tbody>
                {transcript.courses.map((c) => (
                  <tr key={c.courseId} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <span className="num font-medium text-foreground">{c.courseCode}</span>
                      <span className="ml-2 text-muted">{c.courseName}</span>
                      {c.examCount > 1 ? (
                        <span className="num ml-2 text-[11px] text-subtle">
                          ({c.examCount} exams)
                        </span>
                      ) : null}
                    </td>
                    <td className="num px-4 py-3 text-right text-muted">{c.credits}</td>
                    <td className="num px-4 py-3 text-right text-foreground">
                      {c.averagePercentage.toFixed(1)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={cn(
                          'num rounded-lg px-2 py-1 text-xs font-semibold',
                          c.passing ? 'bg-accent-soft text-accent' : 'bg-danger-soft text-danger'
                        )}
                      >
                        {c.letter}
                      </span>
                    </td>
                    <td className="num px-4 py-3 text-right text-foreground">{c.gradePoint}</td>
                    <td className="num px-4 py-3 text-right text-muted">{c.weighted.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border-strong bg-background">
                  <td className="px-4 py-3 text-xs font-medium text-muted">Total</td>
                  <td className="num px-4 py-3 text-right font-medium text-foreground">
                    {transcript.attemptedCredits}
                  </td>
                  <td />
                  <td />
                  <td />
                  <td className="num px-4 py-3 text-right font-semibold text-foreground">
                    {transcript.weightedPoints.toFixed(1)}
                  </td>
                </tr>
                <tr className="bg-background">
                  <td className="px-4 pb-3 text-xs font-medium text-muted">CGPA</td>
                  <td colSpan={5} className="num px-4 pb-3 text-right font-semibold text-accent">
                    {transcript.weightedPoints.toFixed(1)} ÷ {transcript.attemptedCredits} ={' '}
                    {transcript.cgpaDisplay}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
