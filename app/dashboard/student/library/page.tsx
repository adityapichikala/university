import { prisma } from '@/lib/db'
import { requireUser, scopes } from '@/lib/rbac'
import { LIBRARY_ISSUE_SELECT } from '@/lib/library-query'
import { FINE_PER_DAY, computeFine, daysLate, issueState } from '@/lib/library'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { PayOnlineButton } from '@/components/dashboard/pay-online'
import { cn } from '@/lib/utils'

export const metadata = { title: 'My Library · Apex University ERP' }

/**
 * Student › My Library.
 *
 * Fines on a live loan are computed at render time, so the amount shown grows
 * day by day exactly as the desk would charge it — which is also why the pay
 * panel is careful to say the figure is still moving on an unreturned loan.
 */

const STATE_STYLES: Record<string, string> = {
  ACTIVE: 'bg-success-soft text-success',
  OVERDUE: 'bg-danger-soft text-danger',
  RETURNED: 'bg-slate-100 text-muted',
}

export default async function StudentLibraryPage() {
  const ctx = await requireUser({ route: 'student' })
  const now = new Date()

  const issues = await prisma.libraryIssue.findMany({
    where: { ...scopes.college(ctx), studentId: ctx.user.id },
    select: LIBRARY_ISSUE_SELECT,
    orderBy: [{ returnedAt: 'asc' }, { dueAt: 'asc' }],
  })

  const rows = issues.map((issue) => {
    const state = issueState({ returnedAt: issue.returnedAt, dueAt: issue.dueAt, now })
    return {
      ...issue,
      state,
      // A live loan is fined up to now; a returned one stopped on its return.
      runningFine: computeFine(issue.dueAt, issue.returnedAt ?? now),
      lateDays: daysLate(issue.dueAt, issue.returnedAt ?? now),
    }
  })

  const live = rows.filter((r) => r.state !== 'RETURNED')
  const overdue = live.filter((r) => r.state === 'OVERDUE')
  const finesOwed = rows.reduce((sum, r) => sum + r.runningFine, 0)

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">My Library</h1>
        <p className="mt-1 text-sm text-muted">
          Books on loan, due dates, and any fines accrued. Fines are charged at ₹5 per day.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-muted">Books on loan</p>
          <p className="num mt-1 text-3xl font-bold leading-none text-foreground">{live.length}</p>
          <p className="mt-1 text-[11px] text-subtle">not yet returned</p>
        </Card>

        <Card className="p-4">
          <p className="text-xs text-muted">Overdue</p>
          <p
            className={cn(
              'num mt-1 text-3xl font-bold leading-none',
              overdue.length > 0 ? 'text-danger' : 'text-foreground'
            )}
          >
            {overdue.length}
          </p>
          <p className="mt-1 text-[11px] text-subtle">
            {overdue.length > 0 ? 'Return these today' : 'Nothing late'}
          </p>
        </Card>

        <Card className="p-4">
          <p className="text-xs text-muted">Fines</p>
          <p
            className={cn(
              'num mt-1 text-3xl font-bold leading-none',
              finesOwed > 0 ? 'text-warning' : 'text-foreground'
            )}
          >
            ₹{finesOwed}
          </p>
          <p className="mt-1 text-[11px] text-subtle">across all loans</p>
        </Card>

        <Card className="p-4">
          <p className="text-xs text-muted">Returned</p>
          <p className="num mt-1 text-3xl font-bold leading-none text-foreground">
            {rows.length - live.length}
          </p>
          <p className="mt-1 text-[11px] text-subtle">in your history</p>
        </Card>
      </div>

      <div className="mt-6">
        {rows.length === 0 ? (
          <EmptyState
            icon="local_library"
            title="No books on loan"
            description="Books the librarian issues to you will show here with their due date and any fines."
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Loan history</CardTitle>
              <CardDescription>
                A live loan accrues a fine until the day it is handed back at the desk.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-border text-xs uppercase tracking-wide text-muted">
                      <th className="px-4 py-2.5 text-left font-medium">Book</th>
                      <th className="px-4 py-2.5 text-left font-medium">Issued</th>
                      <th className="px-4 py-2.5 text-left font-medium">Due</th>
                      <th className="px-4 py-2.5 text-left font-medium">Returned</th>
                      <th className="px-4 py-2.5 text-right font-medium">Fine</th>
                      <th className="px-4 py-2.5 text-center font-medium">State</th>
                      <th className="px-4 py-2.5 text-right font-medium">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-3">
                          <span className="font-medium text-foreground">{r.item.title}</span>
                          <p className="text-xs text-subtle">{r.item.author}</p>
                        </td>
                        <td className="num px-4 py-3 text-muted">
                          {r.issuedAt.toISOString().slice(0, 10)}
                        </td>
                        <td className="num px-4 py-3 text-muted">
                          {r.dueAt.toISOString().slice(0, 10)}
                        </td>
                        <td className="num px-4 py-3 text-muted">
                          {r.returnedAt ? r.returnedAt.toISOString().slice(0, 10) : '—'}
                        </td>
                        <td
                          className={cn(
                            'num px-4 py-3 text-right font-medium',
                            r.runningFine > 0 ? 'text-danger' : 'text-muted'
                          )}
                        >
                          {r.runningFine > 0 ? `₹${r.runningFine}` : '—'}
                          {r.lateDays > 0 ? (
                            <span className="ml-1 text-[11px] text-subtle">({r.lateDays}d)</span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={cn(
                              'num rounded-lg px-2 py-1 text-xs font-semibold',
                              STATE_STYLES[r.state] ?? 'bg-slate-100 text-muted'
                            )}
                          >
                            {r.state}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {/* Offered only where there is a fine to settle. A
                              loan still out keeps accruing, so the panel says
                              so rather than quoting a figure that will move. */}
                          {r.runningFine > 0 ? (
                            <PayOnlineButton
                              payable={{
                                title: r.item.title,
                                subtitle: r.item.author,
                                amountDisplay: `₹${r.runningFine}`,
                                reference: `LIB-${r.id.slice(-8).toUpperCase()}`,
                                overdue: r.lateDays > 0,
                                details: [
                                  { label: 'Due', value: r.dueAt.toISOString().slice(0, 10) },
                                  {
                                    label: 'Days late',
                                    value: `${r.lateDays}`,
                                    danger: r.lateDays > 0,
                                  },
                                  {
                                    label: 'Returned',
                                    value: r.returnedAt
                                      ? r.returnedAt.toISOString().slice(0, 10)
                                      : 'Not yet',
                                  },
                                  { label: 'Rate', value: `₹${FINE_PER_DAY} / day` },
                                ],
                                guidance:
                                  'pay at the library counter quoting the reference above. ' +
                                  (r.returnedAt
                                    ? 'The amount is final for this loan.'
                                    : 'This fine is still accruing daily until the book is returned, so the counter amount may be higher by the time you pay.'),
                              }}
                            />
                          ) : (
                            <span className="text-xs text-subtle">No fine</span>
                          )}
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
