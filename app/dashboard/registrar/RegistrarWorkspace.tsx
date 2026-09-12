'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState, Spinner } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { KpiCard } from '@/components/dashboard/kpi-card'
import { issueCertificate } from '@/lib/registrar-actions'
import { CERTIFICATE_TYPES } from '@/lib/certificates'
import { cn } from '@/lib/utils'

/**
 * Registrar workspace.
 *
 * Certificate issuance is the only mutation; it is a form + server action so
 * it degrades without JS. Newly issued certificates are prepended locally for
 * immediate feedback, then replaced by the refresh.
 */

interface Certificate {
  id: string
  type: string
  issuedAt: string
  fileUrl: string
  studentName: string
  studentRegno: string
}

interface Props {
  summary: {
    results: number
    averagePercent: number
    passRate: number
    students: number
    certificates: number
  }
  gradeBuckets: { grade: string; count: number; percent: number }[]
  certificates: Certificate[]
  byType: Record<string, number>
  students: { id: string; name: string; regno: string }[]
  recentResults: {
    id: string
    studentName: string
    studentRegno: string
    courseCode: string
    examName: string
    percent: number
    grade: string
  }[]
}

export function RegistrarWorkspace({
  summary,
  gradeBuckets,
  certificates,
  byType,
  students,
  recentResults,
}: Props) {
  const toast = useToast()
  const router = useRouter()
  const [pending, setPending] = React.useState(false)
  const [studentId, setStudentId] = React.useState('')
  const [type, setType] = React.useState<string>(CERTIFICATE_TYPES[0])
  const [issued, setIssued] = React.useState<Certificate[]>([])
  const [query, setQuery] = React.useState('')

  // Local-only rows shown until the server refresh replaces them.
  const all = React.useMemo(() => [...issued, ...certificates], [issued, certificates])

  const filteredStudents = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return students.slice(0, 20)
    return students
      .filter(
        (s) => s.name.toLowerCase().includes(q) || s.regno.toLowerCase().includes(q)
      )
      .slice(0, 20)
  }, [students, query])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!studentId) {
      toast.error('Pick a student', 'Select who the certificate is for.')
      return
    }

    setPending(true)
    let result: { ok: boolean; error?: string; certificateId?: string }
    try {
      result = await issueCertificate({ studentId, type })
    } catch {
      result = { ok: false, error: 'Network error — nothing was issued' }
    }
    setPending(false)

    if (!result.ok) {
      toast.error('Could not issue certificate', result.error)
      return
    }

    const student = students.find((s) => s.id === studentId)
    setIssued((current) => [
      {
        id: result.certificateId ?? `local-${Date.now()}`,
        type,
        issuedAt: new Date().toISOString().slice(0, 10),
        fileUrl: `/certificates/${student?.regno ?? 'new'}-${type.toLowerCase()}.pdf`,
        studentName: student?.name ?? 'Student',
        studentRegno: student?.regno ?? '—',
      },
      ...current,
    ])
    toast.success('Certificate issued', `${type} recorded in the audit log.`)
    router.refresh()
  }

  return (
    <div className="space-y-6">
      {/* ── KPI bento ─────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon="school" label="Students" value={summary.students} hint="on the register" />
        <KpiCard
          icon="quiz"
          label="Results"
          value={summary.results}
          hint="published this cycle"
        />
        <KpiCard
          icon="trending_up"
          label="Pass rate"
          value={`${summary.passRate}%`}
          hint={`avg ${summary.averagePercent}%`}
          tone={summary.passRate >= 60 ? 'success' : 'warning'}
        />
        <KpiCard
          icon="workspace_premium"
          label="Certificates"
          value={summary.certificates}
          hint="issued to date"
        />
      </div>

      {/* ── Issue + grade spread ──────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card id="issue" className="scroll-mt-24 lg:col-span-2">
          <CardHeader>
            <CardTitle>Issue a certificate</CardTitle>
            <CardDescription>
              Select a student and a type. The issuance is recorded in the audit log.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label
                  htmlFor="student-search"
                  className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-subtle"
                >
                  Student
                </label>
                <input
                  id="student-search"
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name or roll number"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
                {filteredStudents.length === 0 ? (
                  <p className="mt-2 text-xs text-muted">No student matches “{query}”.</p>
                ) : (
                  <select
                    aria-label="Student"
                    value={studentId}
                    onChange={(e) => setStudentId(e.target.value)}
                    className="mt-2 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                  >
                    <option value="">Select a student…</option>
                    {filteredStudents.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.regno} · {s.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label
                  htmlFor="cert-type"
                  className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-subtle"
                >
                  Type
                </label>
                <select
                  id="cert-type"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                >
                  {CERTIFICATE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              <Button type="submit" variant="accent" disabled={pending}>
                {pending ? <Spinner /> : null}
                Issue certificate
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Grade spread</CardTitle>
            <CardDescription>College-wide distribution</CardDescription>
          </CardHeader>
          <CardContent>
            {gradeBuckets.length === 0 ? (
              <EmptyState
                icon="insights"
                title="No results yet"
                description="Distribution appears once exams are scored."
              />
            ) : (
              <ul className="space-y-2">
                {gradeBuckets.map((b) => (
                  <li key={b.grade}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="num font-semibold text-foreground">{b.grade}</span>
                      <span className="num text-muted">
                        {b.count} · {b.percent}%
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-border">
                      <div
                        className="h-full rounded-full bg-accent transition-all"
                        style={{ width: `${Math.max(2, b.percent)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Certificates ──────────────────────────────────────────────────── */}
      <Card id="certificates" className="scroll-mt-24">
        <CardHeader>
          <CardTitle>Certificate register</CardTitle>
          <CardDescription>
            {all.length} issued ·{' '}
            {Object.entries(byType)
              .map(([t, n]) => `${n} ${t.toLowerCase()}`)
              .join(' · ') || 'none yet'}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {all.length === 0 ? (
            <div className="px-6">
              <EmptyState
                icon="workspace_premium"
                title="No certificates issued"
                description="Issue a certificate above and it will appear here."
              />
            </div>
          ) : (
            <div className="overflow-x-auto border-t border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-background text-[11px] uppercase tracking-wider text-subtle">
                  <tr>
                    <th className="px-6 py-2.5 font-medium">Student</th>
                    <th className="px-3 py-2.5 font-medium">Type</th>
                    <th className="px-3 py-2.5 font-medium">Issued</th>
                    <th className="px-6 py-2.5 font-medium">Reference</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {all.map((c) => (
                    <tr key={c.id} className="transition-colors hover:bg-background">
                      <td className="px-6 py-3">
                        <p className="font-medium text-foreground">{c.studentName}</p>
                        <p className="num text-[11px] text-subtle">{c.studentRegno}</p>
                      </td>
                      <td className="px-3 py-3">
                        <span className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-accent">
                          {c.type}
                        </span>
                      </td>
                      <td className="num px-3 py-3 text-muted">{c.issuedAt}</td>
                      <td className="num px-6 py-3 text-subtle">{c.fileUrl}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Recent results ────────────────────────────────────────────────── */}
      <Card className={cn('scroll-mt-24')} id="results">
        <CardHeader>
          <CardTitle>Recent results</CardTitle>
          <CardDescription>Latest published scores across the college</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {recentResults.length === 0 ? (
            <div className="px-6">
              <EmptyState
                icon="quiz"
                title="No published results"
                description="Results appear here once teachers publish exam scores."
              />
            </div>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {recentResults.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-6 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{r.studentName}</p>
                    <p className="num text-[11px] text-subtle">
                      {r.studentRegno} · {r.courseCode} · {r.examName}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="num text-sm font-semibold text-foreground">{r.percent}%</p>
                    <p className="num text-[10px] text-subtle">{r.grade}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
