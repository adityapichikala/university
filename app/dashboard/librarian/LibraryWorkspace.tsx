'use client'

import * as React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState, Spinner } from '@/components/ui/states'
import { useApiMutation } from '@/components/dashboard/use-api-mutation'
import { cn } from '@/lib/utils'

/**
 * The interactive half of the Librarian portal: add stock, issue a copy,
 * take one back. Returning is where the fine is decided, so the row shows the
 * projected amount before the librarian commits to it.
 */

export interface CatalogItem {
  id: string
  title: string
  author: string
  isbn: string | null
  totalCopies: number
  availableCopies: number
}

export interface IssueRow {
  id: string
  itemId: string
  itemTitle: string
  studentRegno: string
  studentName: string
  issuedAt: string
  dueAt: string
  returnedAt: string | null
  fineAmount: number
  state: string
  projectedFine: number
}

interface Props {
  summary: { titles: number; onLoan: number; overdue: number; finesCollected: number }
  items: CatalogItem[]
  issues: IssueRow[]
  students: { id: string; name: string; regno: string }[]
}

const STATE_STYLES: Record<string, string> = {
  ACTIVE: 'bg-success-soft text-success',
  OVERDUE: 'bg-danger-soft text-danger',
  RETURNED: 'bg-slate-100 text-muted',
}

