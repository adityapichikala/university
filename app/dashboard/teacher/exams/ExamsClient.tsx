'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { EXAM_TYPES, type ExamType } from '@/lib/academics'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface ExamRow {
  id: string
  courseId: string
  examType: string
  examDate: string
  maxMarks: number
  courseCode: string
  courseName: string
  resultCount: number
}

interface Student {
  id: string
  regno: string
  name: string
}

interface Props {
  canGrade: boolean
  courses: { id: string; code: string; name: string }[]
  initialExams: ExamRow[]
}

const selectClass =
  'h-11 w-full rounded-xl border border-border-strong bg-surface px-3.5 text-sm text-foreground ' +
  'transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs font-medium uppercase tracking-wide text-muted">{label}</Label>
      {children}
    </div>
  )
}

export function ExamsClient({ canGrade, courses, initialExams }: Props) {
  const router = useRouter()
  const [exams, setExams] = useState(initialExams)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [form, setForm] = useState({
    courseId: courses[0]?.id ?? '',
    examType: 'INTERNAL' as ExamType,
    examDate: new Date().toISOString().slice(0, 10),
    maxMarks: '100',
  })

  /** Marks sheet: examId → studentId → score string. */
  const [sheet, setSheet] = useState<Record<string, Record<string, string>>>({})
  /** Roster cache: courseId → students, fetched when a sheet is opened. */
  const [rosters, setRosters] = useState<Record<string, Student[]>>({})
  const [openExamId, setOpenExamId] = useState<string | null>(null)

  async function request(url: string, method: string, body?: unknown) {
    setError(null)
    setMessage(null)
    setBusy(true)
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error ?? 'Request failed')
        return null
      }
      return data
    } catch {
      setError('Network error. Please try again.')
      return null
    } finally {
      setBusy(false)
    }
  }

  async function createExam(e: React.FormEvent) {
    e.preventDefault()
    const data = await request('/api/exams', 'POST', {
      courseId: form.courseId,
      examType: form.examType,
      examDate: form.examDate,
      maxMarks: Number(form.maxMarks),
    })
    if (!data) return
    const created = data.exam
    setExams((prev) =>
      [
        {
          id: created.id,
          courseId: created.courseId,
          examType: created.examType,
          examDate: created.examDate.slice(0, 10),
          maxMarks: created.maxMarks,
          courseCode: created.course.code,
          courseName: created.course.name,
          resultCount: 0,
        },
        ...prev,
      ].sort((a, b) => b.examDate.localeCompare(a.examDate))
    )
    setMessage(`Created ${created.course.code} ${created.examType}`)
    router.refresh()
  }

  async function openSheet(examId: string) {
    if (openExamId === examId) {
      setOpenExamId(null)
      return
    }
    const exam = exams.find((e) => e.id === examId)
    if (!exam) return

    // Fetch existing marks and the course roster together, after the click —
    // never during render.
    const [resultsData, rosterData] = await Promise.all([
      request(`/api/exams/${examId}/results`, 'GET'),
      rosters[exam.courseId]
        ? Promise.resolve(null)
        : request(`/api/enrollments?courseId=${exam.courseId}`, 'GET'),
    ])
    if (!resultsData) return

    setSheet((prev) => ({
      ...prev,
      [examId]: Object.fromEntries(
        resultsData.results.map((r: { studentId: string; marksObtained: number }) => [
          r.studentId,
          String(r.marksObtained),
        ])
      ),
    }))

    if (rosterData) {
      const seen = new Set<string>()
      const rows: Student[] = []
      for (const e of rosterData.enrollments ?? []) {
        if (seen.has(e.student.id)) continue
        seen.add(e.student.id)
        rows.push(e.student)
      }
      setRosters((prev) => ({ ...prev, [exam.courseId]: rows }))
    }

    setOpenExamId(examId)
  }

  async function saveResults(exam: ExamRow, publish: boolean) {
    const entries = Object.entries(sheet[exam.id] ?? {}).filter(([, v]) => v.trim() !== '')
    if (entries.length === 0) {
      setError('Enter at least one mark.')
      return
    }
    const results = entries.map(([studentId, v]) => ({
      studentId,
      marksObtained: Number(v),
    }))
    if (results.some((r) => Number.isNaN(r.marksObtained) || r.marksObtained < 0)) {
      setError('Marks must be non-negative numbers.')
      return
    }
    const data = await request(`/api/exams/${exam.id}/results`, 'PUT', { results, publish })
    if (!data) return
    setExams((prev) =>
      prev.map((x) => (x.id === exam.id ? { ...x, resultCount: results.length } : x))
    )
    setMessage(
      publish
        ? `Saved and published ${results.length} result(s)`
        : `Saved ${results.length} result(s) — not published yet`
    )
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-5">
      {error && (
        <div className="animate-fade rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}
      {message && (
        <div className="animate-fade rounded-xl border border-success/30 bg-success/5 px-4 py-3 text-sm text-success">
          {message}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Schedule an exam</CardTitle>
            <CardDescription>Only for courses assigned to you.</CardDescription>
          </CardHeader>
          <CardContent>
            {courses.length === 0 ? (
              <p className="text-sm text-muted">You have no courses assigned yet.</p>
            ) : (
              <form onSubmit={createExam} className="flex flex-col gap-4">
                <Field label="Course">
                  <select
                    className={selectClass}
                    value={form.courseId}
                    onChange={(e) => setForm({ ...form, courseId: e.target.value })}
                  >
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} · {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Type">
                  <select
                    className={selectClass}
                    value={form.examType}
                    onChange={(e) => setForm({ ...form, examType: e.target.value as ExamType })}
                  >
                    {EXAM_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t.charAt(0) + t.slice(1).toLowerCase()}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Date">
                    <Input
                      type="date"
                      value={form.examDate}
                      onChange={(e) => setForm({ ...form, examDate: e.target.value })}
                      className="num"
                    />
                  </Field>
                  <Field label="Max marks">
                    <Input
                      type="number"
                      min={1}
                      value={form.maxMarks}
                      onChange={(e) => setForm({ ...form, maxMarks: e.target.value })}
                      className="num"
                    />
                  </Field>
                </div>
                <Button type="submit" variant="accent" disabled={busy}>
                  <span className="material-symbols-outlined text-[18px]">add</span>
                  Create exam
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your exams</CardTitle>
            <CardDescription>
              <span className="num">{exams.length}</span> scheduled
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {exams.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-subtle">
                No exams scheduled. Create one on the left.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-border text-xs uppercase tracking-wide text-muted">
                      <th className="px-4 py-2.5 text-left font-medium">Course</th>
                      <th className="px-4 py-2.5 text-left font-medium">Type</th>
                      <th className="px-4 py-2.5 text-left font-medium">Date</th>
                      <th className="px-4 py-2.5 text-left font-medium">Max</th>
                      <th className="px-4 py-2.5 text-left font-medium">Results</th>
                      <th className="px-4 py-2.5 text-right font-medium">Marks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exams.map((exam) => (
                      <tr key={exam.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-3">
                          <span className="num font-medium text-foreground">{exam.courseCode}</span>
                        </td>
                        <td className="px-4 py-3 text-muted">
                          {exam.examType.charAt(0) + exam.examType.slice(1).toLowerCase()}
                        </td>
                        <td className="num px-4 py-3 text-muted">{exam.examDate}</td>
                        <td className="num px-4 py-3 text-muted">{exam.maxMarks}</td>
                        <td className="num px-4 py-3 text-muted">{exam.resultCount}</td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openSheet(exam.id)}
                            disabled={busy || !canGrade}
                          >
                            <span className="material-symbols-outlined text-[18px]">
                              {openExamId === exam.id ? 'expand_less' : 'edit_note'}
                            </span>
                          </Button>
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

      {openExamId && canGrade && (
        <MarksSheet
          exam={exams.find((e) => e.id === openExamId)!}
          students={rosters[exams.find((e) => e.id === openExamId)!.courseId] ?? []}
          values={sheet[openExamId] ?? {}}
          busy={busy}
          onChange={(studentId, value) =>
            setSheet((prev) => ({
              ...prev,
              [openExamId]: { ...prev[openExamId], [studentId]: value },
            }))
          }
          onSave={(publish) => saveResults(exams.find((e) => e.id === openExamId)!, publish)}
        />
      )}
    </div>
  )
}

/* ── Marks sheet ───────────────────────────────────────────────────────────── */

function MarksSheet({
  exam,
  students,
  values,
  busy,
  onChange,
  onSave,
}: {
  exam: ExamRow
  students: Student[]
  values: Record<string, string>
  busy: boolean
  onChange: (studentId: string, value: string) => void
  onSave: (publish: boolean) => void
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>
              Marks · <span className="num">{exam.courseCode}</span>{' '}
              {exam.examType.charAt(0) + exam.examType.slice(1).toLowerCase()}
            </CardTitle>
            <CardDescription>
              Out of <span className="num">{exam.maxMarks}</span>. Publishing makes every result on
              this exam visible to students.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="md" onClick={() => onSave(false)} disabled={busy}>
              Save
            </Button>
            <Button variant="accent" size="md" onClick={() => onSave(true)} disabled={busy}>
              Save &amp; publish
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-0">
        {students.length === 0 && (
          <p className="px-6 py-6 text-center text-sm text-subtle">
            No students enrolled in this course.
          </p>
        )}
        {students.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-border text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5 text-left font-medium">Reg no</th>
                  <th className="px-4 py-2.5 text-left font-medium">Name</th>
                  <th className="w-[140px] px-4 py-2.5 text-right font-medium">Marks</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.id} className="border-b border-border last:border-0">
                    <td className="num px-4 py-2.5 font-medium text-foreground">{s.regno}</td>
                    <td className="px-4 py-2.5 text-foreground">{s.name}</td>
                    <td className="px-4 py-2.5 text-right">
                      <input
                        type="number"
                        min={0}
                        max={exam.maxMarks}
                        value={values[s.id] ?? ''}
                        onChange={(e) => onChange(s.id, e.target.value)}
                        className={cn(
                          'num h-9 w-24 rounded-lg border border-border-strong bg-surface px-2.5 text-right text-sm',
                          'text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20'
                        )}
                        placeholder="—"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
