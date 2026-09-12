'use client'

import * as React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState, Spinner } from '@/components/ui/states'
import { useApiMutation } from '@/components/dashboard/use-api-mutation'
import { cn } from '@/lib/utils'

/**
 * The interactive half of the Finance portal.
 *
 * Three jobs: create fee structures, bill a student against one, and post
 * installments. Each is a plain form against the guarded REST route.
 */

export interface FinanceRecord {
  id: string
  studentId: string
  studentName: string
  studentRegno: string
  structureId: string
  structureName: string
  dueDate: string
  amountDue: number
  amountPaid: number
  outstanding: number
  waiverReason: string | null
  status: string
  payments: { id: string; amount: number; paidAt: string; method: string; transactionRef: string | null }[]
}

export interface FinanceStructure {
  id: string
  programName: string
  batchYear: number
  amount: number
  dueDate: string
  recordCount: number
}

interface Props {
  summary: {
    billed: number
    paid: number
    outstanding: number
    overdueCount: number
    billedLabel: string
    paidLabel: string
    outstandingLabel: string
  }
  records: FinanceRecord[]
  structures: FinanceStructure[]
  students: { id: string; name: string; regno: string }[]
}

const STATUS_STYLES: Record<string, string> = {
  PAID: 'bg-success-soft text-success',
  PARTIAL: 'bg-warning-soft text-warning',
  PENDING: 'bg-slate-100 text-muted',
  OVERDUE: 'bg-danger-soft text-danger',
  WAIVED: 'bg-accent-soft text-accent',
}

const METHODS = ['CASH', 'CARD', 'UPI', 'NETBANKING', 'CHEQUE'] as const

