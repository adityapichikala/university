'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { useApiMutation, type ApiError } from '@/components/dashboard/use-api-mutation'

/* ── Shapes ────────────────────────────────────────────────────────────────── */

interface Ref {
  id: string
  name: string
}
interface Person {
  id: string
  regno: string
  name: string
}

interface CourseRow {
  id: string
  code: string
  name: string
  credits: number
  departmentId: string
  teacherId: string | null
  department: Ref
  teacher: Person | null
  _count: { enrollments: number }
}

interface ClassRow {
  id: string
  name: string
  semester: number
  batchYear: number
  departmentId: string
  department: Ref
  _count: { enrollments: number }
}

interface EnrollmentRow {
  id: string
  studentId: string
  courseId: string
  classId: string
  /** 'CONFIRMED' takes a seat; 'WAITLISTED' is queued. */
  status: string
  student: Person
  course: { id: string; code: string; name: string }
  class: Ref
}

interface Props {
  canManageClasses: boolean
  canManageEnrollments: boolean
  initialCourses: CourseRow[]
  initialClasses: ClassRow[]
  initialEnrollments: EnrollmentRow[]
  departments: Ref[]
  teachers: Person[]
  students: Person[]
}

type Tab = 'courses' | 'classes' | 'enrollments'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'courses', label: 'Courses', icon: 'menu_book' },
  { id: 'classes', label: 'Classes', icon: 'meeting_room' },
  { id: 'enrollments', label: 'Enrollments', icon: 'how_to_reg' },
]

/* ── Small shared pieces ───────────────────────────────────────────────────── */

const selectClass =
  'h-11 w-full rounded-xl border border-border-strong bg-surface px-3.5 text-sm text-foreground ' +
  'transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 ' +
  'disabled:cursor-not-allowed disabled:opacity-60'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs font-medium uppercase tracking-wide text-muted">{label}</Label>
      {children}
    </div>
  )
}

function Alert({ kind, children }: { kind: 'error' | 'ok'; children: React.ReactNode }) {
  if (!children) return null
  return (
    <div
      className={cn(
        'animate-fade rounded-xl border px-4 py-3 text-sm',
        kind === 'error'
          ? 'border-danger/30 bg-danger/5 text-danger'
          : 'border-success/30 bg-success/5 text-success'
      )}
    >
      {children}
    </div>
  )
}

function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-subtle">
        {children}
      </td>
    </tr>
  )
}

/* ── Component ─────────────────────────────────────────────────────────────── */

