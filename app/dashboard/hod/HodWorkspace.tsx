'use client'

import * as React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { LeaveQueue } from '@/components/dashboard/leave-queue'
import { KpiCard } from '@/components/dashboard/kpi-card'
import { cn } from '@/lib/utils'

/**
 * The HOD portal.
 *
 * The leave queue is the only writable surface, and it is shared with HR via
 * <LeaveQueue> so the optimistic update and audit path exist once. Everything
 * else here is read-only department reporting.
 */

interface Props {
  summary: {
    faculty: number
    students: number
    courses: number
    pendingLeave: number
    averagePercent: number
    gradedCount: number
  }
  faculty: {
    id: string
    name: string
    regno: string
    role: string
    designation: string
    salaryBand: string
    courseCount: number
    teachingLoad: number
  }[]
  courses: {
    id: string
    code: string
    name: string
    credits: number
    teacherName: string
    teacherRegno: string
    enrolled: number
    examCount: number
  }[]
  gradeBuckets: { grade: string; count: number; percent: number }[]
  leave: {
    id: string
    employeeName: string
    employeeRegno: string
    designation: string
    startDate: string
    endDate: string
    days: number
    reason: string
    status: string
    reviewedAt: string | null
  }[]
  canApproveLeave: boolean
}

export function HodWorkspace({
  summary,
  faculty,
  courses,
  gradeBuckets,
  leave,
  canApproveLeave,
}: Props) {
  const pendingLeave = leave.filter((r) => r.status === 'PENDING').length

  return (
    <div className="space-y-6">
      {/* ── KPI bento ─────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon="groups" label="Faculty" value={summary.faculty} hint="in your department" />
        <KpiCard icon="school" label="Students" value={summary.students} hint="enrolled" />
        <KpiCard icon="menu_book" label="Courses" value={summary.courses} hint="running this term" />
        <KpiCard
          icon="event_busy"
          label="Pending leave"
          value={pendingLeave}
          hint={pendingLeave === 1 ? 'awaiting a decision' : 'awaiting decisions'}
          tone={pendingLeave > 0 ? 'warning' : 'default'}
        />
      </div>

      {/* ── Leave queue ───────────────────────────────────────────────────── */}
      <div id="leave" className="scroll-mt-24">
        <LeaveQueue
          leave={leave}
          canApprove={canApproveLeave}
          description="Approve or reject requests from your department. Every decision is audited."
          emptyDescription="Requests from your department will appear here."
        />
      </div>

      {/* ── Faculty workload ──────────────────────────────────────────────── */}
      <div id="faculty" className="scroll-mt-24">
        <Card>
          <CardHeader>
            <CardTitle>Faculty</CardTitle>
            <CardDescription>
              Teaching load is the sum of credits across assigned courses.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {faculty.length === 0 ? (
              <div className="px-6">
                <EmptyState
                  icon="groups"
                  title="No faculty in this department"
                  description="Assign teachers to a department to see them here."
                />
              </div>
            ) : (
              <div className="overflow-x-auto border-t border-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-background text-[11px] uppercase tracking-wider text-subtle">
                    <tr>
                      <th className="px-6 py-2.5 font-medium">Name</th>
                      <th className="px-3 py-2.5 font-medium">Designation</th>
                      <th className="px-3 py-2.5 text-right font-medium">Courses</th>
                      <th className="px-6 py-2.5 text-right font-medium">Credits</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {faculty.map((f) => (
                      <tr key={f.id} className="transition-colors hover:bg-background">
                        <td className="px-6 py-3">
                          <p className="font-medium text-foreground">{f.name}</p>
                          <p className="num text-[11px] text-subtle">{f.regno}</p>
                        </td>
                        <td className="px-3 py-3 text-muted">
                          {f.designation}
                          <span className="num ml-2 text-[10px] text-subtle">{f.salaryBand}</span>
                        </td>
                        <td className="num px-3 py-3 text-right text-foreground">{f.courseCount}</td>
                        <td className="num px-6 py-3 text-right text-foreground">
                          {f.teachingLoad}
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

      {/* ── Courses + performance ─────────────────────────────────────────── */}
      <div id="courses" className="scroll-mt-24 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Courses</CardTitle>
            <CardDescription>{courses.length} running in your department</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {courses.length === 0 ? (
              <div className="px-6">
                <EmptyState
                  icon="menu_book"
                  title="No courses yet"
                  description="Create a course to see it here."
                />
              </div>
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {courses.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-6 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        <span className="num text-accent">{c.code}</span> · {c.name}
                      </p>
                      <p className="text-xs text-muted">
                        {c.teacherName} <span className="num text-subtle">{c.teacherRegno}</span>
                      </p>
                    </div>
                    <div className="num shrink-0 text-right text-[11px] text-subtle">
                      <span className="text-foreground">{c.enrolled}</span> enrolled · {c.credits} cr
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Grade spread</CardTitle>
            <CardDescription>
              {summary.gradedCount} graded results · avg{' '}
              <span className="num">{summary.averagePercent}%</span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {gradeBuckets.length === 0 ? (
              <EmptyState
                icon="insights"
                title="No results yet"
                description="Grade distribution appears once exams are scored."
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
    </div>
  )
}
