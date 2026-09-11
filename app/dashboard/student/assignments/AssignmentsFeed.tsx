'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { EmptyState, Spinner } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { formatDate, formatDateTime, dueLabel } from '../../teacher/assignments/_components/format'

/**
 * Student › Assignments.
 *
 * Submit work and read back the grade. The submit button is only offered while
 * the assignment is open; a locked section or a missing enrollment is rejected
 * server-side (403) regardless of what this UI shows.
 */

export interface AssignmentItem {
  id: string
  title: string
  description: string
  dueDate: string
  maxMarks: number
  courseCode: string
  courseName: string
  teacherName: string | null
  submission: {
    id: string
    fileUrl: string
    version: number
    status: string
    submittedAt: string
    grade: { score: number; feedback: string | null; gradedAt: string } | null
  } | null
}

export function AssignmentsFeed({ items }: { items: AssignmentItem[] }) {
  const { success, error: toastError } = useToast()
  const [rows, setRows] = React.useState(items)
  const [links, setLinks] = React.useState<Record<string, string>>({})
  const [pendingId, setPendingId] = React.useState<string | null>(null)
  const [filter, setFilter] = React.useState<'all' | 'open' | 'submitted' | 'graded'>('all')

  const visible = React.useMemo(() => {
    switch (filter) {
      case 'open':
        return rows.filter((r) => !r.submission)
      case 'submitted':
        return rows.filter((r) => r.submission && !r.submission.grade)
      case 'graded':
        return rows.filter((r) => Boolean(r.submission?.grade))
      default:
        return rows
    }
  }, [rows, filter])

  async function submit(assignmentId: string) {
    const fileUrl = (links[assignmentId] ?? '').trim()
    if (!fileUrl) {
      toastError('Link required', 'Paste the URL of your work before submitting.')
      return
    }

    setPendingId(assignmentId)
    try {
      const res = await fetch(`/api/assignments/${assignmentId}/submissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileUrl }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not submit')

      setRows((current) =>
        current.map((row) =>
          row.id === assignmentId
            ? {
                ...row,
                submission: {
                  id: data.submission.id,
                  fileUrl: data.submission.fileUrl,
                  version: data.submission.version,
                  status: data.submission.status,
                  submittedAt: data.submission.submittedAt,
                  grade: null,
                },
              }
            : row
        )
      )
      setLinks((current) => ({ ...current, [assignmentId]: '' }))
      success(
        data.submission.status === 'LATE' ? 'Submitted (late)' : 'Submitted',
        `Version ${data.submission.version} recorded.`
      )
    } catch (err) {
      toastError('Submission failed', err instanceof Error ? err.message : undefined)
    } finally {
      setPendingId(null)
    }
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon="assignment"
        title="No assignments yet"
        description="Work posted by your teachers will show up here with its due date."
      />
    )
  }

  const tabs: Array<{ key: typeof filter; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'open', label: 'To do' },
    { key: 'submitted', label: 'Awaiting grade' },
    { key: 'graded', label: 'Graded' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setFilter(tab.key)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
              filter === tab.key
                ? 'bg-primary text-white'
                : 'border border-border-strong bg-surface text-muted hover:bg-background hover:text-foreground'
            )}
          >
            {tab.label}
          </button>
        ))}
        <span className="num ml-auto text-xs text-subtle">{visible.length} shown</span>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon="filter_alt_off"
          title="Nothing in this view"
          description="Switch tabs to see the rest of your assignments."
        />
      ) : (
        <div className="space-y-3">
          {visible.map((a) => {
            const due = dueLabel(a.dueDate)
            const pending = pendingId === a.id
            return (
              <Card key={a.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="num rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-semibold text-accent">
                        {a.courseCode}
                      </span>
                      <span
                        className={cn(
                          'num text-[11px] font-medium',
                          due.overdue && !a.submission ? 'text-danger' : 'text-subtle'
                        )}
                      >
                        {due.text}
                      </span>
                    </div>
                    <h3 className="mt-1.5 font-heading text-sm font-semibold text-foreground">
                      {a.title}
                    </h3>
                    <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-muted">
                      {a.description}
                    </p>
                    <p className="num mt-1.5 text-[11px] text-subtle">
                      Due {formatDate(a.dueDate)} · {a.maxMarks} marks
                      {a.teacherName ? ` · ${a.teacherName}` : ''}
                    </p>
                  </div>

                  {a.submission?.grade ? (
                    <div className="text-right">
                      <p className="num text-2xl font-bold leading-none text-foreground">
                        {a.submission.grade.score}
                        <span className="text-sm font-normal text-muted">/{a.maxMarks}</span>
                      </p>
                      <p className="mt-1 text-[11px] text-subtle">
                        graded {formatDate(a.submission.grade.gradedAt)}
                      </p>
                    </div>
                  ) : null}
                </div>

                {a.submission ? (
                  <div className="mt-4 rounded-xl border border-border bg-background p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="num text-[11px] text-subtle">
                        v{a.submission.version} · {formatDateTime(a.submission.submittedAt)} ·{' '}
                        <span className={a.submission.status === 'LATE' ? 'text-warning' : ''}>
                          {a.submission.status}
                        </span>
                      </p>
                      <a
                        href={a.submission.fileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                      >
                        <span className="material-symbols-outlined text-[14px] leading-none">link</span>
                        <span className="max-w-[240px] truncate">{a.submission.fileUrl}</span>
                      </a>
                    </div>

                    {a.submission.grade?.feedback ? (
                      <p className="mt-2 border-l-2 border-accent/40 pl-3 text-xs leading-relaxed text-muted">
                        {a.submission.grade.feedback}
                      </p>
                    ) : null}

                    <div className="mt-3 flex items-end gap-2">
                      <div className="flex-1">
                        <Input
                          value={links[a.id] ?? ''}
                          onChange={(e) =>
                            setLinks((current) => ({ ...current, [a.id]: e.target.value }))
                          }
                          placeholder="Paste a new link to resubmit"
                          className="h-9"
                          aria-label={`Resubmit ${a.title}`}
                        />
                      </div>
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => submit(a.id)}>
                        {pending ? <Spinner className="text-[14px]" /> : null}
                        Resubmit
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 flex items-end gap-2">
                    <div className="flex-1">
                      <Input
                        value={links[a.id] ?? ''}
                        onChange={(e) =>
                          setLinks((current) => ({ ...current, [a.id]: e.target.value }))
                        }
                        placeholder="Link to your work (Drive, GitHub, …)"
                        className="h-9"
                        aria-label={`Submit ${a.title}`}
                      />
                    </div>
                    <Button size="sm" disabled={pending} onClick={() => submit(a.id)}>
                      {pending ? <Spinner className="text-[14px]" /> : null}
                      {pending ? 'Submitting…' : 'Submit'}
                    </Button>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