export function FinanceWorkspace({ summary, records, structures, students }: Props) {
  const { run, pending } = useApiMutation()
  const [query, setQuery] = React.useState('')

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return records
    return records.filter(
      (r) =>
        r.studentRegno.toLowerCase().includes(q) ||
        r.studentName.toLowerCase().includes(q) ||
        r.structureName.toLowerCase().includes(q)
    )
  }, [records, query])

  async function createStructure(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const ok = await run(
      '/api/fees/structures',
      'POST',
      {
        programName: String(data.get('programName') ?? '').trim(),
        batchYear: Number(data.get('batchYear')),
        amount: Number(data.get('amount')),
        dueDate: String(data.get('dueDate') ?? ''),
      },
      { successTitle: 'Fee structure created' }
    )
    if (ok) form.reset()
  }

  async function billStudent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const ok = await run(
      '/api/fees/records',
      'POST',
      {
        studentId: String(data.get('studentId') ?? ''),
        feeStructureId: String(data.get('feeStructureId') ?? ''),
        amountPaid: Number(data.get('openingPayment') ?? 0) || undefined,
        transactionRef: String(data.get('transactionRef') ?? '').trim() || undefined,
      },
      { successTitle: 'Student billed' }
    )
    if (ok) form.reset()
  }

  async function postPayment(record: FinanceRecord, amount: number, method: string, ref: string) {
    if (!Number.isFinite(amount) || amount <= 0) return
    await run(
      `/api/fees/records/${record.id}`,
      'PATCH',
      {
        amount,
        method,
        ...(ref.trim() ? { transactionRef: ref.trim() } : {}),
      },
      { successTitle: `Payment of ₹${amount} recorded` }
    )
  }

  async function waive(record: FinanceRecord, reason: string) {
    await run(
      `/api/fees/records/${record.id}`,
      'PATCH',
      { waiverReason: reason },
      { successTitle: 'Waiver applied' }
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-muted">Total billed</p>
          <p className="num mt-1 text-2xl font-bold leading-none text-foreground">
            {summary.billedLabel}
          </p>
          <p className="mt-1 text-[11px] text-subtle">{records.length} records</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted">Collected</p>
          <p className="num mt-1 text-2xl font-bold leading-none text-success">
            {summary.paidLabel}
          </p>
          <p className="mt-1 text-[11px] text-subtle">
            {summary.billed > 0 ? Math.round((summary.paid / summary.billed) * 100) : 0}% of billed
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted">Outstanding</p>
          <p className="num mt-1 text-2xl font-bold leading-none text-accent">
            {summary.outstandingLabel}
          </p>
          <p className="mt-1 text-[11px] text-subtle">yet to be collected</p>
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
          <p className="mt-1 text-[11px] text-subtle">past the due date</p>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>New fee structure</CardTitle>
            <CardDescription>A template: what a program + batch owes, and by when.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={createStructure} className="space-y-3">
              <Field label="Program" name="programName" placeholder="B.Tech CSE — Semester 5" required />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Batch year" name="batchYear" type="number" defaultValue="2026" required />
                <Field label="Amount (₹)" name="amount" type="number" placeholder="85000" required />
              </div>
              <Field label="Due date" name="dueDate" type="date" required />
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner /> : null}
                Create structure
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bill a student</CardTitle>
            <CardDescription>
              Applies a structure to one student. A student can only be billed once per structure.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={billStudent} className="space-y-3">
              <label className="block text-xs font-medium text-muted">
                Student
                <select
                  name="studentId"
                  required
                  className="mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-foreground"
                >
                  <option value="">Select a student…</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.regno} — {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium text-muted">
                Fee structure
                <select
                  name="feeStructureId"
                  required
                  className="mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-foreground"
                >
                  <option value="">Select a structure…</option>
                  {structures.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.programName} ({s.batchYear}) — ₹{s.amount.toLocaleString('en-IN')}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Opening payment (₹)" name="openingPayment" type="number" placeholder="0" />
                <Field label="Reference" name="transactionRef" placeholder="TXN-…" />
              </div>
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner /> : null}
                Assign fee
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Fee structures</CardTitle>
          <CardDescription>{structures.length} template(s) in this college.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {structures.length === 0 ? (
            <div className="px-6">
              <EmptyState icon="payments" title="No fee structures yet" description="Create one to start billing students." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-border text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-2.5 text-left font-medium">Program</th>
                    <th className="px-4 py-2.5 text-right font-medium">Batch</th>
                    <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                    <th className="px-4 py-2.5 text-left font-medium">Due</th>
                    <th className="px-4 py-2.5 text-right font-medium">Billed</th>
                  </tr>
                </thead>
                <tbody>
                  {structures.map((s) => (
                    <tr key={s.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 text-foreground">{s.programName}</td>
                      <td className="num px-4 py-3 text-right text-muted">{s.batchYear}</td>
                      <td className="num px-4 py-3 text-right text-foreground">
                        ₹{s.amount.toLocaleString('en-IN')}
                      </td>
                      <td className="num px-4 py-3 text-muted">{s.dueDate}</td>
                      <td className="num px-4 py-3 text-right text-muted">{s.recordCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fee records</CardTitle>
          <CardDescription>Search, then post an installment or apply a waiver.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <div className="px-6 pb-4">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by reg no., name or program…"
              className="w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-foreground placeholder:text-subtle"
            />
          </div>

          {filtered.length === 0 ? (
            <div className="px-6">
              <EmptyState
                icon="receipt_long"
                title={records.length === 0 ? 'No fee records yet' : 'No matches'}
                description={
                  records.length === 0
                    ? 'Bill a student against a fee structure to see them here.'
                    : 'Nothing matches that search.'
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {filtered.map((r) => (
                <RecordRow
                  key={r.id}
                  record={r}
                  onPay={postPayment}
                  onWaive={waive}
                  disabled={pending}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function RecordRow({
  record,
  onPay,
  onWaive,
  disabled,
}: {
  record: FinanceRecord
  onPay: (r: FinanceRecord, amount: number, method: string, ref: string) => Promise<void>
  onWaive: (r: FinanceRecord, reason: string) => Promise<void>
  disabled: boolean
}) {
  const [amount, setAmount] = React.useState('')
  const [method, setMethod] = React.useState<string>('UPI')
  const [ref, setRef] = React.useState('')
  const settled = record.status === 'PAID' || record.status === 'WAIVED'

  return (
    <li className="px-6 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            <span className="num text-accent">{record.studentRegno}</span> · {record.studentName}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {record.structureName} · due <span className="num">{record.dueDate}</span>
          </p>
          {record.waiverReason ? (
            <p className="mt-0.5 text-xs text-accent">{record.waiverReason}</p>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="num text-sm font-semibold text-foreground">
              ₹{record.amountPaid.toLocaleString('en-IN')}
              <span className="text-subtle"> / ₹{record.amountDue.toLocaleString('en-IN')}</span>
            </p>
            <p className="num text-[11px] text-muted">
              balance ₹{record.outstanding.toLocaleString('en-IN')}
            </p>
          </div>
          <span
            className={cn(
              'num rounded-lg px-2 py-1 text-xs font-semibold',
              STATUS_STYLES[record.status] ?? 'bg-slate-100 text-muted'
            )}
          >
            {record.status}
          </span>
        </div>
      </div>

      {record.payments.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {record.payments.map((p) => (
            <li key={p.id} className="num text-[11px] text-subtle">
              {p.paidAt} · ₹{p.amount.toLocaleString('en-IN')} · {p.method}
              {p.transactionRef ? ` · ${p.transactionRef}` : ''}
            </li>
          ))}
        </ul>
      ) : null}

      {settled ? null : (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-[11px] font-medium text-muted">
            Amount
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              type="number"
              min={1}
              max={record.outstanding}
              placeholder={String(record.outstanding)}
              className="num mt-1 block w-28 rounded-lg border border-border-strong bg-surface px-2 py-1.5 text-sm text-foreground"
            />
          </label>
          <label className="text-[11px] font-medium text-muted">
            Method
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="mt-1 block rounded-lg border border-border-strong bg-surface px-2 py-1.5 text-sm text-foreground"
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] font-medium text-muted">
            Reference
            <input
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder="TXN-…"
              className="num mt-1 block w-32 rounded-lg border border-border-strong bg-surface px-2 py-1.5 text-sm text-foreground"
            />
          </label>
          <Button
            size="sm"
            disabled={disabled}
            onClick={() => onPay(record, Number(amount || record.outstanding), method, ref)}
          >
            Record payment
          </Button>
          {record.waiverReason ? null : (
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                const reason = window.prompt('Reason for waiving this fee?')
                if (reason) void onWaive(record, reason)
              }}
            >
              Waive
            </Button>
          )}
        </div>
      )}
    </li>
  )
}

function Field({
  label,
  name,
  type = 'text',
  placeholder,
  defaultValue,
  required,
}: {
  label: string
  name: string
  type?: string
  placeholder?: string
  defaultValue?: string
  required?: boolean
}) {
  return (
    <label className="block text-xs font-medium text-muted">
      {label}
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        defaultValue={defaultValue}
        required={required}
        className={cn(
          'mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-foreground placeholder:text-subtle',
          type === 'number' && 'num'
        )}
      />
    </label>
  )
}
