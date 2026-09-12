import * as React from 'react'
import { prisma } from '@/lib/db'
import { requireUser, scopes } from '@/lib/rbac'
import { feeStatusFor, formatCurrency, summarizeFees } from '@/lib/fees'
import { FEE_RECORD_SELECT } from '@/lib/fees-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { PayOnlineButton } from '@/components/dashboard/pay-online'
import { cn } from '@/lib/utils'

export const metadata = { title: 'My Fees · Apex University ERP' }

/**
 * Student › My Fees.
 *
 * The ledger is read-only — a payment is a finance-officer action, and the
 * screen never claims otherwise. "Pay online" opens an explanation rather than
 * a checkout, because the gateway is not live yet and a control that silently
 * does nothing is worse than one that says so.
 */

const STATUS_STYLES: Record<string, string> = {
  PAID: 'bg-success-soft text-success',
  PARTIAL: 'bg-warning-soft text-warning',
  PENDING: 'bg-slate-100 text-muted',
  OVERDUE: 'bg-danger-soft text-danger',
  WAIVED: 'bg-accent-soft text-accent',
}

export default async function StudentFeesPage() {
  const ctx = await requireUser({ route: 'student' })

  const records = await prisma.feeRecord.findMany({
    where: { ...scopes.college(ctx), studentId: ctx.user.id },
    select: FEE_RECORD_SELECT,
    orderBy: { feeStructure: { dueDate: 'asc' } },
  })

  // Status is recomputed at render time so a record that slid past its due
  // date overnight shows OVERDUE without anyone having to run a batch job.
  const rows = records.map((r) => {
    const status = feeStatusFor({
      amountDue: r.feeStructure.amount,
      amountPaid: r.amountPaid,
      dueDate: r.feeStructure.dueDate,
      waived: Boolean(r.waiverReason),
    })
    return {
      ...r,
      status,
      outstanding: Math.max(0, r.feeStructure.amount - r.amountPaid),
    }
  })

  const summary = summarizeFees(
    records.map((r) => ({
      amountDue: r.feeStructure.amount,
      amountPaid: r.amountPaid,
      status: r.status,
      dueDate: r.feeStructure.dueDate,
      waived: Boolean(r.waiverReason),
    }))
  )

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">My Fees</h1>
        <p className="mt-1 text-sm text-muted">
          Every installment recorded against your account. Outstanding balances update as the
          finance office posts payments.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-muted">Total billed</p>
          <p className="num mt-1 text-2xl font-bold leading-none text-foreground">
            {formatCurrency(summary.billed)}
          </p>
          <p className="mt-1 text-[11px] text-subtle">
            {summary.count} fee record{summary.count === 1 ? '' : 's'}
          </p>
        </Card>

        <Card className="p-4">
          <p className="text-xs text-muted">Paid</p>
          <p className="num mt-1 text-2xl font-bold leading-none text-success">
            {formatCurrency(summary.paid)}
          </p>
          <p className="mt-1 text-[11px] text-subtle">
            {summary.billed > 0 ? Math.round((summary.paid / summary.billed) * 100) : 0}% of billed
          </p>
        </Card>

        <Card className="p-4">
          <p className="text-xs text-muted">Outstanding</p>
          <p className="num mt-1 text-2xl font-bold leading-none text-accent">
            {formatCurrency(summary.outstanding)}
          </p>
          <p className="mt-1 text-[11px] text-subtle">
            {summary.openCount} open record{summary.openCount === 1 ? '' : 's'}
          </p>
        </Card>

        <Card className="p-4">
          <p className="text-xs text-muted">Overdue</p>
          <p
            className={cn(
              'num mt-1 text-2xl font-bold leading-none',
              summary.overdueCount > 0 ? 'text-danger' : 'text-foreground'
            )}
          >
            {summary.overdueCount}
          </p>
          <p className="mt-1 text-[11px] text-subtle">
            {summary.overdueCount > 0 ? 'Past the due date' : 'Nothing past due'}
          </p>
        </Card>
      </div>

      <div className="mt-6">
        {rows.length === 0 ? (
          <EmptyState
            icon="receipt_long"
            title="No fees on your account"
            description="When the finance office assigns a fee structure to you, it will appear here with its due date."
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Fee records</CardTitle>
              <CardDescription>
                Status is derived from what you have paid against what was billed — not stored.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-border text-xs uppercase tracking-wide text-muted">
                      <th className="px-4 py-2.5 text-left font-medium">Fee</th>
                      <th className="px-4 py-2.5 text-left font-medium">Due</th>
                      <th className="px-4 py-2.5 text-right font-medium">Billed</th>
                      <th className="px-4 py-2.5 text-right font-medium">Paid</th>
                      <th className="px-4 py-2.5 text-right font-medium">Balance</th>
                      <th className="px-4 py-2.5 text-center font-medium">Status</th>
                      <th className="px-4 py-2.5 text-right font-medium">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <React.Fragment key={r.id}>
                        <tr className="border-b border-border last:border-0">
                          <td className="px-4 py-3">
                            <span className="font-medium text-foreground">
                              {r.feeStructure.programName}
                            </span>
                            <span className="num ml-2 text-xs text-subtle">
                              {r.feeStructure.batchYear}
                            </span>
                            {r.waiverReason ? (
                              <p className="mt-0.5 text-[11px] text-accent">{r.waiverReason}</p>
                            ) : null}
                          </td>
                          <td className="num px-4 py-3 text-muted">
                            {r.feeStructure.dueDate.toISOString().slice(0, 10)}
                          </td>
                          <td className="num px-4 py-3 text-right text-muted">
                            {formatCurrency(r.feeStructure.amount)}
                          </td>
                          <td className="num px-4 py-3 text-right text-foreground">
                            {formatCurrency(r.amountPaid)}
                          </td>
                          <td className="num px-4 py-3 text-right font-medium text-foreground">
                            {formatCurrency(r.outstanding)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span
                              className={cn(
                                'num rounded-lg px-2 py-1 text-xs font-semibold',
                                STATUS_STYLES[r.status] ?? 'bg-slate-100 text-muted'
                              )}
                            >
                              {r.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {/* Only offered when there is something left to pay —
                                a fully settled record has no payment to make. */}
                            {r.outstanding > 0 ? (
                              <PayOnlineButton
                                payable={{
                                  title: r.feeStructure.programName,
                                  subtitle: String(r.feeStructure.batchYear),
                                  amountDisplay: formatCurrency(r.outstanding),
                                  reference: `FEE-${r.id.slice(-8).toUpperCase()}`,
                                  overdue: r.status === 'OVERDUE',
                                  details: [
                                    {
                                      label: 'Due',
                                      value: r.feeStructure.dueDate.toISOString().slice(0, 10),
                                      danger: r.status === 'OVERDUE',
                                    },
                                    { label: 'Billed', value: formatCurrency(r.feeStructure.amount) },
                                    { label: 'Already paid', value: formatCurrency(r.amountPaid) },
                                    { label: 'Status', value: r.status },
                                  ],
                                }}
                              />
                            ) : (
                              <span className="text-xs text-subtle">Settled</span>
                            )}
                          </td>
                        </tr>
                        {r.payments.length > 0 ? (
                          <tr className="border-b border-border last:border-0 bg-background">
                            <td colSpan={7} className="px-4 py-2">
                              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-subtle">
                                Installments
                              </p>
                              <ul className="flex flex-wrap gap-x-5 gap-y-1">
                                {r.payments.map((p) => (
                                  <li key={p.id} className="num text-xs text-muted">
                                    {p.paidAt.toISOString().slice(0, 10)}{' '}
                                    <span className="font-semibold text-foreground">
                                      {formatCurrency(p.amount)}
                                    </span>{' '}
                                    <span className="text-subtle">{p.method}</span>
                                    {p.transactionRef ? (
                                      <span className="text-subtle"> · {p.transactionRef}</span>
                                    ) : null}
                                  </li>
                                ))}
                              </ul>
                            </td>
                          </tr>
                        ) : null}
                      </React.Fragment>
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