export function AcademicsClient({
  canManageClasses,
  canManageEnrollments,
  initialCourses,
  initialClasses,
  initialEnrollments,
  departments,
  teachers,
  students,
}: Props) {
  const router = useRouter()
  const enroll = useApiMutation()
  const withdrawMutation = useApiMutation()

  /** Server message shown when a section is full; unlocks the waitlist button. */
  const [waitlistOffer, setWaitlistOffer] = useState<string | null>(null)

  const [tab, setTab] = useState<Tab>('courses')
  const [courses, setCourses] = useState(initialCourses)
  const [classes, setClasses] = useState(initialClasses)
  const [enrollments, setEnrollments] = useState(initialEnrollments)

  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Course form
  const [courseForm, setCourseForm] = useState({
    code: '',
    name: '',
    credits: '3',
    departmentId: departments[0]?.id ?? '',
    teacherId: '',
  })

  // Class form
  const [classForm, setClassForm] = useState({
    name: '',
    departmentId: departments[0]?.id ?? '',
    semester: '1',
    batchYear: String(new Date().getFullYear()),
  })

  // Enrollment form
  const [enrollForm, setEnrollForm] = useState({
    studentId: students[0]?.id ?? '',
    courseId: initialCourses[0]?.id ?? '',
    classId: initialClasses[0]?.id ?? '',
  })

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

  /* ── Courses ── */

  async function createCourse(e: React.FormEvent) {
    e.preventDefault()
    const data = await request('/api/courses', 'POST', {
      code: courseForm.code,
      name: courseForm.name,
      credits: Number(courseForm.credits),
      departmentId: courseForm.departmentId,
      teacherId: courseForm.teacherId || null,
    })
    if (!data) return
    setCourses((prev) => [...prev, data.course].sort((a, b) => a.code.localeCompare(b.code)))
    setCourseForm((f) => ({ ...f, code: '', name: '', teacherId: '' }))
    setMessage(`Created ${data.course.code}`)
    router.refresh()
  }

  async function assignTeacher(courseId: string, teacherId: string) {
    const data = await request(`/api/courses/${courseId}`, 'PATCH', { teacherId: teacherId || null })
    if (!data) return
    setCourses((prev) => prev.map((c) => (c.id === courseId ? { ...c, ...data.course } : c)))
    setMessage('Teacher updated')
    router.refresh()
  }

  async function deleteCourse(course: CourseRow) {
    if (course._count.enrollments > 0) {
      setError(`Cannot delete ${course.code}: ${course._count.enrollments} student(s) enrolled`)
      return
    }
    if (!window.confirm(`Delete course ${course.code}?`)) return
    const data = await request(`/api/courses/${course.id}`, 'DELETE')
    if (!data) return
    setCourses((prev) => prev.filter((c) => c.id !== course.id))
    setMessage(`Deleted ${course.code}`)
    router.refresh()
  }

  /* ── Classes ── */

  async function createClass(e: React.FormEvent) {
    e.preventDefault()
    const data = await request('/api/classes', 'POST', {
      name: classForm.name,
      departmentId: classForm.departmentId,
      semester: Number(classForm.semester),
      batchYear: Number(classForm.batchYear),
    })
    if (!data) return
    setClasses((prev) => [...prev, data.class].sort((a, b) => a.name.localeCompare(b.name)))
    setClassForm((f) => ({ ...f, name: '' }))
    setMessage(`Created ${data.class.name}`)
    router.refresh()
  }

  async function deleteClass(klass: ClassRow) {
    if (klass._count.enrollments > 0) {
      setError(`Cannot delete ${klass.name}: ${klass._count.enrollments} enrollment(s)`)
      return
    }
    if (!window.confirm(`Delete class ${klass.name}?`)) return
    const data = await request(`/api/classes/${klass.id}`, 'DELETE')
    if (!data) return
    setClasses((prev) => prev.filter((c) => c.id !== klass.id))
    setMessage(`Deleted ${klass.name}`)
    router.refresh()
  }

  /* ── Enrollments ── */

  /**
   * Idempotent by design: pressing Enroll twice is not an error, because the
   * second press is asking for a state that already holds. The server answers
   * 409 DUPLICATE and the hook turns that into a confirmation. Other 409s
   * (full section, credit cap, timetable clash) stay refusals — and a full
   * section comes back as an offer to join the waitlist rather than a dead end.
   */
  async function createEnrollment(e: React.FormEvent, joinWaitlist = false) {
    e.preventDefault()
    setError(null)
    setMessage(null)
    setWaitlistOffer(null)

    const ok = await enroll.run(
      '/api/enrollments',
      'POST',
      { ...enrollForm, joinWaitlist },
      {
        successTitle: joinWaitlist ? 'Joined waitlist' : 'Enrolled',
        conflictTitle: 'Could not enrol',
        conflictAsSuccess: (c: ApiError) => c.reason === 'DUPLICATE',
        onConflict: (c: ApiError) => {
          if (c.reason === 'SECTION_FULL') setWaitlistOffer(c.message)
        },
      }
    )
    if (!ok) return
  }

  async function withdraw(enrollment: EnrollmentRow) {
    const label =
      enrollment.status === 'WAITLISTED'
        ? `Remove ${enrollment.student.regno} from the ${enrollment.course.code} waitlist?`
        : `Withdraw ${enrollment.student.regno} from ${enrollment.course.code}?`
    if (!window.confirm(label)) return

    setError(null)
    setMessage(null)
    const ok = await withdrawMutation.run(`/api/enrollments/${enrollment.id}`, 'DELETE', undefined, {
      successTitle: 'Withdrawn',
    })
    if (!ok) return
    setEnrollments((prev) => prev.filter((e) => e.id !== enrollment.id))
    router.refresh()
  }

  /* ── Render ── */

  return (
    <div className="flex flex-col gap-5">
      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl border border-border bg-surface p-1 shadow-soft">
        {TABS.map((t) => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                active ? 'bg-accent text-white' : 'text-muted hover:bg-accent-soft hover:text-accent'
              )}
            >
              <span className="material-symbols-outlined text-[18px]">{t.icon}</span>
              {t.label}
            </button>
          )
        })}
      </div>

      <Alert kind="error">{error}</Alert>
      <Alert kind="ok">{message}</Alert>

      {tab === 'courses' && (
        <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>New course</CardTitle>
              <CardDescription>Course codes are unique per college.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={createCourse} className="flex flex-col gap-4">
                <Field label="Code">
                  <Input
                    required
                    value={courseForm.code}
                    onChange={(e) => setCourseForm({ ...courseForm, code: e.target.value })}
                    placeholder="CS504"
                    className="num uppercase"
                  />
                </Field>
                <Field label="Name">
                  <Input
                    required
                    value={courseForm.name}
                    onChange={(e) => setCourseForm({ ...courseForm, name: e.target.value })}
                    placeholder="Operating Systems"
                  />
                </Field>
                <Field label="Credits">
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={courseForm.credits}
                    onChange={(e) => setCourseForm({ ...courseForm, credits: e.target.value })}
                    className="num"
                  />
                </Field>
                <Field label="Department">
                  <select
                    className={selectClass}
                    value={courseForm.departmentId}
                    onChange={(e) => setCourseForm({ ...courseForm, departmentId: e.target.value })}
                  >
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Teacher">
                  <select
                    className={selectClass}
                    value={courseForm.teacherId}
                    onChange={(e) => setCourseForm({ ...courseForm, teacherId: e.target.value })}
                  >
                    <option value="">Unassigned</option>
                    {teachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.regno} · {t.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Button type="submit" variant="accent" disabled={busy}>
                  <span className="material-symbols-outlined text-[18px]">add</span>
                  Add course
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Course catalogue</CardTitle>
              <CardDescription>
                <span className="num">{courses.length}</span> courses in your college
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-border text-xs uppercase tracking-wide text-muted">
                      <th className="px-4 py-2.5 text-left font-medium">Code</th>
                      <th className="px-4 py-2.5 text-left font-medium">Name</th>
                      <th className="px-4 py-2.5 text-left font-medium">Cr</th>
                      <th className="px-4 py-2.5 text-left font-medium">Teacher</th>
                      <th className="px-4 py-2.5 text-left font-medium">Enr</th>
                      <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {courses.length === 0 && (
                      <EmptyRow colSpan={6}>No courses yet. Create one on the left.</EmptyRow>
                    )}
                    {courses.map((c) => (
                      <tr key={c.id} className="border-b border-border last:border-0">
                        <td className="num px-4 py-3 font-medium text-foreground">{c.code}</td>
                        <td className="px-4 py-3 text-foreground">{c.name}</td>
                        <td className="num px-4 py-3 text-muted">{c.credits}</td>
                        <td className="px-4 py-3">
                          <select
                            className="h-9 rounded-lg border border-border-strong bg-surface px-2 text-xs text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                            value={c.teacherId ?? ''}
                            onChange={(e) => assignTeacher(c.id, e.target.value)}
                            disabled={busy}
                          >
                            <option value="">Unassigned</option>
                            {teachers.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.regno} · {t.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="num px-4 py-3 text-muted">{c._count.enrollments}</td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteCourse(c)}
                            disabled={busy}
                          >
                            <span className="material-symbols-outlined text-[18px]">delete</span>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'classes' && (
        <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>New class</CardTitle>
              <CardDescription>A section of students, e.g. CSE-A.</CardDescription>
            </CardHeader>
            <CardContent>
              {!canManageClasses ? (
                <p className="text-sm text-muted">
                  You need the <span className="num">class.manage</span> permission to create
                  classes.
                </p>
              ) : (
                <form onSubmit={createClass} className="flex flex-col gap-4">
                  <Field label="Name">
                    <Input
                      required
                      value={classForm.name}
                      onChange={(e) => setClassForm({ ...classForm, name: e.target.value })}
                      placeholder="CSE-B"
                    />
                  </Field>
                  <Field label="Department">
                    <select
                      className={selectClass}
                      value={classForm.departmentId}
                      onChange={(e) => setClassForm({ ...classForm, departmentId: e.target.value })}
                    >
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Semester">
                      <Input
                        type="number"
                        min={1}
                        max={12}
                        value={classForm.semester}
                        onChange={(e) => setClassForm({ ...classForm, semester: e.target.value })}
                        className="num"
                      />
                    </Field>
                    <Field label="Batch year">
                      <Input
                        type="number"
                        min={2000}
                        max={2100}
                        value={classForm.batchYear}
                        onChange={(e) => setClassForm({ ...classForm, batchYear: e.target.value })}
                        className="num"
                      />
                    </Field>
                  </div>
                  <Button type="submit" variant="accent" disabled={busy}>
                    <span className="material-symbols-outlined text-[18px]">add</span>
                    Add class
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Classes</CardTitle>
              <CardDescription>
                <span className="num">{classes.length}</span> sections
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-border text-xs uppercase tracking-wide text-muted">
                      <th className="px-4 py-2.5 text-left font-medium">Name</th>
                      <th className="px-4 py-2.5 text-left font-medium">Department</th>
                      <th className="px-4 py-2.5 text-left font-medium">Sem</th>
                      <th className="px-4 py-2.5 text-left font-medium">Batch</th>
                      <th className="px-4 py-2.5 text-left font-medium">Enr</th>
                      <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {classes.length === 0 && <EmptyRow colSpan={6}>No classes yet.</EmptyRow>}
                    {classes.map((k) => (
                      <tr key={k.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-3 font-medium text-foreground">{k.name}</td>
                        <td className="px-4 py-3 text-muted">{k.department.name}</td>
                        <td className="num px-4 py-3 text-muted">{k.semester}</td>
                        <td className="num px-4 py-3 text-muted">{k.batchYear}</td>
                        <td className="num px-4 py-3 text-muted">{k._count.enrollments}</td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteClass(k)}
                            disabled={busy || !canManageClasses}
                          >
                            <span className="material-symbols-outlined text-[18px]">delete</span>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'enrollments' && (
        <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Enroll a student</CardTitle>
              <CardDescription>A student can take a course only once.</CardDescription>
            </CardHeader>
            <CardContent>
              {!canManageEnrollments ? (
                <p className="text-sm text-muted">
                  You need the <span className="num">enrollment.manage</span> permission.
                </p>
              ) : (
                <form onSubmit={createEnrollment} className="flex flex-col gap-4">
                  <Field label="Student">
                    <select
                      className={selectClass}
                      value={enrollForm.studentId}
                      onChange={(e) => setEnrollForm({ ...enrollForm, studentId: e.target.value })}
                    >
                      {students.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.regno} · {s.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Course">
                    <select
                      className={selectClass}
                      value={enrollForm.courseId}
                      onChange={(e) => setEnrollForm({ ...enrollForm, courseId: e.target.value })}
                    >
                      {courses.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} · {c.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Class">
                    <select
                      className={selectClass}
                      value={enrollForm.classId}
                      onChange={(e) => setEnrollForm({ ...enrollForm, classId: e.target.value })}
                    >
                      {classes.map((k) => (
                        <option key={k.id} value={k.id}>
                          {k.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Button type="submit" variant="accent" disabled={enroll.pending}>
                    <span className="material-symbols-outlined text-[18px]">how_to_reg</span>
                    Enroll
                  </Button>

                  {/* A full section is an offer, not a failure. The message
                      comes from the server so the seat count is accurate. */}
                  {waitlistOffer ? (
                    <div className="rounded-xl border border-warning/30 bg-warning-soft/50 p-3">
                      <p className="text-xs leading-relaxed text-muted">{waitlistOffer}</p>
                      <Button
                        type="button"
                        className="mt-2 w-full"
                        disabled={enroll.pending}
                        onClick={(e) => createEnrollment(e, true)}
                      >
                        <span className="material-symbols-outlined text-[18px]">playlist_add</span>
                        Join waitlist
                      </Button>
                    </div>
                  ) : null}
                </form>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Enrollments</CardTitle>
              <CardDescription>
                <span className="num">{enrollments.length}</span> active enrollments
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-border text-xs uppercase tracking-wide text-muted">
                      <th className="px-4 py-2.5 text-left font-medium">Student</th>
                      <th className="px-4 py-2.5 text-left font-medium">Course</th>
                      <th className="px-4 py-2.5 text-left font-medium">Class</th>
                      <th className="px-4 py-2.5 text-left font-medium">Status</th>
                      <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enrollments.length === 0 && (
                      <EmptyRow colSpan={5}>No enrollments yet.</EmptyRow>
                    )}
                    {enrollments.map((e) => (
                      <tr key={e.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-3">
                          <span className="num font-medium text-foreground">{e.student.regno}</span>
                          <span className="ml-2 text-muted">{e.student.name}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="num text-foreground">{e.course.code}</span>
                          <span className="ml-2 text-muted">{e.course.name}</span>
                        </td>
                        <td className="px-4 py-3 text-muted">{e.class.name}</td>
                        <td className="px-4 py-3">
                          {e.status === 'WAITLISTED' ? (
                            <span className="num rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warning">
                              Waitlisted
                            </span>
                          ) : (
                            <span className="num rounded-full bg-success-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-success">
                              Enrolled
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => withdraw(e)}
                            disabled={withdrawMutation.pending || !canManageEnrollments}
                          >
                            <span className="material-symbols-outlined text-[18px]">
                              person_remove
                            </span>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
