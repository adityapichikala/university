'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { ATTENDANCE_STATUSES, type AttendanceStatus } from '@/lib/academics'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface Student {
  id: string
  regno: string
  name: string
  /** Roll number within the section — not unique college-wide. */
  rollNo: string | null
  /** Home section, e.g. "CSE-A". */
  section: string | null
}

interface Props {
  courses: { id: string; code: string; name: string }[]
  initialCourseId: string
  initialDate: string
  roster: Student[]
  initialMarks: { studentId: string; status: AttendanceStatus }[]
}

const selectClass =
  'h-11 rounded-xl border border-border-strong bg-surface px-3.5 text-sm text-foreground ' +
  'transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20'

/** Only PRESENT and LATE count toward the percentage. */
const CREDITED: AttendanceStatus[] = ['PRESENT', 'LATE']

const STATUS_STYLE: Record<AttendanceStatus, string> = {
  PRESENT: 'border-success/40 bg-success/10 text-success',
  ABSENT: 'border-danger/40 bg-danger/10 text-danger',
  LATE: 'border-warning/40 bg-warning/10 text-warning',
  EXCUSED: 'border-border-strong bg-background text-muted',
}

export function AttendanceClient({
  courses,
  initialCourseId,
  initialDate,
  roster,
  initialMarks,
}: Props) {
  const router = useRouter()
  const [courseId, setCourseId] = useState(initialCourseId)
  const [date, setDate] = useState(initialDate)
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>(() =>
    Object.fromEntries(initialMarks.map((m) => [m.studentId, m.status]))
  )
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const credited = useMemo(
    () => roster.filter((s) => marks[s.id] && CREDITED.includes(marks[s.id])).length,
    [roster, marks]
  )
  const allMarked = roster.length > 0 && roster.every((s) => marks[s.id])

  function markAll(status: AttendanceStatus) {
    setMarks(Object.fromEntries(roster.map((s) => [s.id, status])))
  }

  function switchCourse(nextCourseId: string) {
    setCourseId(nextCourseId)
    setMessage(null)
    setError(null)
    router.push(`/dashboard/teacher/attendance?courseId=${nextCourseId}&date=${date}`)
  }

  function switchDate(nextDate: string) {
    setDate(nextDate)
    setMessage(null)
    setError(null)
    router.push(`/dashboard/teacher/attendance?courseId=${courseId}&date=${nextDate}`)
  }

  async function submit() {
    setError(null)
    setMessage(null)

    const payload = roster
      .filter((s) => marks[s.id])
      .map((s) => ({ studentId: s.id, status: marks[s.id] }))

    if (payload.length === 0) {
      setError('Mark at least one student before saving.')
      return
    }

    setBusy(true)
    try {
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, date, marks: payload }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error ?? 'Could not save attendance')
        return
      }
      setMessage(`Saved ${data.marked} mark(s) for ${date}`)
      router.refresh()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 p-5">
          <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
            <Label className="text-xs font-medium uppercase tracking-wide text-muted">Course</Label>
            <select
              className={selectClass}
              value={courseId}
              onChange={(e) => switchCourse(e.target.value)}
            >
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex w-[190px] flex-col gap-1.5">
            <Label className="text-xs font-medium uppercase tracking-wide text-muted">Date</Label>
            <Input type="date" value={date} onChange={(e) => switchDate(e.target.value)} className="num" />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="md" onClick={() => markAll('PRESENT')} disabled={busy}>
              All present
            </Button>
            <Button variant="outline" size="md" onClick={() => markAll('ABSENT')} disabled={busy}>
              All absent
            </Button>
          </div>
        </CardContent>
      </Card>

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

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Roster</CardTitle>
              <CardDescription>
                <span className="num">{roster.length}</span> enrolled ·{' '}
                <span className="num">{credited}</span> credited as present or late
              </CardDescription>
            </div>
            <Button variant="accent" onClick={submit} disabled={busy || !allMarked}>
              <span className="material-symbols-outlined text-[18px]">save</span>
              {busy ? 'Saving…' : 'Save attendance'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          {roster.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-subtle">
              No students are enrolled in this course yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-border text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-2.5 text-left font-medium">Roll no</th>
                    <th className="px-4 py-2.5 text-left font-medium">Name</th>
                    <th className="px-4 py-2.5 text-left font-medium">Reg no</th>
                    <th className="px-4 py-2.5 text-left font-medium">Section</th>
                    <th className="px-4 py-2.5 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.map((s) => (
                    <tr key={s.id} className="border-b border-border last:border-0">
                      <td className="num px-4 py-3 font-medium text-foreground">
                        {s.rollNo ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-foreground">{s.name}</td>
                      <td className="num px-4 py-3 text-muted">{s.regno}</td>
                      <td className="px-4 py-3 text-muted">{s.section ?? '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          {ATTENDANCE_STATUSES.map((status) => {
                            const active = marks[s.id] === status
                            return (
                              <button
                                key={status}
                                type="button"
                                onClick={() => setMarks((m) => ({ ...m, [s.id]: status }))}
                                className={cn(
                                  'rounded-lg border px-2.5 py-1 text-xs font-medium capitalize transition-colors',
                                  active
                                    ? STATUS_STYLE[status]
                                    : 'border-border-strong bg-surface text-subtle hover:bg-background'
                                )}
                              >
                                {status.toLowerCase()}
                              </button>
                            )
                          })}
                        </div>
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
