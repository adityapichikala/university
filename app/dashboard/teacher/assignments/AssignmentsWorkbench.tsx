'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { EmptyState, ErrorState, Skeleton, Spinner } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { formatDate, formatDateTime, dueLabel } from './_components/format'

/**
 * Teacher › Assignments.
 *
 * Create assignments on your own courses, then open a roster and grade each
 * submission. Every action hits the same guarded API the integrations use, so
 * Tier 2 (assignment.manage / grade.entry) and Tier 3 (own course only) are
 * enforced server-side — the UI only decides what to offer.
 */

export interface CourseOption {
  id: string
  code: string
  name: string
}

export interface AssignmentRow {
  id: string
  title: string
  description: string
  dueDate: string
  maxMarks: number
  courseId: string
  courseCode: string
  courseName: string
  submissionCount: number
}

interface SubmissionRow {
  id: string
  fileUrl: string
  submittedAt: string
  version: number
  status: string
  student: { id: string; regno: string; name: string }
  grade: { id: string; score: number; feedback: string | null; gradedAt: string } | null
}

const BLANK = { courseId: '', title: '', description: '', dueDate: '', maxMarks: '100' }

export function AssignmentsWorkbench({
  courses,
  initialAssignments,
}: {
  courses: CourseOption[]
  initialAssignments: AssignmentRow[]
}) {
  const { success, error: toastError } = useToast()

  const [assignments, setAssignments] = React.useState(initialAssignments)
  const [showCreate, setShowCreate] = React.useState(false)
  const [form, setForm] = React.useState({ ...BLANK, courseId: courses[0]?.id ?? '' })
  const [creating, setCreating] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)

  const [openId, setOpenId] = React.useState<string | null>(null)
  const [roster, setRoster] = React.useState<SubmissionRow[] | null>(null)
  const [rosterLoading, setRosterLoading] = React.useState(false)
  const [rosterError, setRosterError] = React.useState<string | null>(null)
  const [savingId, setSavingId] = React.useState<string | null>(null)

  async function createAssignment(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setFormError(null)
    try {
      const res = await fetch('/api/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId: form.courseId,
          title: form.title,
          description: form.description,
          dueDate: form.dueDate,
          maxMarks: Number(form.maxMarks),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not create the assignment')

      const course = courses.find((c) => c.id === form.courseId)
      setAssignments((current) =>
        [
          ...current,
          {
            id: data.assignment.id,
            title: data.assignment.title,
            description: form.description,
            dueDate: data.assignment.dueDate,
            maxMarks: data.assignment.maxMarks,
            courseId: form.courseId,
            courseCode: course?.code ?? '',
            courseName: course?.name ?? '',
            submissionCount: 0,
          },
        ].sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      )
      setForm({ ...BLANK, courseId: courses[0]?.id ?? '' })
      setShowCreate(false)
      success('Assignment created', data.assignment.title)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong'
      setFormError(message)
      toastError('Could not create assignment', message)
    } finally {
      setCreating(false)
    }
  }

  async function openRoster(id: string) {
    if (openId === id) {
      setOpenId(null)
      return
    }
    setOpenId(id)
    setRoster(null)
    setRosterError(null)
    setRosterLoading(true)
    try {
      const res = await fetch(`/api/assignments/${id}/submissions`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not load submissions')
      setRoster(data.submissions ?? [])
    } catch (err) {
      setRosterError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setRosterLoading(false)
    }
  }

  async function grade(submissionId: string, score: string, feedback: string) {
    setSavingId(submissionId)
    try {
      const res = await fetch(`/api/submissions/${submissionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score: Number(score), feedback: feedback || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not save the grade')

      setRoster((current) =>
        (current ?? []).map((row) =>
          row.id === submissionId
            ? {
                ...row,
                status: 'GRADED',
                grade: {
                  id: data.grade.id,
                  score: data.grade.score,
                  feedback: data.grade.feedback ?? null,
                  gradedAt: data.grade.gradedAt,
                },
              }
            : row
        )
      )
      success('Grade saved', `${data.summary.score} / ${data.summary.percentage}% · ${data.summary.letter}`)
    } catch (err) {
      toastError('Could not save grade', err instanceof Error ? err.message : undefined)
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="num text-xs text-subtle">{assignments.length} assignments</p>
        <Button size="sm" onClick={() => setShowCreate((v) => !v)} disabled={courses.length === 0}>
          <span className="material-symbols-outlined text-[16px] leading-none">
            {showCreate ? 'close' : 'add'}
          </span>
          {showCreate ? 'Cancel' : 'New assignment'}
        </Button>
      </div>

      {courses.length === 0 ? (
        <EmptyState
          icon="menu_book"
          title="You don't teach any courses yet"
          description="Ask an administrator to assign you to a course, then you can post assignments here."
        />
      ) : null}

      {showCreate && courses.length > 0 ? (
        <Card className="p-6">
          <form onSubmit={createAssignment} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="course">Course</Label>
              <select
                id="course"
                value={form.courseId}
                onChange={(e) => setForm({ ...form, courseId: e.target.value })}
                className="h-11 w-full rounded-xl border border-border-strong bg-surface px-3.5 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              >
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Binary Search Trees — written exercise"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="due">Due date</Label>
              <Input
                id="due"
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="marks">Max marks</Label>
              <Input
                id="marks"
                type="number"
                min="1"
                max="1000"
                value={form.maxMarks}
                onChange={(e) => setForm({ ...form, maxMarks: e.target.value })}
                required
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="desc">Brief</Label>
              <textarea
                id="desc"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
                required
                placeholder="What students must produce, and how it will be judged."
                className="w-full rounded-xl border border-border-strong bg-surface p-3.5 text-sm text-foreground transition-colors placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>

            {formError ? <p className="text-xs text-danger sm:col-span-2">{formError}</p> : null}

            <div className="sm:col-span-2">
              <Button type="submit" disabled={creating}>
                {creating ? <Spinner className="text-[15px]" /> : null}
                {creating ? 'Creating…' : 'Create assignment'}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {assignments.length === 0 ? (
        <EmptyState
          icon="assignment"
          title="No assignments yet"
          description="Post your first assignment and it will appear in your students' LMS feed."
        />
      ) : (
        <div className="space-y-3">
          {assignments.map((a) => {
            const due = dueLabel(a.dueDate)
            const open = openId === a.id
            return (
              <Card key={a.id} className="overflow-hidden">
                <div className="flex flex-wrap items-start justify-between gap-3 p-5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="num rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-semibold text-accent">
                        {a.courseCode}
                      </span>
                      <span
                        className={cn(
                          'num text-[11px] font-medium',
                          due.overdue ? 'text-danger' : 'text-subtle'
                        )}
                      >
                        {due.text}
                      </span>
                    </div>
                    <h3 className="mt-1.5 font-heading text-sm font-semibold text-foreground">
                      {a.title}
                    </h3>
                    <p className="mt-0.5 line-clamp-2 max-w-2xl text-xs leading-relaxed text-muted">
                      {a.description}
                    </p>
                    <p className="num mt-1.5 text-[11px] text-subtle">
                      Due {formatDate(a.dueDate)} · {a.maxMarks} marks ·{' '}
                      {a.submissionCount} submission{a.submissionCount === 1 ? '' : 's'}
                    </p>
                  </div>

                  <Button variant="outline" size="sm" onClick={() => openRoster(a.id)}>
                    {open ? 'Hide' : 'Submissions'}
                    <span className="material-symbols-outlined text-[16px] leading-none">
                      {open ? 'expand_less' : 'expand_more'}
                    </span>
                  </Button>
                </div>

                {open ? (
                  <div className="border-t border-border bg-background p-5">
                    {rosterLoading ? (
                      <div className="space-y-2">
                        {[0, 1, 2].map((i) => (
                          <Skeleton key={i} className="h-12 w-full" />
                        ))}
                      </div>
                    ) : rosterError ? (
                      <ErrorState description={rosterError} onRetry={() => openRoster(a.id)} />
                    ) : !roster || roster.length === 0 ? (
                      <EmptyState
                        icon="inbox"
                        title="No submissions yet"
                        description="Students have not submitted anything for this assignment."
                      />
                    ) : (
                      <div className="space-y-2">
                        {roster.map((row) => (
                          <SubmissionRowCard
                            key={row.id}
                            row={row}
                            maxMarks={a.maxMarks}
                            saving={savingId === row.id}
                            onSave={(score, feedback) => grade(row.id, score, feedback)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SubmissionRowCard({
  row,
  maxMarks,
  saving,
  onSave,
}: {
  row: SubmissionRow
  maxMarks: number
  saving: boolean
  onSave: (score: string, feedback: string) => void
}) {
  const [score, setScore] = React.useState(row.grade ? String(row.grade.score) : '')
  const [feedback, setFeedback] = React.useState(row.grade?.feedback ?? '')

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{row.student.name}</p>
          <p className="num text-[11px] text-subtle">{row.student.regno}</p>
          <a
            href={row.fileUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-xs text-accent hover:underline"
          >
            <span className="material-symbols-outlined text-[14px] leading-none">link</span>
            <span className="max-w-[280px] truncate">{row.fileUrl}</span>
          </a>
          <p className="num mt-1 text-[11px] text-subtle">
            v{row.version} · {formatDateTime(row.submittedAt)} ·{' '}
            <span className={row.status === 'LATE' ? 'text-warning' : ''}>{row.status}</span>
          </p>
        </div>

        <div className="flex items-end gap-2">
          <div className="w-20">
            <Label htmlFor={`score-${row.id}`} className="text-[10px]">
              Score
            </Label>
            <Input
              id={`score-${row.id}`}
              type="number"
              min="0"
              max={maxMarks}
              step="0.5"
              value={score}
              onChange={(e) => setScore(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="w-48">
            <Label htmlFor={`fb-${row.id}`} className="text-[10px]">
              Feedback
            </Label>
            <Input
              id={`fb-${row.id}`}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Optional"
              className="h-9"
            />
          </div>
          <Button
            size="sm"
            disabled={saving || score === ''}
            onClick={() => onSave(score, feedback)}
          >
            {saving ? <Spinner className="text-[14px]" /> : null}
            {row.grade ? 'Re-grade' : 'Save'}
          </Button>
        </div>
      </div>

      {row.grade ? (
        <p className="num mt-2 text-[11px] text-muted">
          Last graded {formatDateTime(row.grade.gradedAt)} · {row.grade.score}/{maxMarks}
        </p>
      ) : null}
    </div>
  )
}
