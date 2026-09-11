import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { Transcript } from '@/lib/results'
import { cn } from '@/lib/utils'

/**
 * The credit-weighted half of "My Results".
 *
 * Deliberately states that a course's exams are averaged: the schema has no
 * exam weightings, and quietly inventing a policy would be worse than showing
 * the real one.
 */

export function TranscriptPanel({ transcript }: { transcript: Transcript }) {
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
          <p className="mt-1 text-[11px] text-subtle">out of 10</p>
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
            from {transcript.publishedResultCount} published result
            {transcript.publishedResultCount === 1 ? '' : 's'}
          </p>
        </Card>
      </div>

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