export function LibraryWorkspace({ summary, items, issues, students }: Props) {
  const { run, pending } = useApiMutation()
  const [query, setQuery] = React.useState('')
  const [stateFilter, setStateFilter] = React.useState('ALL')

  const filteredIssues = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return issues.filter((i) => {
      if (stateFilter !== 'ALL' && i.state !== stateFilter) return false
      if (!q) return true
      return (
        i.studentRegno.toLowerCase().includes(q) ||
        i.studentName.toLowerCase().includes(q) ||
        i.itemTitle.toLowerCase().includes(q)
      )
    })
  }, [issues, query, stateFilter])

  async function addItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const ok = await run(
      '/api/library/items',
      'POST',
      {
        title: String(data.get('title') ?? '').trim(),
        author: String(data.get('author') ?? '').trim(),
        isbn: String(data.get('isbn') ?? '').trim() || undefined,
        totalCopies: Number(data.get('totalCopies') ?? 1),
      },
      { successTitle: 'Added to catalog' }
    )
    if (ok) form.reset()
  }

  async function issueBook(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const ok = await run(
      '/api/library/issues',
      'POST',
      {
        itemId: String(data.get('itemId') ?? ''),
        studentId: String(data.get('studentId') ?? ''),
        dueAt: String(data.get('dueAt') ?? '').trim() || undefined,
      },
      { successTitle: 'Book issued' }
    )
    if (ok) form.reset()
  }

  async function returnBook(issue: IssueRow) {
    await run(`/api/library/issues/${issue.id}`, 'PATCH', {}, {
      successTitle:
        issue.projectedFine > 0
          ? `Returned — ₹${issue.projectedFine} fine`
          : 'Returned, no fine',
    })
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-muted">Titles</p>
          <p className="num mt-1 text-3xl font-bold leading-none text-foreground">
            {summary.titles}
          </p>
          <p className="mt-1 text-[11px] text-subtle">in the catalog</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted">On loan</p>
          <p className="num mt-1 text-3xl font-bold leading-none text-accent">{summary.onLoan}</p>
          <p className="mt-1 text-[11px] text-subtle">copies out</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted">Overdue</p>
          <p
            className={cn(
              'num mt-1 text-3xl font-bold leading-none',
              summary.overdue > 0 ? 'text-danger' : 'text-foreground'
            )}
          >
            {summary.overdue}
          </p>
          <p className="mt-1 text-[11px] text-subtle">
            {summary.overdue > 0 ? 'chase these' : 'nothing late'}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted">Fines collected</p>
          <p className="num mt-1 text-3xl font-bold leading-none text-warning">
            ₹{summary.finesCollected}
          </p>
          <p className="mt-1 text-[11px] text-subtle">on returned books</p>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Add to catalog</CardTitle>
            <CardDescription>Every copy added starts on the shelf.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={addItem} className="space-y-3">
              <Field label="Title" name="title" required />
              <Field label="Author" name="author" required />
              <div className="grid grid-cols-2 gap-3">
                <Field label="ISBN" name="isbn" placeholder="978-…" />
                <Field label="Copies" name="totalCopies" type="number" defaultValue="1" required />
              </div>
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner /> : null}
                Add item
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Issue a book</CardTitle>
            <CardDescription>
              Only titles with a copy on the shelf can be issued. Leave the due date blank for
              14 days.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={issueBook} className="space-y-3">
              <label className="block text-xs font-medium text-muted">
                Book
                <select
                  name="itemId"
                  required
                  className="mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-foreground"
                >
                  <option value="">Select a title…</option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id} disabled={i.availableCopies <= 0}>
                      {i.title}
                      {i.availableCopies <= 0
                        ? ' — none available'
                        : ` — ${i.availableCopies} free`}
                    </option>
                  ))}
                </select>
              </label>
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
              <Field label="Due date (optional)" name="dueAt" type="date" />
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner /> : null}
                Issue book
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Catalog</CardTitle>
          <CardDescription>{items.length} title(s).</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {items.length === 0 ? (
            <div className="px-6">
              <EmptyState icon="auto_stories" title="Catalog is empty" description="Add your first title above." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-border text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-2.5 text-left font-medium">Title</th>
                    <th className="px-4 py-2.5 text-left font-medium">Author</th>
                    <th className="px-4 py-2.5 text-left font-medium">ISBN</th>
                    <th className="px-4 py-2.5 text-right font-medium">Copies</th>
                    <th className="px-4 py-2.5 text-right font-medium">Available</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 font-medium text-foreground">{i.title}</td>
                      <td className="px-4 py-3 text-muted">{i.author}</td>
                      <td className="num px-4 py-3 text-subtle">{i.isbn ?? '—'}</td>
                      <td className="num px-4 py-3 text-right text-muted">{i.totalCopies}</td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={cn(
                            'num rounded-lg px-2 py-1 text-xs font-semibold',
                            i.availableCopies > 0
                              ? 'bg-success-soft text-success'
                              : 'bg-danger-soft text-danger'
                          )}
                        >
                          {i.availableCopies}
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

      <Card>
        <CardHeader>
          <CardTitle>Loans</CardTitle>
          <CardDescription>Take a copy back to close the loan and settle any fine.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <div className="flex flex-wrap gap-3 px-6 pb-4">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by reg no., name or title…"
              className="min-w-[220px] flex-1 rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-foreground placeholder:text-subtle"
            />
            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              className="rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-foreground"
            >
              <option value="ALL">All states</option>
              <option value="ACTIVE">Active</option>
              <option value="OVERDUE">Overdue</option>
              <option value="RETURNED">Returned</option>
            </select>
          </div>

          {filteredIssues.length === 0 ? (
            <div className="px-6">
              <EmptyState
                icon="swap_horiz"
                title={issues.length === 0 ? 'No loans yet' : 'No matches'}
                description={
                  issues.length === 0
                    ? 'Issue a book to a student to see it here.'
                    : 'Nothing matches that filter.'
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-border text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-2.5 text-left font-medium">Book</th>
                    <th className="px-4 py-2.5 text-left font-medium">Student</th>
                    <th className="px-4 py-2.5 text-left font-medium">Issued</th>
                    <th className="px-4 py-2.5 text-left font-medium">Due</th>
                    <th className="px-4 py-2.5 text-right font-medium">Fine</th>
                    <th className="px-4 py-2.5 text-center font-medium">State</th>
                    <th className="px-4 py-2.5 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredIssues.map((i) => (
                    <tr key={i.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 text-foreground">{i.itemTitle}</td>
                      <td className="px-4 py-3">
                        <span className="num text-accent">{i.studentRegno}</span>
                        <p className="text-xs text-subtle">{i.studentName}</p>
                      </td>
                      <td className="num px-4 py-3 text-muted">{i.issuedAt}</td>
                      <td className="num px-4 py-3 text-muted">{i.dueAt}</td>
                      <td
                        className={cn(
                          'num px-4 py-3 text-right font-medium',
                          (i.returnedAt ? i.fineAmount : i.projectedFine) > 0
                            ? 'text-danger'
                            : 'text-muted'
                        )}
                      >
                        ₹{i.returnedAt ? i.fineAmount : i.projectedFine}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={cn(
                            'num rounded-lg px-2 py-1 text-xs font-semibold',
                            STATE_STYLES[i.state] ?? 'bg-slate-100 text-muted'
                          )}
                        >
                          {i.state}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {i.returnedAt ? (
                          <span className="num text-xs text-subtle">{i.returnedAt}</span>
                        ) : (
                          <Button size="sm" disabled={pending} onClick={() => returnBook(i)}>
                            Return
                          </Button>
                        )}
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
